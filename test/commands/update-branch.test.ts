import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateBranch } from "../../src/commands/update-branch.js";
import type { TaskState } from "../../src/state/machine.js";
import { runGit } from "../../src/vcs/git/run.js";
import { runCommand } from "../helpers/cli.js";
import { commitInWorktree, copyCloneBranchToOrigin } from "../helpers/git.js";
import { seedPinnedPlanRevision } from "../helpers/plan.js";
import { wrongStateError } from "../helpers/state-commands.js";
import {
  databasePathOf,
  eventsOf,
  failTaskFrom,
  lastErrorOf,
  latestTaskOf,
  placeTask,
  readRunMarker,
  withDataRootStore,
} from "../helpers/store.js";
import {
  expectCommandRefused,
  taskBranchTipOf,
  useMovedBaseTask,
  useWorkReviewTask,
  type WorkReviewTask,
} from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";
const BASE_REVISION = "refs/remotes/origin/main";
const NEEDS =
  "workspace_ready, awaiting_plan_review, approved, executed, awaiting_work_review, reviewed, accepted, pushed, in_peer_review, cleanup_failed or failed";

// The note on stderr of a task whose branch is not on origin.
const absentNote = (work: WorkReviewTask) =>
  `note: origin/${String(work.task.branch)} does not exist; nothing to sync from\n`;

const runUpdateBranch = (...args: string[]) => runCommand(updateBranch, "update-branch", KEY, "--repo", REPO, ...args);

// The commit that HEAD of the worktree names, for example "HEAD^" for its first parent.
const revisionOf = async (work: WorkReviewTask, name: string) =>
  (await runGit(["rev-parse", name], { cwd: work.task.worktreePath!, env: work.env })).trim();

// The events of the task after the first count events.
const eventsAfter = (work: WorkReviewTask, count: number) => eventsOf(work.dataRoot, KEY).slice(count);

// Moves the task to state with no edge check, as an earlier command would have left it.
const place = (work: WorkReviewTask, state: TaskState) =>
  withDataRootStore(work.dataRoot, (store) => placeTask(store, work.task.id, state));

