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
  // The signal that stopped the leader.
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  killed: boolean;
  // The first SIGINT or SIGTERM that tasker passed to the group, or null. A stop by the deadline or an abort is
  // not a passed signal. A signal that release gave back to tasker is not a passed signal either.
  passedSignal: NodeJS.Signals | null;
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

// Sends SIGTERM to the group of pid. It gives back the timer that sends SIGKILL after the grace time and then runs
// onKill. A throw of the SIGKILL goes to onError. The caller clears the timer when the group is gone.
function startStop(pid: number, onKill: () => void, onError: (error: unknown) => void): NodeJS.Timeout {
  signalGroup(pid, "SIGTERM");
  return setTimeout(() => {
    try {
      signalGroup(pid, "SIGKILL");
    } catch (error) {
      onError(error);
      return;
    }
    onKill();
  }, KILL_GRACE_MS);
}

// Stops the process group of pid: SIGTERM now, and SIGKILL after five seconds if the group still runs.
// It resolves when the group is gone. An error of a signal or of the poll rejects. A pid below 2 or not whole
// rejects with no signal, because process.kill(-1) signals every process of the user and -0 is the own group.
export function stopGroup(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid < 2) {
    return Promise.reject(
      new RangeError(`cannot stop the process group of pid ${pid}: the pid must be a whole number of 2 or more`),
    );
  }
  return new Promise((resolve, reject) => {
    let graceTimer: NodeJS.Timeout | undefined;
    const finish = (done: () => void) => {
      clearTimeout(graceTimer);
      clearInterval(pollTimer);
      done();
    };
    const fail = (error: unknown) => finish(() => reject(error));
    const poll = () => {
      try {
        if (!groupRuns(pid)) finish(resolve);
      } catch (error) {
        fail(error);
      }
    };
    const pollTimer = setInterval(poll, POLL_MS);
    try {
      graceTimer = startStop(pid, poll, fail);
    } catch (error) {
      fail(error);
    }
  });
}

export interface SignalForward {
  // Gives the pid of the group. Each signal that came before goes to the group now, in the order that it came.
  attach: (pid: number) => void;
  // Removes the listeners. It is for the end of a run after attach. Each signal that came already went to the group.
  stop: () => void;
  // Gives the first signal that went to the group, or null.
  passed: () => NodeJS.Signals | null;
  // For a run with no group. A signal that comes in the poll phase of the event loop reaches the listener only in
  // the next poll phase. So it waits for two setImmediate turns in a row, with one full poll phase between them.
  // Then it removes the listeners. It sends each waiting signal to tasker again, in the order that it came.
  // No listener is left, so each signal gets its default action. A SIGINT or a SIGTERM ends tasker.
  release: () => Promise<void>;
}

// From now on, SIGINT and SIGTERM do not stop tasker. A signal that comes before attach waits for the group.
// If no group starts, release gives each waiting signal its default action.
export function forwardSignals(): SignalForward {
  let pid: number | undefined;
  const waiting: NodeJS.Signals[] = [];
  let passedSignal: NodeJS.Signals | null = null;
  const pass = (groupPid: number, signal: NodeJS.Signals) => {
    passedSignal ??= signal;
    signalGroup(groupPid, signal);
  };
  const forwarders = FORWARDED_SIGNALS.map(
    (signal) => [signal, () => (pid === undefined ? waiting.push(signal) : pass(pid, signal))] as const,
  );
  for (const [signal, handler] of forwarders) process.on(signal, handler);
  const stop = () => {
    for (const [signal, handler] of forwarders) process.off(signal, handler);
  };
  return {
    attach: (groupPid) => {
      pid = groupPid;
      for (const signal of waiting.splice(0)) pass(groupPid, signal);
    },
    stop,
    passed: () => passedSignal,
    release: async () => {
      for (let turn = 0; turn < 2; turn++) await new Promise((resolve) => setImmediate(resolve));
      stop();
      for (const signal of waiting.splice(0)) process.kill(process.pid, signal);
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
// SIGTERM of tasker go to the group, and the result holds the first one in passedSignal. At the deadline, the group gets SIGTERM.
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
      const result = { ...exited, timedOut, killed, passedSignal: options.forward.passed() };
      settle(() => (startError ? reject(startError.error) : resolve(result)));
    };
    const stop = () => {
      if (stopping) return;
      stopping = true;
      clearTimeout(deadlineTimer);
      graceTimer = startStop(
        pid,
        () => {
          killed = true;
          finishIfDone();
        },
        (error) => {
          throw error;
        },
      );
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
    await forward.release();
    throw error;
  }
  const pid = child.pid;
  if (pid === undefined) {
    // The child emits error before the wait ends, so the listener must exist first.
    const error = new Promise<Error>((resolve) => child.once("error", resolve));
    await forward.release();
    // no group exists, so each signal that came gets its default action, and no timer starts
    throw await error;
  }
  const { onSpawn } = options;
  return superviseGroup(child, pid, {
    forward,
    deadline: options.deadline,
    onStart: onSpawn && (() => onSpawn(pid)),
  });
}
