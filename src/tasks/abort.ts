import { existsSync } from "node:fs";
import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { canonicalPath } from "../real-path.js";
import { isTerminalState, transitionTask } from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { Task, TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";

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
  if (isTerminalState(task.state)) {
    throw new Error(`the task of ${task.issueKey} is ${task.state}: tasker abort works only on an active task`);
  }
  const { vcs, ctx } = vcsForRepo(config, ref.repoKey, request.env);
  const entry =
    task.worktreePath === null
      ? undefined
      : (await vcs.listWorkspaces(ctx)).find((e) => e.path === canonicalPath(task.worktreePath!));
  const changes =
    entry !== undefined && existsSync(entry.path)
      ? await vcs.uncommittedChanges(ctx, { path: entry.path })
      : [];
  if (changes.length > 0 && !request.force) {
    const lines = changes.map((change) => `${change.status} ${change.path}`);
    throw new Error(
      [
        `the worktree has uncommitted changes: ${entry!.path}`,
        ...lines,
        "tasker abort --force discards them",
      ].join("\n"),
    );
  }
  return withRepoLock(store, ref.repoKey, request.repoLockWaitMs, async () => {
    if (entry !== undefined) {
      if (changes.length > 0) {
        await vcs.discardWorkspaceChanges(ctx, { path: entry.path });
        report(`discarded the uncommitted changes of ${entry.path}`);
      }
      await vcs.removeWorkspace(ctx, { path: entry.path });
      report(`removed the worktree ${entry.path}`);
    }
    if (task.branch !== null && (await vcs.taskRefExists(ctx, { taskRef: task.branch }))) {
      await vcs.deleteTaskRef(ctx, { taskRef: task.branch });
      report(`deleted the branch ${task.branch}`);
    }
    return transitionTask(store, task.id, "cancelled");
  });
}
