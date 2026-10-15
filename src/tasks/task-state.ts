import type { TaskState } from "../state/machine.js";
import { baseRevisionOf } from "./base-revision.js";
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

// The worktree path of the task. Throws when the task has none.
export function requireWorktree(task: Task): string {
  if (task.worktreePath === null) throw new Error(`the task of ${task.issueKey} has no worktree`);
  return task.worktreePath;
}

// The branch of the task. Throws when the task has none.
export function requireBranch(task: Task): string {
  if (task.branch === null) throw new Error(`the task of ${task.issueKey} has no branch`);
  return task.branch;
}

// The revision of the newest base event of the task. Throws when the task has none.
export function requireBaseRevision(store: TaskStore, task: Task): string {
  const revision = baseRevisionOf(store, task.id);
  if (revision === undefined) throw new Error(`the task of ${task.issueKey} has no base revision`);
  return revision;
}