describe("tasker update-branch", () => {
  it("moves nothing when the branch contains the base", async () => {
    const work = await useWorkReviewTask();
    const head = await taskBranchTipOf(work);
    const tip = (await work.origin.branchHead("main"))!;
    const count = eventsOf(work.dataRoot, KEY).length;

    const result = await runUpdateBranch();

    expect(result).toEqual({
      code: 0,
      out: `${KEY} is current with main at ${tip}; nothing moved\nstate: awaiting_work_review\n`,
      err: absentNote(work),
    });
    expect(latestTaskOf(work.dataRoot, KEY).state).toBe("awaiting_work_review");
    const snapshot = { head, base: "main", baseRevision: BASE_REVISION };
    expect(eventsAfter(work, count)).toMatchObject([
      { type: "transition", data: { from: "awaiting_work_review", to: "updating_branch" } },
      {
        type: "branch_updated",
        data: { before: snapshot, after: snapshot, how: "none", from: "updating_branch", to: "awaiting_work_review" },
      },
    ]);
    expect(eventsAfter(work, count).map((e) => e.type)).not.toContain("base");
    expect(readRunMarker(databasePathOf(work.dataRoot), work.task.id)).toBeUndefined();
  });

  it("fast-forwards a branch with no commit of its own", async () => {
    const work = await useMovedBaseTask({ files: [] });
    const head = await taskBranchTipOf(work);

    const result = await runUpdateBranch();

    expect(result).toEqual({
      code: 0,
      out: `moved ${KEY} onto main at ${work.baseTip} by fast-forward: ${head} to ${work.baseTip}\ndemoted ${KEY} from awaiting_work_review to executed\nstate: executed\n`,
      err: absentNote(work),
    });
    expect(await taskBranchTipOf(work)).toBe(work.baseTip);
    expect(eventsOf(work.dataRoot, KEY).at(-1)).toMatchObject({
      type: "branch_updated",
      data: { how: "fast-forward" },
    });
  });

  it("rebases the branch by default and writes the events of the move", async () => {
    const work = await useMovedBaseTask();
    const head = await taskBranchTipOf(work);
    const count = eventsOf(work.dataRoot, KEY).length;

    const result = await runUpdateBranch();

    const newHead = await taskBranchTipOf(work);
    expect(newHead).not.toBe(head);
    expect(await revisionOf(work, "HEAD^")).toBe(work.baseTip);
    expect(result).toEqual({
      code: 0,
      out: `moved ${KEY} onto main at ${work.baseTip} by rebase: ${head} to ${newHead}\ndemoted ${KEY} from awaiting_work_review to executed\nstate: executed\n`,
      err: absentNote(work),
    });
    const before = { head, base: "main", baseRevision: BASE_REVISION };
    expect(eventsAfter(work, count)).toEqual([
      expect.objectContaining({
        type: "transition",
        data: { from: "awaiting_work_review", to: "updating_branch" },
      }),
      expect.objectContaining({
        type: "base",
        data: { base: "main", revision: BASE_REVISION, source: "update" },
      }),
      expect.objectContaining({
        type: "branch_updated",
        data: {
          before,
          after: { ...before, head: newHead },
          how: "rebase",
          sync: "absent",
          from: "updating_branch",
          to: "executed",
        },
      }),
    ]);
  });

  it("merges the base with --strategy merge", async () => {
    const work = await useMovedBaseTask();
    const head = await taskBranchTipOf(work);

    const result = await runUpdateBranch("--strategy", "merge");

    const newHead = await taskBranchTipOf(work);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`by merge: ${head} to ${newHead}\n`);
    expect(await revisionOf(work, "HEAD^1")).toBe(head);
    expect(await revisionOf(work, "HEAD^2")).toBe(work.baseTip);
  });

  it("merges the base when updateBranchStrategy of the repo is merge", async () => {
    const work = await useMovedBaseTask({ repo: { updateBranchStrategy: "merge" } });

    const result = await runUpdateBranch();

    expect(result.code).toBe(0);
    expect(result.out).toContain("by merge:");
    expect(await revisionOf(work, "HEAD^2")).toBe(work.baseTip);
  });

  it("lets --strategy override updateBranchStrategy of the repo", async () => {
    const work = await useMovedBaseTask({ repo: { updateBranchStrategy: "merge" } });

    const result = await runUpdateBranch("--strategy", "rebase");

    expect(result.out).toContain("by rebase:");
    expect(await revisionOf(work, "HEAD^")).toBe(work.baseTip);
  });

  it("prints the demoted line when the head moved from awaiting_work_review", async () => {
    await useMovedBaseTask();

    const result = await runUpdateBranch();

    expect(result.out.endsWith(`demoted ${KEY} from awaiting_work_review to executed\nstate: executed\n`)).toBe(true);
  });

  describe("the sync step", () => {
    const divergedError = (work: WorkReviewTask) => {
      const branch = String(work.task.branch);
      return `${branch} and origin/${branch} have diverged; make one of them contain the other, then run tasker update-branch ${KEY} again\n`;
    };
    const lastEvent = (work: WorkReviewTask) => eventsOf(work.dataRoot, KEY).at(-1);

    it("moves nothing and writes the note when origin has no such branch", async () => {
      const work = await useWorkReviewTask();
      const head = await taskBranchTipOf(work);

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.err).toBe(absentNote(work));
      expect(result.out).not.toContain("synced");
      expect(await taskBranchTipOf(work)).toBe(head);
      expect(await revisionOf(work, "HEAD")).toBe(head);
      expect(lastEvent(work)).toMatchObject({ type: "branch_updated", data: { sync: "absent", before: { head } } });
    });

    it("moves nothing and writes no note when the two tips are equal", async () => {
      const work = await useWorkReviewTask();
      const branch = work.task.branch!;
      const head = await taskBranchTipOf(work);
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.err).toBe("");
      expect(result.out).not.toContain("synced");
      expect(await taskBranchTipOf(work)).toBe(head);
      expect(await revisionOf(work, "HEAD")).toBe(head);
      expect(lastEvent(work)).toMatchObject({ type: "branch_updated", data: { sync: "none", before: { head } } });
    });

    it("fast-forwards the branch and the worktree to the remote tip and demotes the task", async () => {
      const work = await useWorkReviewTask();
      const branch = work.task.branch!;
      const head = await taskBranchTipOf(work);
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      const remote = await work.origin.addCommit(branch, { file: "remote.txt" });

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.err).toBe("");
      expect(result.out.split("\n")[0]).toBe(`synced ${branch} from origin/${branch} at ${remote} by fast-forward`);
      expect(result.out.endsWith(`demoted ${KEY} from awaiting_work_review to executed\nstate: executed\n`)).toBe(true);
      expect(await taskBranchTipOf(work)).toBe(remote);
      expect(await revisionOf(work, "HEAD")).toBe(remote);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("executed");
      expect(lastEvent(work)).toMatchObject({
        type: "branch_updated",
        data: { sync: "fast-forward", before: { head } },
      });
    });

    it("moves nothing and writes no note when the remote tip is an ancestor of the local tip", async () => {
      const work = await useWorkReviewTask();
      const branch = work.task.branch!;
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      const head = await commitInWorktree(work.task.worktreePath!, work.env, { file: "local.txt" });

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.err).toBe("");
      expect(result.out).not.toContain("synced");
      expect(await taskBranchTipOf(work)).toBe(head);
      expect(await revisionOf(work, "HEAD")).toBe(head);
      expect(lastEvent(work)).toMatchObject({ type: "branch_updated", data: { sync: "none", before: { head } } });
    });

    it("fails and moves nothing when the tips have diverged", async () => {
      const work = await useWorkReviewTask();
      const branch = work.task.branch!;
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      await work.origin.addCommit(branch, { file: "remote.txt" });
      const head = await commitInWorktree(work.task.worktreePath!, work.env, { file: "local.txt" });
      const count = eventsOf(work.dataRoot, KEY).length;

      const result = await runUpdateBranch();

      expect(result).toEqual({ code: 1, out: "", err: divergedError(work) });
      expect(await taskBranchTipOf(work)).toBe(head);
      expect(await revisionOf(work, "HEAD")).toBe(head);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("awaiting_work_review");
      const snapshot = { head, base: "main", baseRevision: BASE_REVISION };
      const events = eventsAfter(work, count);
      expect(events.map((e) => e.type)).toEqual(["transition", "branch_updated"]);
      expect(events.at(-1)).toMatchObject({
        type: "branch_updated",
        data: {
          before: snapshot,
          after: snapshot,
          how: "none",
          sync: "none",
          error: divergedError(work).trimEnd(),
          from: "updating_branch",
          to: "awaiting_work_review",
        },
      });
    });

    it("rebases onto the moved base after a fast-forward of the sync step", async () => {
      const work = await useMovedBaseTask();
      const branch = work.task.branch!;
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      const remote = await work.origin.addCommit(branch, { file: "remote.txt" });

      const result = await runUpdateBranch();

      const newHead = await taskBranchTipOf(work);
      expect(result.code).toBe(0);
      expect(result.out).toBe(
        `synced ${branch} from origin/${branch} at ${remote} by fast-forward\n` +
          `moved ${KEY} onto main at ${work.baseTip} by rebase: ${remote} to ${newHead}\n` +
          `demoted ${KEY} from awaiting_work_review to executed\nstate: executed\n`,
      );
      expect(await revisionOf(work, "HEAD^^")).toBe(work.baseTip);
      expect(lastEvent(work)).toMatchObject({
        type: "branch_updated",
        data: { how: "rebase", sync: "fast-forward", after: { head: newHead } },
      });
    });

    it("moves an approved task that only the sync step moved to awaiting_plan_review", async () => {
      const work = await useWorkReviewTask();
      const branch = work.task.branch!;
      withDataRootStore(work.dataRoot, (store) => {
        placeTask(store, work.task.id, "awaiting_plan_review");
        seedPinnedPlanRevision(store, work.task.id, {}, "approved");
      });
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      await work.origin.addCommit(branch, { file: "remote.txt" });

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("awaiting_plan_review");
      withDataRootStore(work.dataRoot, (store) => {
        expect(store.pinnedPlanRevision(work.task.id)).toBeUndefined();
      });
      expect(
        result.out.endsWith(`demoted ${KEY} from approved to awaiting_plan_review\nstate: awaiting_plan_review\n`),
      ).toBe(true);
    });

    it("moves the branch and the worktree back to the local tip when the base step fails after a fast-forward", async () => {
      const work = await useMovedBaseTask({ baseChange: { file: "work.txt", content: "from the base\n" } });
      const branch = work.task.branch!;
      const head = await taskBranchTipOf(work);
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      await work.origin.addCommit(branch, { file: "work.txt", content: "from the remote\n" });
      const count = eventsOf(work.dataRoot, KEY).length;

      const result = await runUpdateBranch();

      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toContain("work.txt");
      expect(await taskBranchTipOf(work)).toBe(head);
      expect(await revisionOf(work, "HEAD")).toBe(head);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("awaiting_work_review");
      const snapshot = { head, base: "main", baseRevision: BASE_REVISION };
      const events = eventsAfter(work, count);
      expect(events.map((e) => e.type)).toEqual(["transition", "branch_updated"]);
      expect(events.at(-1)).toMatchObject({
        type: "branch_updated",
        data: { before: snapshot, after: snapshot, how: "none", sync: "fast-forward", error: result.err.trimEnd() },
      });
    });
  });

  describe("the target of each origin state", () => {
    it.each<[TaskState, TaskState]>([
      ["awaiting_work_review", "executed"],
      ["reviewed", "executed"],
      ["accepted", "executed"],
      ["pushed", "executed"],
      ["in_peer_review", "executed"],
    ])("moves a task in %s to %s when the head moved", async (origin, target) => {
      const work = await useMovedBaseTask();
      place(work, origin);

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe(target);
      expect(eventsOf(work.dataRoot, KEY).at(-1)).toMatchObject({
        type: "branch_updated",
        data: { from: "updating_branch", to: target, how: "rebase" },
      });
      expect(result.out.endsWith(`demoted ${KEY} from ${origin} to ${target}\nstate: ${target}\n`)).toBe(true);
    });

    it.each<[TaskState, TaskState]>([
      ["workspace_ready", "workspace_ready"],
      ["executed", "executed"],
      ["cleanup_failed", "cleanup_failed"],
    ])("keeps a task in %s in %s when the head moved", async (origin, target) => {
      const work = await useMovedBaseTask();
      place(work, origin);

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe(target);
      expect(result.out).not.toContain("demoted");
      expect(result.out.endsWith(`state: ${target}\n`)).toBe(true);
    });

    it("moves an approved task to awaiting_plan_review and clears the approval", async () => {
      const work = await useMovedBaseTask();
      withDataRootStore(work.dataRoot, (store) => {
        placeTask(store, work.task.id, "awaiting_plan_review");
        seedPinnedPlanRevision(store, work.task.id, {}, "approved");
      });

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("awaiting_plan_review");
      withDataRootStore(work.dataRoot, (store) => {
        expect(store.pinnedPlanRevision(work.task.id)).toBeUndefined();
        expect(store.getPlanRevision(work.task.id, 1)?.approvedAt).toBeNull();
      });
      const types = eventsOf(work.dataRoot, KEY).map((e) => e.type);
      expect(types).not.toContain("unapproved");
      expect(
        result.out.endsWith(`demoted ${KEY} from approved to awaiting_plan_review\nstate: awaiting_plan_review\n`),
      ).toBe(true);
    });

    it.each<[TaskState, TaskState]>([
      ["reviewing", "executed"],
      ["accepted", "executed"],
      ["pushing", "executed"],
      ["opening_pr", "executed"],
      ["merging", "executed"],
      ["executing", "failed"],
    ])("moves a task that failed in %s to %s when the head moved", async (origin, target) => {
      const work = await useMovedBaseTask();
      withDataRootStore(work.dataRoot, (store) => failTaskFrom(store, work.task.id, origin));

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe(target);
    });

    it("keeps the error of a task that failed in verifying and stays in failed", async () => {
      const work = await useMovedBaseTask();
      withDataRootStore(work.dataRoot, (store) =>
        failTaskFrom(store, work.task.id, "verifying", "npm test failed: boom"),
      );

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("failed");
      expect(lastErrorOf(work.dataRoot, work.task.id)).toBe("npm test failed: boom");
    });

    it("keeps a task in awaiting_work_review when the head did not move", async () => {
      const work = await useWorkReviewTask();
      place(work, "accepted");

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.out).toContain("nothing moved");
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("accepted");
    });
  });

  describe("a failure after the move", () => {
    it("restores the worktree and the origin state after a conflict", async () => {
      const work = await useMovedBaseTask({ baseChange: { file: "work.txt", content: "from the base\n" } });
      const head = await taskBranchTipOf(work);
      const count = eventsOf(work.dataRoot, KEY).length;

      const result = await runUpdateBranch();

      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err.startsWith(absentNote(work))).toBe(true);
      expect(result.err).toContain("work.txt");
      expect(await taskBranchTipOf(work)).toBe(head);
      expect(await revisionOf(work, "HEAD")).toBe(head);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("awaiting_work_review");
      expect(readRunMarker(databasePathOf(work.dataRoot), work.task.id)).toBeUndefined();
      const snapshot = { head, base: "main", baseRevision: BASE_REVISION };
      const events = eventsAfter(work, count);
      expect(events.map((e) => e.type)).toEqual(["transition", "branch_updated"]);
      expect(events.at(-1)).toMatchObject({
        type: "branch_updated",
        data: {
          before: snapshot,
          after: snapshot,
          how: "none",
          sync: "absent",
          error: result.err.slice(absentNote(work).length).trimEnd(),
          from: "updating_branch",
          to: "awaiting_work_review",
        },
      });
    });

    it("moves the task to failed when the worktree is not back at the start", async () => {
      const work = await useMovedBaseTask();
      writeFileSync(join(work.clone, "refs", "heads", `${String(work.task.branch)}.lock`), "");

      const result = await runUpdateBranch();

      expect(result.code).toBe(1);
      expect(result.err).toMatch(/^updating branch failed: cannot restore the worktree/);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("failed");
      expect(lastErrorOf(work.dataRoot, work.task.id)).toMatch(/^updating branch failed: cannot restore the worktree/);
      expect(readRunMarker(databasePathOf(work.dataRoot), work.task.id)).toBeUndefined();
    });
  });

  describe("refusals", () => {
    it("refuses a worktree with uncommitted changes", async () => {
      const work = await useMovedBaseTask();
      writeFileSync(join(work.task.worktreePath!, "dirty.txt"), "dirty\n");

      await expectCommandRefused(
        work,
        runUpdateBranch,
        new RegExp(
          `^the worktree has uncommitted changes: ${work.task.worktreePath!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n.*dirty\\.txt\\ntasker update-branch needs a clean worktree\\n$`,
        ),
      );
    });

    it("refuses a strategy other than rebase and merge", async () => {
      const work = await useMovedBaseTask();

      await expectCommandRefused(
        work,
        () => runUpdateBranch("--strategy", "squash"),
        "--strategy must be rebase or merge: squash\n",
      );
    });

    it("refuses a task in a state that update-branch does not accept", async () => {
      const work = await useWorkReviewTask();
      place(work, "planning");

      await expectCommandRefused(
        work,
        runUpdateBranch,
        `${wrongStateError("planning", KEY, "update-branch", NEEDS)}\n`,
      );
    });
  });
});
