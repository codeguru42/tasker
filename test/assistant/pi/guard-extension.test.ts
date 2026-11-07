import * as fs from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { thrownBy } from "../../helpers/errors.js";
import { useFakePiExtension, type FakePiTool } from "../../helpers/fake-pi-extension.js";
import { useTempDir } from "../../helpers/temp.js";
import type { GuardLimits } from "../../../src/assistant/pi/guard-limits.js";
import guardExtension from "../../../src/assistant/pi/guard-extension.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

function validLimits(): GuardLimits {
  return {
    version: 1,
    cwd: "/work/tree",
    tools: [{ name: "read", path: "builtin:read", source: "builtin" }],
    readRoots: null,
    skillRoots: [],
    protectedPaths: [],
    denyRead: [],
    writeRoots: [],
    denyWrite: [],
    deniedCommands: [],
  };
}

function writeLimits(value: unknown): string {
  const path = join(useTempDir("tasker-guard-validation-"), "limits.json");
  fs.writeFileSync(path, JSON.stringify(value));
  return path;
}

function invokeGuard(args: string[], tools: FakePiTool[] = []) {
  const fake = useFakePiExtension(tools);
  const previousArgv = process.argv;
  process.argv = [process.execPath, "pi", ...args];
  try {
    guardExtension(fake.pi);
  } finally {
    process.argv = previousArgv;
  }
  return fake;
}

function guardedFake(limitsTools: GuardLimits["tools"], tools: FakePiTool[]) {
  const path = writeLimits({ ...validLimits(), tools: limitsTools });
  return invokeGuard(limitsArgs(path), tools);
}

function tool(
  name: string,
  path: string,
  source: string,
  execute: FakePiTool["execute"] = () => "tool result",
): FakePiTool {
  return { name, sourceInfo: { path, source }, execute };
}

function limitTool(current: FakePiTool): GuardLimits["tools"][number] {
  return { name: current.name, path: current.sourceInfo.path, source: current.sourceInfo.source };
}

async function callTool(
  fake: ReturnType<typeof useFakePiExtension>,
  name: string,
  input: unknown = {},
  cwd = "/work/tree",
) {
  return fake.callTool(name, input, { cwd });
}

function dispatchToolCall(fake: ReturnType<typeof useFakePiExtension>, event: unknown) {
  return fake.dispatch("tool_call", event, { cwd: "/work/tree" });
}

function expectBlock(value: unknown, reason: string): void {
  expect(value).toMatchObject({ block: true, reason: expect.stringContaining(reason) });
  expect(JSON.stringify(value)).not.toContain("SENSITIVE");
}

function extensionError(args: string[]): string {
  const error = thrownBy(() => invokeGuard(args));
  return error instanceof Error ? error.message : String(error);
}

function limitsArgs(path: string): string[] {
  return ["--tasker-guard-limits", path];
}

