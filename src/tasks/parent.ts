import { STATES, type TaskState } from "../state/machine.js";
import type { Task, TaskStore } from "../store/store.js";
import { LOCAL_PREFIX } from "../vcs/local-branch.js";

// The parent of a stacked task has landed when its task is in one of these states, also when its issue is still open.
export const LANDED_STATES: ReadonlySet<string> = new Set<TaskState>([
  "landed",
  "finishing",
  "cleanup_failed",
  "finished",
]);

// True when the base has the form refs/heads/<x>: a local branch of the clone. The base of a stacked task has this form.
export function isLocalBase(base: string): boolean {
  return base.startsWith(LOCAL_PREFIX);
}

// The parent of a stacked task: the newest task of the repo whose branch is the local base of the task.
// It gives undefined when the base is not a local branch or when no task has that branch. It reads tasks in every
// state, because the task of a parent that finished keeps its branch name.
export function parentOf(store: TaskStore, task: Task): Task | undefined {
  if (task.base === null || !isLocalBase(task.base)) return undefined;
  const branch = task.base.slice(LOCAL_PREFIX.length);
  let parent: Task | undefined;
  for (const candidate of store.listTasks({ repoKey: task.repoKey, states: [...STATES] })) {
    if (candidate.branch === branch && (parent === undefined || candidate.id > parent.id)) parent = candidate;
  }
  return parent;
}

export function hasLanded(task: Task): boolean {
  return LANDED_STATES.has(task.state);
}
