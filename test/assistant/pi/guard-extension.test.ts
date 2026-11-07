import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

function invokeGuard(args: string[], tools: FakePiTool[] = [], fake = useFakePiExtension(tools)) {
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

function guardedFileTool(name: string, cwd: string, limits: Partial<GuardLimits> = {}) {
  const current = tool(name, `builtin:${name}`, "builtin");
  const guard = { ...validLimits(), cwd, tools: [limitTool(current)], ...limits };
  const fake = invokeGuard(limitsArgs(writeLimits(guard)), [current]);
  return { fake, cwd };
}

function fileToolCall(fake: ReturnType<typeof useFakePiExtension>, name: string, input: unknown, cwd: string) {
  return callTool(fake, name, input, cwd);
}

function beforeAgentStart(fake: ReturnType<typeof useFakePiExtension>, event: unknown) {
  return fake.dispatch("before_agent_start", event, { cwd: "/work/tree" });
}

function skillEvent(filePaths: string[]) {
  return { systemPromptOptions: { skills: filePaths.map((filePath) => ({ filePath })) } };
}

function expectFileBlock(value: unknown, privatePath?: string): void {
  expect(value).toMatchObject({ block: true, reason: expect.any(String) });
  if (privatePath !== undefined) expect(JSON.stringify(value)).not.toContain(privatePath);
}

const FILE_TOOL_TABLE = [
  { name: "read", field: "path", noPath: "Not permitted", kind: "read" },
  { name: "grep", field: "path", noPath: "The worktree (.)", kind: "read" },
  { name: "find", field: "path", noPath: "The worktree (.)", kind: "read" },
  { name: "ls", field: "path", noPath: "The worktree (.)", kind: "read" },
  { name: "edit", field: "path", noPath: "Not permitted", kind: "write" },
  { name: "write", field: "path", noPath: "Not permitted", kind: "write" },
] as const;

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
    const fake = useFakePiExtension();
    const registerFlag = vi.spyOn(fake.pi, "registerFlag");

    invokeGuard(limitsArgs(path), [], fake);

    expect(fake.registeredFlags()).toEqual(["tasker-guard-limits"]);
    expect(registerFlag).toHaveBeenCalledWith("tasker-guard-limits", {
      description: "Path to the limits file for the tasker pi guard",
      type: "string",
    });
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

describe("guard extension file path checks", () => {
  it.each(FILE_TOOL_TABLE.filter((entry) => entry.noPath === "Not permitted"))(
    "requires a path for $name",
    async ({ name }) => {
      const cwd = useTempDir("tasker-guard-file-");
      const { fake } = guardedFileTool(name, cwd, { writeRoots: [cwd] });

      const result = await fileToolCall(fake, name, {}, cwd);

      expectFileBlock(result);
    },
  );

  it.each(FILE_TOOL_TABLE.filter((entry) => entry.noPath === "The worktree (.)"))(
    "uses the worktree when $name has no path",
    async ({ name, kind }) => {
      const cwd = useTempDir("tasker-guard-file-");
      const roots = kind === "read" ? { readRoots: [cwd] } : { writeRoots: [cwd] };
      const { fake } = guardedFileTool(name, cwd, roots);

      expect(await fileToolCall(fake, name, {}, cwd)).toBe("tool result");
    },
  );

  it("blocks a non-string path and a cwd that differs from the limits", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const { fake } = guardedFileTool("read", cwd);

    expectFileBlock(await fileToolCall(fake, "read", { path: 4 }, cwd));
    expectFileBlock(await fileToolCall(fake, "read", { path: "/tmp/file" }, "/tmp"));
  });

  it("applies the Unicode-space rule before the cwd rule", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd] });
    const path = join(cwd, `name${String.fromCodePoint(0x00a0)}file`);

    expectBlock(await fileToolCall(fake, "read", { path }, "/tmp"), "Unicode space");
  });

  it("accepts a cwd alias when both cwd paths resolve to the same directory", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const aliasRoot = useTempDir("tasker-guard-cwd-");
    const alias = join(aliasRoot, "worktree");
    fs.symlinkSync(cwd, alias);
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd] });

    expect(await fileToolCall(fake, "read", { path: "file.txt" }, alias)).toBe("tool result");
  });

  it.each([
    ["@file.txt", "file.txt"],
    ["@@file.txt", "@file.txt"],
  ])("drops one leading @ from %s", async (inputPath, resolvedName) => {
    const cwd = useTempDir("tasker-guard-file-");
    const denied = join(cwd, resolvedName);
    const { fake } = guardedFileTool("read", cwd, { denyRead: [denied], readRoots: [cwd] });

    expectFileBlock(await fileToolCall(fake, "read", { path: inputPath }, cwd), denied);
  });

  it("expands home paths and file URLs", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const urlFile = join(cwd, "file with space.txt");
    const { fake } = guardedFileTool("read", cwd, { denyRead: [homedir(), urlFile], readRoots: [cwd] });

    expectFileBlock(await fileToolCall(fake, "read", { path: "~/tasker-sensitive-home-file" }, cwd), homedir());
    expectFileBlock(await fileToolCall(fake, "read", { path: "~" }, cwd), homedir());
    expectFileBlock(await fileToolCall(fake, "read", { path: pathToFileURL(urlFile).href }, cwd), urlFile);
    expectFileBlock(await fileToolCall(fake, "read", { path: `file://localhost${urlFile}` }, cwd), urlFile);
  });

  it("blocks a bad file URL and treats uppercase FILE as a relative path", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd] });

    expectFileBlock(await fileToolCall(fake, "read", { path: "file://example.com/private" }, cwd));
    expect(await fileToolCall(fake, "read", { path: "FILE://relative.txt" }, cwd)).toBe("tool result");
  });

  it.each([
    [
      "AM spelling",
      (cwd: string) => join(cwd, "meeting AM.txt"),
      (cwd: string) => join(cwd, `meeting${String.fromCodePoint(0x202f)}AM.txt`),
    ],
    [
      "lowercase PM spelling",
      (cwd: string) => join(cwd, "meeting pm.txt"),
      (cwd: string) => join(cwd, `meeting${String.fromCodePoint(0x202f)}pm.txt`),
    ],
    [
      "NFD spelling",
      (cwd: string) => join(cwd, `caf${String.fromCodePoint(0x00e9)}.txt`),
      (cwd: string) => join(cwd, `cafe${String.fromCodePoint(0x0301)}.txt`),
    ],
    [
      "curly apostrophe spelling",
      (cwd: string) => join(cwd, "person's.txt"),
      (cwd: string) => join(cwd, `person${String.fromCodePoint(0x2019)}s.txt`),
    ],
    [
      "NFD and curly apostrophe spelling",
      (cwd: string) => join(cwd, `caf${String.fromCodePoint(0x00e9)}'s PM.txt`),
      (cwd: string) => join(cwd, `cafe${String.fromCodePoint(0x0301)}${String.fromCodePoint(0x2019)}s PM.txt`),
    ],
  ])("checks each missing-read %s variant", async (_label, inputPath, variantPath) => {
    const cwd = useTempDir("tasker-guard-file-");
    const denied = variantPath(cwd);
    const { fake } = guardedFileTool("read", cwd, { denyRead: [denied], readRoots: [cwd] });

    expectFileBlock(await fileToolCall(fake, "read", { path: inputPath(cwd) }, cwd), denied);
  });

  it.each([
    0x00a0, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f,
    0x3000,
  ])("blocks Unicode space U+%s in a path", async (codePoint) => {
    const cwd = useTempDir("tasker-guard-file-");
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd] });

    expectFileBlock(
      await fileToolCall(fake, "read", { path: join(cwd, `name${String.fromCodePoint(codePoint)}file`) }, cwd),
    );
  });

  it("resolves a middle link and missing parents before checking roots", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const outside = useTempDir("tasker-guard-outside-");
    fs.symlinkSync(outside, join(cwd, "link"));
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd] });

    expectFileBlock(await fileToolCall(fake, "read", { path: join("link", "missing", "file") }, cwd));
  });

  it("blocks a dangling link", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    fs.symlinkSync(join(cwd, "missing-target"), join(cwd, "dangling"));
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd] });

    expectFileBlock(await fileToolCall(fake, "read", { path: join(cwd, "dangling", "child") }, cwd));
  });

  it("checks supplied and real paths against read denials", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const target = join(cwd, "private.txt");
    fs.symlinkSync(target, join(cwd, "link.txt"));
    const { fake } = guardedFileTool("read", cwd, { denyRead: [target], readRoots: [cwd] });

    expectFileBlock(await fileToolCall(fake, "read", { path: join(cwd, "link.txt") }, cwd), target);

    const link = join(cwd, "link.txt");
    const deniedLink = guardedFileTool("read", cwd, { denyRead: [link], readRoots: [cwd] });
    expectFileBlock(await fileToolCall(deniedLink.fake, "read", { path: target }, cwd), link);
  });

  it("lets a deny path take precedence over a read root", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const denied = join(cwd, "private.txt");
    const { fake } = guardedFileTool("read", cwd, { denyRead: [denied], readRoots: [cwd] });

    expectFileBlock(await fileToolCall(fake, "read", { path: denied }, cwd), denied);
  });

  it("blocks read calls outside the read roots", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const { fake } = guardedFileTool("read", cwd, { readRoots: [join(cwd, "allowed")] });
    const missingRoot = guardedFileTool("read", cwd, { readRoots: [join(cwd, "missing-root")] });

    expectFileBlock(await fileToolCall(fake, "read", { path: join(cwd, "other.txt") }, cwd));
    expectFileBlock(await fileToolCall(missingRoot.fake, "read", { path: join(cwd, "other.txt") }, cwd));
  });

  it("does not limit reads when readRoots is null", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const outside = useTempDir("tasker-guard-outside-");
    const { fake } = guardedFileTool("read", cwd, { readRoots: null });

    expect(await fileToolCall(fake, "read", { path: join(outside, "file.txt") }, cwd)).toBe("tool result");
  });

  it.each(["grep", "find"])("blocks %s traversal over a denied child", async (name) => {
    const cwd = useTempDir("tasker-guard-file-");
    const denied = join(cwd, "private.txt");
    const { fake } = guardedFileTool(name, cwd, { denyRead: [denied], readRoots: [cwd] });

    expectFileBlock(await fileToolCall(fake, name, { path: cwd }, cwd), denied);
  });

  it("does not apply traversal denial to ls", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const denied = join(cwd, "private.txt");
    const { fake } = guardedFileTool("ls", cwd, { denyRead: [denied], readRoots: [cwd] });

    expect(await fileToolCall(fake, "ls", { path: cwd }, cwd)).toBe("tool result");
  });

  it("blocks writes with empty roots and honors write roots and denials", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const path = join(cwd, "file.txt");
    const emptyRoots = guardedFileTool("write", cwd, { writeRoots: [] });
    const outsideRoot = guardedFileTool("write", cwd, { writeRoots: [join(cwd, "allowed")] });
    const allowed = guardedFileTool("write", cwd, { writeRoots: [cwd] });
    const deniedExact = guardedFileTool("edit", cwd, { writeRoots: [cwd], denyWrite: [path] });
    const deniedTree = guardedFileTool("write", cwd, { writeRoots: [cwd], denyWrite: [join(cwd, "private/**")] });

    expectFileBlock(await fileToolCall(emptyRoots.fake, "write", { path }, cwd));
    expectFileBlock(await fileToolCall(outsideRoot.fake, "write", { path }, cwd));
    expect(await fileToolCall(allowed.fake, "write", { path }, cwd)).toBe("tool result");
    expectFileBlock(await fileToolCall(deniedExact.fake, "edit", { path }, cwd), path);
    expectFileBlock(await fileToolCall(deniedTree.fake, "write", { path: join(cwd, "private", "file") }, cwd));
  });

  it("does not apply read denials to writes", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const path = join(cwd, "private.txt");
    const { fake } = guardedFileTool("edit", cwd, { denyRead: [path], writeRoots: [cwd] });

    expect(await fileToolCall(fake, "edit", { path }, cwd)).toBe("tool result");
  });

  it("blocks direct and traversed access to proc", async () => {
    const cwd = useTempDir("tasker-guard-file-");
    const read = guardedFileTool("read", cwd, { readRoots: null });
    const ls = guardedFileTool("ls", cwd, { readRoots: null });
    const grep = guardedFileTool("grep", cwd, { readRoots: null });

    expectFileBlock(await fileToolCall(read.fake, "read", { path: "/proc/self/environ" }, cwd));
    expectFileBlock(await fileToolCall(ls.fake, "ls", { path: "/proc" }, cwd));
    expectFileBlock(await fileToolCall(grep.fake, "grep", { path: "/" }, cwd));
  });
});

