import type { BaseContainment, UncommittedChange } from "../provider.js";
import { assertRevisionInput, resolveRevision } from "./refs.js";
import { isGitExit, runGit } from "./run.js";
import { runRemoteGit } from "./ssh.js";
import { assertTaskBranch, assertTaskWorktree, taskBranchRevision } from "./worktree.js";

// The fields of NUL-ended output: split on "\0" and drop the empty item after the last NUL.
export function nulFields(text: string): string[] {
  const fields = text.split("\0");
  if (fields[fields.length - 1] === "") fields.pop();
  return fields;
}

// The diff of the commits of the task worktree against its base, as git prints it.
// The range is <base>...HEAD, so a file that only the base got after the fork does not show.
// Uncommitted changes do not show. The base is a full revision or a full ref.
export async function worktreeDiff(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
  baseRevision: string;
}): Promise<string> {
  const { clone, env, path, baseRevision } = o;
  assertRevisionInput(baseRevision);
  const target = await assertTaskWorktree({ clone, env, path });
  const base = await resolveRevision({ clone, env, value: baseRevision });
  return runGit(["diff", "--no-renames", "--no-color", "--no-ext-diff", "--no-textconv", `${base}...HEAD`, "--"], {
    cwd: target,
    env,
  });
}

// The paths that the task branch changes against its base, raw, in the order of git.
// The range is <base>...<branch>. A rename gives the old and the new path.
// It reads the branch in the clone, so the worktree is not necessary.
export async function changedPaths(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  branch: string;
  baseRevision: string;
}): Promise<string[]> {
  const { clone, env, branch, baseRevision } = o;
  assertRevisionInput(baseRevision);
  const head = await taskBranchRevision({ clone, env, branch });
  const base = await resolveRevision({ clone, env, value: baseRevision });
  const output = await runGit(["diff", "--no-renames", "-z", "--name-only", `${base}...${head}`, "--"], {
    gitDir: clone,
    env,
  });
  return nulFields(output);
}

// The text for a branch that has no commits of its own.
export const NO_OWN_COMMITS = "This branch has no commits of its own since its base yet.";

// The own commits of the task branch, oldest first, each with its diff. The range is
// <base>..<branch>. The explicit format stops format.pretty and log.decorate.
// --no-show-signature stops log.showSignature, so git starts no gpg.
// A merge commit shows no diff, as git does by default.
export async function ownCommitsText(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  branch: string;
  baseRevision: string;
}): Promise<string> {
  const { clone, env, branch, baseRevision } = o;
  assertRevisionInput(baseRevision);
  const head = await taskBranchRevision({ clone, env, branch });
  const base = await resolveRevision({ clone, env, value: baseRevision });
  const output = await runGit(
    [
      "log",
      "--reverse",
      "--no-renames",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--no-show-signature",
      "--patch",
      "--format=commit %H%n%n%B",
      `${base}..${head}`,
      "--",
    ],
    { gitDir: clone, env },
  );
  return output === "" ? NO_OWN_COMMITS : output;
}

// True when head reaches a commit that none of the others reaches. An empty others gives true
// for each existing head, because git then counts every commit that head reaches.
export async function hasCommitsNotIn(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  head: string;
  others: readonly string[];
}): Promise<boolean> {
  const { clone, env, head, others } = o;
  for (const value of [head, ...others]) assertRevisionInput(value);
  const headSha = await resolveRevision({ clone, env, value: head });
  const otherShas: string[] = [];
  for (const value of others) otherShas.push(await resolveRevision({ clone, env, value }));
  const output = await runGit(["rev-list", "--count", headSha, "--not", ...otherShas, "--"], {
    gitDir: clone,
    env,
  });
  return Number(output.trim()) > 0;
}

