import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli.js";
import { showConfig } from "../../src/commands/show-config.js";
import { loadConfig } from "../../src/config/load.js";
import { captureIo, validConfig, writeTempConfig } from "../helpers.js";

let dir: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("show-config", () => {
  it("prints the configuration with the defaults filled in", async () => {
    const written = writeTempConfig(validConfig());
    dir = written.dir;
    vi.stubEnv("TASKER_CONFIG", written.path);
    const io = captureIo();

    const code = await run(["show-config"], { commands: [showConfig], io });

    expect(code).toBe(0);
    expect(io.err).toEqual([]);
    const expected = loadConfig({ TASKER_CONFIG: written.path });
    expect(io.out.join("")).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    const printed = JSON.parse(io.out.join(""));
    expect(printed.retentionDays).toBe(30);
    expect(printed.limits.planTimeoutMin).toBe(30);
    expect(printed.repos.tasker.vcs).toEqual({ provider: "git", config: {} });
    expect(printed.repos.tasker.issueTracker.assignee).toBe("@me");
  });
});
