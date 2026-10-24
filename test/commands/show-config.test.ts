import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli.js";
import { showConfig } from "../../src/commands/show-config.js";
import { loadConfig } from "../../src/config/load.js";
import { captureIo } from "../helpers/cli.js";
import { useConfigFile, validConfig } from "../helpers/config.js";
import { useProcessEnv } from "../helpers/temp.js";

describe("show-config", () => {
  it("prints the configuration with the defaults filled in", async () => {
    const written = useConfigFile(() => JSON.stringify(validConfig()));
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
    expect(printed.repos.tasker.sessions).toEqual({ kind: "claude", models: {} });
  });

  it("prints the sessions of the repo that --repo names with the defaults filled in", async () => {
    const raw = validConfig();
    raw.repos.tasker.sessions = { models: { planner: { model: "opus", effort: "high" } } };
    useConfigFile(() => JSON.stringify(raw));
    const io = captureIo();

    const code = await run(["show-config", "--repo", "tasker"], { commands: [showConfig], io });

    expect(code).toBe(0);
    expect(JSON.parse(io.out.join("")).sessions).toEqual({
      kind: "claude",
      models: { planner: { model: "opus", effort: "high" } },
    });
  });

  it("prints only the repo that --repo names", async () => {
    const raw = validConfig();
    raw.repos["codeguru42/other"] = {
      ...raw.repos.tasker,
      remote: "git@github.com:codeguru42/other.git",
    };
    const written = useConfigFile(() => JSON.stringify(raw));
    const io = captureIo();

    const code = await run(["show-config", "--repo", "codeguru42/other"], {
      commands: [showConfig],
      io,
    });

    expect(code).toBe(0);
    const expected = loadConfig({ TASKER_CONFIG: written.path }).repos["codeguru42/other"];
    expect(io.out.join("")).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });

  it.each(["missing", "toString"])("reports the repo key %s that does not exist", async (key) => {
    useConfigFile(() => JSON.stringify(validConfig()));
    const io = captureIo();

    const code = await run(["show-config", "--repo", key], {
      commands: [showConfig],
      io,
    });

    expect(code).toBe(1);
    expect(io.out).toEqual([]);
    expect(io.err.join("")).toBe(`repo key not found: ${key}\n`);
  });

  it("prints the loader errors for an invalid configuration", async () => {
    const written = useConfigFile(() => JSON.stringify({ ...validConfig(), bogus: 1 }));
    let message = "";
    try {
      loadConfig({ TASKER_CONFIG: written.path });
    } catch (error) {
      message = (error as Error).message;
    }
    const io = captureIo();

    const code = await run(["show-config"], { commands: [showConfig], io });

    expect(code).toBe(1);
    expect(io.out).toEqual([]);
    expect(io.err.join("")).toBe(`${message}\n`);
    expect(io.err.join("")).toContain("  - bogus: unrecognized key");
  });

  it("prints the loader error for a missing file", async () => {
    const written = useConfigFile(() => JSON.stringify(validConfig()));
    const missing = join(written.dir, "missing.json");
    useProcessEnv({ TASKER_CONFIG: missing });
    const io = captureIo();

    const code = await run(["show-config"], { commands: [showConfig], io });

    expect(code).toBe(1);
    expect(io.out).toEqual([]);
    expect(io.err.join("")).toBe(`config file not found: ${missing}\n`);
  });
});
