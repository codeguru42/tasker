import { appendFileSync, closeSync, openSync, readSync, statSync } from "node:fs";
import { type GroupResult, runInGroup } from "../process/run-group.js";

export interface CommandFailure {
  status: "failed";
  index: number;
  command: string;
  exitCode?: number;
  signal?: NodeJS.Signals;
  timedOut: boolean;
  error?: string;
}

export interface LoggedCommandOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  deadline: number;
  log: string;
  // "a" appends the header to a log that exists. "w" starts the log new.
  logFlag: "a" | "w";
}

// True when the file is empty or its last byte is a newline.
function endsWithNewline(path: string): boolean {
  const size = statSync(path).size;
  if (size === 0) return true;
  const fd = openSync(path, "r");
  try {
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] === 0x0a;
  } finally {
    closeSync(fd);
  }
}

function outcomeLine(result: GroupResult): string {
  if (result.timedOut) return `--- timed out: sent SIGTERM${result.killed ? ", then SIGKILL" : ""}`;
  if (result.signal !== null) return `--- signal ${result.signal}`;
  return `--- exit code ${result.code}`;
}

// Runs one command under /bin/bash in cwd until the deadline. The log gets the command line,
// the output of the command and the outcome line, in this order.
export async function runLoggedCommand(command: string, options: LoggedCommandOptions): Promise<GroupResult> {
  const { log } = options;
  appendFileSync(log, `$ ${command}\n`, { flag: options.logFlag });
  const outputFd = openSync(log, "a");
  let result: GroupResult;
  try {
    result = await runInGroup("/bin/bash", ["-c", command], {
      cwd: options.cwd,
      env: options.env,
      outputFd,
      deadline: options.deadline,
    });
  } finally {
    closeSync(outputFd);
  }
  if (!endsWithNewline(log)) appendFileSync(log, "\n");
  appendFileSync(log, `${outcomeLine(result)}\n`);
  return result;
}

// Gives the failure of a command that timed out or did not exit with 0, else undefined.
export function commandFailure(index: number, command: string, result: GroupResult): CommandFailure | undefined {
  if (!result.timedOut && result.code === 0) return undefined;
  return {
    status: "failed",
    index,
    command,
    ...(result.code !== null && { exitCode: result.code }),
    ...(result.signal !== null && { signal: result.signal }),
    timedOut: result.timedOut,
  };
}
