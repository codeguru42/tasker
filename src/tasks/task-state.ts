import type { TaskState } from "../state/machine.js";
import { baseRevisionOf } from "./base-revision.js";
import { taskNotFound, type Task, type TaskStore } from "../store/store.js";

// The task with the id. An id with no task throws taskNotFound.
export function taskById(store: TaskStore, taskId: number): Task {
  const task = store.getTask(taskId);
  if (task === undefined) throw taskNotFound(taskId);
  return task;
}

// One state, or a list of at least one state.
type StateOrList = TaskState | readonly [TaskState, ...TaskState[]];

// The states as text: "a", "a or b" or "a, b or c".
function statesText(state: StateOrList): string {
  if (typeof state === "string") return state;
  const last = state[state.length - 1];
  return state.length === 1 ? last : `${state.slice(0, -1).join(", ")} or ${last}`;
}

// Throws when the task is in none of the states. The state is one state or a list of states.
// The command is the name of the tasker command.
export function assertTaskState(task: Task, state: StateOrList, command: string): void {
  const allowed: readonly TaskState[] = typeof state === "string" ? [state] : state;
  if (!allowed.includes(task.state as TaskState)) {
    throw new Error(`the task of ${task.issueKey} is in ${task.state}; tasker ${command} needs ${statesText(state)}`);
  }
}

// The task with the id, in one of the states. Throws for an unknown id and for another state.
export function taskInState(store: TaskStore, taskId: number, state: StateOrList, command: string): Task {
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
