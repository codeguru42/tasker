import { describe, expect, it } from "vitest";
import { verify } from "../../src/commands/verify.js";
import { transitionTask } from "../../src/state/machine.js";
import { verifyRunDir } from "../../src/store/layout.js";
import { landBranchOnOriginMain, commitInWorktree } from "../helpers/git.js";
import { updateBranch } from "../../src/commands/update-branch.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { latestTaskOf, withDataRootStore } from "../helpers/store.js";
import {
  expectCommandRefused,
  landParent,
  moveTaskThrough,
  startIssueTask,
  TO_WORK_REVIEW,
  useChainedTasks,
  useStackedTasks,
  useStartFixture,
  useVerifyFixture,
} from "../helpers/task-fixtures.js";
import { wrongStateError } from "../helpers/state-commands.js";

const KEY = "codeguru42/tasker#5";

const runVerify = (key = KEY, ...extra: string[]) => runCommand(verify, "verify", key, ...extra);

describe("tasker verify", () => {
  it("prints the run, the command count and the logs folder of a pass", async () => {
    const fixture = await useVerifyFixture({ commands: ["true", "echo hi"] });

    const result = await runVerify();

    expect(result).toEqual({
      code: 0,
      out: [
        `verified ${KEY}: run 1`,
        "commands: 2",
        `logs: ${verifyRunDir(fixture.started.dataRoot, fixture.task, 1)}`,
        "",
      ].join("\n"),
      err: "",
    });
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("awaiting_work_review");
  });

  it("refuses a task that is not in executed, with the message on stderr and no state change", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    withDataRootStore(fixture.started.dataRoot, (store) => transitionTask(store, fixture.task.id, "updating_branch"));

    const result = await runVerify();

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `${wrongStateError("updating_branch", KEY, "verify", "executed")}\n`,
    });
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("updating_branch");
  });

  it("refuses a stacked task whose parent landed until update-branch moves it", async () => {
    const fixture = await useStackedTasks({ repo: { verify: { commands: ["true"], env: [] } } });
    await landParent(fixture, ["accepted", "landed"]);
    const key = fixture.stacked.key;

    await expectCommandRefused(
      { dataRoot: fixture.dataRoot, key },
      () => runVerify(key),
      `the parent ${fixture.parent.key} of ${key} has landed; run tasker update-branch ${key} to move the task onto main first\n`,
    );

    expect((await runCommand(updateBranch, "update-branch", key)).code).toBe(0);
    expect((await runVerify(key)).code).toBe(0);
    expect(latestTaskOf(fixture.dataRoot, key).state).toBe("awaiting_work_review");
  });

  it("refuses a task whose chain of parents has a loop", async () => {
    const fixture = await useChainedTasks({ repo: { verify: { commands: ["true"], env: [] } } });
    await landParent(fixture, ["accepted", "landed"]);
    const key = fixture.stacked.key;
    withDataRootStore(fixture.dataRoot, (store) =>
      store.updateTask(fixture.parent.task.id, { parentTaskId: fixture.stacked.task.id }),
    );

    await expectCommandRefused(
      { dataRoot: fixture.dataRoot, key },
      () => runVerify(key),
      `the chain of parents of ${key} has a loop at ${key}; nothing moved\n`,
    );
    expect(latestTaskOf(fixture.dataRoot, key).state).toBe("executed");
  });

  describe("a task that starts on the branch of an earlier task", () => {
    const PARENT = "codeguru42/tasker#5";
    const CHILD = "codeguru42/tasker#6";

    // Starts the task of issue 5, moves it to states, then starts the task of issue 6 on its branch and moves it to
    // executed.
    async function startOnBranchOfParent(parentStates: Parameters<typeof moveTaskThrough>[2], landOnOrigin = false) {
      const fixture = await useStartFixture({
        issues: [5, 6].map((number) => ({ project: "codeguru42/tasker", number })),
        repo: { verify: { commands: ["true"], env: [] } },
      });
      const parent = await startIssueTask(fixture, 5);
      expect(parent.result.code).toBe(0);
      if (landOnOrigin) {
        await landBranchOnOriginMain({
          origin: fixture.origin.path,
          clone: parent.clone,
          branch: parent.branch,
          env: fixture.origin.env,
        });
      }
      withDataRootStore(fixture.dataRoot, (store) => {
        const id = store.findLatestTask(fixture.repoKey, PARENT)!.id;
        moveTaskThrough(store, id, TO_WORK_REVIEW);
        if (parentStates.length > 0) moveTaskThrough(store, id, parentStates);
      });
      const child = await startIssueTask(fixture, 6, "--base", `refs/heads/${parent.branch}`);
      expect(child.result.code).toBe(0);
      await commitInWorktree(child.worktree, fixture.origin.env, { file: "child.txt" });
      withDataRootStore(fixture.dataRoot, (store) => {
        moveTaskThrough(store, store.findLatestTask(fixture.repoKey, CHILD)!.id, TO_WORK_REVIEW.slice(0, 5));
      });
      return fixture;
    }

    it("verifies when the earlier task finished", async () => {
      const fixture = await startOnBranchOfParent(["accepted", "landed", "finishing", "finished"]);

      const result = await runVerify(CHILD);

      expect(result.code).toBe(0);
      expect(latestTaskOf(fixture.dataRoot, CHILD).state).toBe("awaiting_work_review");
    });

    it("refuses when the earlier task landed, until update-branch moves it", async () => {
      const fixture = await startOnBranchOfParent(["accepted", "landed"], true);

      await expectCommandRefused(
        { dataRoot: fixture.dataRoot, key: CHILD },
        () => runVerify(CHILD),
        `the parent ${PARENT} of ${CHILD} has landed; run tasker update-branch ${CHILD} to move the task onto main first\n`,
      );

      expect((await runCommand(updateBranch, "update-branch", CHILD)).code).toBe(0);
      expect((await runVerify(CHILD)).code).toBe(0);
    });
  });

  it("prints the description of the command and of --repo for --help", async () => {
    const { code, help } = await runHelp(verify, "verify");

    expect(code).toBe(0);
    expect(help).toContain(
      "Run the verify commands of the repo in the worktree of a task in executed and record the run: the task goes through verifying to awaiting_work_review, or to failed",
    );
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
  });
});
