import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CommandFailure, commandFailure, runLoggedCommand } from "./command-step.js";

export function bootstrapLogPath(logsDir: string): string {
  return join(logsDir, "bootstrap.log");
}

export function bootstrapMarkerPath(logsDir: string): string {
  return join(logsDir, "bootstrap.complete");
}

export type BootstrapResult = { status: "ok" } | { status: "skipped" } | CommandFailure;

export interface BootstrapOptions {
  commands: readonly string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs: number;
  logsDir: string;
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
    const result = await runLoggedCommand(command, {
      cwd: options.cwd,
      env: options.env,
      deadline,
      log,
      logFlag: "a",
    });
    const failure = commandFailure(i + 1, command, result);
    if (failure !== undefined) return failure;
  }
  writeMarker(marker);
  return { status: "ok" };
}
