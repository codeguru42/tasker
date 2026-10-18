import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import {
  type BranchSnapshot,
  type TaskState,
  transitionFromEvents,
  transitionTask,
  transitionWithBranchUpdate,
} from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { BranchUpdateWrites, TaskStore } from "../store/store.js";
import {
  type ReconcileStrategy,
  type ResyncResult,
  type VcsProvider,
  type VcsContext,
  uncommittedChangeText,
  vcsForRepo,
} from "../vcs/provider.js";
import { failRun } from "./run-outcome.js";
import { requireBase, requireBaseRevision, requireBranch, requireWorktree, taskInState } from "./task-state.js";

export interface UpdateBranchRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The command reads it again under the task lock.
  taskId: number;
  // The raw value of --strategy, or undefined when the option is absent.
  strategy: string | undefined;
  // True with --take-remote: the sync step moves the branch and the worktree to the remote tip when it differs.
  takeRemote: boolean;
  env: NodeJS.ProcessEnv;
  io: Io;
  // How long the command waits for the lock of the clone.
  repoLockWaitMs: number;
}

// What the sync step did. A fast-forward and a take have a remote tip: the tip of the copy on origin that the step moved to.
export type SyncOutcome = { sync: "fast-forward" | "take-remote"; remoteTip: string } | { sync: "absent" | "none" };

export type BranchUpdated = SyncOutcome & {
  issueKey: string;
  base: string;
  // The tip of the base that the command read.
  baseTip: string;
  // The task branch.
  branch: string;
  how: ResyncResult["how"];
  // The head at the start of the base step. After a move of the sync step, this is the remote tip.
  headBefore: string;
  headAfter: string;
  // The state of the task before the command.
  origin: TaskState;
  // The state of the task after the command.
  state: TaskState;
};

// A result with exitCode means that the step already printed the message.
export type UpdateBranchResult = BranchUpdated | { exitCode: number };

// The target of a task whose head moved, by origin state. An origin that is not in the table keeps its state.
const DEMOTED_TO: Readonly<Partial<Record<TaskState, TaskState>>> = {
  approved: "awaiting_plan_review",
  awaiting_work_review: "executed",
  reviewed: "executed",
  accepted: "executed",
  pushed: "executed",
  in_peer_review: "executed",
};

// The states a task failed in that a moved head demotes to executed.
const FAILED_IN_DEMOTED: readonly TaskState[] = ["reviewing", "accepted", "pushing", "opening_pr", "merging"];

function demotedTarget(origin: TaskState, failedIn: TaskState | undefined): TaskState {
  if (origin === "failed") {
    return failedIn !== undefined && FAILED_IN_DEMOTED.includes(failedIn) ? "executed" : origin;
  }
  return DEMOTED_TO[origin] ?? origin;
}

function strategyOf(raw: string | undefined, fallback: ReconcileStrategy): ReconcileStrategy {
  if (raw === undefined) return fallback;
  if (raw === "rebase" || raw === "merge") return raw;
  throw new Error(`--strategy must be rebase or merge: ${raw}`);
}

// True when the worktree is at the head of the start, on the task branch and clean. A failed read of the state counts
// as not back at the start.
async function backAtStart(
  vcs: VcsProvider,
  ctx: VcsContext,
  start: { path: string; branch: string; head: string },
): Promise<boolean> {
  try {
    const state = await vcs.workspaceState(ctx, { path: start.path });
    return state.head === start.head && state.taskRef === start.branch && state.changes.length === 0;
  } catch {
    return false;
  }
}

// Brings the task branch current with its copy on origin and brings the worktree of the task up to date with its base. The task lock covers all the steps
// and does not wait. The repo lock covers the fetch and the move of the branch. The sync step comes first. It moves the
// task branch to the copy on origin only by a fast-forward, and it refuses tips that have diverged. With takeRemote, it
// moves the task branch and the worktree to the copy on origin whenever the tips differ, and it fails when origin has no
// such branch. Then the base step
// runs on the new local tip. A failed base step also undoes the sync move. When the head moved in either step, the task
// goes to the target of the demotion table. Otherwise it goes back to its origin state.
export async function updateBranchTask(store: TaskStore, request: UpdateBranchRequest): Promise<UpdateBranchResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => updateBranchLocked(store, request));
}

