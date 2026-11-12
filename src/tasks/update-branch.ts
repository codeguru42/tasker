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
import { LOCAL_PREFIX } from "../vcs/local-branch.js";
import { newParentId, parentOf, walkLandedParents } from "./parent.js";
import { failRun } from "./run-outcome.js";
import { requireBase, requireBranch, requireWorktree, taskInState } from "./task-state.js";

export interface UpdateBranchRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The command reads it again under the task lock.
  taskId: number;
  // The raw value of --base, or undefined when the option is absent.
  base: string | undefined;
  // The raw value of --strategy, or undefined when the option is absent.
  strategy: string | undefined;
  // True with --take-remote: the sync step moves the branch and the worktree to the remote tip for each divergence, also
  // when local work is at risk or no commit is only on origin.
  takeRemote: boolean;
  // True with --undo: put the head and the synced base tip back to the values before the last run that moved the head.
  undo: boolean;
  env: NodeJS.ProcessEnv;
  io: Io;
  // How long the command waits for the lock of the clone.
  repoLockWaitMs: number;
}

// What the sync step did. A fast-forward and a take have a remote tip: the tip of the copy on origin that the step moved to.
export type SyncOutcome = { sync: "fast-forward" | "take-remote"; remoteTip: string } | { sync: "absent" | "none" };

interface UpdateFacts {
  issueKey: string;
  // The task branch.
  branch: string;
  // The head before the sync step.
  startHead: string;
  headAfter: string;
  // Whether the head moved, in the sync step, in the base step or in an undo.
  moved: boolean;
  // Whether the run wrote an undo record, including a base-only change.
  undoRecorded: boolean;
  // Whether the undo record holds base and parent values from --base.
  undoWithBase: boolean;
  // The synced base tip that the replay started after, set when the replay started there.
  replayedAfter?: string;
  // The key of the direct parent that the task is no longer stacked on, set when the task has no parent after the walk.
  unstackedFrom?: string;
  // The key of the parent that the task is now stacked on, set when the walk ended on a parent that has not landed.
  stackedOn?: string;
  // The state of the task before the command.
  origin: TaskState;
  // The state of the task after the command.
  state: TaskState;
}

// An undo has no base and no base tip, because it fetches nothing and reads no base.
export type BranchUpdated = SyncOutcome &
  UpdateFacts &
  (
    | {
        how: ResyncResult["how"];
        base: string;
        // The tip of the base that the command read.
        baseTip: string;
        // The head at the start of the base step. After a move of the sync step, this is the remote tip.
        headBefore: string;
      }
    | { how: "undo" }
  );

// The note for a replay that starts after the merge base. A replay after the synced base tip needs no note.
function replayNote(issueKey: string, start: ReplayStart): string | undefined {
  if (start.from === "synced-base-tip") return undefined;
  const tail = `tasker replays the commits after the merge base ${start.mergeBase}\n`;
  switch (start.why) {
    case "not-ancestor":
      return `note: the synced base tip ${start.syncedBaseTip} of ${issueKey} is not an ancestor of HEAD; ${tail}`;
    case "check-failed":
      return `note: tasker could not check the synced base tip ${start.syncedBaseTip} of ${issueKey} (git exit code ${String(start.exitCode)}); ${tail}`;
    case "no-synced-base-tip":
      return `note: ${issueKey} has no synced base tip; ${tail}`;
    case "newer-merge-base":
      return `note: the merge base ${start.mergeBase} of ${issueKey} is newer than the synced base tip ${start.syncedBaseTip}; ${tail}`;
  }
}

interface BaseResyncRequest {
  vcs: VcsProvider;
  ctx: VcsContext;
  path: string;
  baseTip: string;
  currentHead: string;
  contains: boolean;
  syncedBaseTip: string | null;
  parent: Task | undefined;
  strategy: ReconcileStrategy;
  issueKey: string;
  io: Io;
}

interface BaseResyncResult {
  resynced: ResyncResult;
  replayStart?: ReplayStart;
}

// Resync the task worktree onto the fetched base tip. Both reopen and update-branch use this base step.
export async function resyncTaskBase(request: BaseResyncRequest): Promise<BaseResyncResult> {
  const { vcs, ctx, path, baseTip, currentHead, contains, syncedBaseTip, parent, strategy, issueKey, io } = request;
  if (contains) return { resynced: { moved: false, how: "none", head: currentHead } };
  if (parent !== undefined && strategy === "rebase") {
    let replayStart: ReplayStart | undefined;
    const head = await vcs.replayOnto(ctx, {
      path,
      onto: baseTip,
      syncedBaseTip: syncedBaseTip ?? undefined,
      onStart: (start) => {
        replayStart = start;
        const note = replayNote(issueKey, start);
        if (note !== undefined) io.stderr(note);
      },
    });
    return {
      resynced: { moved: head !== currentHead, how: "rebase", head },
      ...(replayStart === undefined ? {} : { replayStart }),
    };
  }
  return { resynced: await vcs.resync(ctx, { path, baseRevision: baseTip, strategy }) };
}

