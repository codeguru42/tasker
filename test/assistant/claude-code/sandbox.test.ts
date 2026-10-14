import { describe, expect, it } from "vitest";
import { sandboxSettings } from "../../../src/assistant/claude-code/sandbox.js";

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
