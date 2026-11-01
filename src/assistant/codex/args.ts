import type { RunInput } from "../provider.js";

// The name of the permission profile that every run defines for itself.
const PROFILE = "tasker";

// The files of one run that the arguments name. A new session has neither a thread id nor, maybe, a schema.
export interface CodexFiles {
  threadId?: string;
  schemaPath?: string;
}

// The table of the filesystem profile. "/" must be readable, because a smaller profile makes each command fail.
// Each path is a TOML key written with JSON.stringify. A TOML table must not name one key twice, so a repeated
// path counts once. sandbox.allowWrite is never read: the profile has no write grant.
function filesystemTable(input: RunInput): string {
  const denied = [...new Set(input.sandbox?.denyRead ?? [])];
  const keys = [`"/"="read"`, ...denied.map((path) => `${JSON.stringify(path)}="deny"`)];
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
