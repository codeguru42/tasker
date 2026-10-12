import { mkdirSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { GitVcsConfig } from "./provision.js";
import { runGit } from "./run.js";
import { homeKeyPath } from "./ssh.js";
import { assertTaskWorktree, withoutLineEnd } from "./worktree.js";

// The commit rules of the execute prompt. The caller replaces {{BASE_REF}} with the base revision.
export const EXECUTE_COMMIT_TEXT = [
  "Commit each red/green pair, or each completed todo, as its own commit. Never collect the whole plan into one commit at the end. If a run stops partway (a quota limit, a timeout), the work that it finished must stay committed.",
  "The branch can already hold commits from an earlier execute run of an earlier revision of this plan. Before you start, run `git log --reverse {{BASE_REF}}..HEAD` and read what is there. Build on that work. Do not do it again.",
].join("\n\n");

// The deny rules for the shell of the assistant, in the rule syntax of Claude Code.
export const DENY_RULES: readonly string[] = ["Bash(git push:*)"];

// The files that the sandbox must not read: the ssh key, when it is set.
// - No key: no path.
// - A key that is not "~/" and not absolute: throws, because tasker cannot resolve it, and a deny
//   path that tasker cannot resolve leaves the key open.
// - A "~/" key resolves against the home folder, as ssh does.
// - A missing key file: the path alone. ssh cannot open the key either.
// - A key with no symlink: the path alone.
// - A key with a symlink in the file or in a folder on its path: the path, then the real path,
//   because ssh opens the real file.
export function readDenyPaths(config: GitVcsConfig): string[] {
  const key = config.sshKey;
  if (key === undefined) return [];
  const path = homeKeyPath(key, userInfo().homedir) ?? key;
  if (!isAbsolute(path)) {
    throw new Error(`cannot resolve the ssh key path for the sandbox: ${key}`);
  }
  let real: string;
  try {
    real = realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [path];
    throw error;
  }
  return real === path ? [path] : [path, real];
}

// The folders that a git commit in the task worktree writes to, as absolute paths:
// objects/, refs/ and logs/ of the clone, and the admin dir of the worktree.
// Not the whole clone, and not hooks/ or config, because tasker's later git calls run them.
// It creates logs/ when it is missing, because a sandbox cannot bind a missing path.
export async function sandboxWritePaths(options: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
}): Promise<string[]> {
  const { env } = options;
  // The guard also makes sure that the worktree uses its own git dir in the clone.
  const target = await assertTaskWorktree(options);
  // Two calls, not one: one call prints two paths on two lines, and a path can hold a newline.
  // --path-format=absolute needs git 2.31, so resolve each path against the worktree.
  const common = resolve(
    target,
    withoutLineEnd(await runGit(["rev-parse", "--git-common-dir"], { cwd: target, env })),
  );
  const admin = resolve(
    target,
    withoutLineEnd(await runGit(["rev-parse", "--git-dir"], { cwd: target, env })),
  );
  const logs = join(common, "logs");
  mkdirSync(logs, { recursive: true });
  return [join(common, "objects"), join(common, "refs"), logs, admin];
}
