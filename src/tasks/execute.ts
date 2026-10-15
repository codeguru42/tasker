import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import { orderTodos } from "../plan/todo-order.js";
import { withTaskLock } from "../store/locks.js";
import { readPlanFile } from "../store/plan-file.js";
import { taskNotFound, type TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import { prepareTaskExecuteRun } from "./assistant-run.js";
import { baseRevisionOf } from "./base-revision.js";
import { assertSessionModel } from "./session-model.js";

export interface ExecuteRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The execute reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
  // The clock of the deadline, in milliseconds. The default is Date.now. The deadline tests give their own clock.
  clock?: () => number;
}

export interface ExecutedRun {
  version: number;
  todosDone: number;
  todosTotal: number;
  // True when this run did the fix turn.
  fixTurnDone: boolean;
  // The count of the permission denials of all turns of this run.
  denials: number;
  transcriptPath: string;
}

// A result with exitCode means that the run step already printed the message.
export type ExecuteResult = ExecutedRun | { exitCode: number };

// Carries out the pinned plan revision of a task in approved, one turn for each todo that is not done.
// The task lock covers all the steps. It does not wait.
export async function executeTask(store: TaskStore, request: ExecuteRequest): Promise<ExecuteResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => executeLocked(store, request));
}

async function executeLocked(store: TaskStore, request: ExecuteRequest): Promise<ExecuteResult> {
  const { config, env } = request;
  const task = store.getTask(request.taskId);
  if (task === undefined) throw taskNotFound(request.taskId);
  if (task.state !== "approved") {
    throw new Error(`the task of ${task.issueKey} is in ${task.state}; tasker execute needs approved`);
  }
  const revision = store.pinnedPlanRevision(task.id);
  if (revision === undefined) throw new Error(`the task of ${task.issueKey} is approved, but no revision is pinned`);
  readPlanFile(config.dataRoot, task, revision.version);
  orderTodos(revision.answer.todos);
  const baseRevision = baseRevisionOf(store, task.id);
  if (baseRevision === undefined) throw new Error(`the task of ${task.issueKey} has no base revision`);
  if (task.branch === null) throw new Error(`the task of ${task.issueKey} has no branch`);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  try {
    await vcs.remoteTaskRefTip(ctx, { taskRef: task.branch });
  } catch (error) {
    throw new Error(`cannot read the remote before the run: ${errorMessage(error)}`, { cause: error });
  }
  const stored = store.executeSession(task.id, revision.version);
  if (stored) await assertSessionModel(stored, env, `the execute session of ${task.issueKey}`);
  const prepared = await prepareTaskExecuteRun({
    config,
    store,
    task,
    env,
    session: stored ? { resume: true, sessionId: stored.sessionId, recorded: stored } : { resume: false },
  });
  // The turns come in the next todo.
  void prepared;
  throw new Error("the execute turns are not built yet");
}
