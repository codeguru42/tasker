import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { readLogTail } from "../phases/command-step.js";
import {
  failedFromEvents,
  lastFailIndex,
  lastTransitionError,
  transitionWithRetry,
  type TaskState,
} from "../state/machine.js";
import { verifyCommandLogPath } from "../store/layout.js";
import { withTaskLock } from "../store/locks.js";
import type { RetryWrites, TaskEvent, TaskStore, VerifyRun } from "../store/store.js";
import { taskInState } from "./task-state.js";

// The command that runs after the move of a retry. refine is not run: the operator gives the feedback.
export type RetryNext = "start" | "plan" | "refine" | "execute" | "verify";

export interface RetryRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The retry reads it again under the task lock.
  taskId: number;
  resumeExecute: boolean;
}

export interface RetryResult {
  origin: TaskState;
  target: TaskState;
  next: RetryNext;
}

interface RetryRow {
  // The state that the task moves to. For provisioning it is the target that the event names, and no move happens.
  target: TaskState;
  next: RetryNext;
  // What the retry writes beside the move.
  clears: { plan?: boolean; execute?: boolean };
}

// The table of retry: the origin (the state that the task left when it failed) gives the row.
const RETRY_TABLE: Partial<Record<TaskState, RetryRow>> = {
  provisioning: { target: "provisioning", next: "start", clears: {} },
  planning: { target: "workspace_ready", next: "plan", clears: { plan: true } },
  refining: { target: "awaiting_plan_review", next: "refine", clears: {} },
  executing: { target: "approved", next: "execute", clears: { execute: true } },
  verifying: { target: "executed", next: "verify", clears: {} },
};

// The row of verifying with --resume-execute.
const RESUME_EXECUTE_ROW: RetryRow = { target: "approved", next: "execute", clears: {} };

// The most lines and the most bytes of the log tail that a fix turn gets.
const TAIL_LINES = 200;
const TAIL_BYTES = 65536;

// Moves a task in failed back to the state before the step that failed, under the task lock, and says which command
// runs next. The caller runs that command after the lock is free.
export async function retryTask(store: TaskStore, request: RetryRequest): Promise<RetryResult> {
  const { repoKey, key } = request.ref;
  return withTaskLock(store, repoKey, key, () => retryLocked(store, request));
}

function retryLocked(store: TaskStore, request: RetryRequest): RetryResult {
  const { config, taskId, resumeExecute } = request;
  const task = taskInState(store, taskId, "failed", "retry");
  const events = store.listEvents(taskId);
  const origin = failedFromEvents(events);
  const row = origin === undefined ? undefined : RETRY_TABLE[origin];
  if (origin === undefined || row === undefined) {
    throw new Error(`the task of ${task.issueKey} failed in ${origin ?? "unknown"}; tasker retry has no step for it`);
  }
  if (resumeExecute && origin !== "verifying") {
    throw new Error("--resume-execute applies only to a task that failed in verifying");
  }
  const chosen = resumeExecute ? RESUME_EXECUTE_ROW : row;
  const result = { origin, target: chosen.target, next: chosen.next };
  if (origin === "provisioning") {
    // The steps of tasker start move the task from failed to provisioning.
    store.appendEvent(taskId, "retry", { origin, target: chosen.target, resumeExecute: false });
    return result;
  }
  const writes: RetryWrites = {};
  if (chosen.clears.plan === true) writes.clearPlanSession = true;
  const pinned = store.pinnedPlanRevision(taskId);
  if (chosen.clears.execute === true && pinned !== undefined) writes.clearExecuteSession = pinned.version;
  if (resumeExecute) {
    if (pinned === undefined) throw new Error(`the task of ${task.issueKey} has no pinned plan revision`);
    const run = runOfFailure(store, events);
    const logPath =
      run === undefined || run.failingCommand === null
        ? undefined
        : verifyCommandLogPath(config.dataRoot, task, run.number, run.failingCommand);
    writes.resumeExecute = {
      version: pinned.version,
      fixTurn: {
        verifyFailure: lastTransitionError(events) ?? "",
        verifyLogTail: logPath === undefined ? null : readLogTail(logPath, TAIL_LINES, TAIL_BYTES),
      },
    };
  }
  transitionWithRetry(store, taskId, chosen.target, { origin, resumeExecute }, writes);
  return result;
}

// The verify run that the last move into failed recorded, or undefined.
// Three verify failures record no run, so the latest run can belong to an earlier verify, and its log does not
// belong to this error. addVerifyRun writes the verify_run event right before the transition event, in one
// transaction. So the run of this failure is the latest run only when the event right before the last
// transition to failed is a verify_run event with the number of the latest run. An equal time alone is not enough.
function runOfFailure(store: TaskStore, events: readonly TaskEvent[]): VerifyRun | undefined {
  const index = lastFailIndex(events);
  if (index <= 0) return undefined;
  const latest = store.latestVerifyRun(events[index].taskId);
  if (latest === undefined) return undefined;
  const before = events[index - 1];
  const data = before.data as { number?: unknown } | null;
  return before.type === "verify_run" && data?.number === latest.number ? latest : undefined;
}
