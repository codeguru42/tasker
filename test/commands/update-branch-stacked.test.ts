import { describe, expect, it } from "vitest";
import { removeTaskWorktree, deleteTaskBranch } from "../../src/vcs/git/worktree.js";
import { updateBranch } from "../../src/commands/update-branch.js";
import { runGit } from "../../src/vcs/git/run.js";
import { runCommand } from "../helpers/cli.js";
import { commitInWorktree, landBranchOnOriginMain } from "../helpers/git.js";
import { databasePathOf, eventsOf, latestTaskOf, withDataRootStore, withRawDatabase } from "../helpers/store.js";
import { expectCommandRefused, moveTaskThrough, useStackedTasks, type StackedTasks } from "../helpers/task-fixtures.js";

const REPO = "codeguru42/tasker";

// Runs tasker update-branch for the stacked task, issue 6.
const update = (fixture: StackedTasks, ...args: string[]) =>
  runCommand(updateBranch, "update-branch", fixture.stacked.key, "--repo", REPO, ...args);

// Runs git in the clone and gives the trimmed output.
const inClone = async (fixture: StackedTasks, ...args: string[]) =>
  (await runGit(args, { gitDir: fixture.clone, env: fixture.env })).trim();

// Runs git in the worktree of the stacked task and gives the trimmed output.
const inStacked = async (fixture: StackedTasks, ...args: string[]) =>
  (await runGit(args, { cwd: fixture.stacked.worktree, env: fixture.env })).trim();

// Runs git in the worktree of the parent and gives the trimmed output.
const inParent = async (fixture: StackedTasks, ...args: string[]) =>
  (await runGit(args, { cwd: fixture.parent.worktree, env: fixture.env })).trim();

// The base of the stacked task while its parent is in flight: the branch of the parent.
const parentRef = (fixture: StackedTasks) => `refs/heads/${fixture.parent.branch}`;

// The note on stderr of a task whose branch is not on origin.
const absentNote = (fixture: StackedTasks) =>
  `note: origin/${fixture.stacked.branch} does not exist; nothing to sync from\n`;

const eventsOfType = (fixture: StackedTasks, type: string) =>
  eventsOf(fixture.dataRoot, fixture.stacked.key).filter((event) => event.type === type);

// Makes the head of the branch of the parent the head of main on origin, as a landing outside tasker does, then moves
// the task of the parent through states.
async function landParent(fixture: StackedTasks, states: Parameters<typeof moveTaskThrough>[2]) {
  await landBranchOnOriginMain({
    origin: fixture.origin.path,
    clone: fixture.clone,
    branch: fixture.parent.branch,
    env: fixture.env,
  });
  withDataRootStore(fixture.dataRoot, (store) => moveTaskThrough(store, fixture.parent.task.id, states));
}

const noLongerStacked = (fixture: StackedTasks) =>
  `${fixture.stacked.key} is no longer stacked on ${fixture.parent.key}`;

describe("tasker update-branch for a stacked task", () => {
  it("rebases the commits of the task onto new commits of the parent", async () => {
    const fixture = await useStackedTasks();
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-more.txt" });
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));

    const result = await update(fixture);

    const moved = await inStacked(fixture, "rev-parse", "HEAD");
    expect(result).toEqual({
      code: 0,
      out: `moved ${fixture.stacked.key} onto ${parentRef(fixture)} at ${tip} by rebase: ${head} to ${moved}\nstate: executed\n`,
      err: absentNote(fixture),
    });
    expect(moved).not.toBe(head);
    expect(await inStacked(fixture, "rev-parse", "HEAD^")).toBe(tip);
    expect(eventsOfType(fixture, "base").map((event) => event.data)).toContainEqual({
      base: parentRef(fixture),
      revision: parentRef(fixture),
      source: "update",
    });
    expect(eventsOfType(fixture, "branch_updated").at(-1)?.data).toMatchObject({
      before: { head, base: parentRef(fixture), baseRevision: parentRef(fixture) },
      after: { head: moved, base: parentRef(fixture), baseRevision: parentRef(fixture) },
      how: "rebase",
    });
    expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
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

  it("moves nothing when the branch of the task already contains the tip of the parent", async () => {
    const fixture = await useStackedTasks();
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    const tip = await inClone(fixture, "rev-parse", parentRef(fixture));
    const count = eventsOfType(fixture, "base").length;

    const result = await update(fixture);

    expect(result).toEqual({
      code: 0,
      out: `${fixture.stacked.key} is current with ${parentRef(fixture)} at ${tip}; nothing moved\nstate: executed\n`,
      err: absentNote(fixture),
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

  it("refuses --strategy for a stacked task", async () => {
    const fixture = await useStackedTasks();

    await expectCommandRefused(
      { dataRoot: fixture.dataRoot, key: fixture.stacked.key },
      () => update(fixture, "--strategy", "merge"),
      "--strategy does not apply to a stacked task; tasker update-branch replays its commits with a rebase\n",
    );
  });

  it("restores the worktree when a commit of the parent conflicts", async () => {
    const fixture = await useStackedTasks();
    const head = await inStacked(fixture, "rev-parse", "HEAD");
    await inParent(fixture, "reset", "--hard", "HEAD^");
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent.txt", content: "other\n" });

    const result = await update(fixture);

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("parent.txt");
    expect(await inStacked(fixture, "rev-parse", "HEAD")).toBe(head);
    expect(await inStacked(fixture, "status", "--porcelain")).toBe("");
    expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
  });
  describe("after the parent landed", () => {
    // The checks that a move onto the new main shares.
    const expectMovedOntoMain = async (fixture: StackedTasks, head: string, tip: string) => {
      const result = await update(fixture);
      const moved = await inStacked(fixture, "rev-parse", "HEAD");
      expect(result).toEqual({
        code: 0,
        out: `moved ${fixture.stacked.key} onto main at ${tip} by rebase: ${head} to ${moved}\n${noLongerStacked(fixture)}\nstate: executed\n`,
        err: absentNote(fixture),
      });
      expect(await inStacked(fixture, "rev-parse", "HEAD^")).toBe(tip);
      expect(eventsOfType(fixture, "base").map((event) => event.data)).toContainEqual({
        base: "main",
        revision: "refs/remotes/origin/main",
        source: "parent",
      });
      expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).base).toBe("main");
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

      const result = await update(fixture);

      expect(result).toEqual({
        code: 0,
        out: `${fixture.stacked.key} is current with main at ${tip}; nothing moved\n${noLongerStacked(fixture)}\nstate: executed\n`,
        err: absentNote(fixture),
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
    });
  });
});
