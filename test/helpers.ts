import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
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
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished, vi } from "vitest";
import { type Io, type RegisterCommand, run } from "../src/cli.js";
import { start } from "../src/commands/start.js";
import { loadConfig } from "../src/config/load.js";
import { type Config, ConfigError, parseConfig } from "../src/config/schema.js";
import { IssueKeyError } from "../src/issue-key/ref.js";
import { resolveIssueKey } from "../src/issue-key/resolve.js";
import { githubShortRef } from "../src/issue-key/short-ref.js";
import { bootstrapLogPath } from "../src/phases/bootstrap.js";
import { canonicalPath } from "../src/real-path.js";
import { failTask } from "../src/state/machine.js";
import type { LockAttempt } from "../src/store/locks.js";
import { createDataRoot, taskLogsDir } from "../src/store/layout.js";
import { openStore, type StoreOptions, type Task, type TaskStore } from "../src/store/store.js";
import { provisionClone } from "../src/vcs/git/provision.js";
import { type RepoPaths, repoPaths } from "../src/vcs/git/repo-paths.js";
import { GitError, runGit } from "../src/vcs/git/run.js";
import { shellQuote } from "../src/vcs/git/ssh.js";
import { listWorktrees, taskBranchName, taskWorktreePath } from "../src/vcs/git/worktree.js";
import type { VcsContext } from "../src/vcs/provider.js";

export interface CapturedIo extends Io {
  out: string[];
  err: string[];
  questions: string[];
}

// With answers, the io has a prompt that gives the next answer, and rejects when none is left.
export function captureIo(options: { answers?: string[] } = {}): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  const questions: string[] = [];
  const answers = options.answers === undefined ? undefined : [...options.answers];
  const io: CapturedIo = {
    out,
    err,
    questions,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  if (answers !== undefined) {
    io.prompt = (question) => {
      questions.push(question);
      const answer = answers.shift();
      return answer === undefined ? Promise.reject(new Error("no answer left")) : Promise.resolve(answer);
    };
  }
  return io;
}

export const greet: RegisterCommand = (program) => {
  program
    .command("greet")
    .description("Say hello")
    .option("--name <name>", "Who to greet");
};

// Runs argv with only this command and gives the exit code and the whole stdout and stderr.
export async function runCommand(
  command: RegisterCommand,
  ...argv: string[]
): Promise<{ code: number; out: string; err: string }> {
  const io = captureIo();
  const code = await run(argv, { commands: [command], io });
  return { code, out: io.out.join(""), err: io.err.join("") };
}

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

// A new temp folder that is removed after the test. Call it inside a test.
export function useTempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export interface FixtureChild {
  pid: number;
  // The first line of stdout, without the newline. It rejects, with the stderr of the child, when
  // the child ends first.
  firstLine: Promise<string>;
  // Resolves on the exit event. Node reaps the child before it emits exit, so the pid is gone.
  exited: Promise<void>;
}

// Starts test/fixtures/<fixture> through tsx and saves its pid with savePid.
export function startFixture(fixture: string, args: readonly string[]): FixtureChild {
  const child = spawn(process.execPath, ["--import", "tsx", `test/fixtures/${fixture}`, ...args], {
    cwd: repoRoot,
  });
  const pid = child.pid!;
  savePid(pid);
  let stdout = "";
  let stderr = "";
  const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  const firstLine = new Promise<string>((resolve, reject) => {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const end = stdout.indexOf("\n");
      if (end !== -1) resolve(stdout.slice(0, end));
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    // close comes after the stdio streams end, so the stderr is complete here.
    child.on("close", () => reject(new Error(`the child ${fixture} exited first: ${stderr}`)));
  });
  // The rejection after a resolve does nothing. This stops an unhandled rejection of a killed child.
  firstLine.catch(() => {});
  return { pid, firstLine, exited };
}

export interface LockHolder {
  pid: number;
  // The JSON line of the child. It rejects, with the stderr of the child, when the child ends first.
  attempt: Promise<LockAttempt>;
  // Resolves on the exit event. Node reaps the child before it emits exit, so the pid is gone.
  exited: Promise<void>;
}

