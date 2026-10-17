import { chmodSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CommandNotFoundError } from "../../src/process/run-child.js";
import { runAssistant } from "../../src/process/run-assistant.js";
import {
  readPidFile,
  savePid,
  signalListenerCounts,
  startFixture,
  waitForWatching,
  waitUntilGone,
} from "../helpers/processes.js";
import { useTempDir, useTempFile } from "../helpers/temp.js";

const MINUTE_MS = 60_000;
const GRACE_MS = 5000;
// libuv keeps the loop clock of the Node timers in whole ms, so a timer can fire up to 1 ms before its delay.
// On a host where CLOCK_MONOTONIC_COARSE has a resolution of 1 ms or better, libuv reads that coarse clock,
// which can be up to 1 ms more behind.
const TIMER_CLOCK_STEP_MS = 2;

// Runs command under bash as an assistant child. It collects each line and each pid that the runner reports.
async function runCollected(
  command: string,
  opts: {
    cwd?: string;
    prompt?: string;
    deadline?: number;
    signal?: AbortSignal;
    file?: string;
    env?: NodeJS.ProcessEnv;
    onSpawn?: (pid: number) => void;
  } = {},
) {
  const dir = useTempDir("tasker-run-assistant-");
  const lines: string[] = [];
  const pids: number[] = [];
  const result = await runAssistant(opts.file ?? "/bin/bash", ["-c", command], {
    cwd: opts.cwd ?? dir,
    env: opts.env ?? { PATH: process.env.PATH },
    prompt: opts.prompt ?? "",
    deadline: opts.deadline ?? Date.now() + MINUTE_MS,
    signal: opts.signal,
    onLine: (line) => lines.push(line),
    onSpawn: (pid) => {
      pids.push(pid);
      opts.onSpawn?.(pid);
    },
  });
  return { result, lines, pids, dir };
}

