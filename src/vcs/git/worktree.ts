import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { errnoCode } from "../../errno.js";
import { canonicalPath } from "../../real-path.js";
import { pathSlug } from "../../issue-key/path-slug.js";
import { isShortRef, LOWER_SLUG, SHORT_REF } from "../../issue-key/short-ref.js";
import { LOCAL_PREFIX } from "../local-branch.js";
import type { WorkspaceEntry } from "../provider.js";
import { refExists, refRevision } from "./refs.js";
import { runGit } from "./run.js";

const MAX_BRANCH_LENGTH = 100;

// A short ref alone, or a short ref, "-" and the title slug in lower case, as taskBranchName() makes it.
const TASK_BRANCH_PATTERN = new RegExp(`^${SHORT_REF}(?:-${LOWER_SLUG})?$`);

// pathSlug(), but undefined when no character is left. Any other error passes through.
// It matches the start of the message of pathSlug(). A change to one must change the other.
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
  return slugOrUndefined(name) === name && name.length <= MAX_BRANCH_LENGTH && name !== "HEAD";
}

// Throws unless name has the shape that taskBranchName() makes: a short ref alone,
// or a short ref, "-" and a lower-case title slug. Run it after assertTaskBranch().
export function assertTaskBranchShape(name: string): void {
  if (!(isTaskBranch(name) && TASK_BRANCH_PATTERN.test(name))) {
    throw new Error(`not a task branch: ${JSON.stringify(name)}`);
  }
}

// Throws unless name is a task branch with the shape of taskBranchName(). The name check runs first.
export function assertTaskBranchNameAndShape(name: string): void {
  assertTaskBranch(name);
  assertTaskBranchShape(name);
}

// Throws unless name passes isTaskBranch(). Run it before any git call that takes a branch.
export function assertTaskBranch(name: string): void {
  if (!isTaskBranch(name)) {
    throw new Error(`not a task branch name: ${JSON.stringify(name)}`);
  }
}