// Starts test/fixtures/lock-holder.ts.
export function startLockHolder(dbPath: string, name: string, goPath?: string): LockHolder {
  const child = startFixture("lock-holder.ts", [dbPath, name, ...(goPath ? [goPath] : [])]);
  const attempt = child.firstLine.then((line) => JSON.parse(line) as LockAttempt);
  attempt.catch(() => {});
  return { pid: child.pid, attempt, exited: child.exited };
}

// Starts test/fixtures/write-lock-holder.ts. It resolves when the child holds the write lock of dbPath.
// The child keeps the lock for holdMs ms. savePid kills it after the test.
export async function startWriteLockHolder(dbPath: string, holdMs: number): Promise<void> {
  const line = await startFixture("write-lock-holder.ts", [dbPath, String(holdMs)]).firstLine;
  if (line !== "held") throw new Error(`the write lock child printed ${line}`);
}

// Runs tasker (src/main.ts through tsx) in a child process with env on top of the process env.
export function spawnTasker(
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts", ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// The names in the locks table of a data root, sorted.
export function lockNames(dataRoot: string): string[] {
  const db = new DatabaseSync(createDataRoot(dataRoot).database);
  try {
    return db
      .prepare("SELECT name FROM locks ORDER BY name")
      .all()
      .map((row) => String(row.name));
  } finally {
    db.close();
  }
}

// True when the process runs. A zombie (state Z, not yet reaped) counts as gone.
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The state follows the last ")" of the line, because the command name can hold ")".
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return true;
  }
}

// The pid of a real process that ran and ended. spawnSync waits for the end and reaps the child,
// so the pid is gone when it returns.
export function deadPid(): number {
  const result = spawnSync("true");
  if (result.error !== undefined) throw result.error;
  if (result.pid === undefined || result.pid === 0) throw new Error("the short process got no pid");
  return result.pid;
}

// Resolves when predicate gives true. It polls every 50 ms and rejects with message after timeoutMs.
export async function waitUntil(predicate: () => boolean, timeoutMs: number, message: string): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error(message);
    await new Promise((done) => setTimeout(done, 50));
  }
}

// Resolves when the process is gone. Rejects with the pid when it still runs after timeoutMs.
export async function waitUntilGone(pid: number, timeoutMs: number): Promise<void> {
  await waitUntil(() => !isAlive(pid), timeoutMs, `process ${pid} still runs after ${timeoutMs} ms`);
}

// Sends SIGKILL to pid after the test, when it still runs. Use it only for a pid that the test started.
export function savePid(pid: number): void {
  onTestFinished(() => {
    if (isAlive(pid)) process.kill(pid, "SIGKILL");
  });
}

// Waits until the file holds a pid and a newline, saves the pid with savePid and returns it.
export async function readPidFile(path: string, timeoutMs: number): Promise<number> {
  let pid = 0;
  await waitUntil(
    () => {
      const text = existsSync(path) ? readFileSync(path, "utf8") : "";
      if (!/^\d+\n$/.test(text)) return false;
      pid = Number(text);
      return true;
    },
    timeoutMs,
    `no pid in ${path} after ${timeoutMs} ms`,
  );
  savePid(pid);
  return pid;
}

// The numbers of SIGINT and SIGTERM listeners on this process.
export function signalListenerCounts(): number[] {
  return [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
}

// The issues of the ConfigError that fn throws. It throws, so the test fails, when fn returns
// or when the error is not a ConfigError. It is the sync sibling of failureOf.
export function configIssuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof ConfigError)) {
      throw new Error(`the function threw ${String(error)}, not a ConfigError`, { cause: error });
    }
    return error.issues;
  }
  throw new Error("the function returned, but the test needs a ConfigError");
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

// Writes the value that build gives for a new temp dir as JSON to config.json in that dir.
// The caller removes dir.
function writeConfigFile(build: (dir: string) => unknown): { dir: string; path: string } {
  const dir = makeTempDir("tasker-config-");
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(build(dir)));
  return { dir, path };
}

