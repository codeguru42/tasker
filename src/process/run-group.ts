import { type ChildProcess, spawn } from "node:child_process";

const KILL_GRACE_MS = 5_000;
const POLL_MS = 100;
const MAX_TIMER_MS = 2_147_483_647; // above this, setTimeout fires at once
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export interface RunGroupOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  outputFd: number;
  deadline: number;
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
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function groupRuns(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

export interface SuperviseOptions {
  deadline: number;
  signal?: AbortSignal;
  stopOnExit?: boolean;
}

// Watches child, the leader of its own process group with pid pid, until it closes.
// While it runs, SIGINT and SIGTERM of tasker go to the group. At the deadline, the group gets SIGTERM.
// Five seconds later, it gets SIGKILL. After such a stop, it waits until the group is gone.
// An abort of signal stops the group in the same way, but it does not set timedOut.
// With stopOnExit, the exit of the leader stops the group in the same way.
// After a stop, when the leader has exited and the group is gone (or the SIGKILL was sent), it closes the pipes
// of the child that are still open, so a process outside the group cannot hold the run open.
export function superviseGroup(child: ChildProcess, pid: number, options: SuperviseOptions): Promise<GroupResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let stopping = false;
    let killed = false;
    let leaderExited = false;
    let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let deadlineTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    let pollTimer: NodeJS.Timeout | undefined;
    const forwarders = FORWARDED_SIGNALS.map((signal) => [signal, () => signalGroup(pid, signal)] as const);
    for (const [signal, handler] of forwarders) process.on(signal, handler);
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(graceTimer);
      clearInterval(pollTimer);
      for (const [signal, handler] of forwarders) process.off(signal, handler);
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
      settle(() => resolve(result));
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
  });
}

// Runs file with args in a new process group and session. stdout and stderr go to outputFd, and stdin is /dev/null.
// The group, the deadline and the signals follow superviseGroup.
export async function runInGroup(
  file: string,
  args: readonly string[],
  options: RunGroupOptions,
): Promise<GroupResult> {
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["ignore", options.outputFd, options.outputFd],
  });
  const pid = child.pid;
  if (pid === undefined) {
    return new Promise((_, reject) => child.once("error", reject)); // no group exists, so no signal and no timer
  }
  return superviseGroup(child, pid, { deadline: options.deadline });
}
