import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";

// Where git runs. cwd: a folder in a work tree, for any command that needs one.
// gitDir: the bare clone that tasker made, and nothing else. Git runs with
// --bare --git-dir and with the git dir as its cwd, so it has no work tree.
// tasker never sets core.worktree or core.bare=false in that clone. A non-bare
// git dir is out of scope: its configuration can give git a work tree.
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
// Git uses a GIT_SSH_COMMAND that is present, even an empty one. So:
// a non-empty GIT_SSH_COMMAND of the caller stays. Otherwise GIT_SSH_COMMAND goes away,
// and a non-empty GIT_SSH of the caller stays. Otherwise GIT_SSH goes away too,
// and ssh runs in batch mode, so it asks no question and fails instead.
// In gitDir mode, GIT_WORK_TREE goes away too: it beats --bare, so it would give a
// bare repo a work tree.
function childEnv(env: NodeJS.ProcessEnv, gitDirMode: boolean): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env, GIT_TERMINAL_PROMPT: "0" };
  if (gitDirMode) {
    delete result.GIT_WORK_TREE;
  }
  if (env.GIT_SSH_COMMAND) {
    return result;
  }
  delete result.GIT_SSH_COMMAND;
  if (env.GIT_SSH) {
    return result;
  }
  delete result.GIT_SSH;
  result.GIT_SSH_COMMAND = BATCH_SSH_COMMAND;
  return result;
}

type Location = { kind: "cwd" | "gitDir"; path: string };

// Runs git with args (the subcommand first) and resolves with its stdout.
// Git starts one time for each call.
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
  const location: Location =
    "gitDir" in options
      ? { kind: "gitDir", path: options.gitDir }
      : { kind: "cwd", path: options.cwd };
  if (!isFolder(location.path)) {
    return Promise.reject(folderError(location));
  }
  if (location.kind === "cwd") {
    return spawnGit([...args], subcommand, location, childEnv(options.env, false));
  }
  return spawnGit(
    ["--bare", "--git-dir", location.path, ...args],
    subcommand,
    location,
    childEnv(options.env, true),
  );
}

// Starts git once and resolves with its stdout. It rejects as runGit() describes.
function spawnGit(
  fullArgs: readonly string[],
  subcommand: string,
  location: Location,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", fullArgs, {
      cwd: location.path,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if ((error.code === "ENOENT" || error.code === "ENOTDIR") && !isFolder(location.path)) {
        // Node reports a missing cwd as ENOENT and a cwd that is a file as ENOTDIR.
        reject(folderError(location));
      } else if (error.code === "ENOENT") {
        reject(new GitNotInstalledError("git is not installed: git was not found on PATH"));
      } else {
        reject(error);
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

function isFolder(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function folderError(location: Location): Error {
  return location.kind === "gitDir"
    ? new Error(`the git dir does not exist: ${location.path}`)
    : new Error(`the working folder does not exist: ${location.path}`);
}
