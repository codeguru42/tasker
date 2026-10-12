import { assertRevisionInput, resolveRevision } from "./refs.js";
import { runGit } from "./run.js";
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
