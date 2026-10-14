import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAssistant } from "../../src/process/run-assistant.js";
import { readPidFile, signalListenerCounts, startFixture, useTempDir } from "../helpers.js";

const MINUTE_MS = 60_000;

// Runs command under bash as an assistant child. It collects each line and each pid that the runner reports.
async function runCollected(command: string, opts: { cwd?: string; prompt?: string; deadline?: number } = {}) {
  const dir = useTempDir("tasker-run-assistant-");
  const lines: string[] = [];
  const pids: number[] = [];
  const result = await runAssistant("/bin/bash", ["-c", command], {
    cwd: opts.cwd ?? dir,
    env: { PATH: process.env.PATH },
    prompt: opts.prompt ?? "",
    deadline: opts.deadline ?? Date.now() + MINUTE_MS,
    onLine: (line) => lines.push(line),
    onSpawn: (pid) => pids.push(pid),
  });
  return { result, lines, pids, dir };
}

describe("runAssistant", () => {
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

  it("stops the group at the deadline", { timeout: 20_000 }, async () => {
    const { result } = await runCollected("sleep 30", { deadline: Date.now() + 300 });

    expect(result).toMatchObject({ code: null, signal: "SIGTERM", timedOut: true, killed: false });
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
});

describe("runAssistant with the signals of tasker", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "forwards %s to the group and keeps tasker alive",
    { timeout: 20_000 },
    async (signal) => {
      const dir = useTempDir("tasker-run-assistant-");
      const fixture = startFixture("run-assistant-signal.ts", [dir, "60000", "echo noise >&2; echo $$ > started; sleep 30"]);
      await readPidFile(join(dir, "started"), 10_000);

      process.kill(fixture.pid, signal);

      const { result, before, after } = JSON.parse(await fixture.firstLine);
      expect(result).toMatchObject({ signal, timedOut: false, killed: false });
      expect(after).toEqual(before);
      await fixture.exited;
    },
  );
});
