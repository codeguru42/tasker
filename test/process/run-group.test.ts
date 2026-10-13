import { closeSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type GroupResult, runInGroup } from "../../src/process/run-group.js";
import { useTempDir } from "../helpers.js";

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
    const { log } = await runLogged('echo "$$ $(ps -o pgid= -p $$)"; exec 3</dev/tty || echo no-tty');

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
    { name: "exit 0", command: "exit 0", missingCwd: false },
    { name: "exit 3", command: "exit 3", missingCwd: false },
    { name: "a spawn error", command: "exit 0", missingCwd: true },
  ])("leaves the SIGINT and SIGTERM listener counts as before after $name", async (row) => {
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    const cwd = row.missingCwd ? join(useTempDir("tasker-run-group-"), "missing") : undefined;

    await runLogged(row.command, { cwd }).catch(() => undefined);

    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
  });
});
