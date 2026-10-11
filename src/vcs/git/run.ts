import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

// Where git runs. cwd: a folder in a work tree, for any command.
// gitDir: a git dir, for a bare repo or a command that needs no work tree. Git runs
// with the git dir as its cwd and never gets a work tree: a bare git dir runs with
// --bare, and any other git dir runs with --work-tree /dev/null, which beats
// core.worktree. A command that needs a work tree then fails.
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
// Git gets no input stream, and its stdout and stderr go to pipes, not to the terminal.
// Git asks no credential question (GIT_TERMINAL_PROMPT=0), and ssh asks no question
// (BatchMode), unless the caller sets its own ssh command.
// Git stays in the process group of tasker, so a Ctrl-C stops git too.
// With gitDir, git starts twice: first to ask whether the git dir is bare.
export async function runGit(args: readonly string[], options: RunGitOptions): Promise<string> {
  if (args.length === 0) {
    throw new Error("runGit needs a git subcommand");
  }
  const subcommand = args[0];
  if (subcommand.startsWith("-")) {
    throw new Error("runGit needs the git subcommand as the first argument");
  }
  if (!options.env.PATH) {
    throw new GitNotInstalledError("git is not installed: the env has no PATH");
  }
  if ("gitDir" in options && !existsSync(options.gitDir)) {
    throw new Error(`the git dir does not exist: ${options.gitDir}`);
  }
  if ("cwd" in options) {
    const location: Location = { kind: "cwd", path: options.cwd };
    return spawnGit([...args], subcommand, location, childEnv(options.env, false));
  }
  const location: Location = { kind: "gitDir", path: options.gitDir };
  const env = childEnv(options.env, true);
  // A bare git dir keeps its bare behavior. Any other git dir gets /dev/null as its
  // work tree. That beats core.worktree in its configuration, so a command that needs
  // a work tree fails and never touches a folder.
  const bare = await spawnGit(
    ["--bare", "--git-dir", location.path, "rev-parse", "--is-bare-repository"],
    "rev-parse",
    location,
    env,
  ).then(
    (stdout) => stdout === "true\n",
    () => false,
  );
  const prefix = bare
    ? ["--bare", "--git-dir", location.path]
    : ["--git-dir", location.path, "--work-tree", "/dev/null"];
  return spawnGit([...prefix, ...args], subcommand, location, env);
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
      if (error.code !== "ENOENT") {
        reject(error);
      } else if (!existsSync(location.path)) {
        // Node also reports a missing cwd as ENOENT.
        reject(new Error(`the working folder does not exist: ${location.path}`));
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
