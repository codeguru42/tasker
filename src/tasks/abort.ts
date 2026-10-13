import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { canonicalPath } from "../real-path.js";
import { TERMINAL_STATES, transitionTask } from "../state/machine.js";
import type { Task, TaskStore } from "../store/store.js";
import { createVcsProvider } from "../vcs/provider.js";

export interface AbortRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The abort reads it again.
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
  const { config, ref, report } = request;
  const task = store.getTask(request.taskId);
  if (task === undefined) throw new Error(`no task with the id ${request.taskId}`);
  if ((TERMINAL_STATES as ReadonlySet<string>).has(task.state)) {
    throw new Error(`the task of ${task.issueKey} is ${task.state}: tasker abort works only on an active task`);
  }
  if (task.worktreePath !== null || task.branch !== null) {
    const vcs = createVcsProvider(config.repos[ref.repoKey]);
    const ctx = { dataRoot: config.dataRoot, repoKey: ref.repoKey, env: request.env };
    if (task.worktreePath !== null) {
      const path = canonicalPath(task.worktreePath);
      await vcs.removeWorkspace(ctx, { path });
      report(`removed the worktree ${path}`);
    }
    if (task.branch !== null) {
      await vcs.deleteTaskRef(ctx, { taskRef: task.branch });
      report(`deleted the branch ${task.branch}`);
    }
  }
  return transitionTask(store, task.id, "cancelled");
}