// The uncommitted changes of the task worktree. An empty list means a clean worktree.
// -z gives raw paths, and --no-renames gives one path for each record.
// --untracked-files=normal shows untracked files, also when the configuration hides them.
// GIT_OPTIONAL_LOCKS=0 stops git from taking index.lock and from writing the index.
export async function uncommittedChanges(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
}): Promise<UncommittedChange[]> {
  const { clone, env, path } = o;
  const target = await assertTaskWorktree({ clone, env, path });
  return worktreeChanges(target, env);
}

// The status read of uncommittedChanges() without the guard. The target must be the real path
// that assertTaskWorktree() returns.
export async function worktreeChanges(target: string, env: NodeJS.ProcessEnv): Promise<UncommittedChange[]> {
  const output = await runGit(["status", "--porcelain", "--untracked-files=normal", "--no-renames", "-z"], {
    cwd: target,
    env: { ...env, GIT_OPTIONAL_LOCKS: "0" },
  });
  return nulFields(output).map((field) => ({
    status: field.slice(0, 2),
    path: field.slice(3),
  }));
}

// The paths as JSON text, joined with ", ", so a path with a comma or a newline stays readable
// and exact.
export function jsonPathList(paths: readonly string[]): string {
  return paths.map((p) => JSON.stringify(p)).join(", ");
}

// The message that refuses a worktree with uncommitted changes.
export function uncommittedRefusal(path: string, changes: readonly UncommittedChange[]): string {
  return `the worktree has uncommitted changes: ${path}: ${jsonPathList(changes.map((c) => c.path))}`;
}

// The full revision of HEAD in the task worktree. The target must be the real path that
// assertTaskWorktree() returns.
export async function worktreeHead(target: string, env: NodeJS.ProcessEnv): Promise<string> {
  return (await runGit(["rev-parse", "--verify", "HEAD^{commit}"], { cwd: target, env })).trim();
}

// True when ancestor is the same commit as descendant or reaches it through its parents.
// Only exit code 1 of git gives false. Every other failure passes through, for example the exit
// code 128 for a full revision that the clone does not have.
export async function isAncestor(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  ancestor: string;
  descendant: string;
}): Promise<boolean> {
  const { clone, env } = o;
  assertRevisionInput(o.ancestor);
  assertRevisionInput(o.descendant);
  const ancestor = await resolveRevision({ clone, env, value: o.ancestor });
  const descendant = await resolveRevision({ clone, env, value: o.descendant });
  try {
    await runGit(["merge-base", "--is-ancestor", ancestor, descendant], { gitDir: clone, env });
    return true;
  } catch (error) {
    if (isGitExit(error, 1)) return false;
    throw error;
  }
}

// Fetches origin into the clone with the ssh key of the repo. It uses runRemoteGit(). The fetch
// moves and prunes refs/remotes/origin/* in the clone. It changes no worktree.
export async function fetchOrigin(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  sshKey: string | undefined;
}): Promise<void> {
  const { clone, env, sshKey } = o;
  await runRemoteGit(["fetch", "--prune", "origin"], { gitDir: clone, env }, sshKey);
}

// Fetches origin, then reads the tip of the task branch and the tip of the base, and says whether the branch contains
// the tip of the base. It reads the exact ref refs/heads/<branch> in the clone, not HEAD of a worktree, so it needs no
// worktree. A bad base text or a bad branch name causes no fetch. The fetch moves and prunes refs/remotes/origin/* in
// the clone, also when a later read fails. It does not move refs/heads/*. A failure of the fetch or of a read rejects.
export async function fetchBaseContainment(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  sshKey: string | undefined;
  branch: string;
  baseRevision: string;
}): Promise<BaseContainment> {
  const { clone, env, sshKey, branch, baseRevision } = o;
  assertRevisionInput(baseRevision);
  assertTaskBranch(branch);
  await fetchOrigin({ clone, env, sshKey });
  const revision = await taskBranchRevision({ clone, env, branch });
  const baseTip = await resolveRevision({ clone, env, value: baseRevision });
  const contains = await isAncestor({ clone, env, ancestor: baseTip, descendant: revision });
  return { revision, baseTip, contains };
}
