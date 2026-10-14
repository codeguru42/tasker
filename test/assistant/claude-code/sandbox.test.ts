import { chmodSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { sandboxSettings, sandboxSocketFolder } from "../../../src/assistant/claude-code/sandbox.js";
import { useTempDir } from "../../helpers.js";

const limits = { allowWrite: ["/work/wt", "/work/clone/objects"], denyRead: ["/home/test/key"] };

describe("sandboxSettings", () => {
  it("gives the exact settings, with the socket folder as the only Unix socket", () => {
    expect(sandboxSettings(limits, "/tmp/claude-1000")).toEqual({
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
        filesystem: { allowWrite: ["/work/wt", "/work/clone/objects"], denyRead: ["/home/test/key"] },
        network: { allowedDomains: ["*"], allowUnixSockets: ["/tmp/claude-1000"] },
      },
    });
  });

  it("never lets a command leave the sandbox", () => {
    const settings = sandboxSettings(limits, undefined) as { sandbox: Record<string, unknown> };

    expect(settings.sandbox.allowUnsandboxedCommands).toBe(false);
    expect(settings.sandbox.failIfUnavailable).toBe(true);
  });

  it("leaves out allowUnixSockets with no socket folder", () => {
    const settings = sandboxSettings(limits, undefined) as { sandbox: { network: object } };

    expect(settings.sandbox.network).toEqual({ allowedDomains: ["*"] });
    expect(settings.sandbox.network).not.toHaveProperty("allowUnixSockets");
  });

  it("never sets allowAllUnixSockets", () => {
    for (const folder of [undefined, "/tmp/claude-1000"]) {
      expect(JSON.stringify(sandboxSettings(limits, folder))).not.toContain("allowAllUnixSockets");
    }
  });

  it("copies the lists, so a later change does not reach the settings", () => {
    const own = { allowWrite: ["/a"], denyRead: ["/b"] };
    const settings = sandboxSettings(own, undefined);
    own.allowWrite.push("/c");

    expect(JSON.stringify(settings)).not.toContain("/c");
  });
});

describe("sandboxSocketFolder", () => {
  function realTemp(): string {
    return realpathSync(useTempDir("tasker-socket-folder-"));
  }

  it("gives nothing with no uid", () => {
    expect(sandboxSocketFolder({ uid: undefined, tmpRoot: realTemp(), sharedTemps: [] })).toBeUndefined();
  });

  it("gives the real path of claude-<uid> under a symlinked tmpRoot", () => {
    const base = realTemp();
    mkdirSync(join(base, "real"));
    mkdirSync(join(base, "real", "claude-1000"));
    symlinkSync(join(base, "real"), join(base, "link"));

    const folder = sandboxSocketFolder({ uid: 1000, tmpRoot: join(base, "link"), sharedTemps: [] });

    expect(folder).toBe(join(base, "real", "claude-1000"));
  });

  it("gives the real parent plus claude-<uid> when the folder is missing", () => {
    const base = realTemp();
    mkdirSync(join(base, "real"));
    symlinkSync(join(base, "real"), join(base, "link"));

    const folder = sandboxSocketFolder({ uid: 7, tmpRoot: join(base, "link"), sharedTemps: [] });

    expect(folder).toBe(join(base, "real", "claude-7"));
  });

  it("gives nothing when the folder equals a shared temp folder", () => {
    const base = realTemp();
    const folder = join(base, "claude-7");

    expect(sandboxSocketFolder({ uid: 7, tmpRoot: base, sharedTemps: [folder] })).toBeUndefined();
  });

  it("gives nothing when the folder holds a shared temp folder", () => {
    const base = realTemp();

    const folder = sandboxSocketFolder({ uid: 7, tmpRoot: base, sharedTemps: [join(base, "claude-7", "x")] });

    expect(folder).toBeUndefined();
  });

  it("gives nothing when a shared temp folder named ..x is inside the folder", () => {
    const base = realTemp();

    const folder = sandboxSocketFolder({ uid: 7, tmpRoot: base, sharedTemps: [join(base, "claude-7", "..x")] });

    expect(folder).toBeUndefined();
  });

  it("compares real paths, so a link to the folder counts as the folder", () => {
    const base = realTemp();
    mkdirSync(join(base, "claude-7"));
    symlinkSync(join(base, "claude-7"), join(base, "alias"));

    expect(sandboxSocketFolder({ uid: 7, tmpRoot: base, sharedTemps: [join(base, "alias")] })).toBeUndefined();
  });

  it("gives the folder when a shared temp folder is elsewhere", () => {
    const base = realTemp();
    mkdirSync(join(base, "other"));

    const folder = sandboxSocketFolder({ uid: 7, tmpRoot: base, sharedTemps: [join(base, "other")] });

    expect(folder).toBe(join(base, "claude-7"));
  });

  it.skipIf(process.getuid?.() === 0)("throws the error code, and not the path, on EACCES", () => {
    const base = realTemp();
    mkdirSync(join(base, "locked", "root"), { recursive: true });
    chmodSync(join(base, "locked"), 0o000);
    onTestFinished(() => chmodSync(join(base, "locked"), 0o755));

    let message = "";
    try {
      sandboxSocketFolder({ uid: 7, tmpRoot: join(base, "locked", "root"), sharedTemps: [] });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe("cannot resolve the sandbox temp folder: EACCES");
    expect(message).not.toContain(base);
  });
});
