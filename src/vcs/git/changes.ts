import { assertRevisionInput, resolveRevision } from "./refs.js";
import { GitError, runGit } from "./run.js";
import { assertTaskWorktree, taskBranchRevision } from "./worktree.js";

// The fields of NUL-ended output: split on "\0" and drop the empty item after the last NUL.
function nulFields(text: string): string[] {
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
  return runGit(
    ["diff", "--no-renames", "--no-color", "--no-ext-diff", "--no-textconv", `${base}...HEAD`, "--"],
    { cwd: target, env },
  );
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
  const output = await runGit(
    ["diff", "--no-renames", "-z", "--name-only", `${base}...${head}`, "--"],
    { gitDir: clone, env },
  );
  return nulFields(output);
}

// The text for a branch that has no commits of its own.
export const NO_OWN_COMMITS = "This branch has no commits of its own since its base yet.";

// The own commits of the task branch, oldest first, each with its diff. The range is
// <base>..<branch>. The explicit format keeps the user configuration out of the text.
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

export interface UncommittedChange {
  // The two status characters of git, for example " M", "??", "D " or "A ".
  status: string;
  // The raw path, relative to the root of the worktree.
  path: string;
}

// The uncommitted changes of the task worktree. An empty list means a clean worktree.
// -z gives raw paths, and --no-renames gives one path for each record.
// --untracked-files=normal shows untracked files, also when the configuration hides them.
export async function uncommittedChanges(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
}): Promise<UncommittedChange[]> {
  const { clone, env, path } = o;
  const target = await assertTaskWorktree({ clone, env, path });
  const output = await runGit(
    ["status", "--porcelain", "--untracked-files=normal", "--no-renames", "-z"],
    { cwd: target, env },
  );
  return nulFields(output).map((field) => ({
    status: field.slice(0, 2),
    path: field.slice(3),
  }));
}

// The message that refuses a worktree with uncommitted changes. Each path is JSON text, so a
// path with a comma or a newline stays readable and exact.
export function uncommittedRefusal(path: string, changes: readonly UncommittedChange[]): string {
  return `the worktree has uncommitted changes: ${path}: ${changes.map((c) => JSON.stringify(c.path)).join(", ")}`;
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
    if (error instanceof GitError && error.exitCode === 1) return false;
    throw error;
  }
}
