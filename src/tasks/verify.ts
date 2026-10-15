import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { taskInState } from "./task-state.js";

export interface VerifyRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The verify run reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
}

export interface VerifiedRun {
  number: number;
  commands: number;
  logsDir: string;
}

// A result with exitCode means that the step already printed the message.
export type VerifyTaskResult = VerifiedRun | { exitCode: number };

// Runs the verify commands of the repo in the worktree of a task in executed. The task lock covers all the steps.
// It does not wait.
export async function verifyTask(store: TaskStore, request: VerifyRequest): Promise<VerifyTaskResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => verifyLocked(store, request));
}

async function verifyLocked(store: TaskStore, request: VerifyRequest): Promise<VerifyTaskResult> {
  const task = taskInState(store, request.taskId, "executed", "verify");
  if (task.worktreePath === null) throw new Error(`the task of ${task.issueKey} has no worktree`);
  throw new Error("the verify run is not built yet");
}
