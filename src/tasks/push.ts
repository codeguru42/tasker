import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import type { ForgeProvider, PullRequest } from "../forge/provider.js";
import { forgeForRepo } from "../forge/registry.js";
import { transitionTask, transitionWithPrOpened, transitionWithPublication } from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { Task, TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import { matchesTaskBase, prBaseOf } from "./pr-base.js";
import { failRun } from "./run-outcome.js";
import { requireAcceptedTip, requireBranch, taskInState } from "./task-state.js";
import { runReviewWrites } from "./tracker-write.js";

export interface PushRequest {
  config: Config;
  ref: IssueRef;
  // The task that issue lookup found. Push reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
  // How long push waits for the repo lock.
  repoLockWaitMs: number;
  // A provider override for task tests. Commands use the provider in config.
  forge?: ForgeProvider;
}

export interface Pushed {
  branch: string;
  revision: string;
  pushed: boolean;
  review: PeerReviewOutcome;
}

// What push did for the PR that the task records.
// none: push made no forge call. in_peer_review: the task moved there. stays: the PR does not fit the task, so the
// task stays in pushed. warning: a forge or store error left the task in pushed.
export type PeerReviewOutcome =
  | { kind: "none" }
  | { kind: "in_peer_review"; pullRequest: PullRequest }
  | { kind: "stays"; reason: string }
  | { kind: "warning"; reason: string };

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
      branch,
      revision: publication.revision,
      pushed,
      review: await returnToPeerReview(store, request, task, branch),
    };
  });
}

// Moves a published task to in_peer_review when the forge reports its recorded PR as open on the task branch and
// base. The checks run in a fixed order. Any other answer leaves the task in pushed.
async function returnToPeerReview(
  store: TaskStore,
  request: PushRequest,
  task: Task,
  branch: string,
): Promise<PeerReviewOutcome> {
  const { config, env, io } = request;
  const prNumber = task.prNumber;
  if (prNumber === null) return { kind: "none" };
  if (config.repos[task.repoKey].forge === undefined) return { kind: "none" };

  const stays = (reason: string): PeerReviewOutcome => ({
    kind: "stays",
    reason: `${reason}, so the task stays in pushed`,
  });

  let prBase;
  try {
    prBase = prBaseOf(store, task);
  } catch (error) {
    return stays(errorMessage(error));
  }
  const { worktree, baseBranch } = prBase;

  let view;
  try {
    const forge = request.forge ?? forgeForRepo(config, task.repoKey);
    view = await forge.viewPr(prNumber, worktree, env);
  } catch (error) {
    return {
      kind: "warning",
      reason: `warning: cannot read PR #${prNumber} on the forge, so the task stays in pushed: ${errorMessage(error)}`,
    };
  }

  if (view.state !== "open") return stays(`PR #${prNumber} is ${view.state}`);
  if (view.crossRepository) return stays(`PR #${prNumber} comes from another repository`);
  if (view.head !== branch) return stays(`PR #${prNumber} has the head ${view.head}, not ${branch}`);
  if (!matchesTaskBase(view, baseBranch)) {
    return stays(`PR #${prNumber} has the base ${view.base}, not ${baseBranch}`);
  }

  try {
    transitionWithPrOpened(store, task.id, {
      number: view.number,
      url: view.url,
      head: branch,
      base: baseBranch,
      adopted: true,
    });
  } catch (error) {
    return {
      kind: "warning",
      reason: `warning: cannot record the move to in_peer_review, so the task stays in pushed: ${errorMessage(error)}`,
    };
  }
  await runReviewWrites(store, config, request.ref, task, env, io);
  return { kind: "in_peer_review", pullRequest: { number: view.number, url: view.url } };
}
