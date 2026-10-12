import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  type UncommittedChange,
  uncommittedRefusal,
  worktreeChanges,
  worktreeHead,
} from "./changes.js";
import { assertRevisionInput, isFullRevision, resolveRevision } from "./refs.js";
import { GitError, runGit } from "./run.js";
import { assertTaskBranch, assertTaskWorktree } from "./worktree.js";

export type ReconcileStrategy = "rebase" | "merge";

// The options of every rebase. They stop the configuration of the user from changing the rebase.
// --merge forces rebase-merge/, --no-autostash and --no-update-refs stop rebase.autoStash and
// rebase.updateRefs, --no-rebase-merges gives a linear history, --no-gpg-sign stops a gpg
// failure, --no-verify skips the pre-rebase hook, and --no-rerere-autoupdate keeps a conflict
// unmerged. "-c" is not possible, because runGit() removes the GIT_CONFIG_* variables.
const REBASE_OPTIONS = [
  "--merge",
  "--no-autostash",
  "--no-update-refs",
  "--no-rebase-merges",
  "--no-gpg-sign",
  "--no-verify",
  "--no-rerere-autoupdate",
];

// The options of every merge. -s ort stops pull.twohead, --ff and --commit and --no-squash stop
// merge.ff and branch.<name>.mergeOptions, --no-edit stops GIT_MERGE_AUTOEDIT, --no-log stops
// merge.log, and the other options stop the autostash, gpg, hooks, signatures and rerere.
const MERGE_OPTIONS = [
  "-s",
  "ort",
  "--ff",
  "--commit",
  "--no-squash",
  "--no-edit",
  "--no-log",
  "--no-autostash",
  "--no-gpg-sign",
  "--no-verify",
  "--no-verify-signatures",
  "--no-rerere-autoupdate",
];

// The place that a worktree starts from: the full revision of HEAD and the task branch.
// The branch is undefined for a detached HEAD.
export interface StartState {
  head: string;
  branch: string | undefined;
}

export interface WorktreeState extends StartState {
  changes: UncommittedChange[];
}

export interface FoundState extends WorktreeState {
  rebase: boolean;
  merge: boolean;
}

// Reads the state of the worktree. The target must be the real path from assertTaskWorktree().
// The branch comes from "symbolic-ref -q HEAD". Exit code 1 means a detached HEAD. Every other
// failure passes through.
async function stateAt(target: string, env: NodeJS.ProcessEnv): Promise<WorktreeState> {
  const head = await worktreeHead(target, env);
  let branch: string | undefined;
  try {
    const ref = (await runGit(["symbolic-ref", "-q", "HEAD"], { cwd: target, env })).trim();
    branch = ref.replace(/^refs\/heads\//, "");
  } catch (error) {
    if (!(error instanceof GitError && error.exitCode === 1)) throw error;
  }
  const changes = await worktreeChanges(target, env);
  return { head, branch, changes };
}

// The head, the branch and the uncommitted changes of the task worktree.
export async function worktreeState(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
}): Promise<WorktreeState> {
  const { clone, env, path } = o;
  const target = await assertTaskWorktree({ clone, env, path });
  return stateAt(target, env);
}

// Tells whether a rebase or a merge is in progress in the worktree. Git has no plumbing command
// with an exit code for this, and the text of "git status" is not stable. So it asks git for the
// real path of each state file with "rev-parse --git-path" and tests that the file exists.
// The path can be relative to the target or absolute, so it resolves against the target.
async function inProgress(
  target: string,
  env: NodeJS.ProcessEnv,
): Promise<{ rebase: boolean; merge: boolean }> {
  const exists = async (name: string): Promise<boolean> => {
    const found = await runGit(["rev-parse", "--git-path", name], { cwd: target, env });
    return existsSync(resolve(target, found.trim()));
  };
  const rebase = (await exists("rebase-merge")) || (await exists("rebase-apply"));
  const merge = await exists("MERGE_HEAD");
  return { rebase, merge };
}

