import { lstatSync, realpathSync } from "node:fs";
import { errnoCode } from "../../errno.js";
import type { RunInput } from "../provider.js";
import { codexSocketDenyPaths } from "./sockets.js";

// The name of the permission profile that every run defines for itself.
const PROFILE = "tasker";

// The files of one run that the arguments name. A new session has neither a thread id nor, maybe, a schema.
export interface CodexFiles {
  threadId?: string;
  schemaPath?: string;
}

// A key of the table must be a real path. A key that is a link makes bwrap fail at the start. A link becomes its
// target, and a link that cannot resolve is left out. A path that does not exist stays.
function realKeys(paths: readonly string[]): string[] {
  const keys: string[] = [];
  for (const path of paths) {
    let isLink: boolean;
    try {
      isLink = lstatSync(path).isSymbolicLink();
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
      keys.push(path);
      continue;
    }
    if (!isLink) {
      keys.push(path);
      continue;
    }
    try {
      keys.push(realpathSync(path));
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
    }
  }
  return keys;
}

// Leaves out each repeat and each path under another path of the list. An existing path under a denied folder
// makes bwrap fail at the start.
function withoutNested(paths: readonly string[]): string[] {
  const unique = [...new Set(paths)];
  return unique.filter((path) => !unique.some((other) => other !== path && path.startsWith(`${other}/`)));
}

// The table of the filesystem profile. "/" must be readable, because a smaller profile makes each command fail.
// Each path is a TOML key written with JSON.stringify. A TOML table must not name one key twice, so the table
// is a Map and a path has one key. The deny keys are the paths of sandbox.denyRead and the socket paths.
// sandbox.allowWrite is not read yet: the profile has no write grant.
function filesystemTable(input: RunInput): string {
  const table = new Map<string, string>([["/", "read"]]);
  const denied = realKeys([...(input.sandbox?.denyRead ?? []), ...codexSocketDenyPaths(input.env)]);
  for (const path of withoutNested(denied)) table.set(path, "deny");
  const keys = [...table].map(([path, access]) => `${JSON.stringify(path)}=${JSON.stringify(access)}`);
  return `{${keys.join(", ")}}`;
}

// The arguments of one codex run. The prompt goes on stdin (the last argument is -).
// Never use -s, --sandbox, sandbox_mode or --ephemeral: profiles do not compose with a sandbox mode,
// and an ephemeral session cannot be continued. deniedCommands has no rule here: the sandbox is the only
// limit, and it does not block every entry.
export function codexArgs(input: RunInput, files: CodexFiles): string[] {
  const resume = files.threadId !== undefined;
  return [
    "exec",
    ...(resume ? ["resume"] : []),
    "--json",
    "--ignore-user-config",
    "--ignore-rules",
    "-m",
    input.model,
    "-c",
    `model_reasoning_effort="${input.effort}"`,
    "-c",
    `approval_policy="never"`,
    "-c",
    `web_search="disabled"`,
    "-c",
    "features.apps=false",
    "-c",
    `default_permissions="${PROFILE}"`,
    "-c",
    `permissions.${PROFILE}.filesystem=${filesystemTable(input)}`,
    "-c",
    `permissions.${PROFILE}.network.enabled=true`,
    ...(files.schemaPath !== undefined ? ["--output-schema", files.schemaPath] : []),
    ...(files.threadId !== undefined ? [files.threadId] : []),
    "-",
  ];
}
