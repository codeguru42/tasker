import { describe, expect, it } from "vitest";
import { removeTaskWorktree, deleteTaskBranch } from "../../src/vcs/git/worktree.js";
import { updateBranch } from "../../src/commands/update-branch.js";
import { runCommand } from "../helpers/cli.js";
import { absentRemoteNote, undoHint } from "../helpers/command-output.js";
import { expectedShowLines } from "../helpers/state-commands.js";
import { commitInWorktree, copyCloneBranchToOrigin, gitOutput } from "../helpers/git.js";
import {
  databasePathOf,
  eventsOf,
  latestTaskOf,
  placeTask,
  withDataRootStore,
  withRawDatabase,
} from "../helpers/store.js";
import {
  expectCommandRefused,
  landParent,
  moveTaskThrough,
  useChainedTasks,
  useMovedBaseTask,
  useStackedTasks,
  type ChainedTasks,
  type StackedTasks,
} from "../helpers/task-fixtures.js";

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

const newerMergeBaseNote = (fixture: StackedTasks, mergeBase: string, synced: string | null) =>
  `note: the merge base ${mergeBase} of ${fixture.stacked.key} is newer than the synced base tip ${String(synced)}; tasker replays the commits after the merge base ${mergeBase}\n`;

const MERGE_NOTE_START = "note: tasker merged";
const mergeNote = (fixture: StackedTasks, base: string) =>
  `note: tasker merged ${base} into ${fixture.stacked.key}, so the commits of the parent are now in its history; use --strategy rebase for a stacked task that has no merge move yet\n`;

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
      out: `moved ${fixture.stacked.key} onto ${parentRef(fixture)} at ${tip} by rebase: ${head} to ${moved}\n${replayedLine(fixture, synced)}${undoHint(fixture.stacked.key, head)}state: executed\n${expectedShowLines("executed", fixture.stacked.key)}`,
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
      out: `moved ${fixture.stacked.key} onto ${parentRef(fixture)} at ${tip} by rebase: ${head} to ${moved}\n${replayedLine(fixture, synced)}${undoHint(fixture.stacked.key, head)}state: executed\n${expectedShowLines("executed", fixture.stacked.key)}`,
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
      out: `moved ${fixture.stacked.key} onto main at ${tip} by rebase: ${head} to ${moved}\n${replayedLine(fixture, synced)}${noLongerStacked(fixture)}\n${undoHint(fixture.stacked.key, head)}state: executed\n${expectedShowLines("executed", fixture.stacked.key)}`,
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
      out: `moved ${fixture.stacked.key} onto ${parentRef(fixture)} at ${tip} by rebase: ${head} to ${tip}\n${replayedLine(fixture, synced)}${undoHint(fixture.stacked.key, head)}state: executed\n${expectedShowLines("executed", fixture.stacked.key)}`,
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
        `note: the synced base tip ${String(synced)} of ${fixture.stacked.key} is not an ancestor of HEAD; tasker replays the commits after the merge base ${mergeBase}\n`,
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
      `note: tasker could not check the synced base tip ${missing} of ${fixture.stacked.key} (git exit code 128); tasker replays the commits after the merge base ${mergeBase}\n`,
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
      `note: ${fixture.stacked.key} has no synced base tip; tasker replays the commits after the merge base ${mergeBase}\n`,
    );
    expect(result.out).not.toContain("replayed the commits");
  });

  it("replays after a newer merge base when the head builds on a newer tip of the parent", async () => {
    const fixture = await useStackedTasks({ parentCommits: PARENT_COMMITS });
    const synced = syncedOf(fixture);
    const newer = await commitInWorktree(fixture.parent.worktree, fixture.env, {
      file: "parent.txt",
      content: "one\n2\nthree\n",
    });
    await inStacked(fixture, "rebase", newer);
    const tip = await commitInWorktree(fixture.parent.worktree, fixture.env, {
      file: "parent.txt",
      content: "one\nII\nthree\n",
    });

    const result = await update(fixture);

    expect(result.code).toBe(0);
    expect(result.err).toBe(absentRemoteNote(fixture.stacked.branch) + newerMergeBaseNote(fixture, newer, synced));
    expect(result.out).not.toContain("replayed the commits");
    expect(await inStacked(fixture, "rev-parse", "HEAD^")).toBe(tip);
    expect(syncedOf(fixture)).toBe(tip);
  });

  it("moves nothing when the branch of the task already contains the tip of the parent", async () => {
    const fixture = await useStackedTasks();
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));
    const count = eventsOfType(fixture, "base").length;

    const result = await update(fixture);

    expect(result).toEqual({
      code: 0,
      out: `${fixture.stacked.key} is current with ${parentRef(fixture)} at ${tip}; nothing moved\nstate: executed\n${expectedShowLines("executed", fixture.stacked.key)}`,
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
      out: `moved ${fixture.stacked.key} onto ${parentRef(fixture)} at ${tip} by merge: ${head} to ${moved}\n${undoHint(fixture.stacked.key, head)}state: executed\n${expectedShowLines("executed", fixture.stacked.key)}`,
      err: absentRemoteNote(fixture.stacked.branch) + mergeNote(fixture, parentRef(fixture)),
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
      out: `moved ${fixture.stacked.key} onto ${parentRef(fixture)} at ${tip} by fast-forward: ${head} to ${tip}\n${undoHint(fixture.stacked.key, head)}state: executed\n${expectedShowLines("executed", fixture.stacked.key)}`,
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
    expect(result.err).toBe(absentRemoteNote(fixture.stacked.branch));
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
    expect(result.err).toBe(absentRemoteNote(fixture.stacked.branch) + mergeNote(fixture, parentRef(fixture)));
    expect(await inStacked(fixture, "rev-parse", "HEAD^1")).toBe(head);
    expect(await inStacked(fixture, "rev-parse", "HEAD^2")).toBe(tip);
    expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toMatchObject({ how: "merge" });
  });

  it("prints no note for a merge move of a task that is not stacked", async () => {
    const work = await useMovedBaseTask({ repo: { updateBranchStrategy: "merge" } });

    const result = await runCommand(updateBranch, "update-branch", work.key, "--repo", REPO);

    expect(result.code).toBe(0);
    expect(result.out).toContain("by merge:");
    expect(result.err).toBe(absentRemoteNote(String(work.task.branch)));
  });

  it("prints no note when a merge stops on a conflict", async () => {
    const fixture = await useStackedTasks({ repo: { updateBranchStrategy: "merge" } });
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "stacked.txt", content: "other\n" });

    const result = await update(fixture);

    expect(result.code).toBe(1);
    expect(result.err).toContain("stacked.txt");
    expect(result.err).not.toContain(MERGE_NOTE_START);
  });

  it("prints no note for a move of the sync step alone", async () => {
    const fixture = await useStackedTasks({ repo: { updateBranchStrategy: "merge" } });
    await commitInWorktree(fixture.stacked.worktree, fixture.env, { file: "later.txt" });
    await copyCloneBranchToOrigin({
      origin: fixture.origin.path,
      clone: fixture.clone,
      branch: fixture.stacked.branch,
      env: fixture.env,
    });
    await inStacked(fixture, "reset", "--hard", "HEAD^");

    const result = await update(fixture);

    expect(result.code).toBe(0);
    expect(result.out).toContain(`synced ${fixture.stacked.branch} from origin/`);
    expect(result.out).toContain("nothing moved");
    expect(result.err).toBe("");
  });

  it("prints no note when the last write fails", async () => {
    const fixture = await useStackedTasks({ repo: { updateBranchStrategy: "merge" } });
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    withRawDatabase(databasePathOf(fixture.dataRoot), (db) =>
      db.exec(
        "CREATE TRIGGER refuse_update BEFORE INSERT ON events WHEN NEW.type = 'branch_updated' AND json_extract(NEW.data, '$.error') IS NULL BEGIN SELECT RAISE(ABORT, 'refused by the test'); END",
      ),
    );

    const result = await update(fixture);

    expect(result.code).toBe(1);
    expect(result.err).toContain("refused by the test");
    expect(result.err).not.toContain(MERGE_NOTE_START);
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

  it("writes the note with the words tasker replays when the replay stops on a conflict", async () => {
    const fixture = await useStackedTasks();
    withDataRootStore(fixture.dataRoot, (store) => store.updateTask(fixture.stacked.task.id, { syncedBaseTip: null }));
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "stacked.txt", content: "other\n" });
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));
    const mergeBase = await inStacked(fixture, "merge-base", "HEAD", tip);

    const result = await update(fixture);

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain(
      `note: ${fixture.stacked.key} has no synced base tip; tasker replays the commits after the merge base ${mergeBase}\n`,
    );
  });

  describe("after the parent landed", () => {
    // The checks that a move onto the new main shares.
    // end is the key of the end task of the walk: the parent unless the chain has more landed parents.
    const expectMovedOntoMain = async (fixture: StackedTasks, head: string, tip: string, end = fixture.parent.key) => {
      const synced = syncedOf(fixture);
      const result = await update(fixture);
      const moved = await inStacked(fixture, "rev-parse", "HEAD");
      expect(result).toEqual({
        code: 0,
        out: `moved ${fixture.stacked.key} onto main at ${tip} by rebase: ${head} to ${moved}\n${replayedLine(fixture, synced)}${noLongerStacked(fixture)}\n${undoHint(fixture.stacked.key, head)}state: executed\n${expectedShowLines("executed", fixture.stacked.key)}`,
        err: absentRemoteNote(fixture.stacked.branch),
      });
      expect(await inStacked(fixture, "rev-parse", "HEAD^")).toBe(tip);
      expect(eventsOfType(fixture, "base").map((event) => event.data)).toContainEqual({
        base: "main",
        revision: "refs/remotes/origin/main",
        source: "parent",
        baseOf: end,
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
        out: `moved ${fixture.stacked.key} onto main at ${tip} by merge: ${head} to ${moved}\n${noLongerStacked(fixture)}\n${undoHint(fixture.stacked.key, head)}state: executed\n${expectedShowLines("executed", fixture.stacked.key)}`,
        err: absentRemoteNote(fixture.stacked.branch) + mergeNote(fixture, "main"),
      });
      expect(await inStacked(fixture, "rev-parse", "HEAD^1")).toBe(head);
      expect(await inStacked(fixture, "rev-parse", "HEAD^2")).toBe(tip);
      expect(eventsOfType(fixture, "base").map((event) => event.data)).toContainEqual({
        base: "main",
        revision: "refs/remotes/origin/main",
        source: "parent",
        baseOf: fixture.parent.key,
      });
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).base).toBe("main");
      expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toMatchObject({ how: "merge" });
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
    });

    it("prints no note for a later merge move of a task with no parent", async () => {
      const fixture = await useStackedTasks({ repo: { updateBranchStrategy: "merge" } });
      await landParent(fixture, ["accepted", "landed"]);
      await fixture.origin.addCommit("main");
      expect((await update(fixture)).code).toBe(0);
      await fixture.origin.addCommit("main");

      const second = await update(fixture);

      expect(second.code).toBe(0);
      expect(second.out).toContain("by merge:");
      expect(second.err).toBe(absentRemoteNote(fixture.stacked.branch));
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

    it("takes the copy on origin with --take-remote when the merge base is newer", async () => {
      const fixture = await useStackedTasks({ parentCommits: PARENT_COMMITS });
      const head = await inStacked(fixture, "rev-parse", "HEAD");
      const synced = syncedOf(fixture);
      await landParent(fixture, ["accepted", "landed"]);
      await fixture.origin.addCommit("main", { file: "parent.txt", content: "one\n2\nthree\n" });
      const tip = await fixture.origin.addCommit("main", { file: "parent.txt", content: "one\nII\nthree\n" });
      await inClone(fixture, "fetch", "origin", "main");
      await inStacked(fixture, "rebase", tip);
      const copy = await inStacked(fixture, "rev-parse", "HEAD");
      await copyCloneBranchToOrigin({
        origin: fixture.origin.path,
        clone: fixture.clone,
        branch: fixture.stacked.branch,
        env: fixture.env,
      });
      await inStacked(fixture, "reset", "--hard", head);

      const result = await update(fixture, "--take-remote");

      expect(result.code).toBe(0);
      expect(result.err).toContain(newerMergeBaseNote(fixture, tip, synced));
      expect(result.out).not.toContain("replayed the commits");
      expect(await inStacked(fixture, "rev-parse", "HEAD")).toBe(copy);
      expect(syncedOf(fixture)).toBe(tip);
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
        out: `${fixture.stacked.key} is current with main at ${tip}; nothing moved\n${noLongerStacked(fixture)}\nstate: executed\n${expectedShowLines("executed", fixture.stacked.key)}`,
        err: absentRemoteNote(fixture.stacked.branch),
      });
      expect(await inStacked(fixture, "rev-parse", "HEAD")).toBe(head);
      expect(eventsOfType(fixture, "base").map((event) => event.data)).toContainEqual({
        base: "main",
        revision: "refs/remotes/origin/main",
        source: "parent",
        baseOf: fixture.parent.key,
      });
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).base).toBe("main");
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
    });

    it("refuses an end task with a local base and no parent", async () => {
      const fixture = await useStackedTasks();
      await landParent(fixture, ["accepted", "landed"]);
      withRawDatabase(databasePathOf(fixture.dataRoot), (db) =>
        db.prepare("UPDATE tasks SET base = ? WHERE id = ?").run("refs/heads/other", fixture.parent.task.id),
      );
      const before = eventsOf(fixture.dataRoot, fixture.stacked.key);

      const result = await update(fixture);

      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toBe(
        `the base refs/heads/other of ${fixture.parent.key} is a local branch with no parent task; nothing moved\n`,
      );
      expect(eventsOf(fixture.dataRoot, fixture.stacked.key)).toEqual(before);
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).parentTaskId).toBe(fixture.parent.task.id);
    });

    it("moves the task onto main when two parents in a chain landed", async () => {
      const fixture = await useChainedTasks();
      const head = await inStacked(fixture, "rev-parse", "HEAD");
      await landParent({ ...fixture, parent: fixture.grandparent }, ["accepted", "landed"]);
      await landParent(fixture, ["accepted", "landed"]);
      const tip = await fixture.origin.addCommit("main");

      await expectMovedOntoMain(fixture, head, tip, fixture.grandparent.key);

      expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toMatchObject({
        landedParents: [fixture.parent.key, fixture.grandparent.key],
      });
    });

    describe("when the next parent has not landed", () => {
      const grandparentRef = (fixture: ChainedTasks) => `refs/heads/${fixture.grandparent.branch}`;

      // Moves the task of the parent to landed with no landing on origin, and adds a commit to the branch of the
      // grandparent. The task of the grandparent stays in the state that the fixture gives, or in grandparentState.
      const landOnlyParent = async (fixture: ChainedTasks, grandparentState?: "cancelled") => {
        withDataRootStore(fixture.dataRoot, (store) => {
          moveTaskThrough(store, fixture.parent.task.id, ["accepted", "landed"]);
          if (grandparentState !== undefined) placeTask(store, fixture.grandparent.task.id, grandparentState);
        });
        await commitInWorktree(fixture.grandparent.worktree, fixture.env, { file: "grandparent-more.txt" });
      };

      it("stays stacked on the next parent and prints the new parent", async () => {
        const fixture = await useChainedTasks();
        await landOnlyParent(fixture);

        const result = await update(fixture);

        expect(result.code).toBe(0);
        expect(result.out).toContain(`${fixture.stacked.key} is now stacked on ${fixture.grandparent.key}\n`);
        expect(result.out).not.toContain("no longer stacked");
        expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key)).toMatchObject({
          base: grandparentRef(fixture),
          parentTaskId: fixture.grandparent.task.id,
          state: "executed",
        });
        expect(eventsOfType(fixture, "base").at(-1)?.data).toEqual({
          base: grandparentRef(fixture),
          revision: grandparentRef(fixture),
          source: "parent",
          baseOf: fixture.parent.key,
        });
        expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toMatchObject({
          landedParents: [fixture.parent.key],
        });
      });

      it("prints the note with the branch of the next parent after a merge move", async () => {
        const fixture = await useChainedTasks({ repo: { updateBranchStrategy: "merge" } });
        await landOnlyParent(fixture);

        const result = await update(fixture);

        expect(result.code).toBe(0);
        expect(result.out).toContain("by merge:");
        expect(result.err).toBe(absentRemoteNote(fixture.stacked.branch) + mergeNote(fixture, grandparentRef(fixture)));
      });

      it("prints no new parent and writes no landedParents in the second run", async () => {
        const fixture = await useChainedTasks();
        await landOnlyParent(fixture);
        expect((await update(fixture)).code).toBe(0);

        const second = await update(fixture);

        expect(second.code).toBe(0);
        expect(second.out).not.toContain("now stacked");
        expect(second.out).not.toContain("no longer stacked");
        expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).not.toHaveProperty("landedParents");
        expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).parentTaskId).toBe(fixture.grandparent.task.id);
      });

      it("fails and keeps the base and the parent when the branch of the new parent is gone", async () => {
        const fixture = await useChainedTasks();
        await landOnlyParent(fixture);
        await inClone(fixture, "update-ref", "-d", grandparentRef(fixture));

        const result = await update(fixture);

        expect(result.code).toBe(1);
        expect(result.out).toBe("");
        expect(
          result.err.endsWith(
            `the branch of the parent ${fixture.grandparent.key} is gone: ${grandparentRef(fixture)}\n`,
          ),
        ).toBe(true);
        expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key)).toMatchObject({
          base: parentRef(fixture),
          parentTaskId: fixture.parent.task.id,
          state: "executed",
        });
        expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toHaveProperty("error");
        const sources = eventsOfType(fixture, "base").map((event) => (event.data as { source: string }).source);
        expect(sources).not.toContain("parent");
      });

      it("stays stacked on a cancelled next parent", async () => {
        const fixture = await useChainedTasks();
        await landOnlyParent(fixture, "cancelled");

        const result = await update(fixture);

        expect(result.code).toBe(0);
        expect(result.out).toContain(`${fixture.stacked.key} is now stacked on ${fixture.grandparent.key}\n`);
        expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).parentTaskId).toBe(fixture.grandparent.task.id);
      });
    });

    describe("when the chain has a loop", () => {
      // Runs the update and makes sure that it wrote no row and no event.
      const expectNothingWritten = async (fixture: StackedTasks, at: string) => {
        const row = latestTaskOf(fixture.dataRoot, fixture.stacked.key);
        const events = eventsOf(fixture.dataRoot, fixture.stacked.key);

        const result = await update(fixture);

        expect(result).toEqual({
          code: 1,
          out: "",
          err: `the chain of parents of ${fixture.stacked.key} has a loop at ${at}; nothing moved\n`,
        });
        expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key)).toEqual(row);
        expect(eventsOf(fixture.dataRoot, fixture.stacked.key)).toEqual(events);
      };

      it("refuses a chain that goes back to the task", async () => {
        const fixture = await useStackedTasks();
        await landParent(fixture, ["accepted", "landed"]);
        withDataRootStore(fixture.dataRoot, (store) =>
          store.updateTask(fixture.parent.task.id, { parentTaskId: fixture.stacked.task.id }),
        );

        await expectNothingWritten(fixture, fixture.stacked.key);
      });

      it("refuses a chain with a loop above the task", async () => {
        const fixture = await useChainedTasks();
        withDataRootStore(fixture.dataRoot, (store) => {
          moveTaskThrough(store, fixture.grandparent.task.id, ["accepted", "landed"]);
          moveTaskThrough(store, fixture.parent.task.id, ["accepted", "landed"]);
          store.updateTask(fixture.grandparent.task.id, { parentTaskId: fixture.parent.task.id });
        });

        await expectNothingWritten(fixture, fixture.parent.key);
      });
    });
  });
});

