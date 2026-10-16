import { acceptedStates, type TaskCommand } from "../state/commands.js";
import type { TaskState } from "../state/machine.js";
import { baseRevisionOf } from "./base-revision.js";
import { taskNotFound, type Task, type TaskStore } from "../store/store.js";

// The task with the id. An id with no task throws taskNotFound.
export function taskById(store: TaskStore, taskId: number): Task {
  const task = store.getTask(taskId);
  if (task === undefined) throw taskNotFound(taskId);
  return task;
}

// The states as text: "a", "a or b" or "a, b or c". An empty list gives "no state".
function statesText(states: readonly TaskState[]): string {
  const last = states.at(-1);
  if (last === undefined) return "no state";
  return states.length === 1 ? last : `${states.slice(0, -1).join(", ")} or ${last}`;
}

// Throws when the state of the task is not one that the command accepts. The table of the commands of each state
// gives these states. The command is the name of the tasker command.
export function assertTaskState(task: Task, command: TaskCommand): void {
  const allowed = acceptedStates(command);
  if (!allowed.includes(task.state as TaskState)) {
    throw new Error(`the task of ${task.issueKey} is in ${task.state}; tasker ${command} needs ${statesText(allowed)}`);
  }
}

// The task with the id, in a state that the command accepts. Throws for an unknown id and for another state.
export function taskInState(store: TaskStore, taskId: number, command: TaskCommand): Task {
  const task = taskById(store, taskId);
  assertTaskState(task, command);
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

// The base of the task. Throws when the task has none.
export function requireBase(task: Task): string {
  if (task.base === null) throw new Error(`the task of ${task.issueKey} has no base`);
  return task.base;
}

// The revision of the newest base event of the task. Throws when the task has none.
export function requireBaseRevision(store: TaskStore, task: Task): string {
  const revision = baseRevisionOf(store, task.id);
  if (revision === undefined) throw new Error(`the task of ${task.issueKey} has no base revision`);
  return revision;
}
