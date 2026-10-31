import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import { transitionWithMarkedLanding } from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import { assertParentLanded } from "./parent.js";
import { requireBase, requireBranch, taskInState } from "./task-state.js";

export interface MarkLandedRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The command reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  // How long the command waits for the lock of the clone.
  repoLockWaitMs: number;
}

export interface MarkedLanded {
  issueKey: string;
  revision: string;
}

// Records that the work of a task in accepted, pushed or in_peer_review landed on the base outside tasker, when the
// base contains its task branch. The task lock covers all the steps and does not wait. The repo lock covers the fetch.
// The command never pushes.
export async function markLandedTask(store: TaskStore, request: MarkLandedRequest): Promise<MarkedLanded> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => markLandedLocked(store, request));
}

async function markLandedLocked(store: TaskStore, request: MarkLandedRequest): Promise<MarkedLanded> {
  const { config, env } = request;
  const task = taskInState(store, request.taskId, "mark-landed");
  assertParentLanded(store, task);
  const branch = requireBranch(task);
  const base = requireBase(task);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const baseRevision = vcs.baseRevision(base);
  const read = await withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    try {
      return await vcs.taskRefOnBase(ctx, { taskRef: branch, baseRevision });
    } catch (error) {
      throw new Error(`cannot read the base tip: ${errorMessage(error)}`, { cause: error });
    }
  });
  if (!read.onBase) {
    throw new Error(`the branch ${branch} (${read.revision}) is not on the base ${baseRevision} (${read.baseTip})`);
  }
  transitionWithMarkedLanding(store, task.id, read.revision, read.baseTip);
  return { issueKey: task.issueKey, revision: read.revision };
}
