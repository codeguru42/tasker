import { spawn } from "node:child_process";
import { detailSuffix } from "../detail-suffix.js";

export interface RunChildOptions {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

// What the child gave when it closed. code is null when a signal stopped it.
export interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

// The command cannot start: the env has no PATH, or the command is not on the PATH of env.
export class CommandNotFoundError extends Error {
  readonly command: string;
  readonly reason: "no-path" | "not-on-path";

  constructor(command: string, reason: "no-path" | "not-on-path") {
    super(
      reason === "no-path"
        ? `${command} is not installed: the env has no PATH`
        : `${command} is not installed: ${command} was not found on PATH`,
    );
    this.name = "CommandNotFoundError";
    this.command = command;
    this.reason = reason;
  }
}

// Throws CommandNotFoundError ("no-path") when env has no PATH or an empty one.
// runChild() calls it first. A runner that must check PATH before its own checks calls it too.
export function assertPathSet(command: string, env: NodeJS.ProcessEnv): void {
  if (!env.PATH) throw new CommandNotFoundError(command, "no-path");
}

// Starts command once with args and resolves when the child closes, for every exit code
// and for a stop by a signal. The caller decides what a code other than 0 means.
//
// It calls assertPathSet() first and rejects before the child starts. As a result, Node never
// uses the PATH of tasker. It passes env as it is and does not add process.env. The child gets
// no input stream. Its stdout and stderr go to pipes, never to the terminal. The child stays in
// the process group of tasker. It decodes the output as UTF-8 when the child closes.
//
// On an AbortError, it destroys the two pipes of the child and rejects with the abort error,
// because a grandchild can hold the pipes open. ENOENT rejects with CommandNotFoundError
// ("not-on-path"). Node also reports a missing cwd as ENOENT, so a caller that passes a cwd must
// check the folder. Any other error, ENOTDIR included, passes through as it is.
export function runChild(command: string, args: readonly string[], options: RunChildOptions): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    try {
      assertPathSet(command, options.env);
    } catch (error) {
      reject(error);
      return;
    }
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.name === "AbortError") {
        child.stdout.destroy();
        child.stderr.destroy();
        reject(error);
      } else if (error.code === "ENOENT") {
        reject(new CommandNotFoundError(command, "not-on-path"));
      } else {
        reject(error);
      }
    });
    child.on("close", (code, signal) => {
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

// The error of a child command that stopped with a failure. A tool, such as git, extends it and sets its own name.
export class ChildCommandError extends Error {
  readonly subcommand: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(message: string, subcommand: string, stdout: string, stderr: string, exitCode: number | null) {
    super(message);
    this.subcommand = subcommand;
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

// The message for a child that did not exit with code 0. code is null when a signal stopped it.
export function childFailureMessage(
  tool: string,
  subcommand: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
): string {
  if (code === null) return `${tool} ${subcommand} was stopped by signal ${signal}`;
  return `${tool} ${subcommand} failed with exit code ${code}${detailSuffix(stderr.trim())}`;
}
