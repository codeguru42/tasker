import { userInfo } from "node:os";
import type { GitVcsConfig } from "./provision.js";
import { homeKeyPath } from "./ssh.js";

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
