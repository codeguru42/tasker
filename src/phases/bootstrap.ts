import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type GroupResult, runInGroup } from "../process/run-group.js";

export function bootstrapLogPath(logsDir: string): string {
  return join(logsDir, "bootstrap.log");
}

export function bootstrapMarkerPath(logsDir: string): string {
  return join(logsDir, "bootstrap.complete");
}

export type BootstrapResult =
  | { status: "ok" }
  | { status: "skipped" }
  | {
      status: "failed";
      index: number;
      command: string;
      exitCode?: number;
      signal?: NodeJS.Signals;
      timedOut: boolean;
    };

export interface BootstrapOptions {
  commands: readonly string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs: number;
  logsDir: string;
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

// The marker holds the time of the finished run.
function writeMarker(marker: string): void {
  writeFileSync(marker, `${new Date().toISOString()}\n`);
}

// Runs the bootstrap commands one at a time under /bin/bash in cwd, with one deadline for the list.
// The output and the outcome of each command go to the log. The marker records a finished run.
export async function runBootstrap(options: BootstrapOptions): Promise<BootstrapResult> {
  const log = bootstrapLogPath(options.logsDir);
  const marker = bootstrapMarkerPath(options.logsDir);
  if (existsSync(marker)) return { status: "skipped" };
  mkdirSync(options.logsDir, { recursive: true });
  appendFileSync(log, `=== bootstrap run ${new Date().toISOString()} ===\n`);
  if (options.commands.length === 0) {
    appendFileSync(log, "the repo has no bootstrap commands\n");
    writeMarker(marker);
    return { status: "ok" };
  }
  const deadline = Date.now() + options.timeoutMs;
  for (const [i, command] of options.commands.entries()) {
    appendFileSync(log, `$ ${command}\n`);
    const outputFd = openSync(log, "a");
    let result;
    try {
      result = await runInGroup("/bin/bash", ["-c", command], {
        cwd: options.cwd,
        env: options.env,
        outputFd,
        deadline,
      });
    } finally {
      closeSync(outputFd);
    }
    if (!endsWithNewline(log)) appendFileSync(log, "\n");
    appendFileSync(log, `${outcomeLine(result)}\n`);
    if (result.timedOut || result.code !== 0) {
      return {
        status: "failed",
        index: i + 1,
        command,
        ...(result.code !== null && { exitCode: result.code }),
        ...(result.signal !== null && { signal: result.signal }),
        timedOut: result.timedOut,
      };
    }
  }
  writeMarker(marker);
  return { status: "ok" };
}