describe("guard extension skill roots", () => {
  it("uses initial skill roots from the limits", async () => {
    const cwd = useTempDir("tasker-guard-skill-");
    const skillRoot = useTempDir("tasker-guard-skill-root-");
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd], skillRoots: [skillRoot] });

    expect(await fileToolCall(fake, "read", { path: join(skillRoot, "content.txt") }, cwd)).toBe("tool result");
  });

  it("copies skill folders from before_agent_start", async () => {
    const cwd = useTempDir("tasker-guard-skill-");
    const skillRoot = useTempDir("tasker-guard-skill-root-");
    const skills = [{ filePath: join(skillRoot, "SKILL.md") }];
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd] });

    await beforeAgentStart(fake, { systemPromptOptions: { skills } });
    skills.length = 0;

    expect(await fileToolCall(fake, "read", { path: join(skillRoot, "content.txt") }, cwd)).toBe("tool result");
  });

  it("replaces skill folders when a later event arrives", async () => {
    const cwd = useTempDir("tasker-guard-skill-");
    const oldRoot = useTempDir("tasker-guard-old-skill-");
    const newRoot = useTempDir("tasker-guard-new-skill-");
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd] });

    await beforeAgentStart(fake, skillEvent([join(oldRoot, "SKILL.md")]));
    expect(await fileToolCall(fake, "read", { path: join(oldRoot, "content.txt") }, cwd)).toBe("tool result");

    await beforeAgentStart(fake, skillEvent([join(newRoot, "SKILL.md")]));

    expectFileBlock(await fileToolCall(fake, "read", { path: join(oldRoot, "content.txt") }, cwd));
    expect(await fileToolCall(fake, "read", { path: join(newRoot, "content.txt") }, cwd)).toBe("tool result");
  });

  it("does not grant access from a missing skill root", async () => {
    const cwd = useTempDir("tasker-guard-skill-");
    const parent = useTempDir("tasker-guard-missing-skill-");
    const missingRoot = join(parent, "missing-skill");
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd], skillRoots: [missingRoot] });

    expectFileBlock(await fileToolCall(fake, "read", { path: join(missingRoot, "content.txt") }, cwd));
  });

  it.each([
    ["protected", "on"],
    ["protected", "under"],
    ["protected", "above"],
    ["denied", "on"],
    ["denied", "under"],
    ["denied", "above"],
  ])("drops a skill root %s, %s the protected or denied path", async (kind, relation) => {
    const cwd = useTempDir("tasker-guard-skill-");
    const base = useTempDir("tasker-guard-skill-relationship-");
    let skillRoot: string;
    let path: string;
    if (relation === "on") {
      skillRoot = join(base, "target");
      path = skillRoot;
    } else if (relation === "under") {
      path = join(base, "target");
      skillRoot = join(path, "skill");
    } else {
      skillRoot = base;
      path = join(base, "target");
    }
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.mkdirSync(path, { recursive: true });
    const limits =
      kind === "protected"
        ? { protectedPaths: [path] }
        : relation === "above"
          ? { denyRead: [join(path, "denied-child")] }
          : { denyRead: [path] };
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd], skillRoots: [skillRoot], ...limits });
    const candidate =
      relation === "above" && kind === "denied"
        ? join(skillRoot, "outside-denied.txt")
        : join(skillRoot, "content.txt");

    expectFileBlock(
      await fileToolCall(fake, "read", { path: candidate }, cwd),
      kind === "denied" ? limits.denyRead?.[0] : limits.protectedPaths?.[0],
    );
  });

  it("drops skill access from proc", async () => {
    const cwd = useTempDir("tasker-guard-skill-");
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd], skillRoots: ["/proc"] });
    await beforeAgentStart(fake, skillEvent(["/proc/SKILL.md"]));

    expectFileBlock(await fileToolCall(fake, "read", { path: "/proc/self/environ" }, cwd), "/proc");
  });

  it("clears event skill roots after a handler error", async () => {
    const cwd = useTempDir("tasker-guard-skill-");
    const skillRoot = useTempDir("tasker-guard-skill-root-");
    const { fake } = guardedFileTool("read", cwd, { readRoots: [cwd] });
    await beforeAgentStart(fake, skillEvent([join(skillRoot, "SKILL.md")]));
    const invalidEvent = {
      get systemPromptOptions(): never {
        throw new Error("SENSITIVE skill event");
      },
    };

    expect(await beforeAgentStart(fake, invalidEvent)).toEqual([undefined]);
    expectFileBlock(await fileToolCall(fake, "read", { path: join(skillRoot, "content.txt") }, cwd));
  });
});
