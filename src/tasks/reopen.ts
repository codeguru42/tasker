import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import { REOPEN_REFINE_CONTEXT } from "../prompts/refine.js";
import { transitionWithReopenStart } from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { PlanResult } from "./plan-run.js";
import { assertBaseMoved, parentOf } from "./parent.js";
import { resyncTaskBase } from "./update-branch.js";
import { failRun } from "./run-outcome.js";
import { prepareRefine, runRefine } from "./refine.js";
import { requireBranch, requireWorktree, taskInState } from "./task-state.js";
import { uncommittedChangeText, vcsForRepo } from "../vcs/provider.js";
import type { Task, TaskStore } from "../store/store.js";
import type { ReconcileStrategy, VcsContext, VcsProvider } from "../vcs/provider.js";

export interface ReopenRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. Reopen reads it again under the task lock.
  taskId: number;
  feedback: string;
  env: NodeJS.ProcessEnv;
  io: Io;
  repoLockWaitMs: number;
}

// Resyncs the accepted work, then continues its recorded plan session. The task lock covers both steps.
export async function reopenTask(store: TaskStore, request: ReopenRequest): Promise<PlanResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => reopenLocked(store, request));
}

async function reopenLocked(store: TaskStore, request: ReopenRequest): Promise<PlanResult> {
  const { config, env, io, feedback } = request;
  const task = taskInState(store, request.taskId, "reopen");
  if (feedback.trim() === "") throw new Error("the feedback is empty");
  const branch = requireBranch(task);
  const path = requireWorktree(task);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  if (task.base === null) throw new Error(`the task of ${task.issueKey} has no base revision`);
  const base = task.base;
  const prepared = await prepareRefine(
    store,
    config,
    env,
    task,
    `the task of ${task.issueKey} has no plan revision; run tasker plan first`,
  );
  assertBaseMoved(store, task);

  const start = await cleanTaskWorkspace(vcs, ctx, task, path, branch);
  const branchHead = await vcs.taskRefRevision(ctx, { taskRef: branch });
  if (branchHead !== start.head) {
    throw new Error(`the task branch ${branch} is at ${branchHead}, but its worktree HEAD is ${start.head}`);
  }
  const strategy: ReconcileStrategy = config.repos[task.repoKey].updateBranchStrategy;
  let transitioned = task;
  const startedTask = await withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    assertBaseMoved(store, task);
    transitioned = transitionWithReopenStart(store, task.id, start.head, feedback);
    let resyncedHead = start.head;
    let baseTip: string;
    try {
      const containment = await vcs.baseContainment(ctx, { taskRef: branch, baseRevision: vcs.baseRevision(base) });
      baseTip = containment.baseTip;
      const result = await resyncTaskBase({
        vcs,
        ctx,
        path,
        baseTip,
        currentHead: start.head,
        contains: containment.contains,
        syncedBaseTip: task.syncedBaseTip,
        parent: parentOf(store, task),
        strategy,
        issueKey: task.issueKey,
        io,
      });
      resyncedHead = result.resynced.head;
    } catch (error) {
      let message = errorMessage(error);
      try {
        await vcs.restoreWorkspace(ctx, { path, taskRef: branch, revision: start.head });
      } catch (restoreError) {
        message = `${message}; cannot restore the worktree: ${errorMessage(restoreError)}`;
      }
      return failRun(store, store.getTask(task.id) ?? transitioned, io, `reopening failed: ${message}`);
    }

    try {
      const completed = store.completeReopen(task.id, baseTip);
      return { completed };
    } catch (error) {
      const head = await vcs
        .workspaceState(ctx, { path })
        .then((state) => state.head)
        .catch(() => resyncedHead);
      const message = `reopening failed: ${errorMessage(error)}; the task branch ${branch} is now at ${head}`;
      return failRun(store, store.getTask(task.id) ?? transitioned, io, message);
    }
  });

  if (!("completed" in startedTask)) return startedTask;
  try {
    return await runRefine(store, {
      config,
      env,
      io,
      task: startedTask.completed,
      source: "reopen",
      context: REOPEN_REFINE_CONTEXT,
      feedback,
      alreadyRefining: true,
      prepared,
    });
  } catch (error) {
    return failRun(
      store,
      store.getTask(task.id) ?? startedTask.completed,
      io,
      `reopening failed: ${errorMessage(error)}`,
    );
  }
}

// The task workspace must be on the stored task branch and have no uncommitted changes.
async function cleanTaskWorkspace(
  vcs: VcsProvider,
  ctx: VcsContext,
  task: Task,
  path: string,
  branch: string,
): Promise<{ head: string }> {
  const state = await vcs.workspaceState(ctx, { path });
  if (state.taskRef === undefined) {
    throw new Error(`the worktree of ${task.issueKey} is detached; expected task branch ${branch}`);
  }
  if (state.taskRef !== branch) {
    throw new Error(`the worktree of ${task.issueKey} is on ${state.taskRef}; expected task branch ${branch}`);
  }
  if (state.changes.length > 0) {
    throw new Error(
      [
        `the worktree has uncommitted changes: ${path}`,
        ...state.changes.map(uncommittedChangeText),
        "tasker reopen needs a clean worktree",
      ].join("\n"),
    );
  }
  return { head: state.head };
}
