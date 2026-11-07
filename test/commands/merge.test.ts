import { renameSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accept } from "../../src/commands/accept.js";
import { merge } from "../../src/commands/merge.js";
import { updateBranch } from "../../src/commands/update-branch.js";
import { failedFrom } from "../../src/state/machine.js";
import { taskLockName } from "../../src/store/locks.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { commitInWorktree, gitOutput } from "../helpers/git.js";
import { installMergeForgeGh, openPrTokenAnswer } from "../helpers/forge-gh.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  eventsOf,
  lastErrorOf,
  latestTaskOf,
  readRunMarker,
  placeTask,
  withDataRootStore,
} from "../helpers/store.js";
import {
  expectCommandRefused,
  landAcceptedTask,
  seedAcceptedTask,
  unacceptedTipError,
  useAcceptedTask,
  usePeerReviewTask,
  useAcceptedTaskWithNoRevision,
  useStartFixture,
  useWorkReviewTask,
  type StartFixture,
} from "../helpers/task-fixtures.js";
import { wrongStateError } from "../helpers/state-commands.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

const runMerge = (key = KEY) => runCommand(merge, "merge", key, "--repo", REPO);

// Runs merge, expects a refusal that changes nothing, and expects no run marker and the same head of main on origin.
const expectRefused = async (fixture: Pick<StartFixture, "dataRoot" | "origin">, error: string | RegExp) => {
  const head = await fixture.origin.branchHead("main");

  await expectCommandRefused({ dataRoot: fixture.dataRoot, key: KEY }, runMerge, error);

  expect(readRunMarker(databasePathOf(fixture.dataRoot), latestTaskOf(fixture.dataRoot, KEY).id)).toBeUndefined();
  expect(await fixture.origin.branchHead("main")).toBe(head);
};