// The note for a merge move of a task that had a parent when the command started.
function mergeMoveNote(base: string, issueKey: string): string {
  return `note: tasker merged ${base} into ${issueKey}, so the commits of the parent are now in its history; use --strategy rebase for a stacked task that has no merge move yet\n`;
}

// A result with exitCode means that the step already printed the message.
export type UpdateBranchResult = BranchUpdated | { exitCode: number };

// The target of a demoted task, by origin state. An origin that is not in the table keeps its state.
const DEMOTED_TO: Readonly<Partial<Record<TaskState, TaskState>>> = {
  approved: "awaiting_plan_review",
  awaiting_work_review: "executed",
  reviewed: "executed",
  accepted: "executed",
  pushed: "executed",
  in_peer_review: "executed",
};

// The states a task failed in that a demotion moves to executed.
const FAILED_IN_DEMOTED: readonly TaskState[] = ["reviewing", "accepted", "opening_pr", "merging"];

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
// the parent task, and the error text names the same branch.
async function requireParentBranch(vcs: VcsProvider, ctx: VcsContext, parent: Task): Promise<void> {
  const branch = requireBranch(parent);
  if (!(await vcs.taskRefExists(ctx, { taskRef: branch }))) {
    throw new Error(`the branch of the parent ${parent.issueKey} is gone: ${LOCAL_PREFIX}${branch}`);
  }
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

// The values that tasker update-branch --undo reads: the head and the synced base tip before the run, and the head after.
function undoRecord(before: BranchSnapshot, after: BranchSnapshot) {
  return { beforeHead: before.head, afterHead: after.head, syncedBaseTip: before.syncedBaseTip };
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
// review. Otherwise it goes back to its origin state. With undo, the command instead puts the head and the synced base tip
// back to the values that the last run which moved the head stored. The undo counts as a move.
export async function updateBranchTask(store: TaskStore, request: UpdateBranchRequest): Promise<UpdateBranchResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => updateBranchLocked(store, request));
}

