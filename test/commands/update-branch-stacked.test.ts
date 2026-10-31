import { describe, expect, it } from "vitest";
import { removeTaskWorktree, deleteTaskBranch } from "../../src/vcs/git/worktree.js";
import { updateBranch } from "../../src/commands/update-branch.js";
import { runCommand } from "../helpers/cli.js";
import { absentRemoteNote } from "../helpers/command-output.js";
import { commitInWorktree, gitOutput } from "../helpers/git.js";
import { databasePathOf, eventsOf, latestTaskOf, withDataRootStore, withRawDatabase } from "../helpers/store.js";
import { expectCommandRefused, landParent, useStackedTasks, type StackedTasks } from "../helpers/task-fixtures.js";

const REPO = "codeguru42/tasker";

// Runs tasker update-branch for the stacked task, issue 6.
const update = (fixture: StackedTasks, ...args: string[]) =>
  runCommand(updateBranch, "update-branch", fixture.stacked.key, "--repo", REPO, ...args);

// Runs git in the clone and gives the trimmed output.
const inClone = async (fixture: StackedTasks, ...args: string[]) =>
  gitOutput({ gitDir: fixture.clone }, fixture.env, ...args);

// Runs git in the worktree of the stacked task and gives the trimmed output.
const inStacked = async (fixture: StackedTasks, ...args: string[]) =>
  gitOutput({ cwd: fixture.stacked.worktree }, fixture.env, ...args);

// Runs git in the worktree of the parent and gives the trimmed output.
const inParent = async (fixture: StackedTasks, ...args: string[]) =>
  gitOutput({ cwd: fixture.parent.worktree }, fixture.env, ...args);

// The base of the stacked task while its parent is in flight: the branch of the parent.
const parentRef = (fixture: StackedTasks) => `refs/heads/${fixture.parent.branch}`;

const eventsOfType = (fixture: StackedTasks, type: string) =>
  eventsOf(fixture.dataRoot, fixture.stacked.key).filter((event) => event.type === type);

const noLongerStacked = (fixture: StackedTasks) =>
  `${fixture.stacked.key} is no longer stacked on ${fixture.parent.key}`;

// Two commits of the parent. The second commit changes a line of the first.
const PARENT_COMMITS = [
  { file: "parent.txt", content: "one\ntwo\nthree\n" },
  { file: "parent.txt", content: "one\nTWO\nthree\n" },
];

// Replaces the two commits of the parent with two commits of other patches, so that git cannot drop the old commits by
// their patch ids. Gives the new tip of the branch of the parent.
async function rewriteParent(fixture: StackedTasks): Promise<string> {
  await inParent(fixture, "reset", "--hard", "HEAD~2");
  await commitInWorktree(fixture.parent.worktree, fixture.env, {
    file: "parent.txt",
    content: "one\ntwo\nthree\nfour\n",
  });
  await commitInWorktree(fixture.parent.worktree, fixture.env, {
    file: "parent.txt",
    content: "one\nTWO\nthree\nfour\n",
  });
  return inClone(fixture, "rev-parse", parentRef(fixture));
}

// The synced base tip that the column of the stacked task holds.
const syncedOf = (fixture: StackedTasks) => latestTaskOf(fixture.dataRoot, fixture.stacked.key).syncedBaseTip;

const replayedLine = (fixture: StackedTasks, synced: string | null) =>
  `replayed the commits of ${fixture.stacked.key} after the synced base tip ${String(synced)}\n`;

