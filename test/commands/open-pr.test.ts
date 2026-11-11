import { describe, expect, it } from "vitest";
import { delimiter } from "node:path";
import { run } from "../../src/cli.js";
import { openPr } from "../../src/commands/open-pr.js";
import { captureIo, runCommand, runHelp } from "../helpers/cli.js";
import { copyCloneBranchToOrigin, gitRecorderEnv, recordedPushCalls } from "../helpers/git.js";
import { useFakeClaudeOnPath } from "../helpers/fake-claude.js";
import {
  installForgeGh,
  openPrListArgs,
  openPrTokenAnswer,
  OPEN_PR_FORGE_ACCOUNT as ACCOUNT,
  OPEN_PR_FORGE_TOKEN as TOKEN,
} from "../helpers/forge-gh.js";
import {
  databasePathOf,
  eventsOf,
  latestTaskOf,
  readRunMarker,
  seedDeadRun,
  withDataRootStore,
  writeRunMarker,
} from "../helpers/store.js";
import { useAcceptedTask } from "../helpers/task-fixtures.js";
import { useDefaultConfigHome } from "../helpers/config.js";
import { forgeGh } from "../helpers/forge-gh.js";
import { spawnTasker } from "../helpers/processes.js";
import { deadRunNote } from "../helpers/state-commands.js";
import { useProcessEnv, useTempDir } from "../helpers/temp.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

const tokenAnswer = openPrTokenAnswer();