async function updateBranchLocked(store: TaskStore, request: UpdateBranchRequest): Promise<UpdateBranchResult> {
  const { config, env, io } = request;
  const task = taskInState(store, request.taskId, "update-branch");
  const origin = task.state as TaskState;
  const failedIn = origin === "failed" ? transitionFromEvents(store.listEvents(task.id), "failed") : undefined;
  if (failedIn === "pushing") {
    throw new Error(
      `the task of ${task.issueKey} failed in pushing; run tasker retry ${task.issueKey} first, so that tasker records what the push published`,
    );
  }
  const branch = requireBranch(task);
  const path = requireWorktree(task);
  const base = requireBase(task);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const baseRevision = vcs.baseRevision(base);
  const parent = parentOf(store, task);
  const strategy = strategyOf(request.strategy, config.repos[task.repoKey].updateBranchStrategy);
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
  const run: UpdateRun = { store, task, vcs, ctx, io, path, branch, before, origin };
  if (request.undo) return undoLastUpdate(run, request, failedIn);
  return withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    // The walk reads only rows. A loop or a local base with no parent throws here, before any write.
    const resolved =
      request.base === undefined
        ? undefined
        : await vcs.resolveBase(ctx, {
            memory: store,
            issueKey: task.issueKey,
            note: (line) => io.stderr(line),
            explicit: request.base,
            ask: async () => {
              throw new Error("cannot ask for a base when --base is set");
            },
          });
    const walk = resolved === undefined ? walkLandedParents(store, task) : undefined;
    const target =
      resolved ??
      (walk === undefined
        ? { base, revision: baseRevision }
        : { base: walk.base, revision: vcs.baseRevision(walk.base) });
    const explicitParentId = resolved === undefined ? undefined : newParentId(store, task.repoKey, resolved.base);
    const explicitParent =
      explicitParentId === undefined
        ? undefined
        : explicitParentId === null
          ? undefined
          : store.getTask(explicitParentId);
    const stackedOn = resolved === undefined ? (walk === undefined ? parent : walk.newParent) : explicitParent;
    const afterBase: BranchSnapshot = { ...before, base: target.base, baseRevision: target.revision };
    transitionTask(store, task.id, "updating_branch", { head: before.head });
    if (resolved !== undefined) {
      const parentTaskId = explicitParentId ?? null;
      run.failureAfter = afterBase;
      store.updateTask(
        task.id,
        {
          base: resolved.base,
          parentTaskId,
          undoBeforeHead: before.head,
          undoAfterHead: before.head,
          undoSyncedBaseTip: before.syncedBaseTip,
          undoBeforeBase: base,
          undoBeforeParentTaskId: task.parentTaskId,
          undoAfterBase: resolved.base,
          undoAfterParentTaskId: parentTaskId,
        },
        () => ({ type: "base", data: { base: resolved.base, revision: resolved.revision, source: "explicit" } }),
      );
    }
    // What the sync step did, and the head after it. The catch reads both to undo a sync move.
    let synced: SyncOutcome = { sync: "none" };
    let syncedHead = before.head;
    try {
      if (stackedOn !== undefined) await requireParentBranch(vcs, ctx, stackedOn);
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
      const { resynced, replayStart } = await resyncTaskBase({
        vcs,
        ctx,
        path,
        baseTip,
        currentHead: syncedHead,
        contains: upToDate,
        syncedBaseTip: task.syncedBaseTip,
        parent: resolved === undefined ? parent : explicitParent,
        strategy,
        issueKey: task.issueKey,
        io,
      });
      const moved = "remoteTip" in synced || resynced.how !== "none";
      // A task that is ready to land, or failed in the land, with a head that is not the accepted revision needs a new
      // review, also when the head did not move. A task with no accepted revision needs a new review too. This value
      // does not change moved, because moved also decides the base event.
      const unaccepted = (origin === "accepted" || failedIn === "merging") && resynced.head !== task.acceptedRevision;
      const state = moved || unaccepted ? demotedTarget(origin, failedIn) : origin;
      const writes: BranchUpdateWrites = {};
      // After the parent landed, the base and the parent switch also when the head does not move.
      if (walk !== undefined) {
        writes.base = { ...target, source: "parent", baseOf: walk.end.issueKey };
        writes.parentTaskId = walk.newParent?.id ?? null;
      }
      // A head move without a parent walk or explicit base writes an update event.
      if (walk === undefined && resolved === undefined && moved) {
        writes.base = { ...target, source: "update" };
      }
      // Each move of the base step, and the switch after the parent landed, build the branch on the base tip.
      if (resynced.how !== "none" || walk !== undefined || resolved !== undefined) writes.syncedBaseTip = baseTip;
      if (moved && origin === "approved") writes.clearPlanApproval = store.pinnedPlanRevision(task.id)?.version;
      const after: BranchSnapshot = {
        head: resynced.head,
        base: target.base,
        baseRevision: target.revision,
        syncedBaseTip: writes.syncedBaseTip ?? before.syncedBaseTip,
      };
      if (moved || resolved !== undefined) {
        writes.undo = {
          ...undoRecord(before, after),
          ...(resolved === undefined
            ? {}
            : {
                beforeBase: base,
                beforeParentTaskId: task.parentTaskId,
                afterBase: resolved.base,
                afterParentTaskId: explicitParentId ?? null,
              }),
        };
      }
      transitionWithBranchUpdate(
        store,
        task.id,
        state,
        {
          before,
          after,
          how: resynced.how,
          sync: synced.sync,
          ...(walk === undefined ? {} : { landedParents: walk.landedParents }),
        },
        writes,
      );
      if ((resolved === undefined ? parent : explicitParent) !== undefined && resynced.how === "merge") {
        io.stderr(mergeMoveNote(target.base, task.issueKey));
      }
      return {
        issueKey: task.issueKey,
        base: target.base,
        baseTip,
        ...(replayStart?.from === "synced-base-tip" ? { replayedAfter: replayStart.syncedBaseTip } : {}),
        ...(walk !== undefined && walk.newParent === undefined ? { unstackedFrom: walk.landedParents[0] } : {}),
        ...(walk?.newParent === undefined ? {} : { stackedOn: walk.newParent.issueKey }),
        branch,
        ...synced,
        how: resynced.how,
        headBefore: syncedHead,
        startHead: before.head,
        headAfter: resynced.head,
        moved,
        undoRecorded: moved || resolved !== undefined,
        undoWithBase: resolved !== undefined,
        origin,
        state,
      };
    } catch (error) {
      return failedUpdate(run, errorMessage(error), syncedHead, synced.sync);
    }
  });
}

