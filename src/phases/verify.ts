import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { errorMessage } from "../error-message.js";
import type { GroupResult } from "../process/run-group.js";
import {
  type CommandFailure,
  commandFailure,
  commandFailureMessage,
  NO_OUTPUT_LINE,
  readCommandLog,
  runLoggedCommand,
} from "./command-step.js";

export interface VerifyOptions {
  commands: readonly string[];
  // The environment of each command. The caller builds it with childEnv, as for bootstrap.
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs: number;
  // The log path of the command at position (from 1).
  logPath: (position: number) => string;
  // Gets the pid of each command that starts, as for runInGroup.
  onSpawn?: (pid: number) => void;
}

// A failure of a verify command. started is false only when the deadline came before the command,
// so the command never started and has no log. Bootstrap failures never carry the flag.
export type VerifyFailure = CommandFailure & { started?: false };
export type VerifyResult = { status: "ok" } | VerifyFailure;

// Runs the verify commands one at a time under /bin/bash in cwd, with one deadline for the list.
// Each command has its own log, which opens for write. The list stops at the first command that fails.
// A command that would start after the deadline does not start and gets no log. It is the failing command, and the run timed out.
// The phase writes no marker, so each run starts again from the first command.
export async function runVerify(options: VerifyOptions): Promise<VerifyResult> {
  const deadline = Date.now() + options.timeoutMs;
  for (const [i, command] of options.commands.entries()) {
    // A command after the deadline does not start and gets no log, so the last log does not name the failing command.
    if (Date.now() >= deadline) return { status: "failed", index: i + 1, command, timedOut: true, started: false };
    const log = options.logPath(i + 1);
    mkdirSync(dirname(log), { recursive: true });
    let result: GroupResult;
    try {
      result = await runLoggedCommand(command, {
        cwd: options.cwd,
        env: options.env,
        deadline,
        log,
        logFlag: "w",
        onSpawn: options.onSpawn,
      });
    } catch (error) {
      // A command that cannot start is a failure of that command.
      const text = errorMessage(error);
      appendFileSync(log, `--- ${text}\n`);
      return { status: "failed", index: i + 1, command, timedOut: false, error: text };
    }
    const failure = commandFailure(i + 1, command, result);
    if (failure !== undefined) return failure;
  }
  return { status: "ok" };
}

// The commands that started. A failure at index stops the list there, and that command started too,
// unless runVerify marked it with started: false.
export function startedCommands(commands: readonly string[], result: VerifyResult): string[] {
  if (result.status === "ok") return [...commands];
  return commands.slice(0, result.started === false ? result.index - 1 : result.index);
}

// The error of a failed verify run: the message of the failing command, then the tail of its log, then the
// no-output line when the log holds no output.
export function verifyFailureMessage(failure: VerifyFailure, log: string, timeoutMin: number): string {
  const { tail, noOutput } = readCommandLog(log, 20);
  return `${commandFailureMessage("verify", failure, log, timeoutMin)}\n${tail}${noOutput ? `${NO_OUTPUT_LINE}\n` : ""}`.trimEnd();
}
