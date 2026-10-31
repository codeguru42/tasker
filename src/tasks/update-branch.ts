import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import {
  type BranchSnapshot,
  type TaskState,
  transitionFromEvents,
  transitionTask,
  transitionWithBranchUpdate,
} from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { BranchUpdateWrites, Task, TaskStore } from "../store/store.js";
import {
  type ReconcileStrategy,
  type ReplayStart,
  type ResyncResult,
  type RemoteTaskRefSides,
  type VcsProvider,
  type VcsContext,
  uncommittedChangeText,
  vcsForRepo,
} from "../vcs/provider.js";
import { hasLanded, isLocalBase, parentOf } from "./parent.js";
import { failRun } from "./run-outcome.js";
import { requireBase, requireBaseRevision, requireBranch, requireWorktree, taskInState } from "./task-state.js";

export interface UpdateBranchRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The command reads it again under the task lock.
  taskId: number;
  // The raw value of --strategy, or undefined when the option is absent.
  strategy: string | undefined;
  // True with --take-remote: the sync step moves the branch and the worktree to the remote tip for each divergence, also
  // when local work is at risk or no commit is only on origin.
  takeRemote: boolean;
  env: NodeJS.ProcessEnv;
  io: Io;
  // How long the command waits for the lock of the clone.
  repoLockWaitMs: number;
}

// What the sync step did. A fast-forward and a take have a remote tip: the tip of the copy on origin that the step moved to.
export type SyncOutcome = { sync: "fast-forward" | "take-remote"; remoteTip: string } | { sync: "absent" | "none" };

export type BranchUpdated = SyncOutcome & {
  issueKey: string;
  base: string;
  // The tip of the base that the command read.
  baseTip: string;
  // The task branch.
  branch: string;
  how: ResyncResult["how"];
  // The head at the start of the base step. After a move of the sync step, this is the remote tip.
  headBefore: string;
  headAfter: string;
  // The synced base tip that the replay started after, set when the replay started there.
  replayedAfter?: string;
  // The key of the parent that the task is no longer stacked on, set when the parent landed.
  unstackedFrom?: string;
  // The state of the task before the command.
  origin: TaskState;
  // The state of the task after the command.
  state: TaskState;
};

// The note for a replay that fell back to the merge base. A replay after the synced base tip needs no note.
function replayNote(issueKey: string, start: ReplayStart): string | undefined {
  if (start.from === "synced-base-tip") return undefined;
  const tail = `tasker replayed the commits after the merge base ${start.mergeBase}\n`;
  switch (start.why) {
    case "not-ancestor":
      return `note: the synced base tip ${start.syncedBaseTip} of ${issueKey} is not an ancestor of HEAD; ${tail}`;
    case "check-failed":
      return `note: tasker could not check the synced base tip ${start.syncedBaseTip} of ${issueKey} (git exit code ${String(start.exitCode)}); ${tail}`;
    case "no-synced-base-tip":
      return `note: ${issueKey} has no synced base tip; ${tail}`;
  }
}

// A result with exitCode means that the step already printed the message.
export type UpdateBranchResult = BranchUpdated | { exitCode: number };

// The target of a task demoted task, by origin state. An origin that is not in the table keeps its state.
const DEMOTED_TO: Readonly<Partial<Record<TaskState, TaskState>>> = {
  approved: "awaiting_plan_review",
  awaiting_work_review: "executed",
  reviewed: "executed",
  accepted: "executed",
  pushed: "executed",
  in_peer_review: "executed",
};

// The states a task failed in that a demotion moves to executed.
const FAILED_IN_DEMOTED: readonly TaskState[] = ["reviewing", "accepted", "pushing", "opening_pr", "merging"];

function demotedTarget(origin: TaskState, failedIn: TaskState | undefined): TaskState {
  if (origin === "failed") {
    return failedIn !== undefined && FAILED_IN_DEMOTED.includes(failedIn) ? "executed" : origin;
  }
  return DEMOTED_TO[origin] ?? origin;
}

function strategyOf(raw: string | undefined, fallback: ReconcileStrategy): ReconcileStrategy {
  if (raw === undefined) return fallback;
  if (raw === "rebase" || raw === "merge") return raw;
  throw new Error(`--strategy must be rebase or merge: ${raw}`);
}

// Throws when the branch of the parent of a stacked task is gone from the clone. The name of the branch comes from
// the parent task. The stored base of the stacked task is only for the error text.
async function requireParentBranch(vcs: VcsProvider, ctx: VcsContext, parent: Task, base: string): Promise<void> {
  if (!(await vcs.taskRefExists(ctx, { taskRef: requireBranch(parent) }))) {
    throw new Error(`the branch of the parent ${parent.issueKey} is gone: ${base}`);
  }
}

// The base of a task whose parent landed: the base of the parent, and the stored revision of that base. The parent
// must not be stacked too.
function landedParentBase(store: TaskStore, task: Task, parent: Task): { base: string; revision: string } {
  const base = requireBase(parent);
  if (isLocalBase(base)) {
    throw new Error(`the parent ${parent.issueKey} of ${task.issueKey} is stacked too; its base is ${base}`);
  }
  return { base, revision: requireBaseRevision(store, parent) };
}

