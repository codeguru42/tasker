import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Io, RegisterCommand } from "../src/cli.js";
import { GitError, runGit } from "../src/vcs/git/run.js";

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
// It reads no git configuration of the host and never asks the terminal.
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

// The absolute path of file in work. It throws when the path is not inside work.
function resolveInside(work: string, file: string): string {
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
    throw new Error(`addCommit needs a file inside the work repo: ${file}`);
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
      const target = resolveInside(work, change.file ?? `file-${counter}.txt`);
      await runGit(["fetch", "origin"], { cwd: work, env });
      await runGit(["checkout", "-B", branch, `origin/${branch}`], { cwd: work, env });
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, change.content ?? message);
      await runGit(["add", "-A"], { cwd: work, env });
      await runGit(["commit", "--allow-empty", "-m", message], { cwd: work, env });
      await runGit(["push", "origin", `HEAD:refs/heads/${branch}`], { cwd: work, env });
      return (await runGit(["rev-parse", "HEAD"], { cwd: work, env })).trim();
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

// Writes an executable shell script named git into binDir. body is the script after "#!/bin/sh".
// Use binDir as the only PATH folder, so runGit() starts this script, not the real git.
export function writeFakeGit(binDir: string, body: string): void {
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "git"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}
