import { assertRevisionInput, resolveRevision } from "./refs.js";
import { runGit } from "./run.js";
import { assertTaskWorktree } from "./worktree.js";

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
