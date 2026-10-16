import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { errnoCode } from "../../src/errno.js";
import type { LockAttempt } from "../../src/store/locks.js";

// The repo root, for spawn tests that need it as cwd.
export const repoRoot = new URL("../..", import.meta.url);

export interface FixtureChild {
  pid: number;
  // The first line of stdout, without the newline. It rejects, with the stderr of the child, when
  // the child ends first.
  firstLine: Promise<string>;
  // Resolves with the exit code and the signal after the child exits and its stdout and stderr close.
  // Node reaps the child before, so the pid is gone.
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  // The full text so far.
  stdout: () => string;
  stderr: () => string;
}

// Starts test/fixtures/<fixture> through tsx and saves its pid with savePid.
export function startFixture(fixture: string, args: readonly string[]): FixtureChild {
  const child = spawn(process.execPath, ["--import", "tsx", `test/fixtures/${fixture}`, ...args], {
    cwd: repoRoot,
  });
  const pid = child.pid!;
  savePid(pid);
  let stdout = "";
  let stderr = "";
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.on("close", (code, signal) => resolve({ code, signal })),
  );
  const firstLine = new Promise<string>((resolve, reject) => {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const end = stdout.indexOf("\n");
      if (end !== -1) resolve(stdout.slice(0, end));
    });
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    // close comes after the stdio streams end, so the stderr is complete here.
    child.on("close", () => reject(new Error(`the child ${fixture} exited first: ${stderr}`)));
  });
  // The rejection after a resolve does nothing. This stops an unhandled rejection of a killed child.
  firstLine.catch(() => {});
  return { pid, firstLine, exited, stdout: () => stdout, stderr: () => stderr };
}

export interface LockHolder {
  pid: number;
  // The JSON line of the child. It rejects, with the stderr of the child, when the child ends first.
  attempt: Promise<LockAttempt>;
  // Resolves on the exit event. Node reaps the child before it emits exit, so the pid is gone.
  exited: Promise<void>;
}

// Starts test/fixtures/lock-holder.ts.
export function startLockHolder(dbPath: string, name: string, goPath?: string): LockHolder {
  const child = startFixture("lock-holder.ts", [dbPath, name, ...(goPath ? [goPath] : [])]);
  const attempt = child.firstLine.then((line) => JSON.parse(line) as LockAttempt);
  attempt.catch(() => {});
  return { pid: child.pid, attempt, exited: child.exited.then(() => undefined) };
}

// Starts test/fixtures/write-lock-holder.ts. It resolves when the child holds the write lock of dbPath.
// The child keeps the lock for holdMs ms. savePid kills it after the test.
export async function startWriteLockHolder(dbPath: string, holdMs: number): Promise<void> {
  const line = await startFixture("write-lock-holder.ts", [dbPath, String(holdMs)]).firstLine;
  if (line !== "held") throw new Error(`the write lock child printed ${line}`);
}

// Runs tasker (src/main.ts through tsx) in a child process with env on top of the process env.
export function spawnTasker(
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts", ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// True when the process runs. A zombie (state Z, not yet reaped) counts as gone.
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The state follows the last ")" of the line, because the command name can hold ")".
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return true;
  }
}

// The pid of a real process that ran and ended. spawnSync waits for the end and reaps the child,
// so the pid is gone when it returns.
export function deadPid(): number {
  const result = spawnSync("true");
  if (result.error !== undefined) throw result.error;
  if (result.pid === undefined || result.pid === 0) throw new Error("the short process got no pid");
  return result.pid;
}

// Resolves when predicate gives true. It polls every 50 ms and rejects with message after timeoutMs.
export async function waitUntil(predicate: () => boolean, timeoutMs: number, message: string): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error(message);
    await new Promise((done) => setTimeout(done, 50));
  }
}

// Resolves when the process is gone. Rejects with the pid when it still runs after timeoutMs.
export async function waitUntilGone(pid: number, timeoutMs: number): Promise<void> {
  await waitUntil(() => !isAlive(pid), timeoutMs, `process ${pid} still runs after ${timeoutMs} ms`);
}

// Sends SIGKILL to pid after the test, when it still runs. Use it only for a pid that the test started.
// The process can end before the kill, so a pid that is gone (ESRCH) is not an error.
export function savePid(pid: number): void {
  onTestFinished(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (errnoCode(error) !== "ESRCH") throw error;
    }
  });
}

// Starts sleep 30 as the leader of its own process group, saves its pid with savePid and returns the pid.
export function startSleeper(): number {
  const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("sleep did not start");
  savePid(pid);
  return pid;
}

// Waits until the file holds a pid and a newline, saves the pid with savePid and returns it.
export async function readPidFile(path: string, timeoutMs: number): Promise<number> {
  let pid = 0;
  await waitUntil(
    () => {
      const text = existsSync(path) ? readFileSync(path, "utf8") : "";
      if (!/^\d+\n$/.test(text)) return false;
      pid = Number(text);
      return true;
    },
    timeoutMs,
    `no pid in ${path} after ${timeoutMs} ms`,
  );
  savePid(pid);
  return pid;
}

// Waits until the signal fixture that runs in dir writes the file watching, and returns the pid of the fixture.
// The fixture writes the file in onSpawn, when the runner forwards the signals of the fixture.
export function waitForWatching(dir: string, timeoutMs: number): Promise<number> {
  return readPidFile(join(dir, "watching"), timeoutMs);
}

// The numbers of SIGINT and SIGTERM listeners on this process.
export function signalListenerCounts(): number[] {
  return [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
}

export interface FakeProcess {
  pid: number;
  // The name of the process. The file comm ends with a newline, as in /proc.
  comm: string;
  // The folder of the process. Without it, the process has no cwd link.
  cwd?: string;
  // The paths of the open files. Without it, the process has no fd folder.
  openFiles?: readonly string[];
}

// Makes a fake /proc folder in root: <pid>/comm, <pid>/cwd and <pid>/fd/<n> as links.
export function writeFakeProc(root: string, processes: readonly FakeProcess[]): void {
  mkdirSync(root, { recursive: true });
  for (const process of processes) {
    const folder = join(root, String(process.pid));
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "comm"), `${process.comm}\n`);
    if (process.cwd !== undefined) {
      symlinkSync(process.cwd, join(folder, "cwd"));
    }
    if (process.openFiles !== undefined) {
      mkdirSync(join(folder, "fd"));
      process.openFiles.forEach((file, index) => {
        symlinkSync(file, join(folder, "fd", String(index)));
      });
    }
  }
}
