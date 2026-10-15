import type { IssueRef } from "../issue-key/ref.js";
import { transitionWithPlanUnapproval } from "../state/machine.js";
import { withTaskLock } from "../store/locks.js";
import { taskNotFound, type TaskStore } from "../store/store.js";

export interface UnapproveRequest {
  ref: IssueRef;
  // The task that the lookup found. The unapprove reads it again under the task lock.
  taskId: number;
}

export interface Unapproved {
  issueKey: string;
  version: number;
}

// Clears the approval of the pinned plan revision of an approved task. The task lock covers all the steps. It does not wait.
export async function unapproveTask(store: TaskStore, request: UnapproveRequest): Promise<Unapproved> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => unapproveLocked(store, request));
}

async function unapproveLocked(store: TaskStore, request: UnapproveRequest): Promise<Unapproved> {
  const task = store.getTask(request.taskId);
  if (task === undefined) throw taskNotFound(request.taskId);
  if (task.state !== "approved") {
    throw new Error(`the task of ${task.issueKey} is in ${task.state}; tasker unapprove needs approved`);
  }
  const pinned = store.pinnedPlanRevision(task.id);
  if (pinned === undefined) throw new Error(`the task of ${task.issueKey} is approved, but no revision is pinned`);
  transitionWithPlanUnapproval(store, task.id, pinned.version);
  return { issueKey: task.issueKey, version: pinned.version };
}
