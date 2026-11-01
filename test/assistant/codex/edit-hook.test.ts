import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  editHookAnswer,
  editHookCommand,
  editHookRefusal,
  patchPaths,
} from "../../../src/assistant/codex/edit-hook.js";
import { repoRoot } from "../../helpers/processes.js";
import { useTempDir, useTempFile } from "../../helpers/temp.js";

const BAD_INPUT = "the hook input is not a PreToolUse call of apply_patch";
const NOT_PARSED = "tasker cannot read a path from the patch";
const DOT_DOT = (path: string) => `a path with .. is not allowed: ${path}`;
const DENIED_PATH = (path: string) => `the path is denied: ${path}`;
const OUTSIDE = (path: string) => `the path is outside the worktree: ${path}`;
const LINK = (path: string) => `the path goes through a symbolic link: ${path}`;
const UNREADABLE = (path: string) => `tasker cannot read the path: ${path}`;

function denyLine(message: string): string {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: message,
    },
  })}\n`;
}

function patch(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

function hookInput(command: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: "s",
    turn_id: "t",
    transcript_path: "/x/rollout.jsonl",
    cwd: "/x",
    hook_event_name: "PreToolUse",
    model: "m",
    permission_mode: "bypassPermissions",
    tool_name: "apply_patch",
    tool_input: { command },
    tool_use_id: "exec-1",
    ...extra,
  });
}

interface Setup {
  wt: string;
  clone: string;
  denied: string[];
  answer: (command: unknown) => string;
}

function setup(): Setup {
  const root = realpathSync(useTempDir("tasker-hook-"));
  const wt = join(root, "wt");
  const clone = join(root, "clone");
  mkdirSync(wt);
  mkdirSync(clone);
  const denied = [`${wt}/.git`, `${wt}/.git/**`, `${clone}/**`];
  return { wt, clone, denied, answer: (command) => editHookAnswer(hookInput(command), wt, denied) };
}

describe("editHookAnswer", () => {
  it("allows an add, an update, a delete and a move of paths that no rule denies, and prints nothing", () => {
    const { answer } = setup();
    expect(answer(patch("*** Add File: a.txt", "+x"))).toBe("");
    expect(answer(patch("*** Update File: a.txt", "@@", "+x"))).toBe("");
    expect(answer(patch("*** Delete File: a.txt"))).toBe("");
    expect(answer(patch("*** Update File: a.txt", "*** Move to: b.txt", "@@", "+x"))).toBe("");
  });

  it("allows a relative path, an absolute path in the worktree and a path with a . part", () => {
    const { answer, wt } = setup();
    expect(answer(patch("*** Add File: sub/a.txt", "+x"))).toBe("");
    expect(answer(patch(`*** Add File: ${wt}/a.txt`, "+x"))).toBe("");
    expect(answer(patch("*** Add File: ./sub/./a.txt", "+x"))).toBe("");
  });

  it("denies the input that is not JSON, the wrong event, another tool and a command that is not a string", () => {
    const { wt, denied } = setup();
    const good = patch("*** Add File: a.txt", "+x");
    expect(editHookAnswer("not json", wt, denied)).toBe(denyLine(BAD_INPUT));
    expect(editHookAnswer(hookInput(good, { hook_event_name: "PostToolUse" }), wt, denied)).toBe(denyLine(BAD_INPUT));
    expect(editHookAnswer(hookInput(good, { tool_name: "Bash" }), wt, denied)).toBe(denyLine(BAD_INPUT));
    expect(editHookAnswer(hookInput(42), wt, denied)).toBe(denyLine(BAD_INPUT));
  });

  it("denies a patch with no Begin, no End, no path, an empty path and an unknown *** line", () => {
    const { answer } = setup();
    expect(answer("*** Add File: a.txt\n+x\n*** End Patch")).toBe(denyLine(NOT_PARSED));
    expect(answer("*** Begin Patch\n*** Add File: a.txt\n+x")).toBe(denyLine(NOT_PARSED));
    expect(answer(patch("+x"))).toBe(denyLine(NOT_PARSED));
    expect(answer(patch("*** Add File: ", "+x"))).toBe(denyLine(NOT_PARSED));
    expect(answer(patch("*** Add File: a.txt", "*** Rename File: b.txt"))).toBe(denyLine(NOT_PARSED));
  });

  it("denies each of add, update, delete and move for <wt>/.git", () => {
    const { answer, wt } = setup();
    for (const path of [".git", `${wt}/.git`, ".git/config"]) {
      const message = denyLine(DENIED_PATH(path));
      expect(answer(patch(`*** Add File: ${path}`, "+x"))).toBe(message);
      expect(answer(patch(`*** Update File: ${path}`, "@@", "+x"))).toBe(message);
      expect(answer(patch(`*** Delete File: ${path}`))).toBe(message);
      expect(answer(patch("*** Update File: a.txt", `*** Move to: ${path}`, "@@", "+x"))).toBe(message);
    }
  });

  it("denies a move whose source is allowed and whose target is denied, and the reverse", () => {
    const { answer } = setup();
    expect(answer(patch("*** Update File: a.txt", "*** Move to: .git/x", "@@", "+x"))).toBe(
      denyLine(DENIED_PATH(".git/x")),
    );
    expect(answer(patch("*** Update File: .git/x", "*** Move to: a.txt", "@@", "+x"))).toBe(
      denyLine(DENIED_PATH(".git/x")),
    );
  });

  it("denies the second file of a call with two files", () => {
    const { answer } = setup();
    expect(answer(patch("*** Add File: a.txt", "+x", "*** Add File: .git/x", "+y"))).toBe(
      denyLine(DENIED_PATH(".git/x")),
    );
  });

  it("denies a marker with spaces before it", () => {
    const { answer } = setup();
    expect(answer(patch("  *** Add File: .git/x", "+y"))).toBe(denyLine(DENIED_PATH(".git/x")));
  });

  it("does not read a +*** Add File: .git line of a body as a path", () => {
    const { answer } = setup();
    expect(answer(patch("*** Add File: a.txt", "+*** Add File: .git/x", "-*** Delete File: .git/y"))).toBe("");
  });

  it("denies a path under <clone>/**, and gives OUTSIDE for <clone>-other/a", () => {
    const { answer, clone } = setup();
    for (const rest of ["refs/heads/x", "objects/x", "logs/x", "worktrees/w/x"]) {
      const path = `${clone}/${rest}`;
      expect(answer(patch(`*** Add File: ${path}`, "+x"))).toBe(denyLine(DENIED_PATH(path)));
    }
    const other = `${clone}-other/a`;
    expect(answer(patch(`*** Add File: ${other}`, "+x"))).toBe(denyLine(OUTSIDE(other)));
  });

  it("does not take <wt>/.git-keep for <wt>/.git", () => {
    const { answer } = setup();
    expect(answer(patch("*** Add File: .git-keep", "+x"))).toBe("");
  });

  it("denies a relative path that resolves to a denied path", () => {
    const { answer } = setup();
    expect(answer(patch("*** Add File: ./.git/x", "+x"))).toBe(denyLine(DENIED_PATH("./.git/x")));
  });

  it("denies sub/../dotdot.txt", () => {
    const { answer } = setup();
    expect(answer(patch("*** Add File: sub/../dotdot.txt", "+x"))).toBe(denyLine(DOT_DOT("sub/../dotdot.txt")));
  });

  it("denies a symbolic link at the first, a middle and the last part, also inside the worktree", () => {
    const { answer, wt } = setup();
    mkdirSync(join(wt, "real", "deep"), { recursive: true });
    symlinkSync(join(wt, "real"), join(wt, "first"));
    symlinkSync(join(wt, "real", "deep"), join(wt, "real", "mid"));
    writeFileSync(join(wt, "real", "file.txt"), "x");
    symlinkSync(join(wt, "real", "file.txt"), join(wt, "last.txt"));
    for (const path of ["first/a.txt", "real/mid/a.txt", "last.txt"]) {
      expect(answer(patch(`*** Update File: ${path}`, "@@", "+x"))).toBe(denyLine(LINK(path)));
    }
  });

  it("allows a path whose lower parts do not exist yet", () => {
    const { answer } = setup();
    expect(answer(patch("*** Add File: new/deep/er/a.txt", "+x"))).toBe("");
  });

  it("denies with UNREADABLE when a file stands in the place of a folder", () => {
    const { answer, wt } = setup();
    writeFileSync(join(wt, "file"), "x");
    expect(answer(patch("*** Add File: file/a.txt", "+x"))).toBe(denyLine(UNREADABLE("file/a.txt")));
  });

  it("denies a path outside the worktree", () => {
    const { answer } = setup();
    expect(answer(patch("*** Add File: /etc/x", "+x"))).toBe(denyLine(OUTSIDE("/etc/x")));
  });

  it("writes no file in the worktree", () => {
    const { answer, wt } = setup();
    const before = readdirSync(wt);
    answer(patch("*** Add File: a.txt", "+x"));
    answer(patch("*** Add File: .git/x", "+x"));
    expect(readdirSync(wt)).toEqual(before);
  });
});

describe("patchPaths", () => {
  it("reads the paths of the headers in order", () => {
    expect(
      patchPaths(patch("*** Update File: a", "*** Move to: b", "@@", "+x", "*** Delete File: c", "*** End of File")),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("editHookCommand", () => {
  it("gives the exact shell text, with a quote in a path", () => {
    expect(editHookCommand("/s/main.js", "/w t/it's", ["/a", "/b/**"])).toBe(
      `'${process.execPath}' '/s/main.js' '/w t/it'\\''s' '/a' '/b/**'`,
    );
  });
});

describe("editHookRefusal", () => {
  it("gives undefined for a file, and the message for a missing path and for a folder", () => {
    const file = useTempFile("tasker-hook-script-", "main.js", "");
    const dir = useTempDir("tasker-hook-dir-");
    expect(editHookRefusal(file)).toBeUndefined();
    expect(editHookRefusal(join(dir, "nope.js"))).toBe(`the codex edit hook is missing: ${join(dir, "nope.js")}`);
    expect(editHookRefusal(dir)).toBe(`the codex edit hook is missing: ${dir}`);
  });
});

function runMain(args: readonly string[], stdin: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/assistant/codex/edit-hook-main.ts", ...args], {
      cwd: repoRoot,
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(stdin);
  });
}

describe("edit-hook-main", () => {
  it("exists beside edit-hook.ts", () => {
    expect(existsSync(new URL("../../../src/assistant/codex/edit-hook-main.ts", import.meta.url))).toBe(true);
  });

  it("prints the deny line and exits 0 for a denied path", async () => {
    const { wt, denied, answer } = setup();
    const command = patch("*** Add File: .git/x", "+x");
    const result = await runMain([wt, ...denied], hookInput(command));
    expect(result).toEqual({ code: 0, stdout: answer(command) });
    expect(result.stdout).toBe(denyLine(DENIED_PATH(".git/x")));
  });

  it("prints nothing and exits 0 for an allowed path", async () => {
    const { wt, denied } = setup();
    expect(await runMain([wt, ...denied], hookInput(patch("*** Add File: a.txt", "+x")))).toEqual({
      code: 0,
      stdout: "",
    });
  });

  it("prints a deny line and exits 0 for stdin that is not JSON", async () => {
    const { wt, denied } = setup();
    const result = await runMain([wt, ...denied], "not json");
    expect(result).toEqual({ code: 0, stdout: denyLine(BAD_INPUT) });
  });

  it("prints a deny line and exits 0 with no worktree argument", async () => {
    const result = await runMain([], hookInput(patch("*** Add File: a.txt", "+x")));
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^\{"hookSpecificOutput":\{"hookEventName":"PreToolUse","permissionDecision":"deny"/);
  });
});
