import { lastTransitionIndex, type TaskState } from "../state/machine.js";
import { withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { moveFromPause, type ResumeRequest, type ResumeResult } from "./resume.js";
import { taskInState } from "./task-state.js";

export type ApproveCreditsRequest = ResumeRequest;

export interface ApproveCreditsResult extends ResumeResult {
  // The reset time of the approved quota window. The pause record gives it, and a pause can have none.
  approvedResetsAt?: number;
}

// Moves a task in awaiting_quota_approval, or in quota_blocked at the overage boundary, back to the state before the
// run that stopped, like tasker resume, and records the approved quota window in the same transaction. It runs under
// the task lock, and the caller runs the next command after the lock is free.
export async function approveCreditsTask(
  store: TaskStore,
  request: ApproveCreditsRequest,
): Promise<ApproveCreditsResult> {
  const { repoKey, key } = request.ref;
  return withTaskLock(store, repoKey, key, () => approveCreditsLocked(store, request));
}

function approveCreditsLocked(store: TaskStore, request: ApproveCreditsRequest): ApproveCreditsResult {
  const task = taskInState(store, request.taskId, "approve-credits");
  const events = store.listEvents(request.taskId);
  // taskInState made sure that the task is in a pause, so its state is a task state.
  const pause = task.state as TaskState;
  const record = (events[lastTransitionIndex(events, pause)]?.data ?? {}) as { cause?: unknown; resetsAt?: unknown };
  const resetsAt = typeof record.resetsAt === "number" ? record.resetsAt : undefined;
  if (pause === "quota_blocked") {
    if (record.cause !== "overage") {
      throw new Error(
        `the task of ${task.issueKey} stopped at a subscription limit, and paid usage cannot continue it; run tasker resume ${task.issueKey} after the reset`,
      );
    }
    if (resetsAt === undefined) {
      throw new Error(
        `the task of ${task.issueKey} stopped at the overage boundary, but the stop named no window, so an approval cannot hold; run tasker resume ${task.issueKey} after the reset`,
      );
    }
  }
  const result = moveFromPause(
    store,
    task,
    events,
    "approve-credits",
    resetsAt === undefined ? [] : [{ type: "credits_approved", data: { resetsAt } }],
  );
  return resetsAt === undefined ? result : { ...result, approvedResetsAt: resetsAt };
}
