import { type ChildProcess, spawn } from "node:child_process";
import { errnoCode } from "../errno.js";

const KILL_GRACE_MS = 5_000;
const POLL_MS = 100;
const MAX_TIMER_MS = 2_147_483_647; // above this, setTimeout fires at once
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export interface RunGroupOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  outputFd: number;
  deadline: number;
  // Runs once with the pid of the child, after the watch starts. A throw stops the group and rejects the run.
  onSpawn?: (pid: number) => void;
}

export interface GroupResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  killed: boolean;
}

// Sends signal to the process group of pid. A group that is gone (ESRCH) is not an error.
// It is exported only for its direct test.
export function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (errnoCode(error) !== "ESRCH") throw error;
  }
}

function groupRuns(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (errnoCode(error) === "ESRCH") return false;
    throw error;
  }
}

export interface SignalForward {
  // Gives the pid of the group. Each signal that came before goes to the group now, in the order that it came.
  attach: (pid: number) => void;
  // Removes the listeners. A signal that did not reach a group is dropped.
  stop: () => void;
}

// From now on, SIGINT and SIGTERM do not stop tasker. A signal that comes before attach waits for the group.
export function forwardSignals(): SignalForward {
  let pid: number | undefined;
  const waiting: NodeJS.Signals[] = [];
  const forwarders = FORWARDED_SIGNALS.map(
    (signal) => [signal, () => (pid === undefined ? waiting.push(signal) : signalGroup(pid, signal))] as const,
  );
  for (const [signal, handler] of forwarders) process.on(signal, handler);
  return {
    attach: (groupPid) => {
      pid = groupPid;
      for (const signal of waiting.splice(0)) signalGroup(groupPid, signal);
    },
    stop: () => {
      for (const [signal, handler] of forwarders) process.off(signal, handler);
    },
  };
}

export interface SuperviseOptions {
  // Started by the caller right before the spawn. superviseGroup attaches it and stops it when the run ends.
  forward: SignalForward;
  deadline: number;
  signal?: AbortSignal;
  stopOnExit?: boolean;
  onStart?: () => void;
}

// Watches child, the leader of its own process group with pid pid, until it closes.
// The caller starts options.forward right before the spawn. From the attach until the run ends, SIGINT and
// SIGTERM of tasker go to the group. At the deadline, the group gets SIGTERM.
// Five seconds later, it gets SIGKILL. After such a stop, it waits until the group is gone.
// An abort of signal stops the group in the same way, but it does not set timedOut.
// With stopOnExit, the exit of the leader stops the group in the same way.
// After a stop, when the leader has exited and the group is gone (or the SIGKILL was sent), it closes the pipes
// of the child that are still open, so a process outside the group cannot hold the run open.
// onStart runs once, after the watch starts. If it throws, the group is stopped in the same way,
// and the promise rejects with that error after the group is gone.
export function superviseGroup(child: ChildProcess, pid: number, options: SuperviseOptions): Promise<GroupResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let startError: { error: unknown } | undefined;
    let timedOut = false;
    let stopping = false;
    let killed = false;
    let leaderExited = false;
    let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let deadlineTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    let pollTimer: NodeJS.Timeout | undefined;
    options.forward.attach(pid);
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(graceTimer);
      clearInterval(pollTimer);
      options.forward.stop();
      options.signal?.removeEventListener("abort", stop);
      finish();
    };
    const waitsForGroup = () => stopping && !killed && groupRuns(pid); // wait for the group, or for the SIGKILL
    const finishIfDone = () => {
      if (exited === undefined) {
        // A process outside the group can hold a pipe of the child open, and then no close comes.
        if (stopping && leaderExited && !waitsForGroup()) for (const stream of child.stdio) stream?.destroy();
        return;
      }
      if (waitsForGroup()) return;
      const result = { ...exited, timedOut, killed };
      settle(() => (startError ? reject(startError.error) : resolve(result)));
    };
    const stop = () => {
      if (stopping) return;
      stopping = true;
      clearTimeout(deadlineTimer);
      signalGroup(pid, "SIGTERM");
      graceTimer = setTimeout(() => {
        killed = true;
        signalGroup(pid, "SIGKILL");
        finishIfDone();
      }, KILL_GRACE_MS);
      pollTimer = setInterval(finishIfDone, POLL_MS);
    };
    const armDeadline = () => {
      const left = options.deadline - Date.now();
      if (left > 0) {
        deadlineTimer = setTimeout(armDeadline, Math.min(left, MAX_TIMER_MS));
        return;
      }
      timedOut = true;
      stop();
    };
    child.on("error", (error) => settle(() => reject(error)));
    child.on("exit", () => {
      leaderExited = true;
      if (options.stopOnExit) stop();
    });
    child.on("close", (code, signal) => {
      exited = { code, signal };
      finishIfDone();
    });
    armDeadline();
    if (options.signal?.aborted) stop();
    else options.signal?.addEventListener("abort", stop, { once: true });
    try {
      options.onStart?.();
    } catch (error) {
      startError = { error };
      stop();
    }
  });
}

// Runs file with args in a new process group and session. stdout and stderr go to outputFd, and stdin is /dev/null.
// The group, the deadline and the signals follow superviseGroup.
export async function runInGroup(
  file: string,
  args: readonly string[],
  options: RunGroupOptions,
): Promise<GroupResult> {
  const forward = forwardSignals();
  let child: ChildProcess;
  try {
    child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", options.outputFd, options.outputFd],
    });
  } catch (error) {
    forward.stop();
    throw error;
  }
  const pid = child.pid;
  if (pid === undefined) {
    forward.stop();
    return new Promise((_, reject) => child.once("error", reject)); // no group exists, so tasker drops each signal that came, and no timer starts
  }
  const { onSpawn } = options;
  return superviseGroup(child, pid, {
    forward,
    deadline: options.deadline,
    onStart: onSpawn && (() => onSpawn(pid)),
  });
}
