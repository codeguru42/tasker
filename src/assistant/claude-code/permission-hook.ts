import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { errnoCode } from "../../errno.js";
import { shellQuote } from "../../shell-quote.js";

const BAD_INPUT = "the input of the hook is not a PermissionRequest in JSON";
const OTHER_TOOL = "the execute session approves only a Write or an Edit";
const OUTSIDE = "the path is not inside .claude/skills/ of the worktree";
const NOT_ABSOLUTE = "the path must be absolute";
const DOT_PART = "the path must have no . or .. part";
const LINK = "the path has a symbolic link";
const UNREADABLE = "the hook cannot read a part of the path";

const HOOK_SCRIPT = fileURLToPath(new URL("./permission-hook-main.js", import.meta.url));

function allow(): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
  });
}

function deny(message: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "deny", message },
    },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The deny message of the first check that fails for filePath, or undefined when all checks pass:
// 1. The path is absolute.
// 2. No part of the path is . or ..
// 3. As text, the path starts with <worktree>/.claude/skills/ and has a part after it.
// 4. No part from <worktree>/.claude down is a symbolic link. Each part is read with lstat. The walk
//    stops at the first part that does not exist.
// The Write tool of claude 2.1.310 resolves .. as text before it writes, and the kernel follows a
// link first. With no . or .. part and no link, the text path is the path that is written, so no
// real path is needed.
function skillPathProblem(filePath: unknown, worktree: string): string | undefined {
  if (typeof filePath !== "string") return OUTSIDE;
  if (!isAbsolute(filePath)) return NOT_ABSOLUTE;
  if (filePath.split("/").some((part) => part === "." || part === "..")) return DOT_PART;
  const prefix = `${worktree}/.claude/skills/`;
  if (!filePath.startsWith(prefix)) return OUTSIDE;
  const rest = filePath.slice(prefix.length).split("/");
  if (!rest.some((part) => part !== "")) return OUTSIDE;
  let current = worktree;
  for (const part of filePath.slice(worktree.length + 1).split("/")) {
    if (part === "") continue;
    current = `${current}/${part}`;
    try {
      if (lstatSync(current).isSymbolicLink()) return LINK;
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return undefined;
      return UNREADABLE;
    }
  }
  return undefined;
}

// The answer line of the hook for the JSON that claude gives on stdin. It allows a Write or an Edit
// under .claude/skills/ of the worktree and denies each other question. It never throws.
export function permissionAnswer(input: string, worktree: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return deny(BAD_INPUT);
  }
  if (!isObject(parsed) || parsed.hook_event_name !== "PermissionRequest") return deny(BAD_INPUT);
  if (parsed.tool_name !== "Write" && parsed.tool_name !== "Edit") return deny(OTHER_TOOL);
  const filePath = isObject(parsed.tool_input) ? parsed.tool_input.file_path : undefined;
  const problem = skillPathProblem(filePath, worktree);
  return problem === undefined ? allow() : deny(problem);
}

// The hook settings for the execute session, measured with claude 2.1.310. Under dontAsk, claude
// denies each write under .claude/, also with an allow rule, a sandbox write path or a PreToolUse
// hook, and a PermissionRequest hook does not run. Under the default mode, this hook answers each
// question that no allow or deny rule decides. The deny rules run before the hook. The hook allows
// only .claude/skills/, because a write to .claude/settings.json can change the permissions of a
// later session. The matcher "*" covers each tool.
export function permissionHookSettings(worktree: string): Record<string, unknown> {
  const command = [process.execPath, HOOK_SCRIPT, worktree].map(shellQuote).join(" ");
  return {
    hooks: { PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command }] }] },
  };
}
