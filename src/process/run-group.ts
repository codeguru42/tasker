import { spawn } from "node:child_process";

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

// Runs file with args in a new process group and session. stdout and stderr go to outputFd, and stdin is /dev/null.
export function runInGroup(
  file: string,
  args: readonly string[],
  options: RunGroupOptions,
): Promise<GroupResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", options.outputFd, options.outputFd],
    });
    child.once("error", reject);
    if (child.pid === undefined) return; // no group exists, so the error event rejects
    child.once("exit", (code, signal) => resolve({ code, signal, timedOut: false, killed: false }));
  });
}
