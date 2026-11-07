import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { thrownBy } from "../../helpers/errors.js";
import { useTempDir } from "../../helpers/temp.js";
import { builtInTool, guardLimits, writeGuardLimits } from "../../../src/assistant/pi/guard-limits.js";
import { guardStartArgs } from "../../../src/assistant/pi/guard-start.js";
import type { RunInput } from "../../../src/assistant/provider.js";
import { guardLimitsPath } from "../../../src/store/layout.js";

function makeLimits(input: RunInput, tools: { name: string; path: string; source: string }[]) {
  return guardLimits(input, tools);
}

function makeStartArgs(path: string) {
  return guardStartArgs(path);
}

function writeLimits(input: RunInput, limits: ReturnType<typeof makeLimits>) {
  return writeGuardLimits(input, limits);
}

function makeBuiltInTool(name: string) {
  return builtInTool(name);
}

function makeLimitsPath(sessionDir: string, sessionId: string) {
  return guardLimitsPath(sessionDir, sessionId);
}

function runInput(access: RunInput["access"] = "read-only"): RunInput {
  return {
    sessionId: "session-1",
    resume: false,
    prompt: "prompt",
    cwd: "/work/tree",
    env: {},
    timeoutMs: 1000,
    sessionDir: "/sessions",
    access,
    deniedCommands: ["git push"],
    deniedEditPaths: [],
    model: "model",
    effort: "low",
  };
}

const tools = [{ name: "read", path: "builtin:read", source: "builtin" }];

describe("guardLimits", () => {
  it("uses the limits fields and read-only values", () => {
    expect(makeLimits(runInput(), tools)).toEqual({
      version: 1,
      cwd: "/work/tree",
      tools,
      readRoots: null,
      skillRoots: [],
      protectedPaths: [],
      denyRead: [],
      writeRoots: [],
      denyWrite: [],
      deniedCommands: ["git push"],
    });
  });

  it("copies sandbox read denials", () => {
    expect(
      makeLimits(
        {
          ...runInput(),
          sandbox: { allowWrite: [], denyRead: ["/secret"], trackedPaths: async () => [], sharedFolder: "/shared" },
        },
        tools,
      ).denyRead,
    ).toEqual(["/secret"]);
  });

  it("refuses workspace-write access", () => {
    expect(() => makeLimits(runInput("workspace-write"), tools)).toThrow();
  });

  it("makes a built-in tool source", () => {
    expect(makeBuiltInTool("read")).toEqual({ name: "read", path: "builtin:read", source: "builtin" });
  });
});

describe("guardStartArgs", () => {
  it("gives the extension flags in order", () => {
    const path = "/sessions/session-1.guard.json";
    expect(makeStartArgs(path)).toEqual([
      "--no-mcp",
      "-e",
      fileURLToPath(new URL("../../../src/assistant/pi/guard-extension.js", import.meta.url)),
      "--tasker-guard-limits",
      path,
    ]);
  });
});

describe("guardLimitsPath", () => {
  it("uses the session file name", () => {
    expect(makeLimitsPath("/sessions", "session-1")).toBe("/sessions/session-1.guard.json");
  });
});

describe("writeGuardLimits", () => {
  it("writes JSON with mode 0600", () => {
    const sessionDir = useTempDir("tasker-guard-limits-");
    const input = { ...runInput(), sessionDir };
    const limits = makeLimits(input, tools);

    const path = writeLimits(input, limits);

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(limits);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("throws when a parent path is a file", () => {
    const root = useTempDir("tasker-guard-limits-");
    const plainFile = join(root, "file");
    writeFileSync(plainFile, "x");
    const input = { ...runInput(), sessionDir: plainFile };
    const limits = makeLimits(input, tools);

    const error = thrownBy(() => writeLimits(input, limits));

    expect((error as NodeJS.ErrnoException).code).toBe("ENOTDIR");
  });
});
