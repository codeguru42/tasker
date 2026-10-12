import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathSlug } from "../../issue-key/path-slug.js";
import { GitError, runGit } from "./run.js";

const MAX_BRANCH_LENGTH = 100;

// pathSlug(), but undefined when no character is left. Any other error passes through.
function slugOrUndefined(value: string): string | undefined {
  try {
    return pathSlug(value);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("cannot make a path slug from")) {
      return undefined;
    }
    throw error;
  }
}

// True when name is one safe ref part: a path slug, at most MAX_BRANCH_LENGTH long, not "HEAD".
// Git accepts each such name, and none starts with "-".
function isTaskBranch(name: string): boolean {
  return (
    slugOrUndefined(name) === name && name.length <= MAX_BRANCH_LENGTH && name !== "HEAD"
  );
}

// Throws unless name passes isTaskBranch(). Run it before any git call that takes a branch.
function assertTaskBranch(name: string): void {
  if (!isTaskBranch(name)) {
    throw new Error(`not a task branch name: ${JSON.stringify(name)}`);
  }
}

// The task branch: the short ref, then the issue title as a lower-case slug.
// The result is always a valid branch name:
// - The short ref ends with no "-" or ".", and the slug starts with none.
//   So the join makes no "--" and no "..".
// - The slug ends clean, so the result has no ".lock" end.
// - A result with a slug has a "-", so it is never "HEAD".
// - The length is at most MAX_BRANCH_LENGTH.
export function taskBranchName(shortRef: string, title: string): string {
  if (!isTaskBranch(shortRef)) {
    throw new Error(`not a safe short ref: ${JSON.stringify(shortRef)}`);
  }
  const room = MAX_BRANCH_LENGTH - shortRef.length - 1;
  if (room <= 0) return shortRef;
  // Lower case first, so a trailing ".LOCK" becomes ".lock" and pathSlug strips it.
  const first = slugOrUndefined(title.toLowerCase());
  if (first === undefined) return shortRef;
  // The cut keeps the first character of first, so this call cannot throw.
  const slug = pathSlug(first.slice(0, room));
  return `${shortRef}-${slug}`;
}

// The folder of one task worktree: <worktrees>/<shortRef>.
export function taskWorktreePath(worktrees: string, shortRef: string): string {
  return join(worktrees, shortRef);
}

export interface WorktreeEntry {
  path: string;
  branch?: string;
  // Set when the worktree is locked: "" for a lock with no reason.
  lockReason?: string;
}

// The worktrees of the clone, without the bare clone itself.
export async function listWorktrees(options: {
  clone: string;
  env: NodeJS.ProcessEnv;
}): Promise<WorktreeEntry[]> {
  const out = await runGit(["worktree", "list", "--porcelain", "-z"], {
    gitDir: options.clone,
    env: options.env,
  });
  const entries: WorktreeEntry[] = [];
  for (const record of out.split("\0\0")) {
    const fields = record.split("\0").filter((field) => field !== "");
    const worktree = fields.find((field) => field.startsWith("worktree "));
    if (worktree === undefined || fields.includes("bare")) continue;
    const entry: WorktreeEntry = { path: worktree.slice("worktree ".length) };
    for (const field of fields) {
      if (field.startsWith("branch refs/heads/")) {
        entry.branch = field.slice("branch refs/heads/".length);
      } else if (field === "locked") {
        entry.lockReason = "";
      } else if (field.startsWith("locked ")) {
        entry.lockReason = field.slice("locked ".length);
      }
    }
    entries.push(entry);
  }
  return entries;
}

// The path as git lists it: the real parent folder, then the last part. It works for a missing
// folder, because git lists the real path of the parent.
function canonicalPath(path: string): string {
  const full = resolve(path);
  try {
    return join(realpathSync(dirname(full)), basename(full));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return full;
    throw error;
  }
}

// True when refs/heads/<branch> exists in the clone. show-ref matches only the exact ref.
async function branchExists(
  clone: string,
  env: NodeJS.ProcessEnv,
  branch: string,
): Promise<boolean> {
  try {
    await runGit(["show-ref", "--verify", "--quiet", "--", `refs/heads/${branch}`], {
      gitDir: clone,
      env,
    });
    return true;
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return false;
    throw error;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

// True when nothing is at path, or an empty folder (not a symlink) is. Git accepts both.
function isMissingOrEmptyFolder(path: string): boolean {
  try {
    return lstatSync(path).isDirectory() && readdirSync(path).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

// Makes the worktree of a task on a new branch. The new branch has no upstream.
export async function createTaskWorktree(options: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
  branch: string;
  baseRevision: string;
}): Promise<"created" | "reused-branch" | "reused-worktree"> {
  const { clone, env, path, branch, baseRevision } = options;
  assertTaskBranch(branch);
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const target = canonicalPath(path);
  const entries = await listWorktrees({ clone, env });
  const entry = entries.find((candidate) => candidate.path === target);
  if (entry?.lockReason !== undefined) {
    const gitFile = join(target, ".git");
    // A stopped "git worktree add" locks the worktree with this reason (state 23d: the
    // checkout is partial). The folder holds no work of the task, so reset it and unlock it.
    if (entry.lockReason === "initializing" && entry.branch === branch && isFile(gitFile)) {
      await runGit(["reset", "--hard"], { cwd: target, env });
      await runGit(["worktree", "unlock", "--", target], { gitDir: clone, env });
      return "reused-worktree";
    }
    throw new Error(`the worktree is locked: ${target} (${entry.lockReason})`);
  }
  if (entry !== undefined && entry.branch !== branch) {
    throw new Error(
      `the worktree path has another branch: ${target} (${entry.branch ?? "detached"})`,
    );
  }
  if (entry !== undefined) {
    if (existsSync(join(target, ".git"))) return "reused-worktree";
    if (!existsSync(target)) {
      // The folder is gone. Git drops only this entry, and the branch stays.
      await runGit(["worktree", "remove", "--", target], { gitDir: clone, env });
    } else {
      throw new Error(`the worktree has no .git file: ${target}`);
    }
  }
  const holder = entries.find((other) => other.path !== target && other.branch === branch);
  if (holder !== undefined) {
    throw new Error(`the branch ${branch} is in another worktree: ${holder.path}`);
  }
  // Git makes the new branch before it reads the path, so check the path first.
  if (!isMissingOrEmptyFolder(target)) {
    throw new Error(`something else is at the worktree path: ${target}`);
  }
  if (await branchExists(clone, env, branch)) {
    await runGit(["worktree", "add", "--", target, branch], { gitDir: clone, env });
    return "reused-branch";
  }
  await runGit(["worktree", "add", "--no-track", "-b", branch, "--", target, baseRevision], {
    gitDir: clone,
    env,
  });
  return "created";
}

// Removes the worktree folder, without --force. Git refuses a worktree with changes.
// The branch stays.
export async function removeTaskWorktree(options: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
}): Promise<void> {
  await runGit(["worktree", "remove", "--", resolve(options.path)], {
    gitDir: options.clone,
    env: options.env,
  });
}

// Deletes the local branch, also when it is not merged. It makes no remote call.
// It deletes any local branch with a task branch name, also the default branch of the clone.
export async function deleteTaskBranch(options: {
  clone: string;
  env: NodeJS.ProcessEnv;
  branch: string;
}): Promise<void> {
  assertTaskBranch(options.branch);
  await runGit(["branch", "-D", "--", options.branch], {
    gitDir: options.clone,
    env: options.env,
  });
}
