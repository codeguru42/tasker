import type { IssueRef } from "../issue-key/ref.js";
import { failedFrom, transitionWithMarkedLanding } from "../state/machine.js";
import { withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { taskById, taskInState } from "./task-state.js";

export interface MarkLandedRequest {
  ref: IssueRef;
  // The task that the lookup found. The command reads it again under the task lock.
  taskId: number;
}

export interface MarkedLanded {
  issueKey: string;
}

// Records an operator declaration that work in an allowed state landed. The task lock does not wait.
export async function markLandedTask(store: TaskStore, request: MarkLandedRequest): Promise<MarkedLanded> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => markLandedLocked(store, request));
}

function markLandedLocked(store: TaskStore, request: MarkLandedRequest): MarkedLanded {
  const found = taskById(store, request.taskId);
  const task =
    found.state === "failed" && failedFrom(store, found.id) === "opening_pr"
      ? found
      : taskInState(store, request.taskId, "mark-landed");
  transitionWithMarkedLanding(store, task.id);
  return { issueKey: task.issueKey };
}
