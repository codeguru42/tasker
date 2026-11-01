import { lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { isSet } from "../../config/path.js";
import { errnoCode } from "../../errno.js";
import type { RunInput } from "../provider.js";
import { codexSocketDenyPaths } from "./sockets.js";

// The name of the permission profile that every run defines for itself.
const PROFILE = "tasker";

// The files of one run that the arguments name. A new session has neither a thread id nor, maybe, a schema.
export interface CodexFiles {
  threadId?: string;
  schemaPath?: string;
  // The shell command of the PreToolUse hook of apply_patch. Only a run with write access gets it.
  hookCommand?: string;
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
// is a Map and a path has one key, and a later value wins. A run with workspace-write access gets write keys
// for the cwd, the temp folder and each path of sandbox.allowWrite. A read-only run gets no write key.
// The deny keys are the paths of sandbox.denyRead and the socket paths. They come last, so a path that is
// both written and denied gets deny.
function filesystemTable(input: RunInput): string {
  const table = new Map<string, string>([["/", "read"]]);
  if (input.access === "workspace-write") {
    const temp = isSet(input.env.TMPDIR) ? resolve(input.env.TMPDIR) : "/tmp";
    for (const path of realKeys([input.cwd, temp, ...(input.sandbox?.allowWrite ?? [])])) {
      table.set(path, "write");
    }
  }
  const denied = realKeys([...(input.sandbox?.denyRead ?? []), ...codexSocketDenyPaths(input.env)]);
  for (const path of withoutNested(denied)) table.set(path, "deny");
  const keys = [...table].map(([path, access]) => `${JSON.stringify(path)}=${JSON.stringify(access)}`);
  return `{${keys.join(", ")}}`;
}

// The arguments that add the PreToolUse hook of apply_patch. The command is a TOML string, written with
// JSON.stringify. The flag makes Codex run the hook with no trust review. It also runs the hooks of the user.
// The timeout is in seconds. A hook that times out lets the patch pass, and the hook is fast.
function codexHookArgs(command: string): string[] {
  return [
    "-c",
    `hooks.PreToolUse=[{matcher="^apply_patch$", hooks=[{type="command", command=${JSON.stringify(command)}, timeout=10}]}]`,
    "--dangerously-bypass-hook-trust",
  ];
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
    ...(files.hookCommand !== undefined ? codexHookArgs(files.hookCommand) : []),
    ...(files.schemaPath !== undefined ? ["--output-schema", files.schemaPath] : []),
    ...(files.threadId !== undefined ? [files.threadId] : []),
    "-",
  ];
}
