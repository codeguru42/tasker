import { mkdirSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
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

// The files that the sandbox must not read: the ssh key, when it is set. A "~/" key resolves
// against the home folder, as ssh does. Another "~" key throws, because an unresolved deny path
// leaves the key open.
export function readDenyPaths(config: GitVcsConfig): string[] {
  const key = config.sshKey;
  if (key === undefined) return [];
  const home = homeKeyPath(key, userInfo().homedir);
  if (home !== undefined) return [home];
  if (key.startsWith("~")) {
    throw new Error(`cannot resolve the ssh key path for the sandbox: ${key}`);
  }
  return [key];
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
