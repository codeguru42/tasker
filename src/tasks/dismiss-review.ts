import type { IssueRef } from "../issue-key/ref.js";
import { transitionWithReviewDismissal } from "../state/machine.js";
import { withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { taskInState } from "./task-state.js";

export interface DismissReviewRequest {
  ref: IssueRef;
  // The task that the lookup found. The dismissal reads it again under the task lock.
  taskId: number;
  reason: string;
  // The positions to dismiss, as the user typed them after the trim of the spaces. Without it, the command dismisses every
  // open finding.
  positions?: string[];
}

export interface ReviewDismissed {
  issueKey: string;
  number: number;
  // The dismissed positions, in ascending order.
  positions: number[];
  // The positions that are still open, in ascending order.
  open: number[];
}

// Dismisses findings of the latest review of a task in reviewed, with one reason. The task lock covers all the steps. It
// does not wait. Every check runs before the first write.
export async function dismissReviewTask(store: TaskStore, request: DismissReviewRequest): Promise<ReviewDismissed> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => dismissReviewLocked(store, request));
}

async function dismissReviewLocked(store: TaskStore, request: DismissReviewRequest): Promise<ReviewDismissed> {
  const task = taskInState(store, request.taskId, "dismiss-review");
  if (request.reason.trim() === "") throw new Error("the reason is empty");
  const review = store.latestReview(task.id);
  if (review === undefined) throw new Error(`the task of ${task.issueKey} is in reviewed and has no review`);
  const findings = review.findings;

  let positions: number[];
  if (request.positions === undefined) {
    positions = findings.filter((entry) => entry.dismissed === null).map((entry) => entry.position);
    if (positions.length === 0) throw new Error(`the latest review of ${task.issueKey} has no open finding`);
  } else {
    const lines: string[] = [];
    positions = [];
    for (const text of request.positions) {
      const entry = findings.find((candidate) => String(candidate.position) === text);
      if (entry === undefined) {
        lines.push(`the latest review of ${task.issueKey} has no finding ${text}; it has ${findings.length}`);
      } else if (entry.dismissed !== null) {
        lines.push(`finding ${text} of ${task.issueKey} is already dismissed: ${entry.dismissed.reason}`);
      } else {
        positions.push(entry.position);
      }
    }
    if (lines.length > 0) throw new Error(lines.join("\n"));
  }

  positions = [...positions].sort((a, b) => a - b);
  const open = transitionWithReviewDismissal(store, task.id, review.number, positions, request.reason);
  return { issueKey: task.issueKey, number: review.number, positions, open };
}