async function updateBranchLocked(store: TaskStore, request: UpdateBranchRequest): Promise<UpdateBranchResult> {
  const { config, env, io } = request;
  const task = taskInState(store, request.taskId, "update-branch");
  const branch = requireBranch(task);
  const path = requireWorktree(task);
  const base = requireBase(task);
  const baseRevision = requireBaseRevision(store, task);
  const strategy = strategyOf(request.strategy, config.repos[task.repoKey].updateBranchStrategy);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const start = await vcs.workspaceState(ctx, { path });
  if (start.changes.length > 0) {
    throw new Error(
      [
        `the worktree has uncommitted changes: ${path}`,
        ...start.changes.map(uncommittedChangeText),
        "tasker update-branch needs a clean worktree",
      ].join("\n"),
    );
  }
  const before: BranchSnapshot = { head: start.head, base, baseRevision };
  const origin = task.state as TaskState;
  const failedIn = origin === "failed" ? transitionFromEvents(store.listEvents(task.id), "failed") : undefined;
  return withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    transitionTask(store, task.id, "updating_branch");
    // What the sync step did, and the head after it. The catch reads both to undo a sync move.
    let synced: SyncOutcome = { sync: "none" };
    let syncedHead = before.head;
    try {
      const { revision, baseTip, contains } = await vcs.baseContainment(ctx, { taskRef: branch, baseRevision });
      const remote = await vcs.fetchedRemoteTaskRef(ctx, { taskRef: branch, revision });
      if (remote.state === "absent") {
        synced = { sync: "absent" };
        if (request.takeRemote) throw new Error(`--take-remote: origin/${branch} does not exist`);
        io.stderr(`note: origin/${branch} does not exist; nothing to sync from\n`);
      } else if (request.takeRemote && remote.relation !== "equal") {
        syncedHead = await vcs.moveWorkspace(ctx, { path, revision: remote.revision });
        synced = { sync: "take-remote", remoteTip: remote.revision };
      } else if (remote.relation === "local-ancestor") {
        syncedHead = await vcs.moveWorkspace(ctx, { path, revision: remote.revision });
        synced = { sync: "fast-forward", remoteTip: remote.revision };
      } else if (remote.relation === "diverged") {
        throw new Error(
          `${branch} and origin/${branch} have diverged; make one of them contain the other, then run tasker update-branch ${task.issueKey} again`,
        );
      }
      const resynced: Pick<ResyncResult, "how" | "head"> = contains
        ? { how: "none", head: syncedHead }
        : await vcs.resync(ctx, { path, baseRevision: baseTip, strategy });
      const moved = "remoteTip" in synced || resynced.how !== "none";
      const state = moved ? demotedTarget(origin, failedIn) : origin;
      const writes: BranchUpdateWrites = {};
      if (moved) {
        writes.base = { base, revision: baseRevision };
        if (origin === "approved") writes.clearPlanApproval = store.pinnedPlanRevision(task.id)?.version;
      }
      const after: BranchSnapshot = { ...before, head: resynced.head };
      transitionWithBranchUpdate(
        store,
        task.id,
        state,
        { before, after, how: resynced.how, sync: synced.sync },
        writes,
      );
      return {
        issueKey: task.issueKey,
        base,
        baseTip,
        branch,
        ...synced,
        how: resynced.how,
        headBefore: syncedHead,
        headAfter: resynced.head,
        origin,
        state,
      };
    } catch (error) {
      const message = errorMessage(error);
      if (syncedHead !== before.head) {
        // Undo the sync move. A failed move back shows in backAtStart, so its error is dropped.
        await vcs.moveWorkspace(ctx, { path, revision: before.head }).catch(() => undefined);
      }
      if (await backAtStart(vcs, ctx, { path, branch, head: before.head })) {
        // This step does not call failRunTo: the branch_updated event takes the place of the transition event.
        transitionWithBranchUpdate(
          store,
          task.id,
          origin,
          { before, after: before, how: "none", sync: synced.sync, error: message },
          {},
        );
        io.stderr(`${message}\n`);
        return { exitCode: 1 };
      }
      return failRun(store, task, io, `updating branch failed: ${message}`);
    }
  });
}