// True when the worktree is at the head of the start, on the task branch and clean. A failed read of the state counts
// as not back at the start.
async function backAtStart(
  vcs: VcsProvider,
  ctx: VcsContext,
  start: { path: string; branch: string; head: string },
): Promise<boolean> {
  try {
    const state = await vcs.workspaceState(ctx, { path: start.path });
    return state.head === start.head && state.taskRef === start.branch && state.changes.length === 0;
  } catch {
    return false;
  }
}

// Decides the move of the sync step for tips that have diverged. A commit only on origin is a remote-side commit with
// no same-patch commit on the local side. A remote merge commit always counts. Local work at risk is a local-side
// commit that is not a merge commit, has no same-patch commit on the remote side, and that the base tip does not reach.
// With takeRemote, the result is "take". Without it, the step throws the error that lists the commits at risk when local
// work is at risk and a commit is only on origin. With a commit only on origin and no work at risk, the result is "take".
// With local work at risk and no commit only on origin, the result is "note": nothing moves, and the caller writes a note.
// Otherwise the result is "none".
function divergedTake(
  sides: RemoteTaskRefSides,
  o: { branch: string; issueKey: string; takeRemote: boolean },
): "take" | "none" | "note" {
  const { branch, issueKey, takeRemote } = o;
  const onlyOnOrigin = sides.remote.some((c) => c.merge || !c.samePatch);
  const atRisk = sides.local.filter((c) => !c.merge && !c.samePatch && !c.onBase);
  if (takeRemote) return "take";
  if (atRisk.length > 0 && onlyOnOrigin) {
    throw new Error(
      [
        `${branch} and origin/${branch} have diverged, and origin/${branch} has no copy of these commits:`,
        ...atRisk.map((c) => `${c.revision.slice(0, 7)} ${c.subject}`),
        `run tasker update-branch ${issueKey} --take-remote to take origin/${branch} and drop them`,
      ].join("\n"),
    );
  }
  if (onlyOnOrigin) return "take";
  return atRisk.length > 0 ? "note" : "none";
}

// Brings the task branch current with its copy on origin and brings the worktree of the task up to date with its base.
// The task lock covers all the steps and does not wait. The repo lock covers the fetch and the move of the branch. The
// sync step comes first. It fast-forwards the task branch when the local tip is an ancestor of the copy on origin. For tips that have diverged, it compares
// the patches of the two sides. It moves the task branch and the worktree to the copy on origin when origin has a commit
// only on origin and no local work is at risk, or with takeRemote. It fails and lists the commits at risk only when local work is at risk, origin has
// a commit only on origin, and takeRemote is off. With local work at risk and no commit only on origin, nothing moves and
// a note goes to stderr. Then the base step runs on the new local tip. A failed base step also undoes the sync move. When
// the head moved in either step, the task goes to the target of the demotion table. A task that is ready to land, or that
// failed in the land, with a head that is not the accepted revision also goes to the target, because it needs a new
// review. Otherwise it goes back to its origin state.
export async function updateBranchTask(store: TaskStore, request: UpdateBranchRequest): Promise<UpdateBranchResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => updateBranchLocked(store, request));
}

