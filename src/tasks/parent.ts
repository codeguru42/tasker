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

// The parent id that tasker start stores for a task with this base: the highest id of an active task of the repo
// whose branch is the local base. It gives null when the base is not a local branch or when no such task exists.
// A cancelled task never lands, and a finished task is done and its branch is gone or left over. In both cases a new
// start on that branch has a plain local base and no parent. A task in landed, finishing or cleanup_failed is active,
// so it is a parent and tasker verify refuses the child until tasker update-branch moves it.
export function newParentId(store: TaskStore, repoKey: string, base: string): number | null {
  if (!isLocalBase(base)) return null;
  const branch = base.slice(LOCAL_PREFIX.length);
  let parent: number | null = null;
  for (const candidate of store.listTasks({ repoKey })) {
    if (candidate.branch === branch && (parent === null || candidate.id > parent)) parent = candidate.id;
  }
  return parent;
}

export function hasLanded(task: Task): boolean {
  return LANDED_STATES.has(task.state);
}
