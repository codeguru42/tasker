import * as fs from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { thrownBy } from "../../helpers/errors.js";
import { useFakePiExtension } from "../../helpers/fake-pi-extension.js";
import { useTempDir } from "../../helpers/temp.js";
import type { GuardLimits } from "../../../src/assistant/pi/guard-limits.js";
import guardExtension from "../../../src/assistant/pi/guard-extension.js";

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

function invokeGuard(args: string[]) {
  const fake = useFakePiExtension();
  const previousArgv = process.argv;
  process.argv = [process.execPath, "pi", ...args];
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    guardExtension(fake.pi);
  } finally {
    process.argv = previousArgv;
  }
  return fake;
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
    const read = vi.spyOn(fs, "readFileSync");
    onTestFinished(() => read.mockRestore());

    invokeGuard(limitsArgs(path));

    expect(read.mock.calls.filter(([readPath]) => readPath === path)).toHaveLength(1);
  });
});
