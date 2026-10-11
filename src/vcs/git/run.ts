import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export type GitLocation = { cwd: string } | { gitDir: string };
export type RunGitOptions = GitLocation & { env: NodeJS.ProcessEnv };

export class GitError extends Error {
  readonly subcommand: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(
    message: string,
    subcommand: string,
    stdout: string,
    stderr: string,
    exitCode: number | null,
  ) {
    super(message);
    this.name = "GitError";
    this.subcommand = subcommand;
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export class GitNotInstalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitNotInstalledError";
  }
}

const BATCH_SSH_COMMAND = "ssh -o BatchMode=yes";

// The env of the child: env, plus GIT_TERMINAL_PROMPT=0, which always wins.
// If the caller sets no ssh command (GIT_SSH_COMMAND and GIT_SSH missing or empty),
// ssh runs in batch mode, so it asks no question and fails instead.
function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env, GIT_TERMINAL_PROMPT: "0" };
  if (!env.GIT_SSH_COMMAND && !env.GIT_SSH) {
    result.GIT_SSH_COMMAND = BATCH_SSH_COMMAND;
  }
  return result;
}

// Runs git with args (the subcommand first) and resolves with its stdout.
// Git gets no input stream, and its stdout and stderr go to pipes, not to the terminal.
// Git asks no credential question (GIT_TERMINAL_PROMPT=0), and ssh asks no question
// (BatchMode), unless the caller sets its own ssh command.
// Git stays in the process group of tasker, so a Ctrl-C stops git too.
export function runGit(args: readonly string[], options: RunGitOptions): Promise<string> {
  if (args.length === 0) {
    return Promise.reject(new Error("runGit needs a git subcommand"));
  }
  const subcommand = args[0];
  if (subcommand.startsWith("-")) {
    return Promise.reject(new Error("runGit needs the git subcommand as the first argument"));
  }
  if (!options.env.PATH) {
    return Promise.reject(new GitNotInstalledError("git is not installed: the env has no PATH"));
  }
  const fullArgs = "gitDir" in options ? ["--git-dir", options.gitDir, ...args] : [...args];
  const cwd = "cwd" in options ? options.cwd : undefined;

  return new Promise((resolve, reject) => {
    const child = spawn("git", fullArgs, {
      cwd,
      env: childEnv(options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        reject(error);
      } else if (cwd !== undefined && !existsSync(cwd)) {
        // Node also reports a missing cwd as ENOENT.
        reject(new Error(`the working folder does not exist: ${cwd}`));
      } else {
        reject(new GitNotInstalledError("git is not installed: git was not found on PATH"));
      }
    });
    child.on("close", (code, signal) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (code === 0) {
        resolve(stdout);
        return;
      }
      if (code === null) {
        reject(
          new GitError(
            `git ${subcommand} was stopped by signal ${signal}`,
            subcommand,
            stdout,
            stderr,
            null,
          ),
        );
        return;
      }
      const detail = stderr.trim();
      const reason = detail === "" ? "" : `: ${detail}`;
      reject(
        new GitError(
          `git ${subcommand} failed with exit code ${code}${reason}`,
          subcommand,
          stdout,
          stderr,
          code,
        ),
      );
    });
  });
}
