import { appendFileSync, closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { errnoCode } from "../errno.js";
import { type GroupResult, runInGroup } from "../process/run-group.js";
import { startFolderError } from "../process/start-folder.js";

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
  // Gets the pid of the child, as for runInGroup.
  onSpawn?: (pid: number) => void;
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
// A command that cannot start throws, after the command line is in the log.
export async function runLoggedCommand(command: string, options: LoggedCommandOptions): Promise<GroupResult> {
  const { log } = options;
  appendFileSync(log, `$ ${command}\n`, { flag: options.logFlag });
  const folderError = startFolderError("/bin/bash", options.cwd);
  if (folderError !== undefined) throw new Error(folderError);
  const outputFd = openSync(log, "a");
  let result: GroupResult;
  try {
    result = await runInGroup("/bin/bash", ["-c", command], {
      cwd: options.cwd,
      env: options.env,
      outputFd,
      deadline: options.deadline,
      onSpawn: options.onSpawn,
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

// The message of a failed command of a phase: the phase, the command, the outcome and the log.
export function commandFailureMessage(
  phase: string,
  result: CommandFailure,
  log: string,
  timeoutMin: number,
): string {
  const outcome = result.timedOut
    ? `timed out after ${timeoutMin} min`
    : result.signal === undefined
      ? `exit code ${result.exitCode}`
      : `stopped by signal ${result.signal}`;
  return `${phase} command ${result.index} failed: ${result.command}: ${outcome}. The log is ${log}.`;
}

// The last count lines of the log, with a header that gives the real count. It never throws.
export function commandLogTail(log: string, count: number): string {
  let text: string;
  try {
    text = readFileSync(log, "utf8");
  } catch (error) {
    const code = errnoCode(error);
    return code === "ENOENT" ? `the log is missing: ${log}\n` : `cannot read the log ${log}: ${code}\n`;
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const last = lines.slice(-count);
  return `the last ${last.length} lines of the log:\n${last.map((line) => `${line}\n`).join("")}`;
}
