import { mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { thrownBy } from "../../helpers/errors.js";
import { useTempDir } from "../../helpers/temp.js";
import { builtInTool, guardLimits, writeGuardLimits } from "../../../src/assistant/pi/guard-limits.js";
import * as guardStartModule from "../../../src/assistant/pi/guard-start.js";
import { guardStartArgs } from "../../../src/assistant/pi/guard-start.js";
import { guardExtensionPath } from "../../../src/assistant/pi/guard-start.js";
import type { RunInput } from "../../../src/assistant/provider.js";
import { guardLimitsPath } from "../../../src/store/layout.js";
import { runInput as sharedRunInput } from "../../helpers/fake-claude.js";

function makeLimits(input: RunInput, tools: { name: string; path: string; source: string }[]) {
  return guardLimits(input, tools) as ReturnType<typeof guardLimits> & { sandbox: null | SandboxPart };
}

interface SandboxPart {
  bwrap: string;
  worktree: string;
  writePaths: string[];
  tempFolder: string;
  hidePaths: string[];
}

async function makeSandboxPart(input: RunInput, bwrap: string, tempFolder: string): Promise<SandboxPart> {
  const module = (await import("../../../src/assistant/pi/guard-limits.js")) as unknown as {
    sandboxPart(input: RunInput, bwrap: string, tempFolder: string): SandboxPart;
  };
  return module.sandboxPart(input, bwrap, tempFolder);
}

function makeStartArgs(path: string, guardFile?: string) {
  return guardStartArgs(path, guardFile);
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
    ...sharedRunInput(),
    sessionId: "session-1",
    resume: false,
    prompt: "prompt",
    cwd: "/work/tree",
    env: {},
    timeoutMs: 1000,
    sessionDir: "/sessions",
    access,
    sandbox: { allowWrite: [], denyRead: [], trackedPaths: async () => [], sharedFolder: "/shared" },
    deniedCommands: ["git push"],
    deniedEditPaths: [],
    model: "model",
    effort: "low",
  };
}

const tools = [{ name: "read", path: "builtin:read", source: "builtin" }];
const bashTool = { name: "bash", path: guardExtensionPath, source: "cli" };

describe("guardLimits", () => {
  it("accepts permitted denied command entries when bash is enabled", () => {
    for (const deniedCommands of [["git push"], ["git remote"], ["herdr"], ["a.b_c+d-e9"]]) {
      expect(makeLimits({ ...runInput(), deniedCommands }, [...tools, bashTool]).deniedCommands).toEqual(
        deniedCommands,
      );
    }
  });

  it("names every invalid denied command entry when bash is enabled", () => {
    const deniedCommands = ["gh api", "git remote add", "-hidden", "two words"];
    const error = thrownBy(() => makeLimits({ ...runInput(), deniedCommands }, [...tools, bashTool]));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(deniedCommands.join(", "));
  });

  it("keeps denied command entries unchanged when bash is not enabled", () => {
    const deniedCommands = ["gh api", "git remote add", "-hidden", "two words"];

    expect(makeLimits({ ...runInput(), deniedCommands }, tools).deniedCommands).toEqual(deniedCommands);
  });

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
      sandbox: null,
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

  it("sets the sandbox field to null for a read-only run", () => {
    expect(makeLimits(runInput(), tools).sandbox).toBeNull();
  });

  it("builds sandbox paths from real bind paths and unresolved hide paths", async () => {
    const root = useTempDir("tasker-pi-sandbox-part-");
    const worktree = join(root, "worktree");
    const writePath = join(root, "write");
    const tempFolder = join(root, "temp");
    mkdirSync(worktree);
    mkdirSync(writePath);
    mkdirSync(tempFolder);
    const worktreeLink = join(root, "worktree-link");
    const writeLink = join(root, "write-link");
    const tempLink = join(root, "temp-link");
    symlinkSync(worktree, worktreeLink);
    symlinkSync(writePath, writeLink);
    symlinkSync(tempFolder, tempLink);
    const input = {
      ...runInput(),
      cwd: worktreeLink,
      env: {
        XDG_CONFIG_HOME: "/x",
        SSH_AUTH_SOCK: "/s",
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/a%2Cb",
        XDG_RUNTIME_DIR: "rel/run",
      },
      sandbox: {
        allowWrite: [writeLink],
        denyRead: ["/deny/raw"],
        trackedPaths: async () => [],
        sharedFolder: "/shared",
      },
    };

    expect(await makeSandboxPart(input, "/usr/bin/bwrap", tempLink)).toEqual({
      bwrap: "/usr/bin/bwrap",
      worktree: realpathSync(worktree),
      writePaths: [realpathSync(writePath)],
      tempFolder: realpathSync(tempFolder),
      hidePaths: ["/deny/raw", "/x/herdr", "/s", "/tmp/a,b", resolve("rel/run"), "/var/run/docker.sock"],
    });
  });

  it("uses HOME for herdr and keeps SSH_AUTH_SOCK as given", async () => {
    const input = {
      ...runInput(),
      env: { HOME: "/h", SSH_AUTH_SOCK: "/s" },
    };

    expect(await makeSandboxPart(input, "/usr/bin/bwrap", "/tmp/tasker-start")).toMatchObject({
      hidePaths: ["/h/.config/herdr", "/s", "/var/run/docker.sock"],
    });
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

  it("exports the default guard extension path used by its arguments", () => {
    const limitsPath = "/sessions/session-1.guard.json";
    const args = makeStartArgs(limitsPath);

    expect(guardStartModule).toHaveProperty("guardExtensionPath", args[2]);
  });

  it("uses an injected guard extension path", () => {
    const limitsPath = "/sessions/session-1.guard.json";
    const guardFile = "/temporary/guard.js";

    expect(makeStartArgs(limitsPath, guardFile)).toEqual([
      "--no-mcp",
      "-e",
      guardFile,
      "--tasker-guard-limits",
      limitsPath,
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
