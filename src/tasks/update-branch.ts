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
import { type ReconcileStrategy, type ResyncResult, uncommittedChangeText, vcsForRepo } from "../vcs/provider.js";
import { failRun } from "./run-outcome.js";
import { requireBase, requireBaseRevision, requireBranch, requireWorktree, taskInState } from "./task-state.js";

export interface UpdateBranchRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The command reads it again under the task lock.
  taskId: number;
  // The raw value of --strategy, or undefined when the option is absent.
  strategy: string | undefined;
  env: NodeJS.ProcessEnv;
  io: Io;
  // How long the command waits for the lock of the clone.
  repoLockWaitMs: number;
}

export interface BranchUpdated {
  issueKey: string;
  base: string;
  // The tip of the base that the command read.
  baseTip: string;
  how: ResyncResult["how"];
  headBefore: string;
  headAfter: string;
  // The state of the task before the command.
  origin: TaskState;
  // The state of the task after the command.
  state: TaskState;
}

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

// Brings the worktree of a task up to date with its base. The task lock covers all the steps and does not wait. The
// repo lock covers the fetch and the move of the branch. When the head moved, the task goes to the target of the
// demotion table. Otherwise it goes back to its origin state.
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
    try {
      const { baseTip, contains } = await vcs.baseContainment(ctx, { taskRef: branch, baseRevision });
      const resynced: Pick<ResyncResult, "how" | "head"> = contains
        ? { how: "none", head: before.head }
        : await vcs.resync(ctx, { path, baseRevision: baseTip, strategy });
      const moved = resynced.how !== "none";
      const state = moved ? demotedTarget(origin, failedIn) : origin;
      const writes: BranchUpdateWrites = {};
      if (moved) {
        writes.base = { base, revision: baseRevision };
        if (origin === "approved") writes.clearPlanApproval = store.pinnedPlanRevision(task.id)?.version;
      }
      const after: BranchSnapshot = { ...before, head: resynced.head };
      transitionWithBranchUpdate(store, task.id, state, { before, after, how: resynced.how }, writes);
      return {
        issueKey: task.issueKey,
        base,
        baseTip,
        how: resynced.how,
        headBefore: before.head,
        headAfter: resynced.head,
        origin,
        state,
      };
    } catch (error) {
      return failRun(store, task, io, `updating branch failed: ${errorMessage(error)}`);
    }
  });
}
