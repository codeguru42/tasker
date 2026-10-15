import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { childEnv } from "../../src/process/child-env.js";
import { NO_OUTPUT_LINE } from "../../src/phases/command-step.js";
import { runVerify, startedCommands, verifyFailureMessage } from "../../src/phases/verify.js";
import { readPidFile, waitUntilGone } from "../helpers/processes.js";
import { useProcessEnv, useTempDir } from "../helpers/temp.js";

const MINUTE_MS = 60_000;

// A worktree and the folder of the logs of one verify run. The folder does not exist yet.
function setup() {
  const tmp = useTempDir("tasker-verify-");
  return { cwd: tmp, runDir: join(tmp, "logs", "verify-run-1") };
}

interface VerifyCallOptions {
  timeoutMs?: number;
  envNames?: string[];
  onSpawn?: (pid: number) => void;
}

function verify(
  commands: string[],
  dirs: ReturnType<typeof setup>,
  { timeoutMs = MINUTE_MS, envNames = [], onSpawn }: VerifyCallOptions = {},
) {
  return runVerify({
    commands,
    env: childEnv(process.env, envNames),
    cwd: dirs.cwd,
    timeoutMs,
    logPath: (n) => join(dirs.runDir, `verify-${n}.log`),
    onSpawn,
  });
}

function readLog(dirs: ReturnType<typeof setup>, n: number): string {
  return readFileSync(join(dirs.runDir, `verify-${n}.log`), "utf8");
}

describe("runVerify", () => {
  it("runs the commands in order and gives each its own log", async () => {
    const dirs = setup();

    const result = await verify(["echo one", "echo two", "echo three"], dirs);

    expect(result).toStrictEqual({ status: "ok" });
    expect(readLog(dirs, 1)).toBe("$ echo one\none\n--- exit code 0\n");
    expect(readLog(dirs, 2)).toBe("$ echo two\ntwo\n--- exit code 0\n");
    expect(readLog(dirs, 3)).toBe("$ echo three\nthree\n--- exit code 0\n");
    expect(existsSync(join(dirs.runDir, "verify-4.log"))).toBe(false);
  });

  it("stops at the first command that fails", async () => {
    const dirs = setup();

    const result = await verify(["true", "printf no-newline; exit 3", "touch later"], dirs);

    expect(result).toStrictEqual({
      status: "failed",
      index: 2,
      command: "printf no-newline; exit 3",
      exitCode: 3,
      timedOut: false,
    });
    expect(readLog(dirs, 2)).toBe("$ printf no-newline; exit 3\nno-newline\n--- exit code 3\n");
    expect(existsSync(join(dirs.runDir, "verify-3.log"))).toBe(false);
    expect(existsSync(join(dirs.cwd, "later"))).toBe(false);
  });

  it("gives onSpawn one pid for each started command", async () => {
    const dirs = setup();
    const pids: number[] = [];

    await verify(["echo $$ > one.pid", "echo $$ > two.pid"], dirs, { onSpawn: (pid) => pids.push(pid) });

    expect(pids).toEqual([
      Number(readFileSync(join(dirs.cwd, "one.pid"), "utf8")),
      Number(readFileSync(join(dirs.cwd, "two.pid"), "utf8")),
    ]);
  });

  it("gives onSpawn no pid for a command after the failing one", async () => {
    const dirs = setup();
    const pids: number[] = [];

    await verify(["true", "exit 3", "true"], dirs, { onSpawn: (pid) => pids.push(pid) });

    expect(pids).toHaveLength(2);
  });

  it("sends SIGTERM at the deadline and runs no later command", async () => {
    const dirs = setup();

    const result = await verify(["sleep 30", "touch later"], dirs, { timeoutMs: 300 });

    expect(result).toStrictEqual({
      status: "failed",
      index: 1,
      command: "sleep 30",
      signal: "SIGTERM",
      timedOut: true,
    });
    expect(readLog(dirs, 1)).toBe("$ sleep 30\n--- timed out: sent SIGTERM\n");
    expect(existsSync(join(dirs.runDir, "verify-2.log"))).toBe(false);
  });

  it("starts no command and opens no log after the deadline", async () => {
    const dirs = setup();

    const result = await verify(["true", "touch later"], dirs, { timeoutMs: 0 });

    expect(result).toStrictEqual({ status: "failed", index: 1, command: "true", timedOut: true, started: false });
    expect(existsSync(join(dirs.runDir, "verify-1.log"))).toBe(false);
    expect(existsSync(join(dirs.cwd, "later"))).toBe(false);
  });

  it("kills a child that ignores SIGTERM 5 s after the deadline", { timeout: 20_000 }, async () => {
    const dirs = setup();
    const command = '(trap "" TERM; exec sleep 30) & echo $! > child.pid; wait';
    const running = verify([command, "touch later"], dirs, { timeoutMs: 300 });
    const childPid = await readPidFile(join(dirs.cwd, "child.pid"), 5000);

    const result = await running;

    expect(result).toStrictEqual({ status: "failed", index: 1, command, signal: "SIGTERM", timedOut: true });
    expect(readLog(dirs, 1)).toContain("--- timed out: sent SIGTERM, then SIGKILL\n");
    await waitUntilGone(childPid, 5000);
  });

  it("gives a command only the allowed names and the listed names", async () => {
    const dirs = setup();
    useProcessEnv({ VERIFY_PASSED: "yes", TASKER_SECRET: "no" });

    await verify(['echo "$VERIFY_PASSED|${TASKER_SECRET-unset}"'], dirs, {
      envNames: ["VERIFY_PASSED", "TASKER_SECRET"],
    });

    expect(readLog(dirs, 1)).toContain("yes|unset\n");
  });

  it("runs each command in the working folder", async () => {
    const dirs = setup();

    await verify(["pwd -P"], dirs);

    expect(readLog(dirs, 1)).toContain(`${realpathSync(dirs.cwd)}\n`);
  });

  it("reports a command that cannot start as a failure of that command", async () => {
    const dirs = setup();
    const cwd = join(dirs.cwd, "missing");
    const text = `cannot start /bin/bash: the folder ${cwd} does not exist`;

    const result = await verify(["true", "touch later"], { ...dirs, cwd });

    expect(result).toStrictEqual({ status: "failed", index: 1, command: "true", timedOut: false, error: text });
    expect(readLog(dirs, 1)).toBe(`$ true\n--- ${text}\n`);
    expect(existsSync(join(dirs.runDir, "verify-2.log"))).toBe(false);
  });
});

