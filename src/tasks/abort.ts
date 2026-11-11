import { existsSync } from "node:fs";
import type { Io } from "../cli.js";
import { errorMessage } from "../error-message.js";
import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { issueProviderFor } from "../issues/provider.js";
import { acceptsState } from "../state/commands.js";
import { transitionTask } from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { Task, TaskStore } from "../store/store.js";
import { clearMarkerWrite, runTrackerWrite, type TrackerWrite } from "./tracker-write.js";
import { cleanUpTaskWorkspace, findTaskWorkspace } from "./workspace-cleanup.js";
import { RemoteTaskRefMovedError } from "../vcs/errors.js";
import { uncommittedChangeText, vcsForRepo } from "../vcs/provider.js";

export interface AbortRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The abort reads it again under the task lock.
  taskId: number;
  force: boolean;
  keepRemote: boolean;
  env: NodeJS.ProcessEnv;
  // How long the abort waits for the lock of the clone.
  repoLockWaitMs: number;
  // Prints one line for each step that ran.
  report: (line: string) => void;
  // Gets the success line and the warning of the tracker write.
  trackerIo: Pick<Io, "stdout" | "stderr">;
}

// Removes the worktree and the task branch of an active task and moves it to cancelled.
export async function abortTask(store: TaskStore, request: AbortRequest): Promise<Task> {
  const { repoKey, key } = request.ref;
  return withTaskLock(store, repoKey, key, () => abortLocked(store, request));
}

async function abortLocked(store: TaskStore, request: AbortRequest): Promise<Task> {
  const { config, ref, report } = request;
  const task = store.getTask(request.taskId);
  if (task === undefined) throw new Error(`no task with the id ${request.taskId}`);
  if (!acceptsState("abort", task.state)) {
    throw new Error(`the task of ${task.issueKey} is ${task.state}: tasker abort works only on an active task`);
  }
  const run = store.runStatus(task.id);
  if (run.status === "running") {
    throw new Error(
      `the task of ${task.issueKey} has a run in progress in ${task.state} (tasker process ${run.pid}); wait for it, or stop that process`,
    );
  }
  const { vcs, ctx } = vcsForRepo(config, ref.repoKey, request.env);
  const entry = await findTaskWorkspace(vcs, ctx, task.worktreePath);
  const changes =
    entry !== undefined && existsSync(entry.path) ? await vcs.uncommittedChanges(ctx, { path: entry.path }) : [];
  if (changes.length > 0 && !request.force) {
    const lines = changes.map(uncommittedChangeText);
    throw new Error(
      [`the worktree has uncommitted changes: ${entry!.path}`, ...lines, "tasker abort --force discards them"].join(
        "\n",
      ),
    );
  }
  return withRepoLock(store, ref.repoKey, request.repoLockWaitMs, async () => {
    if (request.keepRemote && task.branch !== null) {
      report(`kept ${task.branch} on origin; to delete it: git push origin --delete ${task.branch}`);
    } else if (!request.keepRemote && task.branch !== null && task.publishedRevision !== null) {
      let deletion;
      try {
        deletion = await vcs.deleteRemoteTaskRef(ctx, {
          taskRef: task.branch,
          published: task.publishedRevision,
        });
      } catch (error) {
        if (error instanceof RemoteTaskRefMovedError) {
          const actual = error.tip.state === "present" ? error.tip.revision : "missing";
          throw new Error(
            `cannot abort ${ref.key}: the task branch ${task.branch} moved on origin: tasker published ${String(error.published)}, origin has ${actual}; someone else pushed to it; use --keep-remote to keep that branch`,
            { cause: error },
          );
        }
        const reason = errorMessage(error);
        throw new Error(
          `cannot abort ${ref.key}: cannot delete the task branch ${task.branch} on origin: ${reason}; run tasker abort ${ref.key} again, or delete the branch from a clone of your own`,
          { cause: error },
        );
      }
      if (deletion.state === "deleted") report(`deleted ${task.branch} on origin`);
    }
    if (entry !== undefined && changes.length > 0) {
      await vcs.discardWorkspaceChanges(ctx, { path: entry.path });
      report(`discarded the uncommitted changes of ${entry.path}`);
    }
    await cleanUpTaskWorkspace(vcs, ctx, entry, task.branch, report);
    // The tracker step runs after the clean-up and before the move to cancelled. A failed write only warns.
    const { issueTracker } = config.repos[ref.repoKey];
    const write =
      issueTracker.provider === "jira"
        ? abortStatusWrite(config, ref, task, request.env)
        : clearMarkerWrite(config, ref, task, request.env);
    if (write !== undefined) await runTrackerWrite(store, task.id, write, request.trackerIo);
    return transitionTask(store, task.id, "cancelled");
  });
}

// A Jira status has no clear. When abortStatus is set and this task marked the issue, the abort moves the
// issue to that status. Another machine can work on an issue that this task did not mark, so the abort leaves it.
function abortStatusWrite(config: Config, ref: IssueRef, task: Task, env: NodeJS.ProcessEnv): TrackerWrite | undefined {
  const { issueTracker } = config.repos[ref.repoKey];
  const status = issueTracker.abortStatus;
  if (!issueTracker.updateOnStart || status === undefined || !task.trackerMarked) return undefined;
  const target = `${ref.key} to the status ${JSON.stringify(status)}`;
  return {
    action: "abort",
    text: `move ${target}`,
    success: `moved ${target} on the tracker`,
    run: () => issueProviderFor(config, ref.repoKey).markAborted(ref, status, env),
  };
}