// Puts the worktree back at the start. Each command runs through attempt(): a GitError keeps its
// stderr in the list and the next command runs. Any other error passes through.
// "rebase --quit" comes first, because "checkout --force" does not remove rebase-merge/.
// The checkout removes the merge state. "clean -fd" deletes the untracked files.
async function restoreAt(target: string, env: NodeJS.ProcessEnv, start: StartState): Promise<void> {
  const stderrs: string[] = [];
  const attempt = async (args: string[]): Promise<void> => {
    try {
      await runGit(args, { cwd: target, env });
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      stderrs.push(error.stderr.trim());
    }
  };
  if ((await inProgress(target, env)).rebase) await attempt(["rebase", "--quit"]);
  await attempt(
    start.branch === undefined
      ? ["checkout", "--force", "--detach", start.head]
      : ["checkout", "--force", "-B", start.branch, start.head],
  );
  await attempt(["clean", "-fd"]);
  const found: FoundState = { ...(await stateAt(target, env)), ...(await inProgress(target, env)) };
  const right =
    found.head === start.head &&
    found.branch === start.branch &&
    found.changes.length === 0 &&
    !found.rebase &&
    !found.merge;
  if (right) return;
  const n = found.changes.length;
  const where = found.branch === undefined ? "detached" : `on the branch ${found.branch}`;
  const stderr = stderrs[0] === undefined || stderrs[0] === "" ? "" : `: ${stderrs[0]}`;
  throw new Error(
    `cannot restore the worktree: ${target}: HEAD is at ${found.head}, ${where}` +
      `${found.rebase ? ", a rebase is in progress" : ""}` +
      `${found.merge ? ", a merge is in progress" : ""}` +
      `${n > 0 ? `, ${n} uncommitted changes` : ""}. ` +
      `Run these git commands in the worktree, in this order: ` +
      `${restoreCommands(start, found).join(", then ")}${stderr}`,
  );
}

// The git commands that fit a wrong state, in order. It is exported because the fixture cannot
// make each state: a rebase or a merge in progress appears only when "rebase --quit" or the
// checkout fails. A pure test covers each row.
export function restoreCommands(start: StartState, found: FoundState): string[] {
  const commands: string[] = [];
  if (found.rebase) commands.push("git rebase --abort");
  if (found.merge) commands.push("git merge --abort");
  const wrongPlace =
    found.head !== start.head ||
    (start.branch === undefined ? found.branch !== undefined : found.branch !== start.branch);
  if (wrongPlace) {
    commands.push(
      start.branch === undefined
        ? `git checkout --force --detach ${start.head}`
        : `git checkout --force -B ${start.branch} ${start.head}`,
    );
  }
  if (!wrongPlace && found.changes.some((c) => c.status !== "??")) commands.push("git reset --hard");
  if (found.changes.some((c) => c.status === "??")) commands.push("git clean -fd");
  return commands;
}

// Puts the task worktree back at the start. The caller must find the worktree clean before the
// step, because the restore runs "checkout --force" and "clean -fd". Both delete uncommitted work
// and untracked files. The input checks run before any git call.
export async function restoreWorktree(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
  start: StartState;
}): Promise<void> {
  const { clone, env, path, start } = o;
  if (!isFullRevision(start.head)) {
    throw new Error(`the start revision is not a full revision: ${JSON.stringify(start.head)}`);
  }
  if (start.branch !== undefined) assertTaskBranch(start.branch);
  const target = await assertTaskWorktree({ clone, env, path });
  await restoreAt(target, env, start);
}

// The guard, the clean check and the start read. The restore deletes uncommitted work, so a
// worktree with changes is refused before any step runs.
async function prepare(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
}): Promise<{ target: string; start: StartState }> {
  const { clone, env, path } = o;
  const target = await assertTaskWorktree({ clone, env, path });
  const { changes, ...start } = await stateAt(target, env);
  if (changes.length > 0) throw new Error(uncommittedRefusal(target, changes));
  return { target, start };
}

// Runs one git step in the worktree.
async function runStep(o: {
  target: string;
  env: NodeJS.ProcessEnv;
  args: string[];
}): Promise<void> {
  await runGit(o.args, { cwd: o.target, env: o.env });
}

// Brings the task worktree onto the base with a rebase or a merge. The base is a full revision
// or a full ref. It gives the new head.
export async function reconcileWorktree(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
  baseRevision: string;
  strategy: ReconcileStrategy;
}): Promise<string> {
  const { clone, env, path, baseRevision, strategy } = o;
  assertRevisionInput(baseRevision);
  const { target } = await prepare({ clone, env, path });
  const base = await resolveRevision({ clone, env, value: baseRevision });
  const args =
    strategy === "rebase" ? ["rebase", ...REBASE_OPTIONS, base] : ["merge", ...MERGE_OPTIONS, base];
  await runStep({ target, env, args });
  return worktreeHead(target, env);
}
