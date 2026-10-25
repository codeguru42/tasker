import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deepestRealPath, isInside } from "../../real-path.js";
import { shellQuote } from "../../shell-quote.js";

const BAD_INPUT = "the input of the hook is not a PermissionRequest in JSON";
const OTHER_TOOL = "the execute session approves only a Write or an Edit";
const OUTSIDE = "the path is not inside .claude/skills/ of the worktree";

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

// True when the real path of filePath is inside the real .claude/skills/ folder of the worktree,
// and that folder is itself inside the real worktree. The folder itself is not inside.
function isSkillPath(filePath: unknown, worktree: string): boolean {
  if (typeof filePath !== "string") return false;
  const skills = deepestRealPath(join(worktree, ".claude", "skills"));
  if (!isInside(skills, deepestRealPath(worktree))) return false;
  const real = deepestRealPath(filePath);
  return isInside(real, skills) && real !== skills;
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
  try {
    const filePath = isObject(parsed.tool_input) ? parsed.tool_input.file_path : undefined;
    return isSkillPath(filePath, worktree) ? allow() : deny(OUTSIDE);
  } catch {
    return deny(OUTSIDE);
  }
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