describe("tasker open-pr", () => {
  it("uses PATH and HOME from the child environment for GitHub calls", async () => {
    const accepted = await useAcceptedTask({ repo: { forge: { provider: "github", account: ACCOUNT } } });
    await copyCloneBranchToOrigin({
      origin: accepted.origin.path,
      clone: accepted.clone,
      branch: accepted.task.branch!,
      env: accepted.env,
    });
    withDataRootStore(accepted.dataRoot, (store) =>
      store.updateTask(accepted.task.id, {
        state: "pushed",
        publishedRevision: accepted.revision,
        prNumber: null,
      }),
    );
    const url = "https://github.com/codeguru42/tasker/pull/42";
    const fake = forgeGh(
      useTempDir("tasker-open-pr-default-environment-"),
      TOKEN,
      [
        tokenAnswer,
        {
          args: openPrListArgs(accepted.task.branch!),
          stdout: JSON.stringify([{ number: 42, url, baseRefName: "main", isCrossRepository: false }]),
        },
      ],
      ["PATH", "HOME"],
    );
    const home = useDefaultConfigHome(accepted.configPath);
    const path = [fake.env.PATH, process.env.PATH].filter((part): part is string => part !== undefined).join(delimiter);

    const result = await spawnTasker(
      ["open-pr", KEY, "--repo", REPO],
      {
        PATH: path,
        HOME: home,
      },
      { replaceEnv: true },
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`adopted PR #42: ${url}`);
    expect(latestTaskOf(accepted.dataRoot, KEY)).toMatchObject({ state: "in_peer_review", prNumber: 42 });
    expect(fake.calls().map(({ args }) => args)).toEqual([tokenAnswer.args, openPrListArgs(accepted.task.branch!)]);
    expect(fake.calls()[0]?.env).toEqual({ PATH: `set:${path}`, HOME: `set:${home}` });
  });

  it("shows its issue argument and repo option", async () => {
    const { code, help } = await runHelp(openPr, "open-pr");

    expect(code).toBe(0);
    expect(help).toContain("<issue>");
    expect(help).toContain("--repo <key>");
  });

  it("publishes through push, then adopts the matching PR without creating another", async () => {
    const accepted = await useAcceptedTask({ repo: { forge: { provider: "github", account: ACCOUNT } } });
    const url = "https://github.com/codeguru42/tasker/pull/42";
    withDataRootStore(accepted.dataRoot, (store) => store.updateTask(accepted.task.id, { prNumber: 42 }));
    const listArgs = openPrListArgs(accepted.task.branch!);
    const fake = installForgeGh(
      [
        tokenAnswer,
        {
          args: listArgs,
          stdout: JSON.stringify([{ number: 42, url, baseRefName: "main", isCrossRepository: false }]),
        },
      ],
      "tasker-open-pr-forge-gh-",
    );
    const publishIo = captureIo();
    const published = await run(["push", KEY, "--repo", REPO], { io: publishIo });
    expect(published).toBe(0);
    expect(publishIo.out.join("")).toBe(`pushed ${accepted.task.branch!} at ${accepted.revision}\nstate: pushed\n`);
    expect(latestTaskOf(accepted.dataRoot, KEY)).toMatchObject({ state: "pushed", prNumber: 42 });
    expect(fake.calls()).toEqual([]);
    const output = captureIo();
    const opened = await run(["open-pr", KEY, "--repo", REPO], { io: output });

    expect(opened).toBe(0);
    expect(output.out.join("")).toBe(`adopted PR #42: ${url}\nstate: in_peer_review\n`);
    expect(latestTaskOf(accepted.dataRoot, KEY)).toMatchObject({ state: "in_peer_review", prNumber: 42 });
    expect(fake.calls().map(({ args }) => args)).toEqual([tokenAnswer.args, listArgs]);
    expect(fake.calls()[0]?.tokenMatches).toBe(false);
    expect(fake.calls()[1]?.tokenMatches).toBe(true);
    expect(JSON.stringify(fake.calls())).not.toContain(TOKEN);
  });

  it("does not publish, run an assistant, wait for CI, merge, or detect PR state", async () => {
    const accepted = await useAcceptedTask({ repo: { forge: { provider: "github", account: ACCOUNT } } });
    await copyCloneBranchToOrigin({
      origin: accepted.origin.path,
      clone: accepted.clone,
      branch: accepted.task.branch!,
      env: accepted.env,
    });
    withDataRootStore(accepted.dataRoot, (store) =>
      store.updateTask(accepted.task.id, { state: "pushed", publishedRevision: accepted.revision }),
    );
    const listArgs = openPrListArgs(accepted.task.branch!);
    const url = "https://github.com/codeguru42/tasker/pull/44";
    const fake = installForgeGh(
      [
        tokenAnswer,
        {
          args: listArgs,
          stdout: JSON.stringify([{ number: 44, url, baseRefName: "main", isCrossRepository: false }]),
        },
      ],
      "tasker-open-pr-forge-gh-",
    );
    const claude = useFakeClaudeOnPath({});
    const recorder = gitRecorderEnv(useTempDir("tasker-open-pr-git-log-"), process.env);
    useProcessEnv(recorder.env);

    const result = await runCommand(openPr, "open-pr", KEY, "--repo", REPO);

    expect(result).toEqual({ code: 0, out: `adopted PR #44: ${url}\nstate: in_peer_review\n`, err: "" });
    expect(fake.calls().map(({ args }) => args)).toEqual([tokenAnswer.args, listArgs]);
    expect(recordedPushCalls(recorder.log)).toEqual([]);
    expect(claude.calls()).toEqual([]);
  });

  it("refuses a live opening marker and leaves it in place", async () => {
    const accepted = await useAcceptedTask({ repo: { forge: { provider: "github", account: ACCOUNT } } });
    const markerPath = databasePathOf(accepted.dataRoot);
    withDataRootStore(accepted.dataRoot, (store) =>
      store.updateTask(accepted.task.id, { state: "pushed", publishedRevision: accepted.revision }),
    );
    writeRunMarker(markerPath, accepted.task.id, "opening_pr", process.pid);
    const before = eventsOf(accepted.dataRoot, KEY);
    const marker = readRunMarker(markerPath, accepted.task.id);
    const fake = installForgeGh([], "tasker-open-pr-forge-gh-");

    const result = await runCommand(openPr, "open-pr", KEY, "--repo", REPO);

    expect(result.code).toBe(1);
    expect(result.err).toContain("already has a run marker: state opening_pr");
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("pushed");
    expect(eventsOf(accepted.dataRoot, KEY)).toEqual(before);
    expect(readRunMarker(markerPath, accepted.task.id)).toEqual(marker);
    expect(fake.calls()).toEqual([]);
  });

  it("moves a dead opening marker to interrupted and gives recovery guidance", async () => {
    const accepted = await useAcceptedTask({ repo: { forge: { provider: "github", account: ACCOUNT } } });
    seedDeadRun(accepted.dataRoot, accepted.task.id, "opening_pr");
    const fake = installForgeGh([], "tasker-open-pr-forge-gh-");

    const result = await runCommand(openPr, "open-pr", KEY, "--repo", REPO);

    expect(result.code).toBe(1);
    expect(result.err).toBe(
      `${deadRunNote(KEY, "opening_pr")}\nthe task of ${KEY} is in interrupted; tasker open-pr needs pushed. next: tasker resume ${KEY} (also: tasker abort ${KEY})\n`,
    );
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("interrupted");
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
    expect(fake.calls()).toEqual([]);
  });

  it("excludes fork PRs before creating on the configured forge account", async () => {
    const accepted = await useAcceptedTask({ repo: { forge: { provider: "github", account: ACCOUNT } } });
    await copyCloneBranchToOrigin({
      origin: accepted.origin.path,
      clone: accepted.clone,
      branch: accepted.task.branch!,
      env: accepted.env,
    });
    withDataRootStore(accepted.dataRoot, (store) =>
      store.updateTask(accepted.task.id, { state: "pushed", publishedRevision: accepted.revision }),
    );
    const listArgs = openPrListArgs(accepted.task.branch!);
    const url = "https://github.com/codeguru42/tasker/pull/43";
    const createArgs = [
      "pr",
      "create",
      "--head",
      accepted.task.branch!,
      "--base",
      "main",
      "--title",
      `${accepted.task.title ?? KEY} (${KEY})`,
      "--body",
      `Task: ${KEY}\n\n${accepted.task.title ?? KEY}`,
    ];
    const fake = installForgeGh(
      [
        tokenAnswer,
        {
          args: listArgs,
          stdout: JSON.stringify([
            { number: 55, url: "https://github.com/fork/tasker/pull/55", baseRefName: "main", isCrossRepository: true },
          ]),
        },
        { args: createArgs, stdout: `${url}\n` },
      ],
      "tasker-open-pr-forge-gh-",
    );
    const result = await runCommand(openPr, "open-pr", KEY, "--repo", REPO);

    expect(result).toEqual({ code: 0, out: `opened PR #43: ${url}\nstate: in_peer_review\n`, err: "" });
    expect(latestTaskOf(accepted.dataRoot, KEY)).toMatchObject({ state: "in_peer_review", prNumber: 43 });
    expect(fake.calls().map(({ args }) => args)).toEqual([tokenAnswer.args, listArgs, createArgs]);
    expect(fake.calls()[0]?.tokenMatches).toBe(false);
    expect(fake.calls()[1]?.tokenMatches).toBe(true);
    expect(fake.calls()[2]?.tokenMatches).toBe(true);
    expect(JSON.stringify(fake.calls())).not.toContain(TOKEN);
  });

  it("does not expose the forge token when lookup fails", async () => {
    const accepted = await useAcceptedTask({ repo: { forge: { provider: "github", account: ACCOUNT } } });
    await copyCloneBranchToOrigin({
      origin: accepted.origin.path,
      clone: accepted.clone,
      branch: accepted.task.branch!,
      env: accepted.env,
    });
    withDataRootStore(accepted.dataRoot, (store) =>
      store.updateTask(accepted.task.id, { state: "pushed", publishedRevision: accepted.revision }),
    );
    const listArgs = openPrListArgs(accepted.task.branch!);
    const fake = installForgeGh(
      [tokenAnswer, { args: listArgs, stderr: `lookup failed with ${TOKEN}`, exitCode: 1 }],
      "tasker-open-pr-forge-gh-",
    );

    const result = await runCommand(openPr, "open-pr", KEY, "--repo", REPO);

    expect(result.code).toBe(1);
    expect(result.err).toContain("lookup failed");
    expect(result.err).not.toContain(TOKEN);
    expect(fake.calls()[0]?.tokenMatches).toBe(false);
    expect(fake.calls()[1]?.tokenMatches).toBe(true);
    expect(JSON.stringify(fake.calls())).not.toContain(TOKEN);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("failed");
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("refuses a task without forge configuration", async () => {
    const accepted = await useAcceptedTask();
    await copyCloneBranchToOrigin({
      origin: accepted.origin.path,
      clone: accepted.clone,
      branch: accepted.task.branch!,
      env: accepted.env,
    });
    withDataRootStore(accepted.dataRoot, (store) =>
      store.updateTask(accepted.task.id, { state: "pushed", publishedRevision: accepted.revision }),
    );
    const result = await runCommand(openPr, "open-pr", KEY, "--repo", REPO);

    expect(result.code).toBe(1);
    expect(result.err).toContain(`repo "${REPO}" has no forge configuration`);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("pushed");
  });
});
