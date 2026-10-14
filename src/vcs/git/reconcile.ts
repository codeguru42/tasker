import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { detailSuffix } from "../../detail-suffix.js";
import { ReconcileConflictError } from "../errors.js";
import { LOCAL_PREFIX } from "../local-branch.js";
import type { ReconcileStrategy, UncommittedChange } from "../provider.js";
import {
  isAncestor,
  jsonPathList,
  nulFields,
  uncommittedRefusal,
  worktreeChanges,
  worktreeHead,
} from "./changes.js";
import { assertRevision, assertRevisionInput, resolveRevision } from "./refs.js";
import { GitError, isGitExit, runGit } from "./run.js";
import { assertTaskBranchNameAndShape, assertTaskWorktree } from "./worktree.js";

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

// The fast-forward only merge. It has no conflicts.
const FAST_FORWARD_OPTIONS = ["--ff-only", "--no-squash", "--no-autostash"];

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
    branch = ref.startsWith(LOCAL_PREFIX) ? ref.slice(LOCAL_PREFIX.length) : ref;
  } catch (error) {
    if (!isGitExit(error, 1)) throw error;
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
    !wrongPlace(start, found) && found.changes.length === 0 && !found.rebase && !found.merge;
  if (right) return;
  const n = found.changes.length;
  const where = found.branch === undefined ? "detached" : `on the branch ${found.branch}`;
  throw new Error(
    `cannot restore the worktree: ${target}: HEAD is at ${found.head}, ${where}` +
      `${found.rebase ? ", a rebase is in progress" : ""}` +
      `${found.merge ? ", a merge is in progress" : ""}` +
      `${n > 0 ? `, ${n} uncommitted changes` : ""}. ` +
      `Run these git commands in the worktree, in this order: ` +
      `${restoreCommands(start, found).join(", then ")}${detailSuffix(stderrs[0] ?? "")}`,
  );
}

// True when HEAD or the branch differs from the start. For a detached start, start.branch is
// undefined, so a found branch counts as wrong.
function wrongPlace(start: StartState, found: StartState): boolean {
  return found.head !== start.head || found.branch !== start.branch;
}

// The git commands that fit a wrong state, in order. It is exported because the fixture cannot
// make each state: a rebase or a merge in progress appears only when "rebase --quit" or the
// checkout fails. A pure test covers each row.
export function restoreCommands(start: StartState, found: FoundState): string[] {
  const commands: string[] = [];
  if (found.rebase) commands.push("git rebase --abort");
  if (found.merge) commands.push("git merge --abort");
  const wrong = wrongPlace(start, found);
  if (wrong) {
    commands.push(
      start.branch === undefined
        ? `git checkout --force --detach ${start.head}`
        : `git checkout --force -B ${start.branch} ${start.head}`,
    );
  }
  if (!wrong && found.changes.some((c) => c.status !== "??")) commands.push("git reset --hard");
  if (found.changes.some((c) => c.status === "??")) commands.push("git clean -fd");
  return commands;
}

// The branch check of the reconcile functions and the restore. They move the branch of the
// worktree, so they act only on a task branch, as createTaskWorktree() does. The name check runs
// first, then the shape check. A detached start (no branch) passes.
function assertStartBranch(branch: string | undefined): void {
  if (branch === undefined) return;
  assertTaskBranchNameAndShape(branch);
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
  assertRevision("the start revision", start.head);
  assertStartBranch(start.branch);
  const target = await assertTaskWorktree({ clone, env, path });
  await restoreAt(target, env, start);
}

// The guard, the start read, the branch check and the clean check. The restore deletes uncommitted
// work and moves the branch, so a worktree with changes or on a branch that is not a task branch
// is refused before any step runs.
async function prepare(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
}): Promise<{ target: string; start: StartState }> {
  const { clone, env, path } = o;
  const target = await assertTaskWorktree({ clone, env, path });
  const { changes, ...start } = await stateAt(target, env);
  assertStartBranch(start.branch);
  if (changes.length > 0) throw new Error(uncommittedRefusal(target, changes));
  return { target, start };
}

