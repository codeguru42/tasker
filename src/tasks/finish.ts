import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import { issueProviderFor } from "../issues/provider.js";
import { transitionTask, transitionWithFinish } from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { RemoteTaskRefMovedError } from "../vcs/errors.js";
import { vcsForRepo } from "../vcs/provider.js";
import { failRunTo } from "./run-outcome.js";
import { runTrackerWrite, trackerTargets } from "./tracker-write.js";
import { taskInState } from "./task-state.js";
import { cleanUpTaskWorkspace, findTaskWorkspace } from "./workspace-cleanup.js";

export interface FinishRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The command reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
  // How long the command waits for the lock of the clone.
  repoLockWaitMs: number;
}

export interface Finished {
  issueKey: string;
}

// A result with exitCode means that the step already printed the message.
export type FinishTaskResult = Finished | { exitCode: number };

// Removes the worktree and the local task branch of a task in landed or cleanup_failed. The task lock covers all the
// steps and does not wait. The repo lock covers the cleanup. A failure after the move to finishing moves the task to
// cleanup_failed, and a second run finishes the steps that are left.
export async function finishTask(store: TaskStore, request: FinishRequest): Promise<FinishTaskResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => finishLocked(store, request));
}

async function finishLocked(store: TaskStore, request: FinishRequest): Promise<FinishTaskResult> {
  const { config, env, io } = request;
  const task = taskInState(store, request.taskId, "finish");
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  return withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    transitionTask(store, task.id, "finishing");
    try {
      const entry = await findTaskWorkspace(vcs, ctx, task.worktreePath);
      const result = await cleanUpTaskWorkspace(vcs, ctx, entry, task.branch, (line) => io.stdout(`${line}\n`));
      let remoteResult: "skipped" | "deleted" | "already-gone" | { state: "failed"; reason: string } = "skipped";
      if (task.publishedRevision !== null && task.branch !== null) {
        try {
          remoteResult = (
            await vcs.deleteRemoteTaskRef(ctx, { taskRef: task.branch, published: task.publishedRevision })
          ).state;
        } catch (error) {
          if (error instanceof RemoteTaskRefMovedError) {
            const moved = error as RemoteTaskRefMovedError & {
              published: string;
              tip: { state: "present"; revision: string };
            };
            const reason =
              `the task branch ${moved.taskRef} moved on origin: tasker published ${moved.published}, ` +
              `origin has ${moved.tip.revision}; local cleanup already occurred; decide what to do with the extra ` +
              `commits, then run tasker finish ${request.ref.key} again`;
            return failRunTo(store, task, io, "cleanup_failed", `finishing failed: ${reason}`);
          }
          const message = errorMessage(error);
          remoteResult = { state: "failed", reason: message };
          store.appendEvent(task.id, "remote_cleanup_warning", {
            branch: task.branch,
            publishedRevision: task.publishedRevision,
            error: message,
          });
          io.stderr(`warning: cannot delete the task branch ${task.branch} on origin: ${message}\n`);
        }
      }
      const { issueTracker } = config.repos[task.repoKey];
      if (issueTracker.updateOnFinish) {
        // The write comes before the move to finished, so a second run after a crash does it again.
        await runTrackerWrite(
          store,
          task.id,
          {
            action: "done",
            text: `mark ${request.ref.key} done`,
            success: `marked ${request.ref.key} done on the tracker`,
            run: () =>
              issueProviderFor(config, task.repoKey).markDone(request.ref, trackerTargets(issueTracker).done, env),
          },
          io,
        );
      }
      try {
        transitionWithFinish(store, task.id, { ...result });
      } catch (error) {
        const remote =
          typeof remoteResult === "string"
            ? `remote branch ${remoteResult}`
            : `remote branch failed: ${remoteResult.reason}`;
        const cleanup = `worktree ${result.worktree}, local branch ${result.branch}, ${remote}`;
        const message =
          typeof remoteResult === "string"
            ? `finishing failed after external cleanup succeeded (${cleanup}): completion record failed: ${errorMessage(error)}`
            : `finishing failed after cleanup (${cleanup}): completion record failed: ${errorMessage(error)}`;
        return failRunTo(store, task, io, "cleanup_failed", message);
      }
    } catch (error) {
      return failRunTo(store, task, io, "cleanup_failed", `finishing failed: ${errorMessage(error)}`);
    }
    return { issueKey: task.issueKey };
  });
}