describe("runAssistant", () => {
  it("removes its signal listeners after a spawn that throws", async () => {
    const before = signalListenerCounts();

    await expect(runCollected("exit 0", { file: "/bin/ba\0sh" })).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_VALUE",
    });

    expect(signalListenerCounts()).toEqual(before);
  });

  it("writes the prompt to stdin and gives each stdout line to onLine", async () => {
    const { result, lines } = await runCollected("cat", { prompt: "one\ntwo\n" });

    expect(lines).toEqual(["one", "two"]);
    expect(result).toMatchObject({ code: 0, signal: null });
  });

  it("starts the child in its own group and session, and reports its pid once", async () => {
    const { lines, pids } = await runCollected('echo "$$ $(ps -o pgid=,sid= -p $$)"');

    expect(pids).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.trim().split(/\s+/)).toEqual([String(pids[0]), String(pids[0]), String(pids[0])]);
  });

  it("gives the exit code", async () => {
    const { result } = await runCollected("exit 3");

    expect(result).toMatchObject({ code: 3, signal: null });
  });

  it("gives the signal that stopped the leader", async () => {
    const { result } = await runCollected("kill -TERM $$");

    expect(result).toMatchObject({ code: null, signal: "SIGTERM" });
  });

  it("gives an empty line", async () => {
    const { lines } = await runCollected("printf 'a\\n\\nb\\n'");

    expect(lines).toEqual(["a", "", "b"]);
  });

  it("joins a line that is larger than a chunk and gives the last line with no line end", async () => {
    const { lines } = await runCollected("head -c 3000000 /dev/zero | tr '\\0' x; echo; printf tail");

    expect(lines).toEqual(["x".repeat(3_000_000), "tail"]);
  });

  it("keeps a multi-byte character whole when it crosses a chunk border", async () => {
    const { lines } = await runCollected('s=é; for i in {1..17}; do s=$s$s; done; printf a; echo "$s"');

    expect(lines).toEqual(["a" + "é".repeat(131072)]);
  });

  it.each([
    { name: "never reads the prompt", command: "exit 3", code: 3 },
    { name: "reads one byte of the prompt", command: "head -c 1 >/dev/null; exit 4", code: 4 },
  ])("gives the exit code of a child that $name", async ({ command, code }) => {
    const { result } = await runCollected(command, { prompt: "x".repeat(4 * 1024 * 1024) });

    expect(result).toMatchObject({ code, signal: null });
  });

  it("keeps the last 64 KiB of stderr and gives it no line", async () => {
    const { result, lines } = await runCollected("head -c 100000 /dev/zero | tr '\\0' e >&2; printf END >&2");

    expect(result).toMatchObject({ started: true });
    const stderrTail = result.started ? result.stderrTail : "";
    expect(stderrTail).toHaveLength(65536);
    expect(stderrTail).toMatch(/^e+END$/);
    expect(lines).toEqual([]);
  });

  it("starts the stderr tail at a whole UTF-8 character", async () => {
    const TAIL_BYTES = 65536;
    const CHARACTERS = 2 ** 15; // the é block: 2 bytes each, 65536 bytes in all
    const X_BYTES = 1;
    // The last TAIL_BYTES bytes start 1 byte into the first é of the block.
    const CUT_BYTES = 1;
    const expected = "é".repeat((TAIL_BYTES - X_BYTES - CUT_BYTES) / 2) + "X";
    expect(CHARACTERS * 2).toBe(TAIL_BYTES);
    // /bin/sh, because the bash of some hosts writes a startup warning to stderr.
    const command =
      "head -c 70000 /dev/zero | tr '\\0' e >&2; s=é; for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do s=$s$s; done; " +
      "printf '%s' \"$s\" >&2; printf X >&2";

    const { result } = await runCollected(command, { file: "/bin/sh" });

    expect(result).toMatchObject({ started: true });
    const stderrTail = result.started ? result.stderrTail : "";
    expect(stderrTail).not.toContain("�");
    expect(stderrTail.endsWith("X")).toBe(true);
    expect(stderrTail).toBe(expected);
  });

  it("stops the group when the signal aborts", { timeout: 20_000 }, async () => {
    const dir = useTempDir("tasker-run-assistant-");
    const controller = new AbortController();
    const before = signalListenerCounts();
    const running = runCollected("sleep 30 & echo $! > child.pid; wait", { cwd: dir, signal: controller.signal });
    const childPid = await readPidFile(join(dir, "child.pid"), 5000);

    controller.abort();

    const { result } = await running;
    expect(result).toMatchObject({ code: null, signal: "SIGTERM", timedOut: false, killed: false, passedSignal: null });
    await waitUntilGone(childPid, 5000);
    expect(signalListenerCounts()).toEqual(before);
  });

  it("stops the group at once when the signal is already aborted", { timeout: 20_000 }, async () => {
    const start = Date.now();

    const { result, pids } = await runCollected("sleep 30", { signal: AbortSignal.abort() });

    expect(result).toMatchObject({ signal: "SIGTERM", timedOut: false, killed: false, passedSignal: null });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(pids).toHaveLength(1);
  });

  it("kills a leader that ignores SIGTERM 5 s after the abort", { timeout: 20_000 }, async () => {
    const dir = useTempDir("tasker-run-assistant-");
    const controller = new AbortController();
    const running = runCollected('trap "" TERM; echo $$ > leader.pid; sleep 30', {
      cwd: dir,
      signal: controller.signal,
    });
    const leaderPid = await readPidFile(join(dir, "leader.pid"), 5000);
    const abortedAt = performance.now();

    controller.abort();

    const { result } = await running;
    expect(result).toMatchObject({ timedOut: false, killed: true, passedSignal: null });
    expect(performance.now() - abortedAt).toBeGreaterThan(GRACE_MS - TIMER_CLOCK_STEP_MS);
    await waitUntilGone(leaderPid, 5000);
  });

  it("stops the group when the leader exits and keeps every line of the leader", { timeout: 20_000 }, async () => {
    const dir = useTempDir("tasker-run-assistant-");
    const start = Date.now();

    const { result, lines } = await runCollected("echo one; sleep 30 & echo $! > child.pid; echo two; exit 3", {
      cwd: dir,
    });

    expect(Date.now() - start).toBeLessThan(GRACE_MS);
    expect(lines).toEqual(["one", "two"]);
    expect(result).toMatchObject({ code: 3, signal: null, timedOut: false, killed: false });
    await waitUntilGone(await readPidFile(join(dir, "child.pid"), 5000), 5000);
  });

  it("kills a background child that ignores SIGTERM 5 s after the leader exits", { timeout: 20_000 }, async () => {
    const dir = useTempDir("tasker-run-assistant-");
    const start = performance.now();

    const { result } = await runCollected(
      '(trap "" TERM; echo $BASHPID > child.pid; exec sleep 30) & while [ ! -s child.pid ]; do sleep 0.05; done; exit 0',
      { cwd: dir },
    );

    expect(result).toMatchObject({ code: 0, signal: null, timedOut: false, killed: true });
    expect(performance.now() - start).toBeGreaterThan(GRACE_MS - TIMER_CLOCK_STEP_MS);
    await waitUntilGone(await readPidFile(join(dir, "child.pid"), 5000), 5000);
  });

  it("does not wait for the grace when the leader leaves no other process", { timeout: 20_000 }, async () => {
    const start = Date.now();

    const { result, lines } = await runCollected("echo done; exit 0");

    expect(lines).toEqual(["done"]);
    expect(result).toMatchObject({ code: 0, timedOut: false, killed: false });
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("ends the run when a process outside the group holds stdout", { timeout: 20_000 }, async () => {
    const dir = useTempDir("tasker-run-assistant-");
    const start = Date.now();

    const { result, lines } = await runCollected(
      "setsid sh -c 'echo $$ > child.pid; exec sleep 30' & while [ ! -s child.pid ]; do sleep 0.05; done; echo one; exit 0",
      { cwd: dir },
    );

    expect(Date.now() - start).toBeLessThan(GRACE_MS);
    expect(lines).toEqual(["one"]);
    expect(result).toMatchObject({ code: 0, signal: null, timedOut: false });
    await readPidFile(join(dir, "child.pid"), 5000);
  });

  it(
    "gives the last line with no line end when a process outside the group holds stdout",
    { timeout: 20_000 },
    async () => {
      const dir = useTempDir("tasker-run-assistant-");
      const start = Date.now();

      const { lines } = await runCollected(
        "setsid sh -c 'echo $$ > child.pid; exec sleep 30' & while [ ! -s child.pid ]; do sleep 0.05; done; printf tail; exit 0",
        { cwd: dir },
      );

      expect(Date.now() - start).toBeLessThan(GRACE_MS);
      expect(lines).toEqual(["tail"]);
      await readPidFile(join(dir, "child.pid"), 5000);
    },
  );

  it("reports a started run with all result keys", async () => {
    // /bin/sh, because the bash of some hosts writes a startup warning to stderr.
    const { result } = await runCollected("exit 0", { file: "/bin/sh" });

    expect(result).toEqual({
      started: true,
      code: 0,
      signal: null,
      timedOut: false,
      killed: false,
      passedSignal: null,
      stderrTail: "",
    });
  });

  it("gives an error for a cwd that does not exist", async () => {
    const cwd = join(useTempDir("tasker-run-assistant-"), "missing");

    const { result, pids } = await runCollected("exit 0", { cwd });

    expect(result).toEqual({
      started: false,
      notFound: false,
      error: `cannot start /bin/bash: the folder ${cwd} does not exist`,
    });
    expect(pids).toEqual([]);
  });

  it("gives an error for a cwd that is a file", async () => {
    const cwd = useTempFile("tasker-run-assistant-", "file", "");

    const { result, pids } = await runCollected("exit 0", { cwd });

    expect(result).toEqual({
      started: false,
      notFound: false,
      error: `cannot start /bin/bash: the folder ${cwd} does not exist`,
    });
    expect(pids).toEqual([]);
  });

  it("gives the not-found error for a program that does not exist", async () => {
    const file = join(useTempDir("tasker-run-assistant-"), "missing-program");

    const { result, pids } = await runCollected("exit 0", { file });

    expect(result).toEqual({
      started: false,
      notFound: true,
      error: new CommandNotFoundError(file, "not-on-path").message,
    });
    expect(pids).toEqual([]);
  });

  it("gives an error for a program that is not executable", async () => {
    const file = useTempFile("tasker-run-assistant-", "plain-file", "");
    chmodSync(file, 0o644);

    const { result, pids } = await runCollected("exit 0", { file });

    expect(result).toEqual({ started: false, notFound: false, error: `cannot start ${file}: spawn ${file} EACCES` });
    expect(pids).toEqual([]);
  });

  it("gives the no-path error when the env has no PATH", async () => {
    const { result, pids } = await runCollected("exit 0", { file: "bash", env: {} });

    expect(result).toEqual({
      started: false,
      notFound: true,
      error: new CommandNotFoundError("bash", "no-path").message,
    });
    expect(pids).toEqual([]);
  });

  it("stops the group at the deadline", { timeout: 20_000 }, async () => {
    const { result } = await runCollected("sleep 30", { deadline: Date.now() + 300 });

    expect(result).toMatchObject({ code: null, signal: "SIGTERM", timedOut: true, killed: false, passedSignal: null });
  });

  it("removes its signal listeners after a normal run", async () => {
    const before = signalListenerCounts();

    await runCollected("exit 0");

    expect(signalListenerCounts()).toEqual(before);
  });

  it("removes its signal listeners after a timeout", { timeout: 20_000 }, async () => {
    const before = signalListenerCounts();

    await runCollected("sleep 30", { deadline: Date.now() + 300 });

    expect(signalListenerCounts()).toEqual(before);
  });

  it("stops the group and rejects with the error when onSpawn throws", { timeout: 20_000 }, async () => {
    const before = signalListenerCounts();
    const error = new Error("the pid write failed");
    let spawned: number | undefined;

    await expect(
      runCollected("sleep 30", {
        onSpawn: (pid) => {
          spawned = pid;
          savePid(pid);
          throw error;
        },
      }),
    ).rejects.toBe(error);

    expect(spawned).toBeDefined();
    await waitUntilGone(spawned!, 5000);
    expect(signalListenerCounts()).toEqual(before);
  });
});