describe("tasker update-branch --undo for a stacked task", () => {
  it("puts the head and the synced base tip back, keeps the base and replays only the commits of the task", async () => {
    const fixture = await useStackedTasks({ parentCommits: PARENT_COMMITS });
    const key = fixture.stacked.key;
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    const synced = syncedOf(fixture);
    const tip = await rewriteParent(fixture);
    expect((await update(fixture)).code).toBe(0);
    const moved = await inStacked(fixture, "rev-parse", "HEAD");

    const undone = await update(fixture, "--undo");

    expect(undone.code).toBe(0);
    expect(undone.out).toContain(`undid the last update of ${key}: ${moved} back to ${head}\n`);
    expect(await inStacked(fixture, "rev-parse", "HEAD")).toBe(head);
    expect(syncedOf(fixture)).toBe(synced);
    expect(latestTaskOf(fixture.dataRoot, key)).toMatchObject({
      base: parentRef(fixture),
      parentTaskId: fixture.parent.task.id,
    });

    const second = await update(fixture);

    expect(second.code).toBe(0);
    expect(second.out).toContain(replayedLine(fixture, synced));
    expect((await inStacked(fixture, "rev-list", `${tip}..HEAD`)).split("\n")).toHaveLength(1);
    expect(await inStacked(fixture, "rev-parse", "HEAD^")).toBe(tip);
  });

  it("prints no note for an undo of a merge move", async () => {
    const fixture = await useStackedTasks({ repo: { updateBranchStrategy: "merge" } });
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    expect((await update(fixture, "--strategy", "merge")).code).toBe(0);

    const undone = await update(fixture, "--undo");

    expect(undone.code).toBe(0);
    expect(undone.err).not.toContain(MERGE_NOTE_START);
  });

  it("undoes the last update of a task whose chain of parents has a loop", async () => {
    const fixture = await useStackedTasks();
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    expect((await update(fixture)).code).toBe(0);
    withDataRootStore(fixture.dataRoot, (store) => {
      moveTaskThrough(store, fixture.parent.task.id, ["accepted", "landed"]);
      store.updateTask(fixture.parent.task.id, { parentTaskId: fixture.stacked.task.id });
    });

    const undone = await update(fixture, "--undo");

    expect(undone.code).toBe(0);
    expect(undone.out).toContain(`undid the last update of ${fixture.stacked.key}`);
  });
});
