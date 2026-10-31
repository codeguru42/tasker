import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { githubShortRef } from "../../src/issue-key/short-ref.js";
import { shellQuote } from "../../src/shell-quote.js";
import { provisionClone } from "../../src/vcs/git/provision.js";
import { type RepoPaths, repoPaths } from "../../src/vcs/git/repo-paths.js";
import { GitError, runGit } from "../../src/vcs/git/run.js";
import { taskBranchName, taskWorktreePath } from "../../src/vcs/git/worktree.js";
import { createVcsProvider, type VcsContext, type VcsProvider } from "../../src/vcs/provider.js";
import { logLine, pathWithFirst, realCommandPath, writeFakeCommand } from "./fake-commands.js";
import { makeTempDir, writeFileWithParents } from "./temp.js";

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
  addCommit(branch: string, change?: { file?: string; content?: string; message?: string }): Promise<string>;
  // Merges the head of from (default "main") into branch with a merge commit and returns the new commit SHA.
  addMerge(branch: string, from?: string): Promise<string>;
  // Makes branch name at the head of from (default "main").
  createBranch(name: string, from?: string): Promise<void>;
  // The head SHA of branch, or undefined when the branch is missing.
  branchHead(branch: string): Promise<string | undefined>;
  remove: () => void;
}

// Git reads a name that starts with "-" as an option.
function assertBranchName(name: string): void {
  if (name.startsWith("-")) {
    throw new Error(`the branch name must not start with -: ${name}`);
  }
}