async function updateBranchLocked(store: TaskStore, request: UpdateBranchRequest): Promise<UpdateBranchResult> {
  const { config, env, io } = request;
  const task = taskInState(store, request.taskId, "update-branch");
  const branch = requireBranch(task);
  const path = requireWorktree(task);
  const base = requireBase(task);
  const baseRevision = requireBaseRevision(store, task);
  const parent = parentOf(store, task);
  const strategy = strategyOf(request.strategy, config.repos[task.repoKey].updateBranchStrategy);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const start = await vcs.workspaceState(ctx, { path });
  if (start.changes.length > 0) {
    throw new Error(
      [
        `the worktree has uncommitted changes: ${path}`,
        ...start.changes.map(uncommittedChangeText),
        "tasker update-branch needs a clean worktree",
      ].join("\n"),
    );
  }
  const before: BranchSnapshot = { head: start.head, base, baseRevision, syncedBaseTip: task.syncedBaseTip };
  const origin = task.state as TaskState;
  const failedIn = origin === "failed" ? transitionFromEvents(store.listEvents(task.id), "failed") : undefined;
  return withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    transitionTask(store, task.id, "updating_branch", { head: before.head });
    // What the sync step did, and the head after it. The catch reads both to undo a sync move.
    let synced: SyncOutcome = { sync: "none" };
    let syncedHead = before.head;
    try {
      const landed = parent !== undefined && hasLanded(parent);
      const target = landed ? landedParentBase(store, task, parent) : { base, revision: baseRevision };
      if (parent !== undefined && !landed) await requireParentBranch(vcs, ctx, parent, base);
      const { revision, baseTip, contains } = await vcs.baseContainment(ctx, {
        taskRef: branch,
        baseRevision: target.revision,
      });
      const remote = await vcs.fetchedRemoteTaskRef(ctx, { taskRef: branch, revision });
      if (remote.state === "absent") {
        synced = { sync: "absent" };
        io.stderr(`note: origin/${branch} does not exist; nothing to sync from\n`);
      } else if (remote.relation === "local-ancestor") {
        syncedHead = await vcs.moveWorkspace(ctx, { path, revision: remote.revision });
        synced = { sync: "fast-forward", remoteTip: remote.revision };
      } else if (remote.relation === "diverged") {
        const sides = await vcs.remoteTaskRefSides(ctx, {
          taskRef: branch,
          revision,
          remoteRevision: remote.revision,
          baseRevision: baseTip,
        });
        const move = divergedTake(sides, { branch, issueKey: task.issueKey, takeRemote: request.takeRemote });
        if (move === "take") {
          syncedHead = await vcs.moveWorkspace(ctx, { path, revision: remote.revision });
          synced = { sync: "take-remote", remoteTip: remote.revision };
        } else if (move === "note") {
          io.stderr(`note: ${branch} and origin/${branch} have diverged; reconcile the two branches by hand\n`);
        }
      }
      // `contains` describes the local tip before the sync step, and a take can move to a tip without the base.
      const upToDate = contains && synced.sync !== "take-remote";
      let replayStart: ReplayStart | undefined;
      const resynced: Pick<ResyncResult, "how" | "head"> = upToDate
        ? { how: "none", head: syncedHead }
        : parent !== undefined && strategy === "rebase"
          ? // The new tip of a stacked task is the tip of the branch of the parent while the parent is in flight,
            // and the tip of the base of the parent after the parent landed. Under rebase, the replay puts the
            // commits after the synced base tip onto the new tip, with a rebase. It falls back to the commits after
            // the merge base. Under merge, a stacked task uses the resync of every other task.
            {
              how: "rebase",
              head: await vcs.replayOnto(ctx, {
                path,
                onto: baseTip,
                syncedBaseTip: task.syncedBaseTip ?? undefined,
                onStart: (start) => {
                  replayStart = start;
                  const note = replayNote(task.issueKey, start);
                  if (note !== undefined) io.stderr(note);
                },
              }),
            }
          : await vcs.resync(ctx, { path, baseRevision: baseTip, strategy });
      const moved = "remoteTip" in synced || resynced.how !== "none";
      // A task that is ready to land, or failed in the land, with a head that is not the accepted revision needs a new
      // review, also when the head did not move. A task with no accepted revision needs a new review too. This value
      // does not change moved, because moved also decides the base event.
      const unaccepted = (origin === "accepted" || failedIn === "merging") && resynced.head !== task.acceptedRevision;
      const state = moved || unaccepted ? demotedTarget(origin, failedIn) : origin;
      const writes: BranchUpdateWrites = {};
      // After the parent landed, the base switches also when the head does not move.
      if (moved || landed) writes.base = { ...target, source: landed ? "parent" : "update" };
      // Each move of the base step, and the switch after the parent landed, build the branch on the base tip.
      if (resynced.how !== "none" || landed) writes.syncedBaseTip = baseTip;
      if (moved && origin === "approved") writes.clearPlanApproval = store.pinnedPlanRevision(task.id)?.version;
      const after: BranchSnapshot = {
        head: resynced.head,
        base: writes.base?.base ?? base,
        baseRevision: writes.base?.revision ?? baseRevision,
        syncedBaseTip: writes.syncedBaseTip ?? before.syncedBaseTip,
      };
      transitionWithBranchUpdate(
        store,
        task.id,
        state,
        { before, after, how: resynced.how, sync: synced.sync },
        writes,
      );
      return {
        issueKey: task.issueKey,
        base: target.base,
        baseTip,
        ...(replayStart?.from === "synced-base-tip" ? { replayedAfter: replayStart.syncedBaseTip } : {}),
        ...(landed ? { unstackedFrom: parent.issueKey } : {}),
        branch,
        ...synced,
        how: resynced.how,
        headBefore: syncedHead,
        headAfter: resynced.head,
        origin,
        state,
      };
    } catch (error) {
      const message = errorMessage(error);
      if (syncedHead !== before.head) {
        // Undo the sync move. A failed move back shows in backAtStart, so its error is dropped.
        await vcs.moveWorkspace(ctx, { path, revision: before.head }).catch(() => undefined);
      }
      if (await backAtStart(vcs, ctx, { path, branch, head: before.head })) {
        // This step does not call failRunTo: the branch_updated event takes the place of the transition event.
        transitionWithBranchUpdate(
          store,
          task.id,
          origin,
          { before, after: before, how: "none", sync: synced.sync, error: message },
          {},
        );
        io.stderr(`${message}\n`);
        return { exitCode: 1 };
      }
      return failRun(store, task, io, `updating branch failed: ${message}`);
    }
  });
}
