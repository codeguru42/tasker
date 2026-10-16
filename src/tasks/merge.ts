import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import { transitionTask, transitionWithLanding } from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { LOCAL_PREFIX } from "../vcs/local-branch.js";
import { vcsForRepo } from "../vcs/provider.js";
import { failRun } from "./run-outcome.js";
import { requireBase, requireBaseRevision, requireBranch, taskInState } from "./task-state.js";

export interface MergeRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The merge reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
  // How long the merge waits for the lock of the clone.
  repoLockWaitMs: number;
}

export interface Merged {
  issueKey: string;
  base: string;
  revision: string;
  pushed: boolean;
}

// A result with exitCode means that the step already printed the message.
export type MergeTaskResult = Merged | { exitCode: number };

// Lands the work of a task in accepted on the base branch of origin. The task lock covers all the steps and does not
// wait. The repo lock covers the fetch and the push. A failure after the move to merging moves the task to failed.
export async function mergeTask(store: TaskStore, request: MergeRequest): Promise<MergeTaskResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => mergeLocked(store, request));
}

async function mergeLocked(store: TaskStore, request: MergeRequest): Promise<MergeTaskResult> {
  const { config, env, io } = request;
  const task = taskInState(store, request.taskId, "accepted", "merge");
  const branch = requireBranch(task);
  const base = requireBase(task);
  if (base.startsWith(LOCAL_PREFIX)) {
    throw new Error(
      `the base of ${task.issueKey} is a local branch of the clone: ${base}; tasker merge pushes only to a branch on origin`,
    );
  }
  const baseRevision = requireBaseRevision(store, task);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  return withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    transitionTask(store, task.id, "merging");
    let revision: string;
    let pushed: boolean;
    try {
      const read = await vcs.taskRefOnBase(ctx, { taskRef: branch, baseRevision });
      revision = read.revision;
      pushed = !read.onBase;
      if (pushed) await vcs.land(ctx, { base, revision });
    } catch (error) {
      return failRun(store, task, io, `merging failed: ${errorMessage(error)}`);
    }
    try {
      transitionWithLanding(store, task.id, { revision, base, pushed });
    } catch (error) {
      const reason = pushed
        ? `pushed ${revision} to origin/${base}, but tasker cannot record the result: ${errorMessage(error)}`
        : errorMessage(error);
      return failRun(store, task, io, `merging failed: ${reason}`);
    }
    return { issueKey: task.issueKey, base, revision, pushed };
  });
}
