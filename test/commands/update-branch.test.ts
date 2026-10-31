import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateBranch } from "../../src/commands/update-branch.js";
import type { TaskState } from "../../src/state/machine.js";
import { runGit } from "../../src/vcs/git/run.js";
import { runCommand } from "../helpers/cli.js";
import { absentRemoteNote } from "../helpers/command-output.js";
import { amendWorktreeMessage, commitInWorktree, copyCloneBranchToOrigin, gitOutput } from "../helpers/git.js";
import { seedPinnedPlanRevision } from "../helpers/plan.js";
import { wrongStateError } from "../helpers/state-commands.js";
import {
  databasePathOf,
  eventsOf,
  failTaskFrom,
  failTaskVia,
  lastErrorOf,
  latestTaskOf,
  placeTask,
  readRunMarker,
  withDataRootStore,
} from "../helpers/store.js";
import {
  expectCommandRefused,
  taskBranchTipOf,
  useAcceptedTask,
  useAcceptedTaskWithNoRevision,
  useMovedBaseTask,
  useWorkReviewTask,
  type WorkReviewTask,
} from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";
const BASE_REVISION = "refs/remotes/origin/main";
const NEEDS =
  "workspace_ready, awaiting_plan_review, approved, executed, awaiting_work_review, reviewed, accepted, pushed, in_peer_review, cleanup_failed or failed";

const runUpdateBranch = (...args: string[]) => runCommand(updateBranch, "update-branch", KEY, "--repo", REPO, ...args);

