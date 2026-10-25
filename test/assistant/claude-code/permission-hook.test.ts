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
const NOT_ABSOLUTE = "the path must be absolute";
const DOT_PART = "the path must have no . or .. part";
const LINK = "the path has a symbolic link";
const UNREADABLE = "the hook cannot read a part of the path";

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

  it("allows a Write under folders that do not exist yet in .claude/skills/", () => {
    const wt = newWorktree();
    mkdirSync(join(wt, ".claude/skills"), { recursive: true });
    const input = request("Write", { file_path: join(wt, ".claude/skills/a/b/SKILL.md") });

    expect(answer(input, wt)).toBe(allowLine());
  });

  it("denies .claude/settings.json", () => {
    const wt = newWorktree();
    const input = request("Write", { file_path: join(wt, ".claude/settings.json") });

    expect(answer(input, wt)).toBe(denyLine(OUTSIDE));
  });

  it("denies a relative path", () => {
    const wt = newWorktree();

    expect(answer(request("Write", { file_path: ".claude/skills/x.md" }), wt)).toBe(denyLine(NOT_ABSOLUTE));
  });

  it("denies a missing file_path", () => {
    const wt = newWorktree();

    expect(answer(request("Write", {}), wt)).toBe(denyLine(OUTSIDE));
  });

  it("denies a path with a .. part that leads out of the folder", () => {
    const wt = newWorktree();
    const input = request("Write", { file_path: `${wt}/.claude/skills/../settings.json` });

    expect(answer(input, wt)).toBe(denyLine(DOT_PART));
  });

  it("denies a path with a . part that stays inside the folder", () => {
    const wt = newWorktree();
    const input = request("Write", { file_path: `${wt}/.claude/skills/./x.md` });

    expect(answer(input, wt)).toBe(denyLine(DOT_PART));
  });

  it("denies a path with a .. part that stays inside the folder", () => {
    const wt = newWorktree();
    const input = request("Write", { file_path: `${wt}/.claude/skills/a/../x.md` });

    expect(answer(input, wt)).toBe(denyLine(DOT_PART));
  });

  it("denies a symbolic link under .claude/skills/ that leads out of the folder", () => {
    const wt = newWorktree();
    const outside = realpathSync(useTempDir("tasker-hook-out-"));
    mkdirSync(join(wt, ".claude/skills"), { recursive: true });
    symlinkSync(outside, join(wt, ".claude/skills/out"));
    const input = request("Write", { file_path: join(wt, ".claude/skills/out/x.md") });

    expect(answer(input, wt)).toBe(denyLine(LINK));
  });

  it("denies a symbolic link under .claude/skills/ that leads to a place inside the folder", () => {
    const wt = newWorktree();
    mkdirSync(join(wt, ".claude/skills/a"), { recursive: true });
    symlinkSync(join(wt, ".claude/skills/a"), join(wt, ".claude/skills/in"));
    const input = request("Write", { file_path: join(wt, ".claude/skills/in/x.md") });

    expect(answer(input, wt)).toBe(denyLine(LINK));
  });

  it("denies a dangling symbolic link under .claude/skills/", () => {
    const wt = newWorktree();
    const outside = realpathSync(useTempDir("tasker-hook-out-"));
    mkdirSync(join(wt, ".claude/skills"), { recursive: true });
    symlinkSync(join(outside, "new.sh"), join(wt, ".claude/skills/link"));
    const input = request("Write", { file_path: join(wt, ".claude/skills/link") });

    expect(answer(input, wt)).toBe(denyLine(LINK));
  });

  it("denies a dangling symbolic link that leads inside .claude/skills/", () => {
    const wt = newWorktree();
    mkdirSync(join(wt, ".claude/skills"), { recursive: true });
    symlinkSync(join(wt, ".claude/skills/new.md"), join(wt, ".claude/skills/link"));
    const input = request("Write", { file_path: join(wt, ".claude/skills/link") });

    expect(answer(input, wt)).toBe(denyLine(LINK));
  });

  it("denies .claude/skills as a symbolic link", () => {
    const wt = newWorktree();
    const outside = realpathSync(useTempDir("tasker-hook-out-"));
    mkdirSync(join(wt, ".claude"));
    symlinkSync(outside, join(wt, ".claude/skills"));
    const input = request("Write", { file_path: join(wt, ".claude/skills/x.md") });

    expect(answer(input, wt)).toBe(denyLine(LINK));
  });

  it("denies .claude/skills as a dangling symbolic link", () => {
    const wt = newWorktree();
    const outside = realpathSync(useTempDir("tasker-hook-out-"));
    mkdirSync(join(wt, ".claude"));
    symlinkSync(join(outside, "missing"), join(wt, ".claude/skills"));
    const input = request("Write", { file_path: join(wt, ".claude/skills/x.md") });

    expect(answer(input, wt)).toBe(denyLine(LINK));
  });

  it("denies .claude as a symbolic link", () => {
    const wt = newWorktree();
    const outside = realpathSync(useTempDir("tasker-hook-out-"));
    symlinkSync(outside, join(wt, ".claude"));
    const input = request("Write", { file_path: join(wt, ".claude/skills/x.md") });

    expect(answer(input, wt)).toBe(denyLine(LINK));
  });

  it("denies the .claude/skills folder itself", () => {
    const wt = newWorktree();
    const input = request("Write", { file_path: join(wt, ".claude/skills") });

    expect(answer(input, wt)).toBe(denyLine(OUTSIDE));
  });

  it("denies .claude/skills/ with a trailing slash", () => {
    const wt = newWorktree();
    const input = request("Write", { file_path: `${wt}/.claude/skills/` });

    expect(answer(input, wt)).toBe(denyLine(OUTSIDE));
  });

  it("denies a sibling folder that starts with skills", () => {
    const wt = newWorktree();
    const input = request("Write", { file_path: join(wt, ".claude/skills-x/a.md") });

    expect(answer(input, wt)).toBe(denyLine(OUTSIDE));
  });

  it("denies a path when a part cannot be read", () => {
    const wt = newWorktree();
    mkdirSync(join(wt, ".claude/skills"), { recursive: true });
    writeFileSync(join(wt, ".claude/skills/a.md"), "x");
    const input = request("Write", { file_path: join(wt, ".claude/skills/a.md/x.md") });

    expect(answer(input, wt)).toBe(denyLine(UNREADABLE));
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
