import { mkdirSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { permissionAnswer, permissionHookSettings } from "../../../src/assistant/claude-code/permission-hook.js";
import { shellQuote } from "../../../src/shell-quote.js";
import { useTempDir } from "../../helpers/temp.js";

const BAD_INPUT = "the input of the hook is not a PermissionRequest in JSON";
const OTHER_TOOL = "the execute session approves only a Write or an Edit";
const OUTSIDE = "the path is not inside .claude/skills/ of the worktree";

function answer(input: unknown, worktree: string): string {
  return permissionAnswer(typeof input === "string" ? input : JSON.stringify(input), worktree);
}

function allowLine(): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
  });
}

function denyLine(message: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "deny", message },
    },
  });
}

function request(toolName: string, toolInput: unknown): unknown {
  return { hook_event_name: "PermissionRequest", tool_name: toolName, tool_input: toolInput };
}

function newWorktree(): string {
  return realpathSync(useTempDir("tasker-hook-wt-"));
}

describe("permissionAnswer", () => {
  it("allows a Write of a new file under .claude/skills/ when .claude does not exist", () => {
    const wt = newWorktree();
    const input = request("Write", { file_path: join(wt, ".claude/skills/x/SKILL.md") });

    expect(answer(input, wt)).toBe(allowLine());
  });

  it("allows an Edit of an existing file under .claude/skills/", () => {
    const wt = newWorktree();
    mkdirSync(join(wt, ".claude/skills/x"), { recursive: true });
    writeFileSync(join(wt, ".claude/skills/x/SKILL.md"), "hello");
    const input = request("Edit", { file_path: join(wt, ".claude/skills/x/SKILL.md") });

    expect(answer(input, wt)).toBe(allowLine());
  });

  it("denies .claude/settings.json", () => {
    const wt = newWorktree();
    const input = request("Write", { file_path: join(wt, ".claude/settings.json") });

    expect(answer(input, wt)).toBe(denyLine(OUTSIDE));
  });

  it("denies a path with .. that leads out of .claude/skills/", () => {
    const wt = newWorktree();
    const input = request("Write", { file_path: `${wt}/.claude/skills/../settings.json` });

    expect(answer(input, wt)).toBe(denyLine(OUTSIDE));
  });

  it("denies a path through a symlink that leads out of the worktree", () => {
    const wt = newWorktree();
    const outside = realpathSync(useTempDir("tasker-hook-out-"));
    mkdirSync(join(wt, ".claude/skills"), { recursive: true });
    symlinkSync(outside, join(wt, ".claude/skills/out"));
    const input = request("Write", { file_path: join(wt, ".claude/skills/out/x.md") });

    expect(answer(input, wt)).toBe(denyLine(OUTSIDE));
  });

  it("denies a path when .claude/skills itself is a symlink that leads out", () => {
    const wt = newWorktree();
    const outside = realpathSync(useTempDir("tasker-hook-out-"));
    mkdirSync(join(wt, ".claude"));
    symlinkSync(outside, join(wt, ".claude/skills"));
    const input = request("Write", { file_path: join(wt, ".claude/skills/x.md") });

    expect(answer(input, wt)).toBe(denyLine(OUTSIDE));
  });

  it("denies a Write of a dangling symlink under .claude/skills/ that leads out of the worktree", () => {
    const wt = newWorktree();
    const outside = realpathSync(useTempDir("tasker-hook-out-"));
    mkdirSync(join(wt, ".claude/skills"), { recursive: true });
    symlinkSync(join(outside, "new.sh"), join(wt, ".claude/skills/link"));
    const input = request("Write", { file_path: join(wt, ".claude/skills/link") });

    expect(answer(input, wt)).toBe(denyLine(OUTSIDE));
  });

  it("denies a path under a dangling .claude/skills symlink that leads out of the worktree", () => {
    const wt = newWorktree();
    const outside = realpathSync(useTempDir("tasker-hook-out-"));
    mkdirSync(join(wt, ".claude"));
    symlinkSync(join(outside, "missing"), join(wt, ".claude/skills"));
    const input = request("Write", { file_path: join(wt, ".claude/skills/x.md") });

    expect(answer(input, wt)).toBe(denyLine(OUTSIDE));
  });

  it("allows a dangling symlink under .claude/skills/ that leads to a missing file inside it", () => {
    const wt = newWorktree();
    mkdirSync(join(wt, ".claude/skills"), { recursive: true });
    symlinkSync(join(wt, ".claude/skills/new.md"), join(wt, ".claude/skills/link"));
    const input = request("Write", { file_path: join(wt, ".claude/skills/link") });

    expect(answer(input, wt)).toBe(allowLine());
  });

  it("denies the .claude/skills folder itself", () => {
    const wt = newWorktree();
    const input = request("Write", { file_path: join(wt, ".claude/skills") });

    expect(answer(input, wt)).toBe(denyLine(OUTSIDE));
  });

  it("denies a relative file_path and a missing file_path", () => {
    const wt = newWorktree();

    expect(answer(request("Write", { file_path: ".claude/skills/x.md" }), wt)).toBe(denyLine(OUTSIDE));
    expect(answer(request("Write", {}), wt)).toBe(denyLine(OUTSIDE));
  });

  it("denies a tool other than Write and Edit", () => {
    const wt = newWorktree();
    const path = join(wt, ".claude/skills/x.md");

    expect(answer(request("Bash", { file_path: path }), wt)).toBe(denyLine(OTHER_TOOL));
    expect(answer(request("Read", { file_path: path }), wt)).toBe(denyLine(OTHER_TOOL));
  });

  it("denies an input that is not a PermissionRequest in JSON", () => {
    const wt = newWorktree();
    const other = { ...(request("Write", {}) as object), hook_event_name: "PreToolUse" };

    expect(answer("not json", wt)).toBe(denyLine(BAD_INPUT));
    expect(answer("null", wt)).toBe(denyLine(BAD_INPUT));
    expect(answer(other, wt)).toBe(denyLine(BAD_INPUT));
  });

  it("writes no file", () => {
    const wt = newWorktree();
    const before = readdirSync(wt, { recursive: true });

    answer(request("Write", { file_path: join(wt, ".claude/skills/x/SKILL.md") }), wt);
    answer(request("Write", { file_path: join(wt, ".claude/settings.json") }), wt);

    expect(readdirSync(wt, { recursive: true })).toEqual(before);
  });
});

describe("permissionHookSettings", () => {
  it("runs the hook script with the Node of tasker and the worktree for each tool", () => {
    const wt = newWorktree();
    const script = fileURLToPath(
      new URL("../../../src/assistant/claude-code/permission-hook-main.js", import.meta.url),
    );
    const command = [process.execPath, script, wt].map(shellQuote).join(" ");

    expect(permissionHookSettings(wt)).toEqual({
      hooks: { PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command }] }] },
    });
  });
});