describe("runAssistant with the signals of tasker", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "forwards %s that comes while the child starts to the group",
    { timeout: 20_000 },
    async (signal) => {
      const dir = useTempDir("tasker-run-assistant-");
      const fixture = startFixture("run-assistant-signal.ts", [dir, "60000", "sleep 30", signal]);

      const { result, before, after } = JSON.parse(await fixture.firstLine);
      expect(result).toMatchObject({ started: true, signal, timedOut: false, killed: false, passedSignal: signal });
      expect(after).toEqual(before);
      await fixture.exited;
    },
  );

  it("ends tasker with a signal that comes while a child that cannot start starts", { timeout: 20_000 }, async () => {
    const dir = useTempDir("tasker-run-assistant-");
    const fixture = startFixture("run-assistant-signal.ts", [dir, "60000", "exit 0", "SIGTERM", join(dir, "missing")]);

    expect(await fixture.exited).toEqual({ code: null, signal: "SIGTERM" });
    expect(fixture.stdout()).toBe("");
  });

  it(
    "ends tasker with a signal that comes while a child that cannot start starts after a file read",
    { timeout: 20_000 },
    async () => {
      const dir = useTempDir("tasker-run-assistant-");
      const fixture = startFixture("run-assistant-signal.ts", [
        dir,
        "60000",
        "exit 0",
        "SIGTERM",
        join(dir, "missing"),
        "after-read",
      ]);

      expect(await fixture.exited).toEqual({ code: null, signal: "SIGTERM" });
      expect(fixture.stdout()).toBe("");
    },
  );

  it.each(["SIGINT", "SIGTERM"] as const)(
    "forwards %s to the group and keeps tasker alive",
    { timeout: 20_000 },
    async (signal) => {
      const dir = useTempDir("tasker-run-assistant-");
      const fixture = startFixture("run-assistant-signal.ts", [
        dir,
        "60000",
        "echo noise >&2; echo $$ > started; sleep 30",
      ]);
      await readPidFile(join(dir, "started"), 10_000);
      await waitForWatching(dir, 10_000);

      process.kill(fixture.pid, signal);

      const { result, before, after } = JSON.parse(await fixture.firstLine);
      expect(result).toMatchObject({ signal, timedOut: false, killed: false, passedSignal: signal });
      expect(after).toEqual(before);
      await fixture.exited;
    },
  );
});