describe("guard extension limits validation", () => {
  it("registers its flag and loads a valid limits file", () => {
    const path = writeLimits(validLimits());

    const fake = invokeGuard(limitsArgs(path));

    expect(fake.registeredFlags()).toEqual(["tasker-guard-limits"]);
  });

  it("rejects the equals form of its flag", () => {
    const path = writeLimits(validLimits());

    expect(extensionError([`--tasker-guard-limits=${path}`])).toContain("--tasker-guard-limits");
  });

  it("rejects a missing limits flag", () => {
    expect(extensionError([])).toContain("--tasker-guard-limits");
  });

  it("rejects a missing, relative, or duplicate flag value", () => {
    const path = writeLimits(validLimits());

    expect(extensionError(["--tasker-guard-limits"])).toContain("--tasker-guard-limits");
    expect(extensionError(["--tasker-guard-limits", "relative.json"])).toContain("--tasker-guard-limits");
    expect(extensionError([...limitsArgs(path), ...limitsArgs(path)])).toContain("--tasker-guard-limits");
  });

  it("rejects a file path that cannot be read", () => {
    const root = useTempDir("tasker-guard-validation-");
    const plainFile = join(root, "plain-file");
    fs.writeFileSync(plainFile, "x");

    expect(extensionError(limitsArgs(join(plainFile, "limits.json")))).toContain("limits");
  });

  it("rejects invalid JSON", () => {
    const path = writeLimits("not-json");
    fs.writeFileSync(path, "{");

    expect(extensionError(limitsArgs(path))).toContain("limits");
  });

  it.each([
    "version",
    "cwd",
    "tools",
    "readRoots",
    "skillRoots",
    "protectedPaths",
    "denyRead",
    "writeRoots",
    "denyWrite",
    "deniedCommands",
  ])("rejects a missing required field %s", (field) => {
    const limits = Object.fromEntries(Object.entries(validLimits()).filter(([key]) => key !== field));
    const path = writeLimits(limits);

    expect(extensionError(limitsArgs(path))).toContain(field);
  });

  it.each([
    ["version", "1"],
    ["cwd", 3],
    ["tools", "read"],
    ["readRoots", false],
    ["skillRoots", "skills"],
    ["protectedPaths", "protected"],
    ["denyRead", "/secret"],
    ["writeRoots", "/work"],
    ["denyWrite", "/secret"],
    ["deniedCommands", "git push"],
  ])("rejects a field with the wrong type: %s", (field, value) => {
    const limits = { ...validLimits(), [field]: value };
    const path = writeLimits(limits);

    expect(extensionError(limitsArgs(path))).toContain(field);
  });

  it("rejects non-absolute paths in path fields", () => {
    const pathFields: (keyof GuardLimits)[] = [
      "cwd",
      "readRoots",
      "skillRoots",
      "protectedPaths",
      "denyRead",
      "writeRoots",
      "denyWrite",
    ];
    const errors = pathFields.map((field) => {
      const limits: Record<string, unknown> = { ...validLimits() };
      limits[field] = field === "cwd" ? "relative" : ["relative"];
      const path = writeLimits(limits);
      return extensionError(limitsArgs(path));
    });

    errors.forEach((message, index) => expect(message).toContain(pathFields[index]));
  });

  it.each(["name", "path", "source"])("rejects a tool with a non-string %s", (field) => {
    const limits = {
      ...validLimits(),
      tools: [{ ...validLimits().tools[0], [field]: 4 }],
    };
    const path = writeLimits(limits);

    expect(extensionError(limitsArgs(path))).toContain("tools");
  });

  it("rejects non-string members of path and tool fields", () => {
    const limits = {
      ...validLimits(),
      tools: [{ name: "read", path: "builtin:read", source: 4 }],
      skillRoots: ["/skills", 4],
    };
    const path = writeLimits(limits);

    expect(extensionError(limitsArgs(path))).toContain("tools");
    expect(extensionError(limitsArgs(path))).toContain("skillRoots");
  });

  it("rejects duplicate tool names", () => {
    const limits = {
      ...validLimits(),
      tools: [...validLimits().tools, { name: "read", path: "builtin:read", source: "builtin" }],
    };
    const path = writeLimits(limits);

    expect(extensionError(limitsArgs(path))).toContain("tools");
  });

  it("names every bad field without exposing their values", () => {
    const limits = {
      version: "SECRET_VERSION",
      cwd: "SECRET_CWD",
      tools: "SECRET_TOOLS",
      readRoots: false,
      skillRoots: 1,
      protectedPaths: false,
      denyRead: {},
      writeRoots: null,
      denyWrite: [3],
      deniedCommands: [""],
    };
    const path = writeLimits(limits);

    const error = extensionError(limitsArgs(path));

    for (const field of [
      "version",
      "cwd",
      "tools",
      "readRoots",
      "skillRoots",
      "protectedPaths",
      "denyRead",
      "writeRoots",
      "denyWrite",
      "deniedCommands",
    ]) {
      expect(error).toContain(field);
    }
    expect(error).not.toContain("SECRET_");
  });

  it("reads the limits file once", () => {
    const path = writeLimits(validLimits());

    invokeGuard(limitsArgs(path));

    expect(vi.mocked(fs.readFileSync).mock.calls.filter(([readPath]) => readPath === path)).toHaveLength(1);
  });
});