// Runs git with args at a worktree (cwd) or in a repo (gitDir) and gives the output without the leading and trailing
// white space.
export async function gitOutput(
  at: { cwd: string } | { gitDir: string },
  env: NodeJS.ProcessEnv,
  ...args: string[]
): Promise<string> {
  return (await runGit(args, { ...at, env })).trim();
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
  writeFileWithParents(target, content);
  await runGit(["add", "-A"], { cwd: folder, env });
  await runGit(["commit", ...commitArgs, "-m", message], { cwd: folder, env });
  return gitOutput({ cwd: folder }, env, "rev-parse", "HEAD");
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
      const sha = await writeAndCommit(work, env, target, change.content ?? message, message, ["--allow-empty"]);
      await runGit(["push", "origin", `HEAD:refs/heads/${branch}`], { cwd: work, env });
      return sha;
    },
    async addMerge(branch, from = "main") {
      assertBranchName(branch);
      assertBranchName(from);
      await runGit(["fetch", "origin"], { cwd: work, env });
      await runGit(["checkout", "-B", branch, `origin/${branch}`], { cwd: work, env });
      await runGit(["merge", "--no-ff", "--no-edit", `origin/${from}`], { cwd: work, env });
      await runGit(["push", "origin", `HEAD:refs/heads/${branch}`], { cwd: work, env });
      return gitOutput({ cwd: work }, env, "rev-parse", "HEAD");
    },
    async createBranch(name, from = "main") {
      assertBranchName(name);
      assertBranchName(from);
      await runGit(["branch", name, from], { gitDir: path, env });
    },
    async branchHead(branch) {
      assertBranchName(branch);
      try {
        return await gitOutput(
          { gitDir: path },
          env,
          "rev-parse",
          "--verify",
          "--quiet",
          `refs/heads/${branch}^{commit}`,
        );
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
  const git = (...args: string[]) => gitOutput({ gitDir: clone }, env, ...args);
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

// Copies refs/heads/<branch> of the clone to refs/heads/<to> of the origin (the same name when to is
// not given). Git refuses a copy that is not a fast-forward of an existing branch of the origin.
export async function copyCloneBranchToOrigin(o: {
  origin: string;
  clone: string;
  branch: string;
  to?: string;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  const to = o.to ?? o.branch;
  assertBranchName(o.branch);
  assertBranchName(to);
  await runGit(["fetch", o.clone, `refs/heads/${o.branch}:refs/heads/${to}`], { gitDir: o.origin, env: o.env });
}

// Moves main of the origin to the tip of refs/heads/<branch> in the clone, as a landing outside
// tasker does. Git refuses a move that is not a fast-forward, so the branch must build on main.
export async function landBranchOnOriginMain(o: {
  origin: string;
  clone: string;
  branch: string;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  await copyCloneBranchToOrigin({ ...o, to: "main" });
}

// A local git origin, and the provider context of the repo "tasker" with a data root in origin.dir.
// remove() deletes everything.
export interface ProviderFixture {
  origin: GitOrigin;
  context: VcsContext;
  remove: () => void;
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
  const target = resolveInside(worktree, change.file, "commitInWorktree needs a file inside the worktree");
  worktreeCommitCount += 1;
  const message = change.message ?? `worktree commit ${worktreeCommitCount}`;
  return writeAndCommit(worktree, env, target, change.content ?? message, message, []);
}

// Changes only the message of the head commit of the worktree and returns the new head.
// The patch of the commit stays the same.
export async function amendWorktreeMessage(worktree: string, env: NodeJS.ProcessEnv, message: string): Promise<string> {
  await runGit(["commit", "--amend", "--only", "-m", message], { cwd: worktree, env });
  return gitOutput({ cwd: worktree }, env, "rev-parse", "HEAD");
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
export function taskNames(worktrees: string, issueNumber: number, title = "x"): { branch: string; worktree: string } {
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

// The first six arguments that git passes to ssh for sshCommand(key).
export function sshKeyArgs(key: string): string[] {
  return ["-i", key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes"];
}

// Writes a git wrapper into binDir. It logs each call (see readArgLog()), then runs the real git.
// The real git is the first git file on process.env.PATH.
export function writeGitRecorder(binDir: string, logPath: string): void {
  writeFakeGit(binDir, `${logLine(logPath)}\nexec ${shellQuote(realCommandPath("git"))} "$@"`);
}

// Writes the git recorder of writeGitRecorder() into <dir>/gitbin, with its log at <dir>/git.log.
// It returns base with that folder first on PATH, and the path of the log. The PATH of base is
// the tail, so the other programs of base (for example a fake ssh) stay on PATH.
export function gitRecorderEnv(dir: string, base: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv; log: string } {
  const bin = join(dir, "gitbin");
  const log = join(dir, "git.log");
  writeGitRecorder(bin, log);
  return { env: { ...base, PATH: pathWithFirst(bin, base) }, log };
}

// Writes a git wrapper into <dir>/gitbin-before-push. When an argument of a call is push, the
// wrapper first runs command. If command fails, the wrapper exits with 1 and the push does not
// start. Then it runs the real git. The commands in command must call the real git by its path
// (realCommandPath("git")). A plain git runs this wrapper again, because the wrapper is first on
// PATH. The wrapper runs the real git, not the recorder, so a push does not show in a git log.
// It returns base with that folder first on PATH. In a bare clone, push is not the first
// argument, so the wrapper looks at each argument.
export function gitBeforePushEnv(dir: string, base: NodeJS.ProcessEnv, command: readonly string[]): NodeJS.ProcessEnv {
  return gitBeforeCommandEnv(dir, base, "push", command);
}

// Like gitBeforePushEnv, but the wrapper runs command before each git call that has subcommand as an argument.
// The wrapper folder is dir/gitbin-before-<subcommand>.
export function gitBeforeCommandEnv(
  dir: string,
  base: NodeJS.ProcessEnv,
  subcommand: string,
  command: readonly string[],
): NodeJS.ProcessEnv {
  const bin = join(dir, `gitbin-before-${subcommand}`);
  writeFakeGit(
    bin,
    [
      'for arg in "$@"; do',
      `  if [ "$arg" = ${shellQuote(subcommand)} ]; then`,
      `    ${command.map(shellQuote).join(" ")} || exit 1`,
      "    break",
      "  fi",
      "done",
      `exec ${shellQuote(realCommandPath("git"))} "$@"`,
    ].join("\n"),
  );
  return { ...base, PATH: pathWithFirst(bin, base) };
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

// A git provider for a test that uses only its pure functions. It reads no remote.
export function gitProvider(): VcsProvider {
  return createVcsProvider({ remote: "/no-remote", vcs: { provider: "git", config: {} } });
}
