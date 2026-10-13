import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapLogPath, bootstrapMarkerPath, runBootstrap } from "../../src/phases/bootstrap.js";
import { phaseEnv } from "../../src/phases/env.js";
import { useTempDir } from "../helpers.js";

const HEADER = /^=== bootstrap run \d{4}-.* ===$/m;
const MINUTE_MS = 60_000;

// A worktree and a logs folder that does not exist yet.
function setup() {
  const tmp = useTempDir("tasker-bootstrap-");
  return { cwd: tmp, logsDir: join(tmp, "logs", "nested") };
}

function bootstrap(commands: string[], dirs: ReturnType<typeof setup>, timeoutMs = MINUTE_MS) {
  return runBootstrap({ commands, env: phaseEnv(process.env, []), timeoutMs, ...dirs });
}

describe("the bootstrap paths", () => {
  it("puts the log and the marker in the logs folder", () => {
    expect(bootstrapLogPath("/some/logs")).toBe("/some/logs/bootstrap.log");
    expect(bootstrapMarkerPath("/some/logs")).toBe("/some/logs/bootstrap.complete");
  });
});

describe("runBootstrap", () => {
  it("runs the commands one at a time in the list order", async () => {
    const dirs = setup();
    const commands = ["echo one >> order", "echo two >> order", "echo three >> order"];

    const result = await bootstrap(commands, dirs);

    expect(result).toEqual({ status: "ok" });
    expect(readFileSync(join(dirs.cwd, "order"), "utf8")).toBe("one\ntwo\nthree\n");
    const log = readFileSync(bootstrapLogPath(dirs.logsDir), "utf8");
    expect(log).toMatch(HEADER);
    const lines = commands.map((command) => `$ ${command}\n--- exit code 0\n`);
    expect(log.indexOf(lines[0]!)).toBeGreaterThan(-1);
    expect(log.indexOf(lines[1]!)).toBeGreaterThan(log.indexOf(lines[0]!));
    expect(log.indexOf(lines[2]!)).toBeGreaterThan(log.indexOf(lines[1]!));
  });

  it("writes the marker after the last command succeeds", async () => {
    const dirs = setup();

    await bootstrap(["true"], dirs);

    expect(existsSync(bootstrapMarkerPath(dirs.logsDir))).toBe(true);
  });

  it("writes the command output to the log between its command line and its outcome line", async () => {
    const dirs = setup();

    await bootstrap(["echo out; echo err >&2"], dirs);

    const log = readFileSync(bootstrapLogPath(dirs.logsDir), "utf8");
    expect(log).toContain("$ echo out; echo err >&2\nout\nerr\n--- exit code 0\n");
  });

  it("writes the marker and a log line for an empty command list", async () => {
    const dirs = setup();

    const result = await bootstrap([], dirs);

    expect(result).toEqual({ status: "ok" });
    const log = readFileSync(bootstrapLogPath(dirs.logsDir), "utf8");
    expect(log).toMatch(HEADER);
    expect(log).toContain("the repo has no bootstrap commands\n");
    expect(existsSync(bootstrapMarkerPath(dirs.logsDir))).toBe(true);
  });
});