describe("guard extension tool source checks", () => {
  it("blocks a call with no tool name", async () => {
    const current = tool("read", "builtin:read", "builtin");
    const fake = guardedFake([limitTool(current)], [current]);

    const [result] = await dispatchToolCall(fake, { input: {} });

    expectBlock(result, "tool name");
  });

  it("blocks a tool that is absent from the limits", async () => {
    const current = tool("extra", "/tmp/extra.js", "cli");
    const fake = guardedFake([], [current]);

    const result = await callTool(fake, "extra");

    expectBlock(result, "limits");
  });

  it("blocks a tool that pi no longer lists", async () => {
    const current = tool("read", "builtin:read", "builtin");
    const fake = guardedFake([limitTool(current)], []);

    const result = await callTool(fake, "read");

    expectBlock(result, "available");
  });

  it("blocks a tool after another extension replaces its source", async () => {
    const current = tool("read", "builtin:read", "builtin");
    const replacement = tool("read", "/tmp/SENSITIVE-extension.js", "cli");
    const fake = guardedFake([limitTool(current)], [current]);
    fake.pi.registerTool(replacement);

    const result = await callTool(fake, "read");

    expectBlock(result, "source");
    expect(JSON.stringify(result)).not.toContain(replacement.sourceInfo.path);
  });

  it.each([
    ["path", "/tmp/SENSITIVE-path.js"],
    ["source", "cli"],
  ])("blocks a %s that differs from the limits", async (field, value) => {
    const current = tool("read", "builtin:read", "builtin");
    const mismatch = { ...limitTool(current), [field]: value };
    const fake = guardedFake([mismatch], [current]);

    const result = await callTool(fake, "read");

    expectBlock(result, "source");
  });

  it("looks up current tools for every call", async () => {
    const current = tool("search", "/tmp/search.js", "cli");
    const fake = guardedFake([limitTool(current)], [current]);
    const lookup = vi.spyOn(fake.pi, "getAllTools");
    onTestFinished(() => lookup.mockRestore());

    await callTool(fake, "search");
    await callTool(fake, "search");

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("checks nested calls through tool_call", async () => {
    const nestedCalls: string[] = [];
    const inner = tool("inner", "/tmp/inner.js", "cli", () => "inner result");
    const outer = tool("outer", "/tmp/outer.js", "cli", (_input, context) => context.executeTool("inner", {}));
    const fake = guardedFake([limitTool(outer), limitTool(inner)], [outer, inner]);
    const lookup = vi.spyOn(fake.pi, "getAllTools");
    onTestFinished(() => lookup.mockRestore());
    fake.pi.on("tool_call", (event) => {
      nestedCalls.push((event as { toolName: string }).toolName);
    });

    const result = await callTool(fake, "outer");

    expect(result).toBe("inner result");
    expect(nestedCalls).toEqual(["outer", "inner"]);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it.each(["bash", "powershell"])("blocks shell tool %s without testing a command", async (name) => {
    const shell = tool(name, `builtin:${name}`, "builtin");
    const fake = guardedFake([limitTool(shell)], [shell]);

    const result = await callTool(fake, name, { command: "SENSITIVE" });

    expectBlock(result, "command test");
  });

  it("passes a named non-file, non-shell tool", async () => {
    const search = tool("search", "/tmp/search.js", "cli", () => "search result");
    const fake = guardedFake([limitTool(search)], [search]);

    expect(await callTool(fake, "search")).toBe("search result");
  });

  it("returns a fixed safe block when its handler throws", async () => {
    const current = tool("search", "/tmp/search.js", "cli");
    const fake = guardedFake([limitTool(current)], [current]);
    const lookup = vi.spyOn(fake.pi, "getAllTools").mockImplementation(() => {
      throw new Error("SENSITIVE handler error");
    });
    onTestFinished(() => lookup.mockRestore());

    const result = await callTool(fake, "search");

    expectBlock(result, "guard failure");
  });
});
