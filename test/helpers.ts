import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Io, RegisterCommand } from "../src/cli.js";
import { provisionClone } from "../src/vcs/git/provision.js";
import { GitError, runGit } from "../src/vcs/git/run.js";
import { shellQuote } from "../src/vcs/git/ssh.js";

export interface CapturedIo extends Io {
  out: string[];
  err: string[];
}

export function captureIo(): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
}

export const greet: RegisterCommand = (program) => {
  program
    .command("greet")
    .description("Say hello")
    .option("--name <name>", "Who to greet");
};

// A new object for each call, so a test can change it freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validConfig(): Record<string, any> {
  return {
    dataRoot: "/data/tasker",
    limits: { bootstrapTimeoutMin: 10, verifyTimeoutMin: 20 },
    repos: {
      tasker: {
        remote: "git@github.com:codeguru42/tasker.git",
        issueTracker: { provider: "github", account: "codeguru42" },
        assistant: {
          provider: "claude-code",
          models: {
            plan: { model: "opus", effort: "high" },
            execute: { model: "sonnet", effort: "medium" },
            review: { model: "opus", effort: "high" },
          },
        },
        verify: { commands: ["npm run check"] },
      },
    },
  };
}

// A new empty folder under the system temp folder. The caller removes it.
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// The error that promise rejects with. It throws, so the test fails, when promise resolves
// or when the error is not an instance of type.
export async function failureOf<E extends Error>(
  promise: Promise<unknown>,
  type: abstract new (...args: never[]) => E,
): Promise<E> {
  const outcome = await promise.then(
    () => ({ rejected: false as const }),
    (error: unknown) => ({ rejected: true as const, error }),
  );
  if (!outcome.rejected) {
    throw new Error("the promise resolved, but the test needs a rejection");
  }
  if (!(outcome.error instanceof type)) {
    throw new Error(`the promise rejected with ${String(outcome.error)}, not a ${type.name}`);
  }
  return outcome.error;
}

// The names of the tables in db, in alphabetical order.
export function tableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

// The repo root, for spawn tests that need it as cwd.
export const repoRoot = new URL("..", import.meta.url);

// Writes raw as JSON to config.json in a new temp dir. The caller removes dir.
export function writeTempConfig(raw: unknown): { dir: string; path: string } {
  const dir = makeTempDir("tasker-config-");
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(raw));
  return { dir, path };
}

// The fixed author and committer of every commit that a git test makes.
export const GIT_TEST_IDENTITY = { name: "Tasker Test", email: "tasker-test@example.com" };

// The env for a git child process. home is a temp folder that stands in for $HOME.
// It reads no git configuration of the host and sets GIT_TERMINAL_PROMPT=0.
export function gitTestEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: GIT_TEST_IDENTITY.name,
    GIT_COMMITTER_NAME: GIT_TEST_IDENTITY.name,
    GIT_AUTHOR_EMAIL: GIT_TEST_IDENTITY.email,
    GIT_COMMITTER_EMAIL: GIT_TEST_IDENTITY.email,
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export interface GitOrigin {
  // The temp folder that holds everything. remove() deletes it.
  dir: string;
  // The bare origin repo. Use it as the remote URL.
  path: string;
  env: NodeJS.ProcessEnv;
  // Adds one commit to branch and returns the new commit SHA.
  addCommit(
    branch: string,
    change?: { file?: string; content?: string; message?: string },
  ): Promise<string>;
  // Makes branch name at the head of from (default "main").
  createBranch(name: string, from?: string): Promise<void>;
  // The head SHA of branch, or undefined when the branch is missing.
  branchHead(branch: string): Promise<string | undefined>;
  remove(): void;
}

// Git reads a name that starts with "-" as an option.
function assertBranchName(name: string): void {
  if (name.startsWith("-")) {
    throw new Error(`the branch name must not start with -: ${name}`);
  }
}

// Writes content to target, then commits all changes in folder with message and the extra
// commit arguments. It returns the new SHA.
async function writeAndCommit(
  folder: string,
  env: NodeJS.ProcessEnv,
  target: string,
  content: string,
  message: string,
  commitArgs: readonly string[],
): Promise<string> {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  await runGit(["add", "-A"], { cwd: folder, env });
  await runGit(["commit", ...commitArgs, "-m", message], { cwd: folder, env });
  return (await runGit(["rev-parse", "HEAD"], { cwd: folder, env })).trim();
}

// True when path is folder or inside it.
export function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder + sep);
}

// The absolute path of file in work. It throws with refusal as the text before the file
// when the path is not inside work.
function resolveInside(work: string, file: string, refusal: string): string {
  const target = resolve(work, file);
  const rel = relative(work, target);
  if (
    isAbsolute(file) ||
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    rel.split(sep)[0] === ".git"
  ) {
    throw new Error(`${refusal}: ${file}`);
  }
  return target;
}