describe("tasker update-branch for a stacked task", () => {
  it("rebases the commits of the task onto new commits of the parent", async () => {
    const fixture = await useStackedTasks();
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    const synced = syncedOf(fixture);
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));

    const result = await update(fixture);

    const moved = await inStacked(fixture, "rev-parse", "HEAD");
    expect(result).toEqual({
      code: 0,
      out: `moved ${fixture.stacked.key} onto ${parentRef(fixture)} at ${tip} by rebase: ${head} to ${moved}\n${replayedLine(fixture, synced)}state: executed\n`,
      err: absentRemoteNote(fixture.stacked.branch),
    });
    expect(moved).not.toBe(head);
    expect(await inStacked(fixture, "rev-parse", "HEAD^")).toBe(tip);
    expect(eventsOfType(fixture, "base").map((event) => event.data)).toContainEqual({
      base: parentRef(fixture),
      revision: parentRef(fixture),
      source: "update",
    });
    expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toMatchObject({
      before: { head, base: parentRef(fixture), baseRevision: parentRef(fixture), syncedBaseTip: synced },
      after: { head: moved, base: parentRef(fixture), baseRevision: parentRef(fixture), syncedBaseTip: tip },
      how: "rebase",
    });
    expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
    expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).parentTaskId).toBe(fixture.parent.task.id);
  });

  it("drops the old commit of a parent that was rewritten and keeps the commits of the task", async () => {
    const fixture = await useStackedTasks();
    const oldParentCommit = await inParent(fixture, "rev-parse", "HEAD");
    await inParent(fixture, "commit", "--amend", "-m", "parent reworded");
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));

    const result = await update(fixture);

    expect(result.code).toBe(0);
    expect(await inStacked(fixture, "rev-list", `${tip}..HEAD`)).toHaveLength(40);
    expect(await inStacked(fixture, "log", "-1", "--format=%s", "HEAD^")).toBe(
      await inClone(fixture, "log", "-1", "--format=%s", tip),
    );
    expect(await inStacked(fixture, "rev-list", "HEAD")).not.toContain(oldParentCommit);
    expect(await inStacked(fixture, "ls-files")).toContain("stacked.txt");
  });

  it("replays only the commits of the task after the synced base tip when the commits of the parent change", async () => {
    const fixture = await useStackedTasks({ parentCommits: PARENT_COMMITS });
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    const synced = syncedOf(fixture);
    const tip = await rewriteParent(fixture);

    const result = await update(fixture);

    const moved = await inStacked(fixture, "rev-parse", "HEAD");
    expect(result).toEqual({
      code: 0,
      out: `moved ${fixture.stacked.key} onto ${parentRef(fixture)} at ${tip} by rebase: ${head} to ${moved}\n${replayedLine(fixture, synced)}state: executed\n`,
      err: absentRemoteNote(fixture.stacked.branch),
    });
    expect((await inStacked(fixture, "rev-list", `${tip}..HEAD`)).split("\n")).toHaveLength(1);
    expect(await inStacked(fixture, "rev-parse", "HEAD^")).toBe(tip);
    expect(syncedOf(fixture)).toBe(tip);
  });

  it("replays only the commits of the task after the synced base tip when the parent landed with changed commits", async () => {
    const fixture = await useStackedTasks({ parentCommits: PARENT_COMMITS });
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    const synced = syncedOf(fixture);
    await rewriteParent(fixture);
    await landParent(fixture, ["accepted", "landed"]);
    const tip = await fixture.origin.addCommit("main");

    const result = await update(fixture);

    const moved = await inStacked(fixture, "rev-parse", "HEAD");
    expect(result).toEqual({
      code: 0,
      out: `moved ${fixture.stacked.key} onto main at ${tip} by rebase: ${head} to ${moved}\n${replayedLine(fixture, synced)}${noLongerStacked(fixture)}\nstate: executed\n`,
      err: absentRemoteNote(fixture.stacked.branch),
    });
    expect(await inStacked(fixture, "rev-parse", "HEAD^")).toBe(tip);
    expect(syncedOf(fixture)).toBe(tip);
  });

  it("moves a task with no commit of its own to the new tip of the parent", async () => {
    const fixture = await useStackedTasks({ parentCommits: PARENT_COMMITS, stackedCommit: false });
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    const synced = syncedOf(fixture);
    const tip = await rewriteParent(fixture);

    const result = await update(fixture);

    expect(await inStacked(fixture, "rev-parse", "HEAD")).toBe(tip);
    expect(result).toEqual({
      code: 0,
      out: `moved ${fixture.stacked.key} onto ${parentRef(fixture)} at ${tip} by rebase: ${head} to ${tip}\n${replayedLine(fixture, synced)}state: executed\n`,
      err: absentRemoteNote(fixture.stacked.branch),
    });
  });

  it("replays after the merge base and prints a note when the head does not build on the synced base tip", async () => {
    const fixture = await useStackedTasks();
    const synced = syncedOf(fixture);
    await inStacked(fixture, "reset", "--hard", "HEAD~2");
    await commitInWorktree(fixture.stacked.worktree, fixture.env, { file: "stacked.txt" });
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));
    const mergeBase = await inStacked(fixture, "merge-base", "HEAD", tip);

    const result = await update(fixture);

    expect(result.code).toBe(0);
    expect(result.err).toBe(
      absentRemoteNote(fixture.stacked.branch) +
        `note: the synced base tip ${String(synced)} of ${fixture.stacked.key} is not an ancestor of HEAD; tasker replayed the commits after the merge base ${mergeBase}\n`,
    );
    expect(result.out).not.toContain("replayed the commits");
  });

  it("replays after the merge base and prints a note when the clone does not have the synced base tip", async () => {
    const fixture = await useStackedTasks();
    const missing = "1234567890".repeat(4);
    withDataRootStore(fixture.dataRoot, (store) =>
      store.updateTask(fixture.stacked.task.id, { syncedBaseTip: missing }),
    );
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));
    const mergeBase = await inStacked(fixture, "merge-base", "HEAD", tip);

    const result = await update(fixture);

    expect(result.code).toBe(0);
    expect(result.err).toContain(
      `note: tasker could not check the synced base tip ${missing} of ${fixture.stacked.key} (git exit code 128); tasker replayed the commits after the merge base ${mergeBase}\n`,
    );
    expect(result.out).not.toContain("replayed the commits");
  });

  it("replays after the merge base and prints a note when the task has no synced base tip", async () => {
    const fixture = await useStackedTasks();
    withDataRootStore(fixture.dataRoot, (store) => store.updateTask(fixture.stacked.task.id, { syncedBaseTip: null }));
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));
    const mergeBase = await inStacked(fixture, "merge-base", "HEAD", tip);

    const result = await update(fixture);

    expect(result.code).toBe(0);
    expect(result.err).toContain(
      `note: ${fixture.stacked.key} has no synced base tip; tasker replayed the commits after the merge base ${mergeBase}\n`,
    );
    expect(result.out).not.toContain("replayed the commits");
  });

  it("moves nothing when the branch of the task already contains the tip of the parent", async () => {
    const fixture = await useStackedTasks();
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));
    const count = eventsOfType(fixture, "base").length;

    const result = await update(fixture);

    expect(result).toEqual({
      code: 0,
      out: `${fixture.stacked.key} is current with ${parentRef(fixture)} at ${tip}; nothing moved\nstate: executed\n`,
      err: absentRemoteNote(fixture.stacked.branch),
    });
    expect(await inStacked(fixture, "rev-parse", "HEAD")).toBe(head);
    expect(eventsOfType(fixture, "base")).toHaveLength(count);
  });

  it("fails and restores the origin state when the branch of the parent is gone", async () => {
    const fixture = await useStackedTasks();
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    await inClone(fixture, "update-ref", "-d", parentRef(fixture));

    const result = await update(fixture);

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err.endsWith(`the branch of the parent ${fixture.parent.key} is gone: ${parentRef(fixture)}\n`)).toBe(
      true,
    );
    expect(await inStacked(fixture, "rev-parse", "HEAD")).toBe(head);
    expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
    expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toHaveProperty("error");
  });

  it("refuses a bad --strategy for a stacked task", async () => {
    const fixture = await useStackedTasks();

    await expectCommandRefused(
      { dataRoot: fixture.dataRoot, key: fixture.stacked.key },
      () => update(fixture, "--strategy", "squash"),
      "--strategy must be rebase or merge: squash\n",
    );
  });

  it("merges new commits of the parent when updateBranchStrategy is merge", async () => {
    const fixture = await useStackedTasks({ repo: { updateBranchStrategy: "merge" } });
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));

    const result = await update(fixture);

    const moved = await inStacked(fixture, "rev-parse", "HEAD");
    expect(result).toEqual({
      code: 0,
      out: `moved ${fixture.stacked.key} onto ${parentRef(fixture)} at ${tip} by merge: ${head} to ${moved}\nstate: executed\n`,
      err: absentRemoteNote(fixture.stacked.branch),
    });
    expect(await inStacked(fixture, "rev-parse", "HEAD^1")).toBe(head);
    expect(await inStacked(fixture, "rev-parse", "HEAD^2")).toBe(tip);
    expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).syncedBaseTip).toBe(tip);
    expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toMatchObject({
      before: { head },
      after: { head: moved },
      how: "merge",
    });
    expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
  });

  it("fast-forwards when the head is an ancestor of the tip of the parent under merge", async () => {
    const fixture = await useStackedTasks({ repo: { updateBranchStrategy: "merge" } });
    await inStacked(fixture, "reset", "--hard", "HEAD^");
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));

    const result = await update(fixture);

    expect(result).toEqual({
      code: 0,
      out: `moved ${fixture.stacked.key} onto ${parentRef(fixture)} at ${tip} by fast-forward: ${head} to ${tip}\nstate: executed\n`,
      err: absentRemoteNote(fixture.stacked.branch),
    });
    expect(await inStacked(fixture, "rev-parse", "HEAD")).toBe(tip);
    expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toMatchObject({ how: "fast-forward" });
    expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
  });

  it("replays with a rebase under --strategy rebase when updateBranchStrategy is merge", async () => {
    const fixture = await useStackedTasks({ repo: { updateBranchStrategy: "merge" } });
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));

    const result = await update(fixture, "--strategy", "rebase");

    expect(result.code).toBe(0);
    expect(result.out).toContain("by rebase:");
    expect(await inStacked(fixture, "rev-parse", "HEAD^")).toBe(tip);
    expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toMatchObject({ how: "rebase" });
  });

  it("merges under --strategy merge when updateBranchStrategy is rebase", async () => {
    const fixture = await useStackedTasks();
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));

    const result = await update(fixture, "--strategy", "merge");

    expect(result.code).toBe(0);
    expect(result.out).toContain("by merge:");
    expect(await inStacked(fixture, "rev-parse", "HEAD^1")).toBe(head);
    expect(await inStacked(fixture, "rev-parse", "HEAD^2")).toBe(tip);
    expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toMatchObject({ how: "merge" });
  });

  it("restores the worktree when a commit of the task conflicts", async () => {
    const fixture = await useStackedTasks();
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "stacked.txt", content: "other\n" });

    const result = await update(fixture);

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("stacked.txt");
    expect(await inStacked(fixture, "rev-parse", "HEAD")).toBe(head);
    expect(await inStacked(fixture, "status", "--porcelain")).toBe("");
    expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
  });
  describe("after the parent landed", () => {
    // The checks that a move onto the new main shares.
    const expectMovedOntoMain = async (fixture: StackedTasks, head: string, tip: string) => {
      const synced = syncedOf(fixture);
      const result = await update(fixture);
      const moved = await inStacked(fixture, "rev-parse", "HEAD");
      expect(result).toEqual({
        code: 0,
        out: `moved ${fixture.stacked.key} onto main at ${tip} by rebase: ${head} to ${moved}\n${replayedLine(fixture, synced)}${noLongerStacked(fixture)}\nstate: executed\n`,
        err: absentRemoteNote(fixture.stacked.branch),
      });
      expect(await inStacked(fixture, "rev-parse", "HEAD^")).toBe(tip);
      expect(eventsOfType(fixture, "base").map((event) => event.data)).toContainEqual({
        base: "main",
        revision: "refs/remotes/origin/main",
        source: "parent",
      });
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key)).toMatchObject({ base: "main", parentTaskId: null });
      expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toMatchObject({
        after: { head: moved, base: "main", baseRevision: "refs/remotes/origin/main" },
      });
    };

    it("moves the task onto main and switches its base", async () => {
      const fixture = await useStackedTasks();
      const head = await inStacked(fixture, "rev-parse", "HEAD");
      await landParent(fixture, ["accepted", "landed"]);
      const tip = await fixture.origin.addCommit("main");

      await expectMovedOntoMain(fixture, head, tip);

      const second = await update(fixture);
      expect(second.code).toBe(0);
      expect(second.out).toContain("nothing moved");
      expect(second.out).not.toContain("no longer stacked");
    });

    it("merges the base of a landed parent when updateBranchStrategy is merge", async () => {
      const fixture = await useStackedTasks({ repo: { updateBranchStrategy: "merge" } });
      const head = await inStacked(fixture, "rev-parse", "HEAD");
      await landParent(fixture, ["accepted", "landed"]);
      const tip = await fixture.origin.addCommit("main");

      const result = await update(fixture);

      const moved = await inStacked(fixture, "rev-parse", "HEAD");
      expect(result).toEqual({
        code: 0,
        out: `moved ${fixture.stacked.key} onto main at ${tip} by merge: ${head} to ${moved}\n${noLongerStacked(fixture)}\nstate: executed\n`,
        err: absentRemoteNote(fixture.stacked.branch),
      });
      expect(await inStacked(fixture, "rev-parse", "HEAD^1")).toBe(head);
      expect(await inStacked(fixture, "rev-parse", "HEAD^2")).toBe(tip);
      expect(eventsOfType(fixture, "base").map((event) => event.data)).toContainEqual({
        base: "main",
        revision: "refs/remotes/origin/main",
        source: "parent",
      });
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).base).toBe("main");
      expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toMatchObject({ how: "merge" });
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
    });

    it("moves the task when the parent finished and its branch and worktree are gone", async () => {
      const fixture = await useStackedTasks();
      const head = await inStacked(fixture, "rev-parse", "HEAD");
      await landParent(fixture, ["accepted", "landed", "finishing", "finished"]);
      await removeTaskWorktree({ clone: fixture.clone, env: fixture.env, path: fixture.parent.worktree });
      await deleteTaskBranch({ clone: fixture.clone, env: fixture.env, branch: fixture.parent.branch });
      const tip = await fixture.origin.addCommit("main");

      await expectMovedOntoMain(fixture, head, tip);
    });

    it("switches the base with no move when the parent landed at the tip that the task holds", async () => {
      const fixture = await useStackedTasks();
      const head = await inStacked(fixture, "rev-parse", "HEAD");
      await landParent(fixture, ["accepted", "landed"]);
      const tip = (await fixture.origin.branchHead("main"))!;
      withDataRootStore(fixture.dataRoot, (store) =>
        store.updateTask(fixture.stacked.task.id, { syncedBaseTip: null }),
      );

      const result = await update(fixture);

      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).syncedBaseTip).toBe(tip);
      expect(result).toEqual({
        code: 0,
        out: `${fixture.stacked.key} is current with main at ${tip}; nothing moved\n${noLongerStacked(fixture)}\nstate: executed\n`,
        err: absentRemoteNote(fixture.stacked.branch),
      });
      expect(await inStacked(fixture, "rev-parse", "HEAD")).toBe(head);
      expect(eventsOfType(fixture, "base").map((event) => event.data)).toContainEqual({
        base: "main",
        revision: "refs/remotes/origin/main",
        source: "parent",
      });
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).base).toBe("main");
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
    });

    it("refuses a parent that is stacked too", async () => {
      const fixture = await useStackedTasks();
      await landParent(fixture, ["accepted", "landed"]);
      withRawDatabase(databasePathOf(fixture.dataRoot), (db) =>
        db.prepare("UPDATE tasks SET base = ? WHERE id = ?").run("refs/heads/other", fixture.parent.task.id),
      );

      const result = await update(fixture);

      expect(result.code).toBe(1);
      expect(
        result.err.endsWith(
          `the parent ${fixture.parent.key} of ${fixture.stacked.key} is stacked too; its base is refs/heads/other\n`,
        ),
      ).toBe(true);
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).parentTaskId).toBe(fixture.parent.task.id);
    });
  });
});
