import { type UncommittedChange, worktreeChanges, worktreeHead } from "./changes.js";
import { GitError, runGit } from "./run.js";
import { assertTaskWorktree } from "./worktree.js";

// The place that a worktree starts from: the full revision of HEAD and the task branch.
// The branch is undefined for a detached HEAD.
export interface StartState {
  head: string;
  branch: string | undefined;
}

export interface WorktreeState extends StartState {
  changes: UncommittedChange[];
}

// Reads the state of the worktree. The target must be the real path from assertTaskWorktree().
// The branch comes from "symbolic-ref -q HEAD". Exit code 1 means a detached HEAD. Every other
// failure passes through.
async function stateAt(target: string, env: NodeJS.ProcessEnv): Promise<WorktreeState> {
  const head = await worktreeHead(target, env);
  let branch: string | undefined;
  try {
    const ref = (await runGit(["symbolic-ref", "-q", "HEAD"], { cwd: target, env })).trim();
    branch = ref.replace(/^refs\/heads\//, "");
  } catch (error) {
    if (!(error instanceof GitError && error.exitCode === 1)) throw error;
  }
  const changes = await worktreeChanges(target, env);
  return { head, branch, changes };
}

// The head, the branch and the uncommitted changes of the task worktree.
export async function worktreeState(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
}): Promise<WorktreeState> {
  const { clone, env, path } = o;
  const target = await assertTaskWorktree({ clone, env, path });
  return stateAt(target, env);
}
