import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type GroupResult, forwardSignals, runInGroup, signalGroup } from "../../src/process/run-group.js";
import {
  isAlive,
  readPidFile,
  signalListenerCounts,
  startFixture,
  startSleeper,
  waitForWatching,
  waitUntil,
  waitUntilGone,
} from "../helpers/processes.js";
import { useTempDir } from "../helpers/temp.js";

const MINUTE_MS = 60_000;
const IGNORE_TERM = 'trap "" TERM; sleep 30';

interface Run {
  result: GroupResult;
  log: string;
}

// Runs command under bash in a new folder, with a deadline 60 s ahead. The log holds its output.
async function runLogged(
  command: string,
  options: { cwd?: string; deadline?: number; file?: string; onSpawn?: (pid: number) => void } = {},
): Promise<Run & { dir: string }> {
  const dir = useTempDir("tasker-run-group-");
  const logPath = join(dir, "out.log");
  const outputFd = openSync(logPath, "a");
  try {
    const result = await runInGroup(options.file ?? "/bin/bash", ["-c", command], {
      cwd: options.cwd ?? dir,
      env: { PATH: process.env.PATH },
      outputFd,
      deadline: options.deadline ?? Date.now() + MINUTE_MS,
      onSpawn: options.onSpawn,
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

  it("gives onSpawn the pid of the child", async () => {
    const pids: number[] = [];

    const { log } = await runLogged("echo $$", { onSpawn: (pid) => pids.push(pid) });

    expect(pids).toEqual([Number(log.trim())]);
  });

  it("rejects with the error of onSpawn", async () => {
    await expect(
      runLogged("sleep 30", {
        onSpawn: () => {
          throw new Error("spawn hook failed");
        },
      }),
    ).rejects.toThrow("spawn hook failed");
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

  it("leaves a background child alive when the leader exits", async () => {
    const cwd = useTempDir("tasker-run-group-cwd-");

    const { result } = await runLogged("sleep 30 & echo $! > child.pid; exit 0", { cwd });

    expect(result).toEqual({ code: 0, signal: null, timedOut: false, killed: false });
    const childPid = await readPidFile(join(cwd, "child.pid"), 5000);
    expect(isAlive(childPid)).toBe(true);
  });

  it.each([
    { name: "exit 0", command: "exit 0", missingCwd: false, deadlineMs: MINUTE_MS },
    { name: "exit 3", command: "exit 3", missingCwd: false, deadlineMs: MINUTE_MS },
    { name: "a spawn error", command: "exit 0", missingCwd: true, deadlineMs: MINUTE_MS },
    { name: "a timeout", command: "sleep 30", missingCwd: false, deadlineMs: 300 },
    { name: "a SIGKILL", command: IGNORE_TERM, missingCwd: false, deadlineMs: 300 },
  ])("leaves the SIGINT and SIGTERM listener counts as before after $name", { timeout: 20_000 }, async (row) => {
    const before = signalListenerCounts();
    const cwd = row.missingCwd ? join(useTempDir("tasker-run-group-"), "missing") : undefined;

    await runLogged(row.command, { cwd, deadline: Date.now() + row.deadlineMs }).catch(() => undefined);

    expect(signalListenerCounts()).toEqual(before);
  });

  it("leaves the SIGINT and SIGTERM listener counts as before after a spawn that throws", async () => {
    const before = signalListenerCounts();

    await expect(runLogged("exit 0", { file: "/bin/ba\0sh" })).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_VALUE",
    });

    expect(signalListenerCounts()).toEqual(before);
  });

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

interface GroupFixture {
  pid: number;
  dir: string;
  logPath: string;
  stdout: () => string;
  stderr: () => string;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  send: (signal: NodeJS.Signals) => void;
  // Waits for the JSON line of the fixture.
  line: () => Promise<{
    result?: GroupResult;
    error?: { code: string; message: string };
    before: number[];
    after: number[];
  }>;
  // Resolves "exited" when the fixture ends within ms, and "hung" when it does not.
  exitsWithin: (ms: number) => Promise<"exited" | "hung">;
}

// Starts the fixture script, which runs command with runInGroup in its own process.
function startGroupFixture(
  command: string,
  deadlineMs: number,
  holdMs: number,
  extra: { spawnSignal?: NodeJS.Signals; file?: string } = {},
): GroupFixture {
  const dir = useTempDir("tasker-run-group-fixture-");
  const logPath = join(dir, "out.log");
  const child = startFixture("run-group-signal.ts", [
    dir,
    logPath,
    String(deadlineMs),
    String(holdMs),
    command,
    extra.spawnSignal ?? "",
    ...(extra.file ? [extra.file] : []),
  ]);
  let exited = false;
  void child.exited.then(() => (exited = true));
  return {
    pid: child.pid,
    dir,
    logPath,
    stdout: child.stdout,
    stderr: child.stderr,
    exit: child.exited,
    send: (signal) => process.kill(child.pid, signal),
    line: async () => JSON.parse(await child.firstLine),
    exitsWithin: (ms) =>
      waitUntil(() => exited, ms, "the fixture still runs").then(
        () => "exited" as const,
        () => "hung" as const,
      ),
  };
}

async function waitForLines(path: string, count: number): Promise<void> {
  await waitUntil(
    () => existsSync(path) && readFileSync(path, "utf8").split("\n").length - 1 >= count,
    10_000,
    `${path} has fewer than ${count} lines`,
  );
}

describe("runInGroup with the signals of tasker", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "forwards %s to the group and keeps tasker alive",
    { timeout: 20_000 },
    async (signal) => {
      const fixture = startGroupFixture(
        "echo noise; echo noise >&2; echo $$ > started; sleep 30; touch after",
        MINUTE_MS,
        0,
      );
      await readPidFile(join(fixture.dir, "started"), 10_000);
      await waitForWatching(fixture.dir, 10_000);

      fixture.send(signal);

      expect(await fixture.exit).toEqual({ code: 0, signal: null });
      const { result, before, after } = await fixture.line();
      expect(result).toEqual({ code: null, signal, timedOut: false, killed: false });
      expect(after).toEqual(before);
      expect(existsSync(join(fixture.dir, "after"))).toBe(false);
      expect(fixture.stdout().trim().split("\n")).toHaveLength(1);
      expect(fixture.stderr()).toBe("");
      expect(readFileSync(fixture.logPath, "utf8")).toBe("noise\nnoise\n");
    },
  );

  it.each(["SIGINT", "SIGTERM"] as const)(
    "forwards %s that comes while the child starts to the group",
    { timeout: 20_000 },
    async (signal) => {
      const fixture = startGroupFixture("echo $$ > started; sleep 30; touch after", MINUTE_MS, 0, {
        spawnSignal: signal,
      });

      expect(await fixture.exit).toEqual({ code: 0, signal: null });
      const { result, before, after } = await fixture.line();
      expect(result).toEqual({ code: null, signal, timedOut: false, killed: false });
      expect(after).toEqual(before);
      expect(existsSync(join(fixture.dir, "after"))).toBe(false);
    },
  );

  it("drops a signal that comes while a child that cannot start starts", { timeout: 20_000 }, async () => {
    const file = join(useTempDir("tasker-run-group-"), "missing");
    const fixture = startGroupFixture("exit 0", MINUTE_MS, 0, { spawnSignal: "SIGTERM", file });

    expect(await fixture.exit).toEqual({ code: 0, signal: null });
    const { error, before, after } = await fixture.line();
    expect(error?.code).toBe("ENOENT");
    expect(after).toEqual(before);
  });

  it("forwards a second SIGINT to the same command", { timeout: 20_000 }, async () => {
    const fixture = startGroupFixture(
      "trap 'echo int >> ints' INT; echo $$ > started; while :; do sleep 0.05; done",
      MINUTE_MS,
      0,
    );
    await readPidFile(join(fixture.dir, "started"), 10_000);
    await waitForWatching(fixture.dir, 10_000);
    const ints = join(fixture.dir, "ints");

    fixture.send("SIGINT");
    await waitForLines(ints, 1);
    fixture.send("SIGINT");
    await waitForLines(ints, 2);

    expect(readFileSync(ints, "utf8")).toBe("int\nint\n");
    expect(isAlive(fixture.pid)).toBe(true);
    fixture.send("SIGTERM");
    expect(await fixture.exit).toEqual({ code: 0, signal: null });
    expect((await fixture.line()).result?.signal).toBe("SIGTERM");
  });

  it("lets a SIGTERM after the run end tasker", { timeout: 20_000 }, async () => {
    const fixture = startGroupFixture("exit 0", MINUTE_MS, 30_000);
    await fixture.line();

    fixture.send("SIGTERM");

    expect(await fixture.exit).toEqual({ code: null, signal: "SIGTERM" });
  });

  it("exits on its own within 3 s after a fast command", { timeout: 20_000 }, async () => {
    const fixture = startGroupFixture("exit 0", MINUTE_MS, 0);
    await fixture.line();

    expect(await fixture.exitsWithin(3000)).toBe("exited");
  });

  it("exits on its own within 3 s after a SIGKILL timeout", { timeout: 20_000 }, async () => {
    const fixture = startGroupFixture(IGNORE_TERM, 300, 0);
    const { result } = await fixture.line();

    expect(result?.killed).toBe(true);
    expect(await fixture.exitsWithin(3000)).toBe("exited");
  });
});

describe("forwardSignals", () => {
  it("sends a signal that comes before attach to the group at attach", async () => {
    const pid = startSleeper();
    const forward = forwardSignals();
    onTestFinished(forward.stop);

    process.emit("SIGTERM");

    expect(isAlive(pid)).toBe(true);
    forward.attach(pid);
    await waitUntilGone(pid, 5000);
  });

  it("sends a signal after attach to the group at once", async () => {
    const pid = startSleeper();
    const forward = forwardSignals();
    onTestFinished(forward.stop);
    forward.attach(pid);

    process.emit("SIGINT");

    await waitUntilGone(pid, 5000);
  });

  it("removes its listeners at stop", () => {
    const before = signalListenerCounts();

    const forward = forwardSignals();

    expect(signalListenerCounts()).toEqual([before[0] + 1, before[1] + 1]);
    forward.stop();
    expect(signalListenerCounts()).toEqual(before);
  });
});
