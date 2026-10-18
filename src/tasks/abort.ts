import { existsSync } from "node:fs";
import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { issueProviderFor } from "../issues/provider.js";
import { acceptsState } from "../state/commands.js";
import { transitionTask } from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { Task, TaskStore } from "../store/store.js";
import { runTrackerWrite, trackerTargets } from "./tracker-write.js";
import { cleanUpTaskWorkspace, findTaskWorkspace } from "./workspace-cleanup.js";
import { uncommittedChangeText, vcsForRepo } from "../vcs/provider.js";

export interface AbortRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The abort reads it again under the task lock.
  taskId: number;
  force: boolean;
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
    if (entry !== undefined && changes.length > 0) {
      await vcs.discardWorkspaceChanges(ctx, { path: entry.path });
      report(`discarded the uncommitted changes of ${entry.path}`);
    }
    await cleanUpTaskWorkspace(vcs, ctx, entry, task.branch, report);
    // The marker protects an issue against two machines. After an abort, no machine works on the issue,
    // so the abort removes the marker. A failed write only warns. The assignee stays.
    const { issueTracker } = config.repos[ref.repoKey];
    const marker = trackerTargets(issueTracker).inProgress;
    if (issueTracker.updateOnStart && marker !== undefined) {
      await runTrackerWrite(
        store,
        task.id,
        {
          action: "clear_in_progress",
          text: `clear the in-progress marker of ${ref.key}`,
          success: `cleared the in-progress marker of ${ref.key} on the tracker`,
          run: () => issueProviderFor(config, ref.repoKey).clearInProgress(ref, marker, request.env),
        },
        request.trackerIo,
      );
    }
    return transitionTask(store, task.id, "cancelled");
  });
}
