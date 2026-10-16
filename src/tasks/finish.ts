import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import { transitionTask } from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import { taskInState } from "./task-state.js";
import { cleanUpTaskWorkspace } from "./workspace-cleanup.js";

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
  const task = taskInState(store, request.taskId, ["landed", "cleanup_failed"], "finish");
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  return withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    transitionTask(store, task.id, "finishing");
    try {
      const result = await cleanUpTaskWorkspace(vcs, ctx, task, (line) => io.stdout(`${line}\n`));
      transitionTask(store, task.id, "finished", { ...result });
    } catch (error) {
      const message = `finishing failed: ${errorMessage(error)}`;
      transitionTask(store, task.id, "cleanup_failed", { error: message });
      io.stderr(`${message}\n`);
      return { exitCode: 1 };
    }
    return { issueKey: task.issueKey };
  });
}
