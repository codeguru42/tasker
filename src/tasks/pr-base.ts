import type { Task, TaskStore } from "../store/store.js";
import { branchOfBase } from "../vcs/local-branch.js";
import { assertBaseMoved } from "./parent.js";
import { requireBase, requireBranch, requireWorktree } from "./task-state.js";

export interface PrBase {
  branch: string;
  worktree: string;
  base: string;
  baseBranch: string;
}

// The facts that a PR of a task needs: the branch, the worktree, the stored base and its branch name.
// It refuses a task whose stacked parent landed.
export function prBaseOf(store: TaskStore, task: Task): PrBase {
  assertBaseMoved(store, task);
  const branch = requireBranch(task);
  const worktree = requireWorktree(task);
  const base = requireBase(task);
  const baseBranch = branchOfBase(base);
  return { branch, worktree, base, baseBranch };
}

// The PR base rule: the base of the PR equals the base branch of the task.
export function matchesTaskBase(pr: { base: string }, baseBranch: string): boolean {
  return pr.base === baseBranch;
}
