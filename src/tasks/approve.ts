import type { IssueRef } from "../issue-key/ref.js";
import type { PlanAnswer } from "../plan/answer.js";
import { transitionWithPlanApproval } from "../state/machine.js";
import { withTaskLock } from "../store/locks.js";
import type { TaskEvent, TaskStore } from "../store/store.js";
import { assertTaskState, taskById } from "./task-state.js";

export interface ApproveRequest {
  ref: IssueRef;
  // The task that the lookup found. The approve reads it again under the task lock.
  taskId: number;
  // Prints the overlap warning for the files of the newest revision. It runs after the checks and before the write.
  warnOverlaps: (files: readonly string[]) => Promise<void>;
}

export interface Approved {
  issueKey: string;
  version: number;
  // The questions of the approved revision. All questions of the newest revision are open.
  openQuestions: PlanAnswer["questions"];
}

// Approves the newest plan revision of the task. The task lock covers all the steps. It does not wait.
export async function approveTask(store: TaskStore, request: ApproveRequest): Promise<Approved> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => approveLocked(store, request));
}

// True when the newest branch_updated event with a head that moved comes after the newest plan_revision event.
function planIsOlderThanLastMove(events: readonly TaskEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const { type, data } = events[i];
    if (type === "plan_revision") return false;
    if (type === "branch_updated" && (data as { how?: unknown }).how !== "none") return true;
  }
  return false;
}

async function approveLocked(store: TaskStore, request: ApproveRequest): Promise<Approved> {
  const task = taskById(store, request.taskId);
  if (task.state === "approved") {
    const pinned = store.pinnedPlanRevision(task.id);
    if (pinned !== undefined) throw new Error(`${task.issueKey} is already approved at revision v${pinned.version}`);
  }
  assertTaskState(task, "approve");
  const revision = store.latestPlanRevision(task.id);
  if (revision === undefined) throw new Error(`the task of ${task.issueKey} has no plan revision`);
  if (planIsOlderThanLastMove(store.listEvents(task.id))) {
    throw new Error(
      `the plan v${revision.version} of ${task.issueKey} is older than the last move of the worktree; run tasker refine ${task.issueKey} "<feedback>" first`,
    );
  }
  const openQuestions = revision.answer.questions;
  await request.warnOverlaps(revision.answer.files_changed);
  transitionWithPlanApproval(store, task.id, revision.version, openQuestions.length);
  return { issueKey: task.issueKey, version: revision.version, openQuestions };
}