// Runs one git step in the worktree. When the step fails with a GitError, it reads the list of
// unmerged paths. The exit code of git does not tell a conflict from other failures, so only a
// non-empty list means a conflict. With a conflict it aborts the step. Then it restores the
// worktree to the start, and an error of the restore wins. Then it throws a
// ReconcileConflictError for a conflict, or else the GitError again.
// Any other error passes through with no restore.
async function runStep(o: {
  target: string;
  env: NodeJS.ProcessEnv;
  start: StartState;
  args: string[];
  kind: ReconcileStrategy;
  base: string;
}): Promise<void> {
  const { target, env, start, args, kind, base } = o;
  try {
    await runGit(args, { cwd: target, env });
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    const paths = await unmergedPaths(target, env);
    if (paths.length > 0) {
      // The restore runs next and makes sure that the state is right, so a failed abort is dropped.
      await runGit([kind, "--abort"], { cwd: target, env }).catch((abortError: unknown) => {
        if (!(abortError instanceof GitError)) throw abortError;
      });
    }
    await restoreAt(target, env, start);
    if (paths.length === 0) throw error;
    throw new ReconcileConflictError(
      `the ${kind} onto ${base} stopped on conflicts: ${target}: ${jsonPathList(paths)}`,
      paths,
    );
  }
}

// The paths that a step left unmerged, raw, one time each.
async function unmergedPaths(target: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  try {
    const output = await runGit(["diff", "--name-only", "--diff-filter=U", "-z"], {
      cwd: target,
      env,
    });
    return nulFields(output);
  } catch (error) {
    if (error instanceof GitError) return [];
    throw error;
  }
}

function strategyArgs(strategy: ReconcileStrategy, base: string): string[] {
  return strategy === "rebase"
    ? ["rebase", ...REBASE_OPTIONS, base]
    : ["merge", ...MERGE_OPTIONS, base];
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
  const { target, start } = await prepare({ clone, env, path });
  const base = await resolveRevision({ clone, env, value: baseRevision });
  await runStep({ target, env, start, args: strategyArgs(strategy, base), kind: strategy, base });
  return worktreeHead(target, env);
}

// Rebases only the commits after the upstream onto a base. Both are full revisions or full refs.
// Stacked tasks use it. It gives the new head.
export async function rebaseOnto(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
  upstream: string;
  onto: string;
}): Promise<string> {
  const { clone, env, path } = o;
  assertRevisionInput(o.upstream);
  assertRevisionInput(o.onto);
  const { target, start } = await prepare({ clone, env, path });
  const upstream = await resolveRevision({ clone, env, value: o.upstream });
  const onto = await resolveRevision({ clone, env, value: o.onto });
  const args = ["rebase", ...REBASE_OPTIONS, "--onto", onto, upstream];
  await runStep({ target, env, start, args, kind: "rebase", base: onto });
  return worktreeHead(target, env);
}

export interface ResyncResult {
  moved: boolean;
  how: "none" | "fast-forward" | "rebase" | "merge";
  head: string;
}

// The one rule for the result: moved is true for every case except "none".
async function resyncResult(
  target: string,
  env: NodeJS.ProcessEnv,
  how: ResyncResult["how"],
): Promise<ResyncResult> {
  return { moved: how !== "none", how, head: await worktreeHead(target, env) };
}

// Brings the task worktree onto the base tip that the caller fetched. It does not fetch.
// If the base tip is HEAD or an ancestor of HEAD, nothing moves ("none"). A task that the base
// got by a fast-forward outside tasker gives this case. A task that the base got with a merge
// commit outside tasker gives "fast-forward", because the merge commit is ahead of HEAD.
// If HEAD is an ancestor of the base tip, it fast-forwards. Else it runs the strategy, with the
// restore and the conflict rule of reconcileWorktree().
export async function resyncWorktree(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
  baseRevision: string;
  strategy: ReconcileStrategy;
}): Promise<ResyncResult> {
  const { clone, env, path, baseRevision, strategy } = o;
  assertRevisionInput(baseRevision);
  const { target, start } = await prepare({ clone, env, path });
  const base = await resolveRevision({ clone, env, value: baseRevision });
  if (await isAncestor({ clone, env, ancestor: base, descendant: start.head })) {
    return resyncResult(target, env, "none");
  }
  if (await isAncestor({ clone, env, ancestor: start.head, descendant: base })) {
    const args = ["merge", ...FAST_FORWARD_OPTIONS, base];
    await runStep({ target, env, start, args, kind: "merge", base });
    return resyncResult(target, env, "fast-forward");
  }
  await runStep({ target, env, start, args: strategyArgs(strategy, base), kind: strategy, base });
  return resyncResult(target, env, strategy);
}
