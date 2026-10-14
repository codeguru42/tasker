import { existsSync, statSync } from "node:fs";
import { errnoCode } from "../../errno.js";
import { errorMessage } from "../../error-message.js";
import {
  assertPathSet,
  ChildCommandError,
  type ChildResult,
  childFailureMessage,
  CommandNotFoundError,
  runChild,
} from "../../process/run-child.js";

// Where git runs. cwd: a folder in a work tree, for any command that needs one.
// gitDir: the bare clone that tasker made, and nothing else. Git runs with
// --bare --git-dir and with the git dir as its cwd, so it has no work tree.
// tasker never sets core.worktree or core.bare=false in that clone. A non-bare
// git dir is out of scope: its configuration can give git a work tree.
// In both modes, runGit() removes the repo-local git variables of the caller (see
// REPO_LOCAL_GIT_VARS). Apart from the ssh and prompt rules of childEnv(), other
// variables, such as GIT_CONFIG_GLOBAL, reach git unchanged.
export type GitLocation = { cwd: string } | { gitDir: string };
// signal stops git with SIGTERM and rejects with an AbortError. An ssh child of git can keep running.
export type RunGitOptions = GitLocation & { env: NodeJS.ProcessEnv; signal?: AbortSignal };

export class GitError extends ChildCommandError {
  constructor(
    message: string,
    subcommand: string,
    stdout: string,
    stderr: string,
    exitCode: number | null,
  ) {
    super(message, subcommand, stdout, stderr, exitCode);
    this.name = "GitError";
  }
}

// True when error is a GitError that exited with the given code.
export function isGitExit(error: unknown, code: number): error is GitError {
  return error instanceof GitError && error.exitCode === code;
}

export class GitNotInstalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitNotInstalledError";
  }
}

const BATCH_SSH_COMMAND = "ssh -o BatchMode=yes";

// The repo-local git variables. The list is the output of `git rev-parse --local-env-vars`
// (git 2.47.3), plus GIT_NAMESPACE. Each of them can change the repo, the index or the
// object store that git uses, or add configuration for this one run of git.
const REPO_LOCAL_GIT_VARS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
] as const;

// The pairs that GIT_CONFIG_COUNT counts. They go away with it.
const CONFIG_PAIR_VAR = /^GIT_CONFIG_(KEY|VALUE)_\d+$/;

// The env of the child: env, plus GIT_TERMINAL_PROMPT=0, which always wins.
// tasker owns the repo that it uses, so the repo-local git variables of the caller go
// away in both modes (see "How tasker uses git" in docs/dev/version-control.md).
// Apart from the ssh and prompt rules, no other variable is removed or changed.
// For example, GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM name configuration files
// that git reads. They do not choose the repo.
// Git uses a GIT_SSH_COMMAND that is present, even an empty one. So:
// the ssh command is gitSshCommand(env). When it is undefined, the GIT_SSH_COMMAND
// (an empty value) goes away, and the GIT_SSH of the caller stays. Otherwise GIT_SSH
// goes away, and GIT_SSH_COMMAND is set to the command. The command is the one of the
// caller, or ssh in batch mode, which asks no question and fails instead.
function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env, GIT_TERMINAL_PROMPT: "0" };
  for (const name of REPO_LOCAL_GIT_VARS) {
    delete result[name];
  }
  for (const name of Object.keys(result)) {
    if (CONFIG_PAIR_VAR.test(name)) {
      delete result[name];
    }
  }
  const command = gitSshCommand(env);
  if (command === undefined) {
    delete result.GIT_SSH_COMMAND; // an empty value; the GIT_SSH of the caller stays
    return result;
  }
  delete result.GIT_SSH;
  result.GIT_SSH_COMMAND = command;
  return result;
}

// The ssh command that git runs for env: a non-empty GIT_SSH_COMMAND of the caller,
// else undefined when a non-empty GIT_SSH of the caller stays, else the batch ssh command.
export function gitSshCommand(env: NodeJS.ProcessEnv): string | undefined {
  if (env.GIT_SSH_COMMAND) {
    return env.GIT_SSH_COMMAND;
  }
  return env.GIT_SSH ? undefined : BATCH_SSH_COMMAND;
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
  try {
    assertPathSet("git", options.env);
  } catch (error) {
    return Promise.reject(new GitNotInstalledError(errorMessage(error)));
  }
  const location: Location =
    "gitDir" in options
      ? { kind: "gitDir", path: options.gitDir }
      : { kind: "cwd", path: options.cwd };
  if (!isFolder(location.path)) {
    return Promise.reject(folderError(location));
  }
  if (location.kind === "cwd") {
    return spawnGit([...args], subcommand, location, childEnv(options.env), options.signal);
  }
  return spawnGit(
    ["--bare", "--git-dir", location.path, ...args],
    subcommand,
    location,
    childEnv(options.env),
    options.signal,
  );
}

// Starts git once and resolves with its stdout. It rejects as runGit() describes.
async function spawnGit(
  fullArgs: readonly string[],
  subcommand: string,
  location: Location,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
): Promise<string> {
  let result: ChildResult;
  try {
    result = await runChild("git", fullArgs, { cwd: location.path, env, signal });
  } catch (error) {
    const notFound = error instanceof CommandNotFoundError;
    if ((notFound || errnoCode(error) === "ENOTDIR") && !isFolder(location.path)) {
      // Node reports a missing cwd as ENOENT and a cwd that is a file as ENOTDIR.
      throw folderError(location);
    }
    if (notFound) {
      throw new GitNotInstalledError(error.message);
    }
    throw error; // An AbortError and every other error pass through.
  }
  const { code, signal: stopSignal, stdout, stderr } = result;
  if (code === 0) {
    return stdout;
  }
  throw new GitError(childFailureMessage("git", subcommand, code, stopSignal, stderr), subcommand, stdout, stderr, code);
}

function isFolder(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function folderError(location: Location): Error {
  return location.kind === "gitDir"
    ? new Error(`the git dir does not exist: ${location.path}`)
    : new Error(`the working folder does not exist: ${location.path}`);
}
