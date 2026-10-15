import type { TaskState } from "../state/machine.js";
import { taskNotFound, type Task, type TaskStore } from "../store/store.js";

// The task with the id. An id with no task throws taskNotFound.
export function taskById(store: TaskStore, taskId: number): Task {
  const task = store.getTask(taskId);
  if (task === undefined) throw taskNotFound(taskId);
  return task;
}

// Throws when the task is in another state than state. The command is the name of the tasker command.
export function assertTaskState(task: Task, state: TaskState, command: string): void {
  if (task.state !== state) {
    throw new Error(`the task of ${task.issueKey} is in ${task.state}; tasker ${command} needs ${state}`);
  }
}

// The task with the id, in the state. Throws for an unknown id and for another state.
export function taskInState(store: TaskStore, taskId: number, state: TaskState, command: string): Task {
  const task = taskById(store, taskId);
  assertTaskState(task, state, command);
  return task;
}