// What the failure path and the undo need from a run.
interface UpdateRun {
  store: TaskStore;
  task: Task;
  vcs: VcsProvider;
  ctx: VcsContext;
  io: Io;
  path: string;
  branch: string;
  before: BranchSnapshot;
  origin: TaskState;
  failureAfter?: BranchSnapshot;
}

// The failure path of a run in updating_branch. movedHead is the head that a step left. When it differs from the head
// at the start, the worktree moves back first. Then the task goes back to its origin, or to failed when the worktree is
// not back at the start.
async function failedUpdate(
  run: UpdateRun,
  message: string,
  movedHead: string,
  sync: SyncOutcome["sync"],
): Promise<UpdateBranchResult> {
  const { store, task, vcs, ctx, io, path, branch, before, origin } = run;
  const after = run.failureAfter ?? before;
  if (movedHead !== before.head) {
    // Move back. A failed move back shows in backAtStart, so its error is dropped.
    await vcs.moveWorkspace(ctx, { path, revision: before.head }).catch(() => undefined);
  }
  if (await backAtStart(vcs, ctx, { path, branch, head: before.head })) {
    // This step does not call failRunTo: the branch_updated event takes the place of the transition event.
    transitionWithBranchUpdate(store, task.id, origin, { before, after, how: "none", sync, error: message }, {});
    io.stderr(`${message}\n`);
    return { exitCode: 1 };
  }
  return failRun(store, task, io, `updating branch failed: ${message}`);
}

// Puts the head, the branch and the synced base tip back to the values that the last run stored. An explicit-base
// record also restores the base and parent. The checks come first and write nothing.
async function undoLastUpdate(
  run: UpdateRun,
  request: UpdateBranchRequest,
  failedIn: TaskState | undefined,
): Promise<UpdateBranchResult> {
  const { store, task, vcs, ctx, path, branch, before, origin } = run;
  const { undoBeforeHead, undoAfterHead } = task;
  if (undoBeforeHead === null || undoAfterHead === null) throw new Error(`nothing to undo for ${task.issueKey}`);
  const branchTip = await vcs.taskRefRevision(ctx, { taskRef: branch });
  if (before.head !== undoAfterHead || branchTip !== undoAfterHead) {
    throw new Error(
      `the worktree of ${task.issueKey} moved since the last update (HEAD ${before.head}, branch ${branchTip}, last update ${undoAfterHead}); nothing undone`,
    );
  }
  return withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    transitionTask(store, task.id, "updating_branch", { head: before.head });
    let movedHead = before.head;
    try {
      movedHead = await vcs.moveWorkspace(ctx, { path, revision: undoBeforeHead });
      const undoWithBase = task.undoBeforeBase !== null && task.undoAfterBase !== null;
      const restoredBase = undoWithBase ? task.undoBeforeBase! : before.base;
      const restoredParentTaskId = undoWithBase ? task.undoBeforeParentTaskId : task.parentTaskId;
      const restoredBaseRevision = vcs.baseRevision(restoredBase);
      const after: BranchSnapshot = {
        ...before,
        head: movedHead,
        base: restoredBase,
        baseRevision: restoredBaseRevision,
        syncedBaseTip: task.undoSyncedBaseTip,
      };
      const moved = movedHead !== before.head;
      const unaccepted = (origin === "accepted" || failedIn === "merging") && movedHead !== task.acceptedRevision;
      const state = moved || unaccepted ? demotedTarget(origin, failedIn) : origin;
      const writes: BranchUpdateWrites = {
        syncedBaseTip: task.undoSyncedBaseTip,
        ...(undoWithBase && restoredBase !== before.base
          ? { base: { base: restoredBase, revision: restoredBaseRevision, source: "undo" as const } }
          : {}),
        ...(undoWithBase ? { parentTaskId: restoredParentTaskId } : {}),
        undo: {
          ...undoRecord(before, after),
          ...(undoWithBase
            ? {
                beforeBase: before.base,
                beforeParentTaskId: task.parentTaskId,
                afterBase: restoredBase,
                afterParentTaskId: restoredParentTaskId,
              }
            : {}),
        },
      };
      if (moved && origin === "approved") writes.clearPlanApproval = store.pinnedPlanRevision(task.id)?.version;
      transitionWithBranchUpdate(store, task.id, state, { before, after, how: "undo", sync: "none" }, writes);
      return {
        issueKey: task.issueKey,
        branch,
        how: "undo",
        sync: "none",
        startHead: before.head,
        headAfter: movedHead,
        moved,
        undoRecorded: true,
        undoWithBase,
        origin,
        state,
      };
    } catch (error) {
      return failedUpdate(run, errorMessage(error), movedHead, "none");
    }
  });
}
