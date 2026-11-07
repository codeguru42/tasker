import { describe, expect, it } from "vitest";
import { run } from "../../src/cli.js";
import { openPr } from "../../src/commands/open-pr.js";
import { captureIo, runCommand, runHelp } from "../helpers/cli.js";
import { copyCloneBranchToOrigin } from "../helpers/git.js";
import {
  installOpenPrForgeGh,
  openPrListArgs,
  openPrTokenAnswer,
  OPEN_PR_FORGE_ACCOUNT as ACCOUNT,
  OPEN_PR_FORGE_TOKEN as TOKEN,
} from "../helpers/forge-gh.js";
import { databasePathOf, latestTaskOf, readRunMarker, withDataRootStore } from "../helpers/store.js";
import { useAcceptedTask } from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

const tokenAnswer = openPrTokenAnswer();

describe("tasker open-pr", () => {
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
    const fake = installOpenPrForgeGh(
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
    const fake = installOpenPrForgeGh(
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
    const fake = installOpenPrForgeGh(
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
