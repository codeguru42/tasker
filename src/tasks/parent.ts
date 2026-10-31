import type { TaskState } from "../state/machine.js";
import type { Task, TaskStore } from "../store/store.js";
import { LOCAL_PREFIX } from "../vcs/local-branch.js";
import { requireBase } from "./task-state.js";

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

// The parent of a stacked task: the task whose id the column parent_task_id holds. It gives undefined when the column is
// NULL. It reads the task in every state, because a parent that finished keeps its row.
export function parentOf(store: TaskStore, task: Task): Task | undefined {
  return task.parentTaskId === null ? undefined : store.getTask(task.parentTaskId);
}

// The parent id that tasker start stores for a task with this base: the highest id of an active task of the repo
// whose branch is the local base. It gives null when the base is not a local branch or when no such task exists.
// A cancelled task never lands, and a finished task is done and its branch is gone or left over. In both cases a new
// start on that branch has a plain local base and no parent. A task in landed, finishing or cleanup_failed is active,
// so it is a parent and the moved-base guard refuses the child until tasker update-branch moves it.
export function newParentId(store: TaskStore, repoKey: string, base: string): number | null {
  if (!isLocalBase(base)) return null;
  const branch = base.slice(LOCAL_PREFIX.length);
  let parent: number | null = null;
  for (const candidate of store.listTasks({ repoKey })) {
    if (candidate.branch === branch && (parent === null || candidate.id > parent)) parent = candidate.id;
  }
  return parent;
}

function hasLanded(task: Task): boolean {
  return LANDED_STATES.has(task.state);
}

// The result of the walk up the chain of landed parents of a task.
export interface ParentWalk {
  // The issue keys of each landed parent, in the order of the walk. The first is the direct parent.
  landedParents: string[];
  // The task where the walk stopped: the end task.
  end: Task;
  // The base of the end task: the new base of the task.
  base: string;
  // The parent of the end task when it has not landed. The task stays stacked on it. Undefined when the task is no
  // longer stacked.
  newParent: Task | undefined;
}

// Walks up from the landed parent of the task and reads only rows. It gives undefined when the task has no parent or
// its parent has not landed. It throws when the chain has a loop, and when the end task has a local base and no parent.
export function walkLandedParents(store: TaskStore, task: Task): ParentWalk | undefined {
  const direct = parentOf(store, task);
  if (direct === undefined || !hasLanded(direct)) return undefined;
  const passed = new Set<number>([task.id]);
  const landedParents: string[] = [];
  let walkTask = direct;
  let parent: Task | undefined;
  for (;;) {
    passed.add(walkTask.id);
    landedParents.push(walkTask.issueKey);
    parent = parentOf(store, walkTask);
    if (parent !== undefined && passed.has(parent.id)) {
      throw new Error(`the chain of parents of ${task.issueKey} has a loop at ${parent.issueKey}; nothing moved`);
    }
    if (parent === undefined || !hasLanded(parent)) break;
    walkTask = parent;
  }
  const base = requireBase(walkTask);
  if (parent === undefined && isLocalBase(base)) {
    throw new Error(`the base ${base} of ${walkTask.issueKey} is a local branch with no parent task; nothing moved`);
  }
  return { landedParents, end: walkTask, base, newParent: parent };
}

// The error for a task whose parent has landed: the task must move onto the base that the walk ends on first.
function landedParentError(walk: ParentWalk, task: Task): Error {
  return new Error(
    `the parent ${walk.landedParents[0]} of ${task.issueKey} has landed; run tasker update-branch ${task.issueKey} to move the task onto ${walk.base} first`,
  );
}

// Refuses to land a stacked task before each parent in its chain landed and tasker update-branch moved the task. A task
// with no parent passes. The checks run in the order landed, cancelled, not landed.
export function assertParentLanded(store: TaskStore, task: Task): void {
  assertBaseMoved(store, task);
  const parent = parentOf(store, task);
  if (parent === undefined) return;
  if (parent.state === "cancelled") {
    throw new Error(
      `the parent ${parent.issueKey} of ${task.issueKey} is cancelled; ${task.issueKey} cannot land on it`,
    );
  }
  throw new Error(
    `the parent ${parent.issueKey} of ${task.issueKey} has not landed; land the parent first, then run tasker update-branch ${task.issueKey}`,
  );
}

// Refuses a command that judges or builds a stacked task while its parent has landed, because the branch of a landed
// parent is no base for the work. The task must first move onto the base that the walk ends on. A cancelled parent does
// not stop the command.
export function assertBaseMoved(store: TaskStore, task: Task): void {
  const walk = walkLandedParents(store, task);
  if (walk !== undefined) throw landedParentError(walk, task);
}
