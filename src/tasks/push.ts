import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import { transitionTask, transitionWithPublication } from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import { failRun } from "./run-outcome.js";
import { requireAcceptedTip, requireBranch, taskInState } from "./task-state.js";

export interface PushRequest {
  config: Config;
  ref: IssueRef;
  // The task that issue lookup found. Push reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
  // How long push waits for the repo lock.
  repoLockWaitMs: number;
}

export interface Pushed {
  issueKey: string;
  branch: string;
  revision: string;
  lease: boolean;
  pushed: boolean;
}

// A result with exitCode means that the step already printed its message.
export type PushTaskResult = Pushed | { exitCode: number };

// Publishes the accepted revision to its task branch on origin. The task lock does not wait. A failure after the move
// to pushing moves the task to failed.
export async function pushTask(store: TaskStore, request: PushRequest): Promise<PushTaskResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => pushLocked(store, request));
}

async function pushLocked(store: TaskStore, request: PushRequest): Promise<PushTaskResult> {
  const { config, env, io } = request;
  const task = taskInState(store, request.taskId, "push");
  const branch = requireBranch(task);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);

  // Check the exact local task ref before any task or remote write.
  requireAcceptedTip(task, branch, await vcs.taskRefRevision(ctx, { taskRef: branch }));

  return withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    transitionTask(store, task.id, "pushing");
    let publication;
    try {
      publication = await vcs.publish(ctx, {
        taskRef: branch,
        published: task.publishedRevision ?? undefined,
      });
    } catch (error) {
      return failRun(store, task, io, `pushing failed: ${errorMessage(error)}`);
    }

    const pushed = publication.state === "published";
    try {
      transitionWithPublication(store, task.id, publication.revision, {
        branch: publication.taskRef,
        lease: publication.lease,
        pushed,
      });
    } catch (error) {
      const reason = pushed
        ? `pushed ${publication.revision} to origin/${branch}, but tasker cannot record the result: ${errorMessage(error)}`
        : errorMessage(error);
      return failRun(store, task, io, `pushing failed: ${reason}`);
    }

    return {
      issueKey: task.issueKey,
      branch,
      revision: publication.revision,
      lease: publication.lease,
      pushed,
    };
  });
}