describe("tasker merge", () => {
  it("prints the exact success lines after a newly requested merge", async () => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const forge = installMergeForgeGh(
      [
        openPrTokenAnswer(),
        { args: ["pr", "merge", "42", "--merge", "--match-head-commit", fixture.publishedRevision] },
      ],
      "tasker-merge-requested-",
    );
    forge.setMergeStates(["OPEN", "MERGED"]);
    const result = await runMerge();
    expect(result).toEqual({ code: 0, out: `merged ${KEY}\nlanded PR #42 through github\nstate: landed\n`, err: "" });
    expect(forge.calls().filter(({ args }) => args[1] === "merge")).toHaveLength(1);
    expect(eventsOf(fixture.dataRoot, KEY).at(-1)).toMatchObject({
      type: "merged",
      data: { forge: "github", expectedHead: fixture.publishedRevision, requested: true },
    });
  });

  it("refuses an atomic expected-head mismatch without landing", async () => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const forge = installMergeForgeGh([openPrTokenAnswer()], "tasker-merge-head-");
    forge.setMergeState("OPEN");
    forge.setRemoteHead("changed-remote-head");
    const result = await runMerge();
    expect(result.code).toBe(1);
    expect(result.err).toContain("--match-head-commit does not match the current remote head");
    expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ state: "failed", mergeOrigin: "in_peer_review" });
    expect(eventsOf(fixture.dataRoot, KEY).some(({ type }) => type === "merged")).toBe(false);
    expect(forge.calls().filter(({ args }) => args[1] === "merge")).toHaveLength(1);
  });

  it("names the independent forge account when authentication fails without printing its token", async () => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const forge = installMergeForgeGh(
      [{ args: openPrTokenAnswer().args, exitCode: 1, stderr: "fixture authentication refused" }],
      "tasker-merge-auth-",
    );
    const result = await runMerge();
    expect(result.code).toBe(1);
    expect(result.err).toContain("forge-team");
    expect(result.out + result.err).not.toContain("forge-token-private");
    expect(forge.calls().map(({ args }) => args)).toEqual([openPrTokenAnswer().args]);
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("failed");
  });

  it("reports an already merged PR and lands the peer-review task", async () => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const forge = installMergeForgeGh([openPrTokenAnswer()], "tasker-merge-command-forge-");
    forge.setMergeState("MERGED");
    withDataRootStore(fixture.dataRoot, (store) => store.updateTask(fixture.task.id, { worktreePath: null }));

    const result = await runMerge();

    expect(result.code).toBe(0);
    expect(result.out).toBe(`merged ${KEY}\nlanded PR #42 through github\nstate: landed\n`);
    expect(result.err).toBe("");
    expect(forge.calls().map(({ args }) => args)).toEqual([
      ["auth", "token", "--user", "forge-team"],
      ["pr", "view", "42", "--json", "state"],
    ]);
    expect(forge.calls()[0].tokenMatches).toBe(false);
    expect(forge.calls()[1].tokenMatches).toBe(true);
    expect(JSON.stringify(forge.calls())).not.toContain("forge-token-private");
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("landed");
    forge.assertAnswered();
  });

  it("lands the work on the base of origin and moves the task to landed", async () => {
    const accepted = await useAcceptedTask();
    const before = eventsOf(accepted.dataRoot, KEY);

    const result = await runMerge();

    expect(result).toEqual({
      code: 0,
      out: `merged ${KEY}\nlanded: ${accepted.revision} on origin/main\n`,
      err: "",
    });
    expect(await accepted.origin.branchHead("main")).toBe(accepted.revision);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("landed");
    const events = eventsOf(accepted.dataRoot, KEY);
    expect(events.slice(0, before.length)).toEqual(before);
    expect(events.slice(before.length)).toMatchObject([
      { type: "transition", data: { from: "accepted", to: "merging" } },
      {
        type: "landed",
        data: { revision: accepted.revision, base: "main", pushed: true, from: "merging", to: "landed" },
      },
    ]);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("pushes nothing when the work is already on the base", async () => {
    const accepted = await useAcceptedTask();
    await landAcceptedTask(accepted);

    const result = await runMerge();

    expect(result).toEqual({
      code: 0,
      out: `merged ${KEY}\nalready on origin/main: ${accepted.revision}. Nothing pushed.\n`,
      err: "",
    });
    expect(eventsOf(accepted.dataRoot, KEY).at(-1)).toMatchObject({
      type: "landed",
      data: { revision: accepted.revision, base: "main", pushed: false, from: "merging", to: "landed" },
    });
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("landed");
    expect(await accepted.origin.branchHead("main")).toBe(accepted.revision);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("fails the task from merging when the base moved on origin after accept", async () => {
    const accepted = await useAcceptedTask();
    const tip = await accepted.origin.addCommit("main");

    const result = await runMerge();

    const error = `merging failed: cannot land ${accepted.revision} on the base branch: main: the revision does not build on the tip of the base on origin: ${tip}`;
    expect(result).toEqual({ code: 1, out: "", err: `${error}\n` });
    expect(lastErrorOf(accepted.dataRoot, accepted.task.id)).toBe(error);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("failed");
    withDataRootStore(accepted.dataRoot, (store) => expect(failedFrom(store, accepted.task.id)).toBe("merging"));
    expect(await accepted.origin.branchHead("main")).toBe(tip);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("fails the task from merging when the fetch fails", async () => {
    const accepted = await useAcceptedTask();
    const head = await accepted.origin.branchHead("main");
    renameSync(accepted.origin.path, `${accepted.origin.path}-moved`);

    const result = await runMerge();

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err.startsWith("merging failed: ")).toBe(true);
    expect(lastErrorOf(accepted.dataRoot, accepted.task.id)).toBe(result.err.trimEnd());
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("failed");
    withDataRootStore(accepted.dataRoot, (store) => expect(failedFrom(store, accepted.task.id)).toBe("merging"));
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
    const moved = await gitOutput(
      { gitDir: `${accepted.origin.path}-moved` },
      accepted.env,
      "rev-parse",
      "refs/heads/main",
    );
    expect(moved).toBe(head);
  });

  describe("refusals", () => {
    it("refuses a task that is not in accepted", async () => {
      const work = await useWorkReviewTask();

      await expectRefused(
        work,
        `${wrongStateError("awaiting_work_review", KEY, "merge", "accepted or in_peer_review")}\n`,
      );
    });

    it("refuses a task with no branch", async () => {
      const fixture = await useStartFixture();
      seedAcceptedTask(fixture);

      await expectRefused(fixture, `the task of ${KEY} has no branch\n`);
    });

    it("refuses a task with no base", async () => {
      const fixture = await useStartFixture();
      seedAcceptedTask(fixture, { branch: "tasker/five" });

      await expectRefused(fixture, `the task of ${KEY} has no base\n`);
    });

    it("refuses a base that is a local branch of the clone", async () => {
      const fixture = await useStartFixture();
      seedAcceptedTask(fixture, { branch: "tasker/five", base: "refs/heads/x" });

      await expectRefused(
        fixture,
        `the base of ${KEY} is a local branch of the clone: refs/heads/x; tasker merge pushes only to a branch on origin\n`,
      );
    });

    it("refuses a tip that is not the accepted revision", async () => {
      const accepted = await useAcceptedTask();
      const tip = await commitInWorktree(accepted.task.worktreePath!, accepted.env, { file: "late.txt" });

      await expectRefused(accepted, `${unacceptedTipError(accepted.task.branch!, tip, accepted.revision)}\n`);
      expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("accepted");
    });

    it("refuses a task with no accepted revision", async () => {
      const work = await useAcceptedTaskWithNoRevision();

      await expectRefused(work, `the task of ${KEY} has no accepted revision\n`);
    });

    it("fails at once when another process holds the task lock", async () => {
      const accepted = await useAcceptedTask();
      const name = taskLockName(REPO, KEY);
      const holder = startLockHolder(databasePathOf(accepted.dataRoot), name);
      await holder.attempt;

      await expectRefused(accepted, new RegExp(`^the lock ${name} is busy`));
    });
  });

  it("lands the new tip after update-branch and a new accept", async () => {
    const accepted = await useAcceptedTask();
    const tip = await commitInWorktree(accepted.task.worktreePath!, accepted.env, { file: "late.txt" });
    await expectRefused(accepted, `${unacceptedTipError(accepted.task.branch!, tip, accepted.revision)}\n`);

    const updated = await runCommand(updateBranch, "update-branch", KEY, "--repo", REPO);
    expect(updated.code).toBe(0);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("executed");
    withDataRootStore(accepted.dataRoot, (store) => placeTask(store, accepted.task.id, "awaiting_work_review"));
    const accepting = await runCommand(accept, "accept", KEY, "--repo", REPO);
    expect(accepting.code).toBe(0);
    const merged = await runMerge();

    expect(merged.code).toBe(0);
    expect(await accepted.origin.branchHead("main")).toBe(tip);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("landed");
  });

  it("prints the description of the command and of --repo for --help", async () => {
    const { code, help } = await runHelp(merge, "merge");

    expect(code).toBe(0);
    expect(help).toContain(
      "Merge a task in accepted on the base branch of origin with one fast-forward push, or merge its recorded PR in in_peer_review after the forge confirms the merge. tasker does not wait for CI",
    );
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
  });
});
