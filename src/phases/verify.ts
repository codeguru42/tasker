import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { childEnv } from "../process/child-env.js";
import { type CommandFailure, commandFailure, runLoggedCommand } from "./command-step.js";

export interface VerifyOptions {
  commands: readonly string[];
  env: NodeJS.ProcessEnv;
  // The names of env that a command gets, besides the allowed names.
  envNames: readonly string[];
  cwd: string;
  timeoutMs: number;
  // The log path of the command at position (from 1).
  logPath: (position: number) => string;
}

export type VerifyResult = { status: "ok" } | CommandFailure;

// Runs the verify commands one at a time under /bin/bash in cwd, with one deadline for the list.
// Each command has its own log, which opens for write. The list stops at the first command that fails.
// The phase writes no marker, so each run starts again from the first command.
export async function runVerify(options: VerifyOptions): Promise<VerifyResult> {
  const env = childEnv(options.env, options.envNames);
  const deadline = Date.now() + options.timeoutMs;
  for (const [i, command] of options.commands.entries()) {
    const log = options.logPath(i + 1);
    mkdirSync(dirname(log), { recursive: true });
    const result = await runLoggedCommand(command, { cwd: options.cwd, env, deadline, log, logFlag: "w" });
    const failure = commandFailure(i + 1, command, result);
    if (failure !== undefined) return failure;
  }
  return { status: "ok" };
}
