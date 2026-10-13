import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapLogPath, bootstrapMarkerPath, runBootstrap } from "../../src/phases/bootstrap.js";
import { phaseEnv } from "../../src/phases/env.js";
import { readPidFile, useTempDir, waitUntilGone } from "../helpers.js";

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

describe("runBootstrap when a command fails", () => {
  function readLog(logsDir: string): string {
    return readFileSync(bootstrapLogPath(logsDir), "utf8");
  }

  it("stops at the first command that fails", async () => {
    const dirs = setup();
    const commands = ["true", "printf no-newline; exit 3", "touch later"];

    const result = await bootstrap(commands, dirs);

    expect(result).toStrictEqual({
      status: "failed",
      index: 2,
      command: "printf no-newline; exit 3",
      exitCode: 3,
      timedOut: false,
    });
    expect(readLog(dirs.logsDir)).toContain("$ printf no-newline; exit 3\nno-newline\n--- exit code 3\n");
    expect(readLog(dirs.logsDir)).not.toContain("touch later");
    expect(existsSync(join(dirs.cwd, "later"))).toBe(false);
    expect(existsSync(bootstrapMarkerPath(dirs.logsDir))).toBe(false);
  });

  it("reports the signal that stopped a command", async () => {
    const dirs = setup();

    const result = await bootstrap(["kill -TERM $$", "touch later"], dirs);

    expect(result).toStrictEqual({
      status: "failed",
      index: 1,
      command: "kill -TERM $$",
      signal: "SIGTERM",
      timedOut: false,
    });
    expect(readLog(dirs.logsDir)).toContain("$ kill -TERM $$\n--- signal SIGTERM\n");
    expect(readLog(dirs.logsDir)).not.toContain("touch later");
    expect(existsSync(join(dirs.cwd, "later"))).toBe(false);
    expect(existsSync(bootstrapMarkerPath(dirs.logsDir))).toBe(false);
  });

  it("stops the second command when the one deadline of the list runs out", async () => {
    const dirs = setup();
    const second = "sleep 0.8; echo second-done";

    const result = await bootstrap(["sleep 0.6", second, "touch later"], dirs, 1000);

    expect(result).toStrictEqual({
      status: "failed",
      index: 2,
      command: second,
      signal: "SIGTERM",
      timedOut: true,
    });
    const log = readLog(dirs.logsDir);
    expect(log).toContain(`$ ${second}\n--- timed out: sent SIGTERM\n`);
    expect(log).not.toContain("\nsecond-done\n");
    expect(log).not.toContain("touch later");
    expect(existsSync(join(dirs.cwd, "later"))).toBe(false);
    expect(existsSync(bootstrapMarkerPath(dirs.logsDir))).toBe(false);
  });

  it("kills a child that ignores SIGTERM 5 s after the deadline", { timeout: 20_000 }, async () => {
    const dirs = setup();
    const command = '(trap "" TERM; exec sleep 30) & echo $! > child.pid; wait';
    const running = bootstrap([command, "touch later"], dirs, 300);
    const childPid = await readPidFile(join(dirs.cwd, "child.pid"), 5000);

    const result = await running;

    expect(result).toStrictEqual({ status: "failed", index: 1, command, signal: "SIGTERM", timedOut: true });
    expect(readLog(dirs.logsDir)).toContain(`$ ${command}\n--- timed out: sent SIGTERM, then SIGKILL\n`);
    expect(readLog(dirs.logsDir)).not.toContain("touch later");
    await waitUntilGone(childPid, 5000);
    expect(existsSync(join(dirs.cwd, "later"))).toBe(false);
    expect(existsSync(bootstrapMarkerPath(dirs.logsDir))).toBe(false);
  });
});

describe("runBootstrap run again", () => {
  it("skips the run and writes nothing when the marker exists", async () => {
    const dirs = setup();
    await bootstrap(["true"], dirs);
    const log = readFileSync(bootstrapLogPath(dirs.logsDir));
    const marker = readFileSync(bootstrapMarkerPath(dirs.logsDir));

    const result = await bootstrap(["touch touched"], dirs);

    expect(result).toEqual({ status: "skipped" });
    expect(existsSync(join(dirs.cwd, "touched"))).toBe(false);
    expect(readFileSync(bootstrapLogPath(dirs.logsDir)).equals(log)).toBe(true);
    expect(readFileSync(bootstrapMarkerPath(dirs.logsDir)).equals(marker)).toBe(true);
  });

  it("runs every command again from the first when the marker is missing", async () => {
    const dirs = setup();

    const first = await bootstrap(["echo run >> count", "exit 1"], dirs);
    const second = await bootstrap(["echo run >> count"], dirs);

    expect(first).toMatchObject({ status: "failed", index: 2, exitCode: 1 });
    expect(second).toEqual({ status: "ok" });
    expect(readFileSync(join(dirs.cwd, "count"), "utf8")).toBe("run\nrun\n");
    const log = readFileSync(bootstrapLogPath(dirs.logsDir), "utf8");
    expect(log.match(/^=== bootstrap run /gm)).toHaveLength(2);
    expect(log).toContain("$ exit 1\n--- exit code 1\n");
  });
});