// The task branch: the short ref, then the issue title as a lower-case slug.
// The result is always a valid branch name:
// - The short ref and the slug have only letters, digits and single "-" inside.
//   So the result has no "--" and no ".", and as a result no ".." and no ".lock" end.
// - A result with a slug has a "-", so it is never "HEAD".
// - The length is at most MAX_BRANCH_LENGTH.
export function taskBranchName(shortRef: string, title: string): string {
  if (!(isTaskBranch(shortRef) && isShortRef(shortRef))) {
    throw new Error(`not a safe short ref: ${JSON.stringify(shortRef)}`);
  }
  const room = MAX_BRANCH_LENGTH - shortRef.length - 1;
  if (room <= 0) return shortRef;
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

// The worktrees of the clone, without the bare clone itself.
export async function listWorktrees(options: { clone: string; env: NodeJS.ProcessEnv }): Promise<WorkspaceEntry[]> {
  const out = await runGit(["worktree", "list", "--porcelain", "-z"], {
    gitDir: options.clone,
    env: options.env,
  });
  const entries: WorkspaceEntry[] = [];
  for (const record of out.split("\0\0")) {
    const fields = record.split("\0").filter((field) => field !== "");
    const worktree = fields.find((field) => field.startsWith("worktree "));
    if (worktree === undefined || fields.includes("bare")) continue;
    const entry: WorkspaceEntry = { path: worktree.slice("worktree ".length) };
    const branchField = `branch ${LOCAL_PREFIX}`;
    for (const field of fields) {
      if (field.startsWith(branchField)) {
        entry.taskRef = field.slice(branchField.length);
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

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return false;
    throw error;
  }
}

// True when <folder>/.git is a file, as in a linked worktree. A .git folder is a separate repo.
function hasGitFile(folder: string): boolean {
  return isFile(join(folder, ".git"));
}

// True when nothing is at path, or an empty folder (not a symlink) is. Git accepts both.
function isMissingOrEmptyFolder(path: string): boolean {
  try {
    return lstatSync(path).isDirectory() && readdirSync(path).length === 0;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return true;
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
  assertTaskBranchNameAndShape(branch);
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const target = canonicalPath(path);
  const entries = await listWorktrees({ clone, env });
  const entry = entries.find((candidate) => candidate.path === target);
  if (entry?.lockReason !== undefined) {
    // A stopped "git worktree add" locks the worktree with this reason (state 23d: the
    // checkout is partial). The folder holds no work of the task, so reset it and unlock it.
    if (entry.lockReason === "initializing" && entry.taskRef === branch && hasGitFile(target)) {
      await runGit(["reset", "--hard"], { cwd: target, env });
      await runGit(["worktree", "unlock", "--", target], { gitDir: clone, env });
      return "reused-worktree";
    }
    throw new Error(`the worktree is locked: ${target} (${entry.lockReason})`);
  }
  if (entry !== undefined && entry.taskRef !== branch) {
    throw new Error(`the worktree path has another branch: ${target} (${entry.taskRef ?? "detached"})`);
  }
  if (entry !== undefined) {
    if (hasGitFile(target)) return "reused-worktree";
    if (!existsSync(target)) {
      // The folder is gone. Git drops only this entry, and the branch stays.
      await runGit(["worktree", "remove", "--", target], { gitDir: clone, env });
    } else {
      throw new Error(`the worktree has no .git file: ${target}`);
    }
  }
  const holder = entries.find((other) => other.path !== target && other.taskRef === branch);
  if (holder !== undefined) {
    throw new Error(`the branch ${branch} is in another worktree: ${holder.path}`);
  }
  // Git makes the new branch before it reads the path, so check the path first.
  if (!isMissingOrEmptyFolder(target)) {
    throw new Error(`something else is at the worktree path: ${target}`);
  }
  if (await refExists({ clone, env, ref: `${LOCAL_PREFIX}${branch}` })) {
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
// It deletes any local branch with a task branch name, also a branch that HEAD of the clone names.
export async function deleteTaskBranch(options: {
  clone: string;
  env: NodeJS.ProcessEnv;
  branch: string;
}): Promise<void> {
  assertTaskBranchNameAndShape(options.branch);
  await runGit(["branch", "-D", "--", options.branch], {
    gitDir: options.clone,
    env: options.env,
  });
}

// text without one "\n" or "\r\n" at its end. A path can end with a space, so do not trim().
export function withoutLineEnd(text: string): string {
  return text.replace(/\r?\n$/, "");
}

// The text of file without its line end, or undefined when the file is missing.
function readGuardFile(file: string): string | undefined {
  try {
    return withoutLineEnd(readFileSync(file, "utf8"));
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

// True when the worktree at target uses its own admin dir in the clone. It reads the files that
// git follows and runs no git. The assistant can write the .git file and the admin dir.
function usesOwnGitDir(clone: string, target: string): boolean {
  const realClone = realpathSync(clone);
  const dotGit = readGuardFile(join(target, ".git"));
  if (!dotGit?.startsWith("gitdir: ")) return false;
  const admin = resolve(target, dotGit.slice("gitdir: ".length));
  if (dirname(admin) !== join(realClone, "worktrees")) return false;
  const common = readGuardFile(join(admin, "commondir"));
  if (common === undefined || resolve(admin, common) !== realClone) return false;
  // Only this fact catches a .git file that names the admin dir of another task worktree.
  const gitdir = readGuardFile(join(admin, "gitdir"));
  return gitdir !== undefined && resolve(admin, gitdir) === join(target, ".git");
}

// Throws unless path is a listed worktree of the clone with a .git file. Gives the real path.
// Git with a wrong cwd changes another repo. Without a .git file, git would use a repo around
// the folder. The .git file and the admin dir must also name each other and the clone, because
// git follows them. The guard only reads.
export async function assertTaskWorktree(options: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
}): Promise<string> {
  const { clone, env, path } = options;
  const target = canonicalPath(path);
  const entries = await listWorktrees({ clone, env });
  if (!entries.some((entry) => entry.path === target)) {
    throw new Error(`not a worktree of the clone: ${path}`);
  }
  if (!hasGitFile(target)) {
    throw new Error(`the worktree has no .git file: ${target}`);
  }
  if (!usesOwnGitDir(clone, target)) {
    throw new Error(`the worktree does not use its own git dir in the clone: ${target}`);
  }
  return target;
}

// Resets tracked files, then deletes untracked files and nested git repos. Ignored files stay.
// The folder must pass assertTaskWorktree().
// Reset runs first, so a deleted .gitignore comes back before clean reads it.
export async function discardWorktreeChanges(options: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
}): Promise<void> {
  const { env } = options;
  const target = await assertTaskWorktree(options);
  await runGit(["reset", "--hard"], { cwd: target, env });
  await runGit(["clean", "-ffd"], { cwd: target, env });
}

// The commit SHA of the local task branch. It reads the exact ref only, so git does not try
// other ref names.
export async function taskBranchRevision(options: {
  clone: string;
  env: NodeJS.ProcessEnv;
  branch: string;
}): Promise<string> {
  const { clone, env, branch } = options;
  assertTaskBranch(branch);
  const revision = await refRevision({ clone, env, ref: `${LOCAL_PREFIX}${branch}` });
  if (revision === undefined) throw new Error(`cannot resolve the task branch: ${branch}`);
  return revision;
}

// True when the local task branch exists. It reads the exact ref only.
export async function taskBranchExists(options: {
  clone: string;
  env: NodeJS.ProcessEnv;
  branch: string;
}): Promise<boolean> {
  const { clone, env, branch } = options;
  assertTaskBranch(branch);
  return refExists({ clone, env, ref: `${LOCAL_PREFIX}${branch}` });
}