describe("startedCommands", () => {
  const commands = ["a", "b", "c"];

  it("gives all commands for an ok result", () => {
    expect(startedCommands(commands, { status: "ok" })).toEqual(["a", "b", "c"]);
  });

  it("includes the command that failed with an exit code", () => {
    const failure = { status: "failed", index: 2, command: "b", exitCode: 3, timedOut: false } as const;
    expect(startedCommands(commands, failure)).toEqual(["a", "b"]);
  });

  it("includes the command that timed out after it started", () => {
    const failure = { status: "failed", index: 2, command: "b", signal: "SIGTERM", timedOut: true } as const;
    expect(startedCommands(commands, failure)).toEqual(["a", "b"]);
  });

  it("includes the command that could not start", () => {
    const failure = { status: "failed", index: 2, command: "b", timedOut: false, error: "spawn ENOENT" } as const;
    expect(startedCommands(commands, failure)).toEqual(["a", "b"]);
  });

  it("leaves out the command that the deadline kept from its start", () => {
    const failure = { status: "failed", index: 2, command: "b", timedOut: true, started: false } as const;
    expect(startedCommands(commands, failure)).toEqual(["a"]);
  });

  it("counts a timeout with no flag as started", () => {
    const failure = { status: "failed", index: 2, command: "b", timedOut: true } as const;
    expect(startedCommands(commands, failure)).toEqual(["a", "b"]);
  });
});

describe("verifyFailureMessage", () => {
  function logWith(content: string): string {
    const path = join(useTempDir("tasker-verify-message-"), "verify.log");
    writeFileSync(path, content);
    return path;
  }

  it("gives the message of the command and the tail of its log", () => {
    const log = logWith("$ seq 1 3; exit 3\n1\n2\n3\n--- exit code 3\n");
    const failure = { status: "failed", index: 1, command: "seq 1 3; exit 3", exitCode: 3, timedOut: false } as const;
    expect(verifyFailureMessage(failure, log, 20)).toBe(
      `verify command 1 failed: seq 1 3; exit 3: exit code 3. The log is ${log}.\n` +
        "the last 5 lines of the log:\n$ seq 1 3; exit 3\n1\n2\n3\n--- exit code 3",
    );
  });

  it("ends with the no-output line when the log holds no output", () => {
    const log = logWith("$ exit 3\n--- exit code 3\n");
    const failure = { status: "failed", index: 1, command: "exit 3", exitCode: 3, timedOut: false } as const;
    expect(verifyFailureMessage(failure, log, 20).endsWith(`\n${NO_OUTPUT_LINE}`)).toBe(true);
  });

  it("leaves out the log for a command that never started", () => {
    const log = join(useTempDir("tasker-verify-message-"), "none.log");
    const failure = { status: "failed", index: 2, command: "npm test", timedOut: true, started: false } as const;
    expect(verifyFailureMessage(failure, log, 20)).toBe(
      "verify command 2 failed: npm test: timed out after 20 min, before the command started.",
    );
  });
});
