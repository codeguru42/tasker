import { acceptedStates, acceptsState, errorSentence, type TaskCommand } from "../state/commands.js";
import type { TaskState } from "../state/machine.js";
import { taskNotFound, type Task, type TaskStore } from "../store/store.js";
import type { VcsProvider } from "../vcs/provider.js";

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
  if (!acceptsState(command, task.state)) {
    const allowed = statesText(acceptedStates(command));
    const message = `the task of ${task.issueKey} is in ${task.state}; tasker ${command} needs ${allowed}`;
    const sentence = errorSentence(task.state, task.issueKey);
    throw new Error(sentence === undefined ? message : `${message}. ${sentence}`);
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

// The revision of the base of the task. Throws when the task has no base.
export function requireBaseRevision(vcs: VcsProvider, task: Task): string {
  if (task.base === null) throw new Error(`the task of ${task.issueKey} has no base revision`);
  return vcs.baseRevision(task.base);
}

// Throws when tip, the revision of the branch, is not the accepted revision of the task. The accepted revision is the
// one that the last tasker accept stored. The task needs one.
export function requireAcceptedTip(task: Task, branch: string, tip: string): void {
  if (task.acceptedRevision === null) throw new Error(`the task of ${task.issueKey} has no accepted revision`);
  if (tip !== task.acceptedRevision) {
    throw new Error(
      `the tip of ${branch} (${tip}) is not the accepted revision (${task.acceptedRevision}); run tasker update-branch and review the work again`,
    );
  }
}
