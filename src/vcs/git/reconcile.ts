import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type UncommittedChange, worktreeChanges, worktreeHead } from "./changes.js";
import { isFullRevision } from "./refs.js";
import { GitError, runGit } from "./run.js";
import { assertTaskBranch, assertTaskWorktree } from "./worktree.js";

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

// Tells whether a rebase or a merge is in progress in the worktree. Git has no plumbing command
// with an exit code for this, and the text of "git status" is not stable. So it asks git for the
// real path of each state file with "rev-parse --git-path" and tests that the file exists.
// The path can be relative to the target or absolute, so it resolves against the target.
async function inProgress(
  target: string,
  env: NodeJS.ProcessEnv,
): Promise<{ rebase: boolean; merge: boolean }> {
  const exists = async (name: string): Promise<boolean> => {
    const found = await runGit(["rev-parse", "--git-path", name], { cwd: target, env });
    return existsSync(resolve(target, found.trim()));
  };
  const rebase = (await exists("rebase-merge")) || (await exists("rebase-apply"));
  const merge = await exists("MERGE_HEAD");
  return { rebase, merge };
}

// Puts the worktree back at the start. Each command runs through attempt(): a GitError keeps its
// stderr in the list and the next command runs. Any other error passes through.
// "rebase --quit" comes first, because "checkout --force" does not remove rebase-merge/.
// The checkout removes the merge state. "clean -fd" deletes the untracked files.
async function restoreAt(target: string, env: NodeJS.ProcessEnv, start: StartState): Promise<void> {
  const stderrs: string[] = [];
  const attempt = async (args: string[]): Promise<void> => {
    try {
      await runGit(args, { cwd: target, env });
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      stderrs.push(error.stderr.trim());
    }
  };
  if ((await inProgress(target, env)).rebase) await attempt(["rebase", "--quit"]);
  await attempt(
    start.branch === undefined
      ? ["checkout", "--force", "--detach", start.head]
      : ["checkout", "--force", "-B", start.branch, start.head],
  );
  await attempt(["clean", "-fd"]);
}

// Puts the task worktree back at the start. The caller must find the worktree clean before the
// step, because the restore runs "checkout --force" and "clean -fd". Both delete uncommitted work
// and untracked files. The input checks run before any git call.
export async function restoreWorktree(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
  start: StartState;
}): Promise<void> {
  const { clone, env, path, start } = o;
  if (!isFullRevision(start.head)) {
    throw new Error(`the start revision is not a full revision: ${JSON.stringify(start.head)}`);
  }
  if (start.branch !== undefined) assertTaskBranch(start.branch);
  const target = await assertTaskWorktree({ clone, env, path });
  await restoreAt(target, env, start);
}
