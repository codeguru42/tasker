import { describe, expect, it } from "vitest";
import { accept } from "../../src/commands/accept.js";
import { markLanded } from "../../src/commands/mark-landed.js";
import { merge } from "../../src/commands/merge.js";
import { updateBranch } from "../../src/commands/update-branch.js";
import { deleteTaskBranch, removeTaskWorktree } from "../../src/vcs/git/worktree.js";
import { runCommand } from "../helpers/cli.js";
import { gitOutput } from "../helpers/git.js";
import { latestTaskOf, placeTask, withDataRootStore } from "../helpers/store.js";
import { expectCommandRefused, landParent, useStackedTasks, type StackedTasks } from "../helpers/task-fixtures.js";

const REPO = "codeguru42/tasker";
const PARENT = "codeguru42/tasker#5";
const STACKED = "codeguru42/tasker#6";

const NOT_LANDED = `the parent ${PARENT} of ${STACKED} has not landed; land the parent first, then run tasker update-branch ${STACKED}\n`;
const LANDED = `the parent ${PARENT} of ${STACKED} has landed; run tasker update-branch ${STACKED} to move the task onto main first\n`;
const CANCELLED = `the parent ${PARENT} of ${STACKED} is cancelled; ${STACKED} cannot land on it\n`;

const run = (command: typeof merge, name: string) => () => runCommand(command, name, STACKED, "--repo", REPO);

// Lands the parent on main, finishes its task, then removes its worktree and its branch.
async function landAndDropParent(fixture: StackedTasks): Promise<void> {
  await landParent(fixture, ["accepted", "landed", "finishing", "finished"]);
  await removeTaskWorktree({ clone: fixture.clone, env: fixture.env, path: fixture.parent.worktree });
  await deleteTaskBranch({ clone: fixture.clone, env: fixture.env, branch: fixture.parent.branch });
}

const LANDING_COMMANDS = [
  ["merge", merge],
  ["mark-landed", markLanded],
] as const;

describe.each(LANDING_COMMANDS)("tasker %s for a stacked task", (name, command) => {
  const runIt = run(command, name);

  // Expects a refusal that changes nothing and leaves main on origin where it was.
  async function expectRefused(fixture: StackedTasks, error: string): Promise<void> {
    const head = await fixture.origin.branchHead("main");
    await expectCommandRefused({ dataRoot: fixture.dataRoot, key: STACKED }, runIt, error);
    expect(await fixture.origin.branchHead("main")).toBe(head);
  }

  it("refuses a stacked task while its parent is in flight", async () => {
    const fixture = await useStackedTasks();
    withDataRootStore(fixture.dataRoot, (store) => placeTask(store, fixture.stacked.task.id, "accepted"));

    await expectRefused(fixture, NOT_LANDED);
  });

  it("refuses a stacked task with no own commit while its parent is in flight", async () => {
    const fixture = await useStackedTasks({ stackedCommit: false });
    withDataRootStore(fixture.dataRoot, (store) => placeTask(store, fixture.stacked.task.id, "accepted"));

    await expectRefused(fixture, NOT_LANDED);
  });

  it("refuses a stacked task after its parent landed", async () => {
    const fixture = await useStackedTasks();
    withDataRootStore(fixture.dataRoot, (store) => placeTask(store, fixture.stacked.task.id, "accepted"));
    await landAndDropParent(fixture);

    await expectRefused(fixture, LANDED);
  });

  it("refuses a stacked task whose parent is cancelled", async () => {
    const fixture = await useStackedTasks();
    withDataRootStore(fixture.dataRoot, (store) => {
      placeTask(store, fixture.stacked.task.id, "accepted");
      placeTask(store, fixture.parent.task.id, "cancelled");
    });

    await expectRefused(fixture, CANCELLED);
  });
});

describe("tasker merge after tasker update-branch", () => {
  it("lands a stacked task after update-branch moved it", async () => {
    const fixture = await useStackedTasks();
    withDataRootStore(fixture.dataRoot, (store) => placeTask(store, fixture.stacked.task.id, "awaiting_work_review"));
    const accepted = await runCommand(accept, "accept", STACKED, "--repo", REPO);
    expect(accepted.code).toBe(0);
    await landParent(fixture, ["accepted", "landed"]);

    await expectCommandRefused({ dataRoot: fixture.dataRoot, key: STACKED }, run(merge, "merge"), LANDED);
    const moved = await runCommand(updateBranch, "update-branch", STACKED, "--repo", REPO);
    expect(moved.code).toBe(0);
    const result = await run(merge, "merge")();

    expect(result.code).toBe(0);
    const tip = await gitOutput({ cwd: fixture.stacked.worktree }, fixture.env, "rev-parse", "HEAD");
    expect(await fixture.origin.branchHead("main")).toBe(tip);
    expect(latestTaskOf(fixture.dataRoot, STACKED).state).toBe("landed");
  });
});