// Writes raw as JSON to config.json in a new temp dir. The caller removes dir.
export function writeTempConfig(raw: unknown): { dir: string; path: string } {
  return writeConfigFile(() => raw);
}

// Writes raw as config.json in a new temp dir, with dataRoot set to <dir>/data. The caller removes dir.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writeDataRootConfig(raw: Record<string, any> = validConfig()): {
  dir: string;
  path: string;
  dataRoot: string;
} {
  const written = writeConfigFile((dir) => ({ ...raw, dataRoot: join(dir, "data") }));
  return { ...written, dataRoot: join(written.dir, "data") };
}

export interface SeedTask {
  issueKey: string;
  repoKey: string;
  state: string;
  at: string;
  title?: string;
  base?: string;
  branch?: string;
  worktreePath?: string;
  // Fails the task at its at, with this message.
  failWith?: string;
}

// The repos codeguru42/tasker and codeguru42/other, and the repo fork. The project of fork
// is the same as the project of codeguru42/tasker, so one issue key matches two repos.
export function threeRepoConfig() {
  const raw = validConfig();
  const base = raw.repos.tasker;
  raw.repos["codeguru42/tasker"] = base;
  raw.repos["codeguru42/other"] = { ...base, remote: "git@github.com:codeguru42/other.git" };
  raw.repos.fork = {
    ...base,
    remote: "git@github.com:someone/tasker.git",
    issueTracker: { ...base.issueTracker, project: "codeguru42/tasker" },
  };
  delete raw.repos.tasker;
  return raw;
}