// A real local bare origin repo with one commit on main. No test needs the network.
// A private scratch repo, "work", makes the commits and pushes them by local path.
export async function makeGitOrigin(): Promise<GitOrigin> {
  const dir = makeTempDir("tasker-git-");
  const home = join(dir, "home");
  mkdirSync(home);
  const env = gitTestEnv(home);
  const path = join(dir, "origin.git");
  const work = join(dir, "work");

  await runGit(["init", "--bare", "--initial-branch=main", "origin.git"], { cwd: dir, env });
  await runGit(["init", "--initial-branch=main", "work"], { cwd: dir, env });
  await runGit(["remote", "add", "origin", path], { cwd: work, env });
  writeFileSync(join(work, "README.md"), "initial commit\n");
  await runGit(["add", "-A"], { cwd: work, env });
  await runGit(["commit", "-m", "initial commit"], { cwd: work, env });
  await runGit(["push", "origin", "main"], { cwd: work, env });

  let counter = 0;

  return {
    dir,
    path,
    env,
    async addCommit(branch, change = {}) {
      assertBranchName(branch);
      counter += 1;
      const message = change.message ?? `commit ${counter}`;
      const target = resolveInside(
        work,
        change.file ?? `file-${counter}.txt`,
        "addCommit needs a file inside the work repo",
      );
      await runGit(["fetch", "origin"], { cwd: work, env });
      await runGit(["checkout", "-B", branch, `origin/${branch}`], { cwd: work, env });
      const sha = await writeAndCommit(work, env, target, change.content ?? message, message, [
        "--allow-empty",
      ]);
      await runGit(["push", "origin", `HEAD:refs/heads/${branch}`], { cwd: work, env });
      return sha;
    },
    async createBranch(name, from = "main") {
      assertBranchName(name);
      assertBranchName(from);
      await runGit(["branch", name, from], { gitDir: path, env });
    },
    async branchHead(branch) {
      assertBranchName(branch);
      try {
        const out = await runGit(
          ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`],
          { gitDir: path, env },
        );
        return out.trim();
      } catch (error) {
        if (error instanceof GitError && error.exitCode === 1 && error.stdout === "") {
          return undefined;
        }
        throw error;
      }
    },
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let cloneCommitCount = 0;

// Adds one commit to refs/heads/<branch> of the bare clone and returns the new SHA.
// The parent is parent, or the tip of the branch, or refs/remotes/origin/main when the branch is new.
export async function addCloneCommit(
  clone: string,
  env: NodeJS.ProcessEnv,
  branch: string,
  parent?: string,
): Promise<string> {
  for (const name of [branch, parent]) {
    if (name?.startsWith("-")) {
      throw new Error(`a name must not start with "-": ${JSON.stringify(name)}`);
    }
  }
  const git = (...args: string[]) =>
    runGit(args, { gitDir: clone, env }).then((out) => out.trim());
  const ref = `refs/heads/${branch}`;
  const base =
    parent ??
    (await git("rev-parse", "--verify", "--quiet", ref).then(
      () => ref,
      () => "refs/remotes/origin/main",
    ));
  const parentSha = await git("rev-parse", "--verify", `${base}^{commit}`);
  const tree = await git("rev-parse", `${base}^{tree}`);
  cloneCommitCount += 1;
  const sha = await git("commit-tree", tree, "-p", parentSha, "-m", `clone commit ${cloneCommitCount}`);
  await git("update-ref", ref, sha);
  return sha;
}

let worktreeCommitCount = 0;

// Writes content to file in the worktree, then commits all changes there with message.
// It returns the new SHA. It throws for a file outside the worktree.
export async function commitInWorktree(
  worktree: string,
  env: NodeJS.ProcessEnv,
  change: { file: string; content?: string; message?: string },
): Promise<string> {
  const target = resolveInside(
    worktree,
    change.file,
    "commitInWorktree needs a file inside the worktree",
  );
  worktreeCommitCount += 1;
  const message = change.message ?? `worktree commit ${worktreeCommitCount}`;
  return writeAndCommit(worktree, env, target, change.content ?? message, message, []);
}

// Names that pass the syntax check of a task branch but not the shape check.
export const NOT_TASK_BRANCHES = [
  "main",
  "master",
  "feature-x",
  "issue-0-x",
  "issue-x",
  "issue-17-Fix",
  "proj-12-x",
  "PROJ-012-x",
  "release-1.2",
];

// The text that the pre-push hook prints for a push with no valid publish token.
export const NO_TOKEN = "tasker: the push has no valid publish token";

// The folder of the publish tokens of the clone that makeGitClone() makes.
export function gitCloneTokens(origin: GitOrigin): string {
  return join(origin.dir, "clone", "publish-tokens");
}

// A bare clone of origin, made by provisionClone(). origin.remove() deletes it.
export async function makeGitClone(origin: GitOrigin): Promise<string> {
  const clone = join(origin.dir, "clone", "repo.git");
  await provisionClone({
    remote: origin.path,
    clone,
    config: {},
    env: origin.env,
    publishTokens: gitCloneTokens(origin),
  });
  return clone;
}

// Writes an executable shell script named git into binDir. body is the script after "#!/bin/sh".
// Use binDir as the only PATH folder, so runGit() starts this script, not the real git.
export function writeFakeGit(binDir: string, body: string): void {
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "git"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

// The shell line that appends one call to the log: the argument count, then each argument.
// Each item ends with a NUL, so an argument can hold a newline.
function logLine(logPath: string): string {
  return `printf '%s\\0' "$#" "$@" >> ${shellQuote(logPath)}`;
}

// Writes an executable ssh into binDir. Each call goes in the log at logPath (see readArgLog()).
// "serve" runs the last argument in a shell, so the real git-upload-pack on PATH serves a local origin.
// "refuse" prints what ssh prints for a missing key file at $2, then exits with 255.
// Use the remote ssh://tasker.invalid<origin.path> and PATH=<binDir>:<process.env.PATH>.
export function writeFakeSsh(binDir: string, logPath: string, mode: "serve" | "refuse"): void {
  mkdirSync(binDir, { recursive: true });
  const body =
    mode === "serve"
      ? [logLine(logPath), "for last; do :; done", 'exec sh -c "$last"']
      : [
          logLine(logPath),
          `home=${shellQuote(userInfo().homedir)}`,
          'case "$2" in',
          '  "~/"*) key="$home${2#"~"}" ;;',
          '  *) key="$2" ;;',
          "esac",
          'printf \'Warning: Identity file %s not accessible: No such file or directory.\\n\' "$key" >&2',
          "echo 'Permission denied (publickey).' >&2",
          "exit 255",
        ];
  writeFileSync(join(binDir, "ssh"), `#!/bin/sh\n${body.join("\n")}\n`, { mode: 0o755 });
}

export interface FakeSsh {
  // baseEnv with PATH=<dir>/bin<delimiter><process.env.PATH>, so git starts the fake ssh.
  env: NodeJS.ProcessEnv;
  // The log of the fake ssh. readArgLog() reads it.
  logPath: string;
  // The ssh remote for a repo path: ssh://tasker.invalid<path>.
  remote(path: string): string;
}

// Writes a fake ssh into <dir>/bin with writeFakeSsh(), with the log <dir>/ssh.log.
// A second call with the same dir replaces the script and keeps the log.
export function fakeSsh(
  dir: string,
  baseEnv: NodeJS.ProcessEnv,
  mode: "serve" | "refuse",
): FakeSsh {
  const binDir = join(dir, "bin");
  const logPath = join(dir, "ssh.log");
  writeFakeSsh(binDir, logPath, mode);
  return {
    env: { ...baseEnv, PATH: `${binDir}${delimiter}${process.env.PATH}` },
    logPath,
    remote: (path) => `ssh://tasker.invalid${path}`,
  };
}

// The first six arguments that git passes to ssh for sshCommand(key).
export function sshKeyArgs(key: string): string[] {
  return ["-i", key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes"];
}

// The first git file on process.env.PATH.
function realGitPath(): string {
  for (const folder of (process.env.PATH ?? "").split(delimiter)) {
    if (folder === "") continue;
    const candidate = join(folder, "git");
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {
      // Not here. Try the next folder.
    }
  }
  throw new Error("no git found on PATH");
}

// Writes a git wrapper into binDir. It logs each call (see readArgLog()), then runs the real git.
// The real git is the first git file on process.env.PATH.
export function writeGitRecorder(binDir: string, logPath: string): void {
  writeFakeGit(binDir, `${logLine(logPath)}\nexec ${shellQuote(realGitPath())} "$@"`);
}

// Writes a git wrapper into binDir. It runs the real git with the same arguments. Then it exits
// with 1 when the first argument is subcommand, and else with the exit code of the real git.
// The real step finishes first, so a test sees a step that fails after it changed the worktree.
export function writeGitFailAfter(binDir: string, subcommand: string): void {
  writeFakeGit(
    binDir,
    `${shellQuote(realGitPath())} "$@"\ncode=$?\nif [ "$1" = ${shellQuote(subcommand)} ]; then exit 1; fi\nexit $code`,
  );
}

// Reads a log of writeFakeSsh() or writeGitRecorder(). It returns one argument list for each call.
// A missing log gives no calls.
export function readArgLog(logPath: string): string[][] {
  let text: string;
  try {
    text = readFileSync(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const items = text.split("\0");
  items.pop(); // The text after the last NUL is empty.
  const calls: string[][] = [];
  let index = 0;
  while (index < items.length) {
    const count = Number(items[index]);
    calls.push(items.slice(index + 1, index + 1 + count));
    index += 1 + count;
  }
  return calls;
}
