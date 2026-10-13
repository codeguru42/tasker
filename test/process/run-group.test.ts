import { closeSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type GroupResult, runInGroup, signalGroup } from "../../src/process/run-group.js";
import { readPidFile, useTempDir, waitUntilGone } from "../helpers.js";

const MINUTE_MS = 60_000;

interface Run {
  result: GroupResult;
  log: string;
}

// Runs command under bash in a new folder, with a deadline 60 s ahead. The log holds its output.
async function runLogged(
  command: string,
  options: { cwd?: string; deadline?: number } = {},
): Promise<Run & { dir: string }> {
  const dir = useTempDir("tasker-run-group-");
  const logPath = join(dir, "out.log");
  const outputFd = openSync(logPath, "a");
  try {
    const result = await runInGroup("/bin/bash", ["-c", command], {
      cwd: options.cwd ?? dir,
      env: { PATH: process.env.PATH },
      outputFd,
      deadline: options.deadline ?? Date.now() + MINUTE_MS,
    });
    return { result, log: readFileSync(logPath, "utf8"), dir };
  } finally {
    closeSync(outputFd);
  }
}

describe("runInGroup", () => {
  it("runs the command in a new group with no terminal", async () => {
    const { log } = await runLogged('echo "$$ $(ps -o pgid= -p $$)"; { exec 3</dev/tty; } 2>/dev/null || echo no-tty');

    const [line, second] = log.split("\n");
    const [pid, pgid] = (line ?? "").trim().split(/\s+/);
    expect(pid).toMatch(/^\d+$/);
    expect(pgid).toBe(pid);
    expect(second).toBe("no-tty");
  });

  it("writes stdout and stderr to the fd in the order they came", async () => {
    const { log } = await runLogged("echo out1; echo err1 >&2; echo out2; echo err2 >&2");

    expect(log).toBe("out1\nerr1\nout2\nerr2\n");
  });

  it("gives the command no input", async () => {
    const { log } = await runLogged("read -r line; echo rc=$?");

    expect(log).toBe("rc=1\n");
  });

  it("gives the exit code", async () => {
    const { result } = await runLogged("exit 3");

    expect(result).toEqual({ code: 3, signal: null, timedOut: false, killed: false });
  });

  it("gives the signal that stopped the leader", async () => {
    const { result } = await runLogged("kill -TERM $$");

    expect(result).toEqual({ code: null, signal: "SIGTERM", timedOut: false, killed: false });
  });

  it("runs the command in cwd", async () => {
    const cwd = useTempDir("tasker-run-group-cwd-");
    const { log } = await runLogged("pwd -P", { cwd });

    expect(log.trim()).toBe(cwd);
  });

  it("rejects when the spawn fails", async () => {
    const missing = join(useTempDir("tasker-run-group-"), "missing");

    await expect(runLogged("exit 0", { cwd: missing })).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    { name: "exit 0", command: "exit 0", missingCwd: false, deadlineMs: MINUTE_MS },
    { name: "exit 3", command: "exit 3", missingCwd: false, deadlineMs: MINUTE_MS },
    { name: "a spawn error", command: "exit 0", missingCwd: true, deadlineMs: MINUTE_MS },
    { name: "a timeout", command: "sleep 30", missingCwd: false, deadlineMs: 300 },
    { name: "a SIGKILL", command: 'trap "" TERM; sleep 30', missingCwd: false, deadlineMs: 300 },
  ])(
    "leaves the SIGINT and SIGTERM listener counts as before after $name",
    { timeout: 20_000 },
    async (row) => {
      const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
      const cwd = row.missingCwd ? join(useTempDir("tasker-run-group-"), "missing") : undefined;

      await runLogged(row.command, { cwd, deadline: Date.now() + row.deadlineMs }).catch(() => undefined);

      expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
    },
  );

  it("sends SIGTERM to the whole group at the deadline", { timeout: 20_000 }, async () => {
    const cwd = useTempDir("tasker-run-group-cwd-");
    const running = runLogged("sleep 30 & echo $! > child.pid; wait", {
      cwd,
      deadline: Date.now() + 300,
    });
    const childPid = await readPidFile(join(cwd, "child.pid"), 5000);

    const { result } = await running;

    expect(result).toEqual({ code: null, signal: "SIGTERM", timedOut: true, killed: false });
    await waitUntilGone(childPid, 5000);
  });

  it("kills a child that ignores SIGTERM 5 s after the deadline", { timeout: 20_000 }, async () => {
    const cwd = useTempDir("tasker-run-group-cwd-");
    const started = Date.now();
    const running = runLogged('(trap "" TERM; exec sleep 30) & echo $! > child.pid; wait', {
      cwd,
      deadline: started + 300,
    });
    const childPid = await readPidFile(join(cwd, "child.pid"), 5000);

    const { result } = await running;

    expect(result.timedOut).toBe(true);
    expect(result.killed).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(5000);
    await waitUntilGone(childPid, 5000);
  });

  it("kills a leader that ignores SIGTERM 5 s after the deadline", { timeout: 20_000 }, async () => {
    const cwd = useTempDir("tasker-run-group-cwd-");
    const started = Date.now();
    const running = runLogged('trap "" TERM; echo $$ > leader.pid; sleep 30', {
      cwd,
      deadline: started + 300,
    });
    const leaderPid = await readPidFile(join(cwd, "leader.pid"), 5000);

    const { result } = await running;

    expect(result.timedOut).toBe(true);
    expect(result.killed).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(5000);
    await waitUntilGone(leaderPid, 5000);
  });

  it("does not time out with a deadline beyond the timer limit", async () => {
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on("warning", onWarning);
    onTestFinished(() => {
      process.off("warning", onWarning);
    });

    const { result } = await runLogged("exit 0", { deadline: Date.now() + 2 ** 40 });
    await new Promise((done) => setImmediate(done));

    expect(result).toEqual({ code: 0, signal: null, timedOut: false, killed: false });
    expect(warnings.map((warning) => warning.name)).not.toContain("TimeoutOverflowWarning");
  });
});

describe("signalGroup", () => {
  it("ignores a group that is gone", async () => {
    const cwd = useTempDir("tasker-run-group-cwd-");
    await runLogged("echo $$ > leader.pid", { cwd });
    const leaderPid = await readPidFile(join(cwd, "leader.pid"), 5000);

    expect(() => signalGroup(leaderPid, "SIGTERM")).not.toThrow();
  });

  it("reaches each process of a live group", async () => {
    const cwd = useTempDir("tasker-run-group-cwd-");
    const running = runLogged("echo $$ > leader.pid; sleep 30 & echo $! > child.pid; wait", { cwd });
    const leaderPid = await readPidFile(join(cwd, "leader.pid"), 5000);
    const childPid = await readPidFile(join(cwd, "child.pid"), 5000);

    signalGroup(leaderPid, "SIGTERM");

    const { result } = await running;
    expect(result.signal).toBe("SIGTERM");
    await waitUntilGone(childPid, 5000);
  });

  it("passes an error other than ESRCH through", () => {
    expect(() => signalGroup(process.pid, "SIGNOPE" as NodeJS.Signals)).toThrow();
  });
});