// The time 00:00 UTC of a day in January 2026, for example dayAt(2) is 2026-01-02T00:00:00.000Z.
export function dayAt(day: number): string {
  return `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;
}

// Sets each name of env in process.env for this test. A value of undefined removes the name.
// After the test, it restores process.env. Call it inside a test.
export function useProcessEnv(env: NodeJS.ProcessEnv): void {
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
}

// Writes the text that build gives as config.json in a new temp dir, and points TASKER_CONFIG at it.
// build gets the data root <dir>/data. Call it inside a test. After the test, it restores the env and removes the folder.
export function useConfigFile(build: (dataRoot: string) => string): {
  dir: string;
  path: string;
  dataRoot: string;
} {
  const dir = makeTempDir("tasker-config-");
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const path = join(dir, "config.json");
  const dataRoot = join(dir, "data");
  writeFileSync(path, build(dataRoot));
  useProcessEnv({ TASKER_CONFIG: path });
  return { dir, path, dataRoot };
}

// Writes threeRepoConfig() with useConfigFile(). Call it inside a test.
export function useThreeRepoDataRoot(): { dir: string; path: string; dataRoot: string } {
  return useConfigFile((dataRoot) => JSON.stringify({ ...threeRepoConfig(), dataRoot }));
}

export interface StartFixture {
  origin: GitOrigin;
  dataRoot: string;
  configPath: string;
  gh: FakeGh;
  repoKey: string;
  config: Config;
}

// The setup of the tests of tasker start: a local origin with main, one repo codeguru42/tasker that
// uses it as the remote, and a fake gh that answers the token call and the read of each issue.
// The default issue is codeguru42/tasker#5. A key of options.repo that is undefined is removed.
// The fake gh comes first on the PATH, so the real gh never runs and git still runs.
// Call it inside a test. After the test, it removes the folders and restores the env.
export async function useStartFixture(
  options: {
    issues?: Parameters<typeof githubIssueAnswer>[0][];
    repo?: Record<string, unknown>;
    remote?: string;
  } = {},
): Promise<StartFixture> {
  const provider = await makeProviderFixture();
  onTestFinished(() => provider.remove());
  const { origin } = provider;
  const repoKey = "codeguru42/tasker";
  const raw = validConfig();
  const repo: Record<string, unknown> = {
    ...raw.repos.tasker,
    remote: options.remote ?? origin.path,
    defaultBaseBranch: "main",
    ...options.repo,
  };
  for (const [name, value] of Object.entries(repo)) {
    if (value === undefined) delete repo[name];
  }
  raw.repos = { [repoKey]: repo };
  const written = writeDataRootConfig(raw);
  onTestFinished(() => rmSync(written.dir, { recursive: true, force: true }));
  const gh = fakeGh(written.dir, {}, [
    ghTokenAnswer("codeguru42", "gho_test"),
    ...(options.issues ?? [{ project: repoKey, number: 5 }]).map(githubIssueAnswer),
  ]);
  useProcessEnv({
    TASKER_CONFIG: written.path,
    PATH: `${gh.env.PATH}${delimiter}${process.env.PATH}`,
  });
  return { origin, dataRoot: written.dataRoot, configPath: written.path, gh, repoKey, config: loadConfig() };
}

export interface StartedTask extends StartFixture {
  key: string;
  // The result of tasker start for the key.
  result: { code: number; out: string; err: string };
  branch: string;
  worktree: string;
  clone: string;
  env: NodeJS.ProcessEnv;
}

// Runs useStartFixture(options), then tasker start for issue 5. It makes no assertion, so a test
// with a failing bootstrap can use it. Call it inside a test.
export async function useStartedTask(options: Parameters<typeof useStartFixture>[0] = {}): Promise<StartedTask> {
  const fixture = await useStartFixture(options);
  const key = "codeguru42/tasker#5";
  const result = await runCommand(start, "start", key);
  const { clone, worktrees } = repoPaths(fixture.dataRoot, fixture.repoKey);
  const { branch, worktree } = taskNames(worktrees, 5, "Issue 5");
  return { ...fixture, key, result, branch, worktree, clone, env: fixture.origin.env };
}

// What a test compares before and after a command: the state of the latest task, whether the
// worktree folder exists, whether git lists the worktree, and whether the task branch exists.
export async function taskWorkspaceState(
  started: Pick<StartedTask, "dataRoot" | "repoKey" | "key" | "worktree" | "branch" | "clone" | "env">,
): Promise<{ state: string | undefined; worktree: boolean; listed: boolean; branch: boolean }> {
  const { clone, env } = started;
  const state = withDataRootStore(started.dataRoot, (store) => store.findLatestTask(started.repoKey, started.key)?.state);
  const listedPaths = (await listWorktrees({ clone, env })).map((entry) => entry.path);
  return {
    state,
    worktree: existsSync(started.worktree),
    listed: listedPaths.includes(canonicalPath(started.worktree)),
    branch: (await localBranches(clone, env)).includes(`refs/heads/${started.branch}`),
  };
}

// The message of the IssueKeyError that resolveIssueKey() throws for key with the
// configuration at configPath. It fails the test when the key resolves.
export function issueKeyErrorMessage(key: string, configPath: string): string {
  try {
    resolveIssueKey(key, loadConfig({ TASKER_CONFIG: configPath }));
  } catch (error) {
    if (!(error instanceof IssueKeyError)) throw error;
    return error.message;
  }
  return expect.fail(`the issue key ${key} resolves`);
}

// Runs fn with resource, then closes resource. When fn gives a promise, resource closes after the
// promise settles. When fn throws, resource closes and the error goes on.
function closeAfter<R extends { close(): void }, T>(resource: R, fn: (resource: R) => T): T {
  let result: T;
  try {
    result = fn(resource);
  } catch (error) {
    resource.close();
    throw error;
  }
  if (result instanceof Promise) return result.finally(() => resource.close()) as T;
  resource.close();
  return result;
}

// Runs fn with the open store of the database file at path, then closes the store, as closeAfter does.
export function withStoreFile<T>(path: string, fn: (store: TaskStore) => T, options?: StoreOptions): T {
  return closeAfter(openStore(path, options), fn);
}

// Runs fn with a raw connection to the SQLite file at path, then closes it, as withStoreFile does.
export function withRawDatabase<T>(path: string, fn: (db: DatabaseSync) => T): T {
  return closeAfter(new DatabaseSync(path), fn);
}

// Runs fn with the open store of dataRoot. It keeps each promise of withStoreFile.
export function withDataRootStore<T>(dataRoot: string, fn: (store: TaskStore) => T, options?: StoreOptions): T {
  return withStoreFile(createDataRoot(dataRoot).database, fn, options);
}

// Creates each task in the store of dataRoot, in order. Its created_at and updated_at are its at.
export function seedTasks(dataRoot: string, tasks: readonly SeedTask[]): Task[] {
  let at = new Date(0);
  return withDataRootStore(
    dataRoot,
    (store) =>
      tasks.map((task) => {
        at = new Date(task.at);
        const created = store.createTask({
          issueKey: task.issueKey,
          repoKey: task.repoKey,
          state: task.state,
          title: task.title,
          base: task.base,
          branch: task.branch,
          worktreePath: task.worktreePath,
        });
        return task.failWith === undefined ? created : failTask(store, created.id, task.failWith);
      }),
    { now: () => at },
  );
}

// Writes text as the bootstrap log of the attempt of task under dataRoot.
export function writeBootstrapLog(dataRoot: string, task: Pick<Task, "issueKey" | "attempt">, text: string): void {
  const path = bootstrapLogPath(taskLogsDir(dataRoot, task));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
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
  "release-1-2",
];

// The text that the pre-push hook prints for a push with no valid publish token.
export const NO_TOKEN = "tasker: the push has no valid publish token";

// The task branch and the worktree folder of a GitHub issue number, as tasker makes them.
export function taskNames(
  worktrees: string,
  issueNumber: number,
  title = "x",
): { branch: string; worktree: string } {
  const shortRef = githubShortRef(String(issueNumber));
  return {
    branch: taskBranchName(shortRef, title),
    worktree: taskWorktreePath(worktrees, shortRef),
  };
}

// The repo folders of the key "tasker" under the clone-data data root inside the origin folder.
function gitCloneFolders(origin: GitOrigin): RepoPaths {
  return repoPaths(join(origin.dir, "clone-data"), "tasker");
}

// The folder of the publish tokens of the clone that makeGitClone() makes.
export function gitCloneTokens(origin: GitOrigin): string {
  return gitCloneFolders(origin).publishTokens;
}

// A bare clone of origin, made by provisionClone() at the repo folder of the key "tasker"
// under <origin>/clone-data. origin.remove() deletes it.
export async function makeGitClone(origin: GitOrigin): Promise<string> {
  const clone = gitCloneFolders(origin).clone;
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

// The answer of the call that reads one GitHub issue (see readGithubIssue()).
export function githubIssueAnswer(issue: {
  project: string;
  number: number;
  title?: string;
  state?: "OPEN" | "CLOSED";
  labels?: readonly string[];
}): FakeGhAnswer {
  return {
    args: ["issue", "view", String(issue.number), "-R", issue.project, "--json", "number,title,body,url,labels,state"],
    stdout: JSON.stringify({
      number: issue.number,
      title: issue.title ?? `Issue ${issue.number}`,
      body: "",
      url: `https://github.com/${issue.project}/issues/${issue.number}`,
      labels: (issue.labels ?? []).map((name) => ({ name })),
      state: issue.state ?? "OPEN",
    }),
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

// The issueTracker keys of each repo, by repo key.
export type Trackers = Record<string, Record<string, unknown>>;

// A parsed configuration with one repo for each entry of trackers. Each repo copies the
// repo of validConfig(). Its issueTracker is the issueTracker of validConfig() (which has
// the account that a github tracker needs) with the keys of the entry on top.
export function configWithTrackers(trackers: Trackers): Config {
  const raw = validConfig();
  const base = raw.repos.tasker;
  raw.repos = Object.fromEntries(
    Object.entries(trackers).map(([key, issueTracker]) => [
      key,
      { ...base, issueTracker: { ...base.issueTracker, ...issueTracker } },
    ]),
  );
  return parseConfig(raw, {}, "/home/test");
}
