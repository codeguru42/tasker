import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished } from "vitest";
import type { Io, RegisterCommand } from "../src/cli.js";
import { provisionClone } from "../src/vcs/git/provision.js";
import { GitError, runGit } from "../src/vcs/git/run.js";
import { shellQuote } from "../src/vcs/git/ssh.js";
import type { VcsContext } from "../src/vcs/provider.js";

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

// A local git origin, and the provider context of the repo "tasker" with a data root in origin.dir.
// remove() deletes everything.
export interface ProviderFixture {
  origin: GitOrigin;
  context: VcsContext;
  remove(): void;
}

export async function makeProviderFixture(): Promise<ProviderFixture> {
  const origin = await makeGitOrigin();
  const context: VcsContext = {
    dataRoot: join(origin.dir, "data"),
    repoKey: "tasker",
    env: origin.env,
  };
  return { origin, context, remove: () => origin.remove() };
}

// The full names of the local branches of the bare clone, from git for-each-ref refs/heads/.
export async function localBranches(clone: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const out = await runGit(["for-each-ref", "--format=%(refname)", "refs/heads/"], {
    gitDir: clone,
    env,
  });
  return out.split("\n").filter((line) => line !== "");
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
  writeFakeCommand(binDir, "git", body);
}

// Writes an executable shell script named name into binDir. body is the script after "#!/bin/sh".
export function writeFakeCommand(binDir: string, name: string, body: string): void {
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

// The shell line that appends one call to the log: the argument count, then each argument.
// Each item ends with a NUL, so an argument can hold a newline.
// Each item of extra (a piece of shell code) goes in the log before the arguments and counts in the argument count.
function logLine(logPath: string, extra: readonly string[] = []): string {
  const count = extra.length === 0 ? '"$#"' : `"$(($# + ${extra.length}))"`;
  return `printf '%s\\0' ${[count, ...extra].join(" ")} "$@" >> ${shellQuote(logPath)}`;
}

// How a fake ssh behaves (see writeFakeSsh()).
export type FakeSshMode =
  | "serve"
  | "refuse"
  | "hang"
  | { greet: string; repo: "serve" | "missing" };

// Writes an executable ssh into binDir. Each call goes in the log at logPath (see readArgLog()).
// "serve" runs the last argument in a shell, so the real git-upload-pack on PATH serves a local origin.
// "refuse" prints what ssh prints for a missing key file at $2, then exits with 255.
// "hang" runs sleep 5 after it writes the log.
// { greet, repo } acts like GitHub. When the last argument starts with "git-", it serves the repo
// ("serve"), or it prints "ERROR: Repository not found." and exits with 1 ("missing").
// Else it prints the greeting for the account greet to stderr and exits with 1.
// Use the remote ssh://tasker.invalid<origin.path> and PATH=<binDir>:<process.env.PATH>.
export function writeFakeSsh(binDir: string, logPath: string, mode: FakeSshMode): void {
  let body: string[];
  if (mode === "serve") {
    body = [logLine(logPath), "for last; do :; done", 'exec sh -c "$last"'];
  } else if (mode === "hang") {
    body = [logLine(logPath), "exec sleep 5"];
  } else if (mode === "refuse") {
    body = [
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
  } else {
    const greeting = `Hi ${mode.greet}! You've successfully authenticated, but GitHub does not provide shell access.`;
    body = [
      logLine(logPath),
      "for last; do :; done",
      'case "$last" in',
      "  git-*)",
      ...(mode.repo === "serve"
        ? ['    exec sh -c "$last" ;;']
        : ["    echo 'ERROR: Repository not found.' >&2", "    exit 1 ;;"]),
      "  *)",
      `    echo ${shellQuote(greeting)} >&2`,
      "    exit 1 ;;",
      "esac",
    ];
  }
  writeFakeCommand(binDir, "ssh", body.join("\n"));
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
  mode: FakeSshMode,
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

// One canned answer of the fake gh. args is the whole argument list. It must match exactly, in order.
// When two answers have the same args, the first one wins.
export interface FakeGhAnswer {
  args: readonly string[];
  stdout?: string; // default ""
  stderr?: string; // default ""
  exitCode?: number; // default 0
  // A signal name such as "TERM": the fake prints its output, then stops itself with this signal.
  killWith?: string;
  // The fake runs the real sleep for this many seconds before it prints its output.
  delaySeconds?: number;
}

// One call that the fake gh logged.
export interface FakeGhCall {
  args: string[];
  // undefined when GH_TOKEN was not set.
  ghToken: string | undefined;
  // Each name of logEnv. undefined when the name was not set.
  env: Record<string, string | undefined>;
}

// The answer of gh auth token for account.
export function ghTokenAnswer(account: string, token: string): FakeGhAnswer {
  return {
    args: ["auth", "token", "--hostname", "github.com", "--user", account],
    stdout: `${token}\n`,
  };
}

const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const signalNamePattern = /^[A-Z0-9]+$/;

// Writes an executable gh into binDir. It uses shell builtins, so it works with binDir as the
// only PATH folder. Only for a delay, it runs the real sleep by its absolute path. As a result, the
// real gh can never run. Each call goes in the log at logPath (see readArgLog()).
// The log of a call holds "${GH_TOKEN+set:$GH_TOKEN}", then the same for each name of logEnv, then the arguments.
// An empty item means that the name was not set. "set:<value>" means that it was set to <value>.
// A call that no answer matches goes in the log <logPath>.unanswered, prints an error and exits with 99.
export function writeFakeGh(
  binDir: string,
  logPath: string,
  answers: readonly FakeGhAnswer[],
  logEnv: readonly string[] = [],
): void {
  for (const name of logEnv) {
    if (!envNamePattern.test(name)) throw new Error(`bad env name for the fake gh: ${name}`);
  }
  const extra = ["GH_TOKEN", ...logEnv].map((name) => `"\${${name}+set:$${name}}"`);
  const body = [logLine(logPath, extra)];
  for (const answer of answers) {
    const conditions = [
      `[ $# -eq ${answer.args.length} ]`,
      ...answer.args.map((arg, index) => `[ "\${${index + 1}}" = ${shellQuote(arg)} ]`),
    ];
    const lines = [`if ${conditions.join(" && ")}; then`];
    if (answer.delaySeconds !== undefined) {
      if (!/^\d+(\.\d+)?$/.test(String(answer.delaySeconds))) {
        throw new Error(`bad delay for the fake gh: ${answer.delaySeconds}`);
      }
      lines.push(`  ${shellQuote(realCommandPath("sleep"))} ${answer.delaySeconds}`);
    }
    lines.push(
      `  printf '%s' ${shellQuote(answer.stdout ?? "")}`,
      `  printf '%s' ${shellQuote(answer.stderr ?? "")} >&2`,
    );
    if (answer.killWith !== undefined) {
      if (!signalNamePattern.test(answer.killWith)) {
        throw new Error(`bad signal name for the fake gh: ${answer.killWith}`);
      }
      lines.push(`  kill -${answer.killWith} $$`);
    }
    lines.push(`  exit ${answer.exitCode ?? 0}`, "fi");
    body.push(...lines);
  }
  body.push(
    logLine(`${logPath}.unanswered`),
    "printf 'fake gh: no answer for: %s\\n' \"$*\" >&2",
    "exit 99",
  );
  writeFakeCommand(binDir, "gh", body.join("\n"));
}

export interface FakeGh {
  // baseEnv with PATH=<dir>/bin and nothing else on PATH.
  env: NodeJS.ProcessEnv;
  // <dir>/gh.log. readArgLog() reads it.
  logPath: string;
  calls(): FakeGhCall[];
  // The argument lists that had no answer.
  unanswered(): string[][];
  // Throws when unanswered() is not empty. fakeGh() registers it with onTestFinished.
  assertAnswered(): void;
}

// Writes a fake gh into <dir>/bin with writeFakeGh(), with the log <dir>/gh.log.
// A call with no answer fails the test, also when the code under test catches the error.
// Call it in a test or in beforeEach. A second call with the same dir replaces the script and keeps the log.
export function fakeGh(
  dir: string,
  baseEnv: NodeJS.ProcessEnv,
  answers: readonly FakeGhAnswer[],
  options: { logEnv?: readonly string[] } = {},
): FakeGh {
  const binDir = join(dir, "bin");
  const logPath = join(dir, "gh.log");
  const logEnv = options.logEnv ?? [];
  writeFakeGh(binDir, logPath, answers, logEnv);
  const unanswered = () => readArgLog(`${logPath}.unanswered`);
  const fake: FakeGh = {
    env: { ...baseEnv, PATH: binDir },
    logPath,
    calls: () =>
      readArgLog(logPath).map((items) => {
        const fromLog = (item: string) => (item === "" ? undefined : item.slice("set:".length));
        return {
          args: items.slice(1 + logEnv.length),
          ghToken: fromLog(items[0]),
          env: Object.fromEntries(logEnv.map((name, index) => [name, fromLog(items[1 + index])])),
        };
      }),
    unanswered,
    assertAnswered: () => expect(unanswered(), "gh calls with no answer").toEqual([]),
  };
  onTestFinished(() => fake.assertAnswered());
  return fake;
}

// The first six arguments that git passes to ssh for sshCommand(key).
export function sshKeyArgs(key: string): string[] {
  return ["-i", key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes"];
}

// The first file with this name on process.env.PATH.
function realCommandPath(name: string): string {
  for (const folder of (process.env.PATH ?? "").split(delimiter)) {
    if (folder === "") continue;
    const candidate = join(folder, name);
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {
      // Not here. Try the next folder.
    }
  }
  throw new Error(`no ${name} found on PATH`);
}

// Writes a git wrapper into binDir. It logs each call (see readArgLog()), then runs the real git.
// The real git is the first git file on process.env.PATH.
export function writeGitRecorder(binDir: string, logPath: string): void {
  writeFakeGit(binDir, `${logLine(logPath)}\nexec ${shellQuote(realCommandPath("git"))} "$@"`);
}

// Writes a git wrapper into binDir. It runs the real git with the same arguments. Then it exits
// with 1 when the first argument is subcommand, and else with the exit code of the real git.
// The real step finishes first, so a test sees a step that fails after it changed the worktree.
export function writeGitFailAfter(binDir: string, subcommand: string): void {
  writeFakeGit(
    binDir,
    `${shellQuote(realCommandPath("git"))} "$@"\ncode=$?\nif [ "$1" = ${shellQuote(subcommand)} ]; then exit 1; fi\nexit $code`,
  );
}

// Reads a log of writeFakeSsh(), writeGitRecorder() or writeFakeGh(). It returns one argument list for each call.
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

// Sets the mtime of file to ageMs milliseconds in the past.
export function ageFile(path: string, ageMs: number): void {
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
}

export interface FakeProcess {
  pid: number;
  // The name of the process. The file comm ends with a newline, as in /proc.
  comm: string;
  // The folder of the process. Without it, the process has no cwd link.
  cwd?: string;
  // The paths of the open files. Without it, the process has no fd folder.
  openFiles?: readonly string[];
}

// Makes a fake /proc folder in root: <pid>/comm, <pid>/cwd and <pid>/fd/<n> as links.
export function writeFakeProc(root: string, processes: readonly FakeProcess[]): void {
  mkdirSync(root, { recursive: true });
  for (const process of processes) {
    const folder = join(root, String(process.pid));
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "comm"), `${process.comm}\n`);
    if (process.cwd !== undefined) {
      symlinkSync(process.cwd, join(folder, "cwd"));
    }
    if (process.openFiles !== undefined) {
      mkdirSync(join(folder, "fd"));
      process.openFiles.forEach((file, index) => {
        symlinkSync(file, join(folder, "fd", String(index)));
      });
    }
  }
}

export interface TreeEntry {
  // The path relative to the folder.
  path: string;
  type: "file" | "directory" | "link" | "other";
  size: number;
  mtimeMs: number;
}

// A sorted list of every entry under folder. It uses lstat and follows no link.
export function treeSnapshot(folder: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stat = lstatSync(path);
      const type = stat.isDirectory()
        ? "directory"
        : stat.isFile()
          ? "file"
          : stat.isSymbolicLink()
            ? "link"
            : "other";
      entries.push({ path: relative(folder, path), type, size: stat.size, mtimeMs: stat.mtimeMs });
      if (type === "directory") {
        walk(path);
      }
    }
  };
  walk(folder);
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export const sourceDir = fileURLToPath(new URL("../src/", import.meta.url));

const childProcessName = String.raw`["'\`](?:node:)?child_process["'\`]`;
const loadsChildProcessPattern = new RegExp(
  [
    String.raw`\bfrom\s*${childProcessName}`, // import ... from, export ... from
    String.raw`\bimport\s*${childProcessName}`, // import "child_process"
    String.raw`\bimport\s*\(\s*${childProcessName}`, // import("child_process")
    String.raw`\brequire\s*\(\s*${childProcessName}`, // require("child_process")
  ].join("|"),
);

// True when text loads the child process module in any of these forms.
export function loadsChildProcess(text: string): boolean {
  return loadsChildProcessPattern.test(text);
}

export interface SourceFile {
  file: string;
  text: string;
}

// Each .ts file under src/ (a path with "/") and its text.
export function sourceFiles(): SourceFile[] {
  return readdirSync(sourceDir, { recursive: true, encoding: "utf8" })
    .map((file) => file.split("\\").join("/"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({ file, text: readFileSync(join(sourceDir, file), "utf8") }));
}

const moduleSpecifierPattern = /\b(?:from|import|require)\s*\(?\s*(["'`])([^"'`]+)\1/g;

// True when text (the text of file, a path under src/ with "/") loads or re-exports target.
// target is a path under sourceDir: a folder, or a .ts file. A relative specifier counts when
// it resolves to target or to a path inside target. A ".js" ending counts as ".ts" (NodeNext).
// It cannot find a module name that the code builds at run time.
export function importsPath(file: string, text: string, target: string): boolean {
  const fileDir = join(sourceDir, dirname(file));
  return [...text.matchAll(moduleSpecifierPattern)].some((match) => {
    const specifier = match[2];
    if (!specifier.startsWith(".")) return false;
    const resolved = resolve(fileDir, specifier);
    return isInside(resolved, target) || resolved.replace(/\.js$/, ".ts") === target;
  });
}

export const runChildPath = join(sourceDir, "process", "run-child.ts");

// True when text (the text of file) starts command: it loads child_process or imports
// src/process/run-child.ts, and it has the string literal command or "command ...".
export function startsCommand(file: string, text: string, command: string): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const commandLiteral = new RegExp(`(["'\`])${escaped}(?: [^"'\`]*)?\\1`);
  return (loadsChildProcess(text) || importsPath(file, text, runChildPath)) && commandLiteral.test(text);
}

// The files under src/ (paths with "/") that start command.
// The scan finds a literal command, alone or followed by a space and arguments, and a literal module name.
// It cannot find a module name or a command name that is built at run time.
export function filesThatStart(command: string): string[] {
  return sourceFiles()
    .filter(({ file, text }) => startsCommand(file, text, command))
    .map(({ file }) => file);
}

// The folder under src/ of target, a path written with "/" (for example "vcs/git").
function sourcePath(target: string): string {
  return join(sourceDir, ...target.split("/"));
}

// The files under src/ (paths with "/") that load or re-export a module in target, a folder
// under src/ written with "/" (for example "vcs/git"). It cannot find a module name that the
// code builds at run time.
export function filesThatImport(target: string): string[] {
  return sourceFiles()
    .filter(({ file, text }) => importsPath(file, text, sourcePath(target)))
    .map(({ file }) => file);
}

// True when file (a path under src/ with "/") does not start with owner (for example "vcs/")
// and loads or re-exports a module in target (for example "vcs/git").
export function breaksBoundary(file: string, text: string, owner: string, target: string): boolean {
  return !file.startsWith(owner) && importsPath(file, text, sourcePath(target));
}

// The files under src/ that break the boundary of breaksBoundary().
export function filesThatBreakBoundary(owner: string, target: string): string[] {
  return sourceFiles()
    .filter(({ file, text }) => breaksBoundary(file, text, owner, target))
    .map(({ file }) => file);
}

// The query of readGithubBlockers(). It is a literal, so that the test checks the query on its own.
const BLOCKERS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      blockedBy(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { number state repository { nameWithOwner } }
      }
    }
  }
}`;

// The call of readGithubBlockers(). Owner, name and cursor go as strings (-f), the number as an Int (-F).
// The first page has no cursor argument.
export const blockersGraphqlArgs = (owner: string, name: string, number: string, cursor?: string) => [
  "api",
  "graphql",
  "-f",
  `query=${BLOCKERS_QUERY}`,
  "-f",
  `owner=${owner}`,
  "-f",
  `name=${name}`,
  "-F",
  `number=${number}`,
  ...(cursor === undefined ? [] : ["-f", `cursor=${cursor}`]),
];

// One blocker node, as GitHub gives it.
export const blockersNode = (number: number, state: string, nameWithOwner: string) => ({
  number,
  state,
  repository: { nameWithOwner },
});

// The JSON that gh prints for one page of blockers.
export function blockersPageJson(
  nodes: unknown[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = { hasNextPage: false, endCursor: null },
): string {
  return JSON.stringify({ data: { repository: { issue: { blockedBy: { pageInfo, nodes } } } } });
}
