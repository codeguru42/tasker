import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import { transitionWithAcceptance } from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import { assertBaseMoved } from "./parent.js";
import { requireBaseRevision, requireBranch, requireWorktree, taskInState } from "./task-state.js";

export interface AcceptRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The accept reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  // How long the accept waits for the lock of the clone.
  repoLockWaitMs: number;
}

export interface Accepted {
  issueKey: string;
  revision: string;
}

// Accepts the work of a task in awaiting_work_review when its task branch contains the tip of the base. The task lock
// covers all the steps and does not wait. The repo lock covers the fetch.
export async function acceptTask(store: TaskStore, request: AcceptRequest): Promise<Accepted> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => acceptLocked(store, request));
}

async function acceptLocked(store: TaskStore, request: AcceptRequest): Promise<Accepted> {
  const { config, env } = request;
  const task = taskInState(store, request.taskId, "accept");
  assertBaseMoved(store, task);
  requireWorktree(task);
  const branch = requireBranch(task);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const baseRevision = requireBaseRevision(vcs, task);
  const read = await withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    try {
      return await vcs.baseContainment(ctx, { taskRef: branch, baseRevision });
    } catch (error) {
      throw new Error(`cannot read the base tip: ${errorMessage(error)}`, { cause: error });
    }
  });
  if (!read.contains) {
    throw new Error(
      `the branch ${branch} (${read.revision}) does not contain the tip of the base ${baseRevision} (${read.baseTip})`,
    );
  }
  transitionWithAcceptance(store, task.id, read.revision, read.baseTip);
  return { issueKey: task.issueKey, revision: read.revision };
}
