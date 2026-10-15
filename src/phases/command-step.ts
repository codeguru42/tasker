import { appendFileSync, closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { type GroupResult, runInGroup } from "../process/run-group.js";
import { readTextFile } from "../read-text-file.js";
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
  const outcome =
    result.error !== undefined
      ? `could not start: ${result.error}`
      : result.timedOut
        ? `timed out after ${timeoutMin} min`
        : result.signal === undefined
          ? `exit code ${result.exitCode}`
          : `stopped by signal ${result.signal}`;
  return `${phase} command ${result.index} failed: ${result.command}: ${outcome}. The log is ${log}.`;
}

export const NO_OUTPUT_LINE =
  "The command produced no output. It usually failed before it reached the tool that it runs.";

// The lines of a text, split on a line end, with no empty last item.
export function textLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// Each line followed by a line end, joined.
export function withLineEnds(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

// Reads the log of a failed command one time. tail is the text of the last count lines, with a header that gives
// the real count. noOutput is true when the log holds only the command line, empty lines and the outcome line.
// A missing or unreadable log gives its tail text and noOutput false. It never throws.
export function readCommandLog(log: string, count: number): { tail: string; noOutput: boolean } {
  const file = readTextFile(log);
  if (file.text === undefined) {
    const tail = file.missing ? `the log is missing: ${log}\n` : `cannot read the log ${log}: ${file.error}\n`;
    return { tail, noOutput: false };
  }
  const lines = textLines(file.text);
  const last = lines.slice(-count);
  const tail = `the last ${last.length} lines of the log:\n${withLineEnds(last)}`;
  const rest = lines.slice(1);
  if (rest.at(-1)?.startsWith("--- ")) rest.pop();
  return { tail, noOutput: rest.every((line) => line === "") };
}

// The last maxLines lines of the log at path, each followed by a line end, from the last maxBytes bytes of the file.
// It reads a byte window and not the whole file, so it does not use readTextFile. A window that starts inside a line
// drops the partial first line, and a window that starts inside a character starts at the next whole character.
// A missing or unreadable file gives null. It never throws.
export function readLogTail(path: string, maxLines: number, maxBytes: number): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    // The extra first byte shows whether start is at a line start.
    const from = start > 0 ? start - 1 : 0;
    const buffer = Buffer.alloc(size - from);
    let filled = 0;
    while (filled < buffer.length) {
      const count = readSync(fd, buffer, filled, buffer.length - filled, from + filled);
      if (count === 0) break;
      filled += count;
    }
    const bytes = buffer.subarray(0, filled);
    let begin = 0;
    if (start > 0) {
      const lineEnd = bytes.indexOf(0x0a);
      if (lineEnd >= 0 && lineEnd < bytes.length - 1) {
        begin = lineEnd + 1;
      } else {
        // One line is longer than the window. Skip the continuation bytes of a character that the window cuts.
        begin = 1;
        while (begin < bytes.length && (bytes[begin]! & 0xc0) === 0x80) begin++;
      }
    }
    return withLineEnds(textLines(bytes.subarray(begin).toString("utf8")).slice(-maxLines));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