// The commit that HEAD of the worktree names, for example "HEAD^" for its first parent.
const revisionOf = async (work: WorkReviewTask, name: string) =>
  gitOutput({ cwd: work.task.worktreePath! }, work.env, "rev-parse", name);

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
      err: absentRemoteNote(String(work.task.branch)),
    });
    expect(latestTaskOf(work.dataRoot, KEY).state).toBe("awaiting_work_review");
    const snapshot = { head, base: "main", baseRevision: BASE_REVISION };
    expect(eventsAfter(work, count)).toMatchObject([
      { type: "transition", data: { head, from: "awaiting_work_review", to: "updating_branch" } },
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
      err: absentRemoteNote(String(work.task.branch)),
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
    const start = latestTaskOf(work.dataRoot, KEY).syncedBaseTip;

    const result = await runUpdateBranch();

    const newHead = await taskBranchTipOf(work);
    expect(newHead).not.toBe(head);
    expect(await revisionOf(work, "HEAD^")).toBe(work.baseTip);
    expect(latestTaskOf(work.dataRoot, KEY).syncedBaseTip).toBe(work.baseTip);
    expect(result).toEqual({
      code: 0,
      out: `moved ${KEY} onto main at ${work.baseTip} by rebase: ${head} to ${newHead}\ndemoted ${KEY} from awaiting_work_review to executed\nstate: executed\n`,
      err: absentRemoteNote(String(work.task.branch)),
    });
    const before = { head, base: "main", baseRevision: BASE_REVISION, syncedBaseTip: start };
    expect(eventsAfter(work, count)).toEqual([
      expect.objectContaining({
        type: "transition",
        data: { head, from: "awaiting_work_review", to: "updating_branch" },
      }),
      expect.objectContaining({
        type: "base",
        data: { base: "main", revision: BASE_REVISION, source: "update" },
      }),
      expect.objectContaining({
        type: "branch_updated",
        data: {
          before,
          after: { ...before, head: newHead, syncedBaseTip: work.baseTip },
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
    const atRiskError = (work: WorkReviewTask, lines: string[]) => {
      const branch = String(work.task.branch);
      return `${branch} and origin/${branch} have diverged, and origin/${branch} has no copy of these commits:\n${lines.join("\n")}\nrun tasker update-branch ${KEY} --take-remote to take origin/${branch} and drop them\n`;
    };
    const takeLine = (branch: string, remote: string) =>
      `synced ${branch} from origin/${branch} at ${remote} by take-remote`;
    const divergedNote = (branch: string) =>
      `note: ${branch} and origin/${branch} have diverged; reconcile the two branches by hand\n`;
    const lastEvent = (work: WorkReviewTask) => eventsOf(work.dataRoot, KEY).at(-1);

    it("moves nothing and writes the note when origin has no such branch", async () => {
      const work = await useWorkReviewTask();
      const head = await taskBranchTipOf(work);

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.err).toBe(absentRemoteNote(String(work.task.branch)));
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

    it("fails and moves nothing when the tips have diverged and local work is at risk", async () => {
      const work = await useWorkReviewTask();
      const branch = work.task.branch!;
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      await work.origin.addCommit(branch, { file: "remote.txt" });
      const head = await commitInWorktree(work.task.worktreePath!, work.env, {
        file: "local.txt",
        message: "local work",
      });
      const count = eventsOf(work.dataRoot, KEY).length;

      const result = await runUpdateBranch();

      expect(result).toEqual({ code: 1, out: "", err: atRiskError(work, [`${head.slice(0, 7)} local work`]) });
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
          error: atRiskError(work, [`${head.slice(0, 7)} local work`]).trimEnd(),
          from: "updating_branch",
          to: "awaiting_work_review",
        },
      });
    });

    it("writes the note and moves nothing when local work is at risk and no commit is only on origin", async () => {
      const work = await useWorkReviewTask();
      const branch = work.task.branch!;
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      await amendWorktreeMessage(work.task.worktreePath!, work.env, "amended message");
      const head = await commitInWorktree(work.task.worktreePath!, work.env, {
        file: "local.txt",
        message: "local work",
      });

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.err).toBe(divergedNote(branch));
      expect(result.out).not.toContain("synced");
      expect(await taskBranchTipOf(work)).toBe(head);
      expect(await revisionOf(work, "HEAD")).toBe(head);
      expect(existsSync(join(work.task.worktreePath!, "local.txt"))).toBe(true);
      expect(lastEvent(work)).toMatchObject({ type: "branch_updated", data: { sync: "none", before: { head } } });
    });

    it("moves nothing when the local copy was rebased with the same patches", async () => {
      const work = await useMovedBaseTask();
      const branch = work.task.branch!;
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      expect((await runUpdateBranch()).code).toBe(0);
      const head = await taskBranchTipOf(work);

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.err).toBe("");
      expect(result.out).not.toContain("synced");
      expect(await taskBranchTipOf(work)).toBe(head);
      expect(lastEvent(work)).toMatchObject({ type: "branch_updated", data: { sync: "none" } });
    });

    it("takes a commit that was pushed by hand when the local copy was rebased", async () => {
      const work = await useMovedBaseTask();
      const branch = work.task.branch!;
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      expect((await runUpdateBranch()).code).toBe(0);
      const remote = await work.origin.addCommit(branch, { file: "remote.txt" });

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      const lines = result.out.split("\n");
      expect(lines[0]).toBe(takeLine(branch, remote));
      expect(lines[1]).toContain(`moved ${KEY} onto main at ${work.baseTip} by rebase`);
      expect(await revisionOf(work, "HEAD^^")).toBe(work.baseTip);
      expect(existsSync(join(work.task.worktreePath!, "remote.txt"))).toBe(true);
      expect(lastEvent(work)).toMatchObject({ type: "branch_updated", data: { sync: "take-remote" } });
    });

    it("takes a merge commit on the remote side", async () => {
      const work = await useMovedBaseTask();
      const branch = work.task.branch!;
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      expect((await runUpdateBranch()).code).toBe(0);
      const remote = await work.origin.addMerge(branch);

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.out.split("\n")[0]).toBe(takeLine(branch, remote));
      expect(lastEvent(work)).toMatchObject({ type: "branch_updated", data: { sync: "take-remote" } });
    });

    it("does not count a merge commit on the local side as local work at risk", async () => {
      const work = await useMovedBaseTask();
      const branch = work.task.branch!;
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      expect((await runUpdateBranch("--strategy", "merge")).code).toBe(0);
      const remote = await work.origin.addCommit(branch, { file: "remote.txt" });

      const result = await runUpdateBranch("--strategy", "merge");

      expect(result.code).toBe(0);
      expect(result.out.split("\n")[0]).toBe(takeLine(branch, remote));
      expect(lastEvent(work)).toMatchObject({ type: "branch_updated", data: { sync: "take-remote" } });
    });

    it("moves nothing when a commit differs only in its message", async () => {
      const work = await useWorkReviewTask();
      const branch = work.task.branch!;
      await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
      const head = await amendWorktreeMessage(work.task.worktreePath!, work.env, "amended message");

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.err).toBe("");
      expect(result.out).not.toContain("synced");
      expect(await taskBranchTipOf(work)).toBe(head);
      expect(lastEvent(work)).toMatchObject({ type: "branch_updated", data: { sync: "none" } });
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

    describe("--take-remote", () => {
      const worktreeStatus = async (work: WorkReviewTask) =>
        await runGit(["status", "--porcelain"], { cwd: work.task.worktreePath!, env: work.env });

      it("writes the note and moves nothing when origin has no such branch", async () => {
        const work = await useWorkReviewTask();
        const head = await taskBranchTipOf(work);

        const result = await runUpdateBranch("--take-remote");

        expect(result.code).toBe(0);
        expect(result.err).toBe(absentRemoteNote(String(work.task.branch)));
        expect(result.out).not.toContain("synced");
        expect(await taskBranchTipOf(work)).toBe(head);
        expect(await revisionOf(work, "HEAD")).toBe(head);
        expect(lastEvent(work)).toMatchObject({ type: "branch_updated", data: { sync: "absent", before: { head } } });
      });

      it("moves nothing when the two tips are equal", async () => {
        const work = await useWorkReviewTask();
        const branch = work.task.branch!;
        const head = await taskBranchTipOf(work);
        await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });

        const result = await runUpdateBranch("--take-remote");

        expect(result.code).toBe(0);
        expect(result.err).toBe("");
        expect(result.out).not.toContain("synced");
        expect(await taskBranchTipOf(work)).toBe(head);
        expect(await revisionOf(work, "HEAD")).toBe(head);
        expect(lastEvent(work)).toMatchObject({ type: "branch_updated", data: { sync: "none", before: { head } } });
      });

      it("fast-forwards when the local tip is an ancestor of the remote tip", async () => {
        const work = await useWorkReviewTask();
        const branch = work.task.branch!;
        const head = await taskBranchTipOf(work);
        await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
        const remote = await work.origin.addCommit(branch, { file: "remote.txt" });

        const result = await runUpdateBranch("--take-remote");

        expect(result.code).toBe(0);
        expect(result.err).toBe("");
        expect(result.out.split("\n")[0]).toBe(`synced ${branch} from origin/${branch} at ${remote} by fast-forward`);
        expect(await taskBranchTipOf(work)).toBe(remote);
        expect(await revisionOf(work, "HEAD")).toBe(remote);
        expect(latestTaskOf(work.dataRoot, KEY).state).toBe("executed");
        expect(lastEvent(work)).toMatchObject({
          type: "branch_updated",
          data: { sync: "fast-forward", before: { head } },
        });
      });

      it("moves nothing when the remote tip is an ancestor of the local tip", async () => {
        const work = await useWorkReviewTask();
        const branch = work.task.branch!;
        await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
        const head = await commitInWorktree(work.task.worktreePath!, work.env, { file: "local.txt" });

        const result = await runUpdateBranch("--take-remote");

        expect(result.code).toBe(0);
        expect(result.err).toBe("");
        expect(result.out).not.toContain("synced");
        expect(await taskBranchTipOf(work)).toBe(head);
        expect(await revisionOf(work, "HEAD")).toBe(head);
        expect(existsSync(join(work.task.worktreePath!, "local.txt"))).toBe(true);
        expect(lastEvent(work)).toMatchObject({ type: "branch_updated", data: { sync: "none", before: { head } } });
      });

      it("takes the remote tip when the tips have diverged", async () => {
        const work = await useWorkReviewTask();
        const branch = work.task.branch!;
        await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
        const remote = await work.origin.addCommit(branch, { file: "remote.txt" });
        const head = await commitInWorktree(work.task.worktreePath!, work.env, { file: "local.txt" });

        const result = await runUpdateBranch("--take-remote");

        expect(result.code).toBe(0);
        expect(result.out.split("\n")[0]).toBe(takeLine(branch, remote));
        expect(await taskBranchTipOf(work)).toBe(remote);
        expect(await revisionOf(work, "HEAD")).toBe(remote);
        expect(existsSync(join(work.task.worktreePath!, "local.txt"))).toBe(false);
        expect(await worktreeStatus(work)).toBe("");
        expect(latestTaskOf(work.dataRoot, KEY).state).toBe("executed");
        expect(lastEvent(work)).toMatchObject({
          type: "branch_updated",
          data: { sync: "take-remote", before: { head } },
        });
      });

      it("takes the remote tip when local work is at risk and no commit is only on origin", async () => {
        const work = await useWorkReviewTask();
        const branch = work.task.branch!;
        await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
        const remote = await taskBranchTipOf(work);
        await amendWorktreeMessage(work.task.worktreePath!, work.env, "amended message");
        const head = await commitInWorktree(work.task.worktreePath!, work.env, {
          file: "local.txt",
          message: "local work",
        });

        const result = await runUpdateBranch("--take-remote");

        expect(result.code).toBe(0);
        expect(result.out.split("\n")[0]).toBe(takeLine(branch, remote));
        expect(await taskBranchTipOf(work)).toBe(remote);
        expect(existsSync(join(work.task.worktreePath!, "local.txt"))).toBe(false);
        expect(lastEvent(work)).toMatchObject({
          type: "branch_updated",
          data: { sync: "take-remote", before: { head } },
        });
      });

      it("rebases onto the moved base after the take", async () => {
        const work = await useMovedBaseTask();
        const branch = work.task.branch!;
        await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
        const remote = await work.origin.addCommit(branch, { file: "remote.txt" });
        await commitInWorktree(work.task.worktreePath!, work.env, { file: "local.txt" });

        const result = await runUpdateBranch("--take-remote");

        const newHead = await taskBranchTipOf(work);
        expect(result.code).toBe(0);
        expect(result.out).toBe(
          `${takeLine(branch, remote)}\n` +
            `moved ${KEY} onto main at ${work.baseTip} by rebase: ${remote} to ${newHead}\n` +
            `demoted ${KEY} from awaiting_work_review to executed\nstate: executed\n`,
        );
        expect(await revisionOf(work, "HEAD^^")).toBe(work.baseTip);
        expect(lastEvent(work)).toMatchObject({
          type: "branch_updated",
          data: { how: "rebase", sync: "take-remote", after: { head: newHead } },
        });
      });

      it("rebases onto the base after a take of a remote tip that lacks the base", async () => {
        const work = await useMovedBaseTask();
        const branch = work.task.branch!;
        const remote = await taskBranchTipOf(work);
        await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
        expect((await runUpdateBranch()).code).toBe(0);

        const result = await runUpdateBranch("--take-remote");

        const newHead = await taskBranchTipOf(work);
        expect(result.code).toBe(0);
        expect(result.out).toBe(
          `${takeLine(branch, remote)}\n` +
            `moved ${KEY} onto main at ${work.baseTip} by rebase: ${remote} to ${newHead}\n` +
            `state: executed\n`,
        );
        expect(await revisionOf(work, "HEAD^")).toBe(work.baseTip);
        expect(lastEvent(work)).toMatchObject({
          type: "branch_updated",
          data: { how: "rebase", sync: "take-remote", after: { head: newHead } },
        });
      });

      it("moves back to the local tip when the base step fails after the take", async () => {
        const work = await useMovedBaseTask({ baseChange: { file: "work.txt", content: "from the base\n" } });
        const branch = work.task.branch!;
        await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
        await work.origin.addCommit(branch, { file: "work.txt", content: "from the remote\n" });
        const head = await commitInWorktree(work.task.worktreePath!, work.env, { file: "local.txt" });

        const result = await runUpdateBranch("--take-remote");

        expect(result.code).toBe(1);
        expect(result.out).toBe("");
        expect(result.err).toContain("work.txt");
        expect(await taskBranchTipOf(work)).toBe(head);
        expect(await revisionOf(work, "HEAD")).toBe(head);
        expect(latestTaskOf(work.dataRoot, KEY).state).toBe("awaiting_work_review");
        expect(lastEvent(work)).toMatchObject({
          type: "branch_updated",
          data: { how: "none", sync: "take-remote", error: result.err.trimEnd() },
        });
      });
    });
  });

  describe("the accepted revision", () => {
    it("moves a task in accepted to executed when a commit moved the tip after the accept", async () => {
      const accepted = await useAcceptedTask();
      await commitInWorktree(accepted.task.worktreePath!, accepted.env, { file: "late.txt" });
      const count = eventsOf(accepted.dataRoot, KEY).length;

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.out.endsWith(`demoted ${KEY} from accepted to executed\nstate: executed\n`)).toBe(true);
      expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("executed");
      expect(
        eventsOf(accepted.dataRoot, KEY)
          .slice(count)
          .map((e) => e.type),
      ).not.toContain("base");
    });

    it("moves a task that failed from merging to executed when its tip is not the accepted revision", async () => {
      const accepted = await useAcceptedTask();
      withDataRootStore(accepted.dataRoot, (store) => failTaskVia(store, accepted.task.id, "accepted", "merging"));
      await commitInWorktree(accepted.task.worktreePath!, accepted.env, { file: "late.txt" });

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.out.endsWith(`state: executed\n`)).toBe(true);
      expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("executed");
    });

    it("moves a task in accepted with no accepted revision to executed", async () => {
      const work = await useAcceptedTaskWithNoRevision();
      const count = eventsOf(work.dataRoot, KEY).length;

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.out.endsWith(`demoted ${KEY} from accepted to executed\nstate: executed\n`)).toBe(true);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("executed");
      expect(
        eventsOf(work.dataRoot, KEY)
          .slice(count)
          .map((e) => e.type),
      ).not.toContain("base");
    });

    it("keeps a task in accepted when the tip is the accepted revision", async () => {
      const accepted = await useAcceptedTask();

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.out.endsWith("state: accepted\n")).toBe(true);
      expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("accepted");
    });

    it("moves a task in accepted to executed when the base step moved the head", async () => {
      const accepted = await useAcceptedTask();
      await accepted.origin.addCommit("main");
      const count = eventsOf(accepted.dataRoot, KEY).length;

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("executed");
      const events = eventsOf(accepted.dataRoot, KEY).slice(count);
      expect(events.filter((e) => e.type === "base")).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ type: "branch_updated", data: { how: "rebase" } });
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

      const result = await runUpdateBranch();

      expect(result.code).toBe(0);
      expect(result.out).toContain("nothing moved");
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("awaiting_work_review");
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
      expect(result.err.startsWith(absentRemoteNote(String(work.task.branch)))).toBe(true);
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
          error: result.err.slice(absentRemoteNote(String(work.task.branch)).length).trimEnd(),
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
      expect(result.err.startsWith(absentRemoteNote(String(work.task.branch)))).toBe(true);
      expect(result.err.slice(absentRemoteNote(String(work.task.branch)).length)).toMatch(
        /^updating branch failed: cannot restore the worktree/,
      );
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
