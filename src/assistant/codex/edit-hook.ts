import { lstatSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative, resolve, sep } from "node:path";
import { errnoCode } from "../../errno.js";
import { errorMessage } from "../../error-message.js";
import { isObject } from "../../object.js";
import { isInside } from "../../real-path.js";
import { shellQuote } from "../../shell-quote.js";

// The script that Codex runs as the PreToolUse hook of apply_patch. It does not exist under src/.
export const EDIT_HOOK_SCRIPT = fileURLToPath(new URL("./edit-hook-main.js", import.meta.url));

// The shell command that runs the hook script for the worktree and the denied edit paths.
export function editHookCommand(script: string, worktree: string, denied: readonly string[]): string {
  return [process.execPath, script, worktree, ...denied].map(shellQuote).join(" ");
}

// Codex lets each patch pass when the file of the hook command is missing. This gives the reason to refuse the
// run when script is not a file.
export function editHookRefusal(script: string): string | undefined {
  try {
    if (statSync(script).isFile()) return undefined;
  } catch {
    // A path that cannot be read counts as missing.
  }
  return `the codex edit hook is missing: ${script}`;
}

const HEADER = /^\*\*\* (?:Add File|Update File|Delete File|Move to):(.*)$/;

// The paths that a patch names, in order. It gives undefined when the text is not a patch that it can read.
export function patchPaths(patch: string): string[] | undefined {
  const lines = patch.split("\n").filter((line) => line.trim() !== "");
  const first = lines[0]?.trim();
  const last = lines[lines.length - 1]?.trim();
  if (first !== "*** Begin Patch" || last !== "*** End Patch") return undefined;
  const paths: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("+") || line.startsWith("-") || !line.startsWith("***")) continue;
    if (line === "*** Begin Patch" || line === "*** End Patch" || line === "*** End of File") continue;
    const header = HEADER.exec(line);
    if (header !== null) {
      const path = (header[1] ?? "").trim();
      if (path === "") return undefined;
      paths.push(path);
      continue;
    }
    // An indented line that matches no header is a context line of a hunk.
    if (raw.startsWith(" ") || raw.startsWith("\t")) continue;
    return undefined;
  }
  return paths;
}

function deny(message: string): string {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: message,
    },
  })}\n`;
}

function isDenied(full: string, denied: readonly string[]): boolean {
  return denied.some((entry) => {
    if (!entry.endsWith("/**")) return full === entry;
    const base = entry.slice(0, -3);
    return full === base || full.startsWith(`${base}/`);
  });
}

// Walks from the worktree down to full. It gives a deny message, or undefined when no part is a link.
function walk(worktree: string, full: string, path: string): string | undefined {
  let current = worktree;
  for (const part of relative(worktree, full).split(sep)) {
    current = resolve(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return `the path goes through a symbolic link: ${path}`;
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return undefined;
      return `tasker cannot read the path: ${path}`;
    }
  }
  return undefined;
}

// The output of the hook for the stdin text. An allow gives "". A deny gives one JSON line. It never throws.
export function editHookAnswer(input: string, worktree: string, denied: readonly string[]): string {
  let command: string | undefined;
  try {
    const parsed: unknown = JSON.parse(input);
    if (
      isObject(parsed) &&
      parsed.hook_event_name === "PreToolUse" &&
      parsed.tool_name === "apply_patch" &&
      isObject(parsed.tool_input) &&
      typeof parsed.tool_input.command === "string"
    ) {
      command = parsed.tool_input.command;
    }
  } catch {
    // The input is not JSON.
  }
  if (command === undefined) return deny("the hook input is not a PreToolUse call of apply_patch");
  try {
    const paths = patchPaths(command);
    if (paths === undefined || paths.length === 0) return deny("tasker cannot read a path from the patch");
    for (const path of paths) {
      if (path.split(/[\\/]/).includes("..")) return deny(`a path with .. is not allowed: ${path}`);
      const full = resolve(worktree, path);
      if (isDenied(full, denied)) return deny(`the path is denied: ${path}`);
      if (!isInside(full, worktree)) return deny(`the path is outside the worktree: ${path}`);
      const linked = walk(worktree, full, path);
      if (linked !== undefined) return deny(linked);
    }
    return "";
  } catch (error) {
    return deny(`the edit hook failed: ${errorMessage(error)}`);
  }
}
