import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import { forgeForRepo } from "../forge/registry.js";
import type { ForgeProvider, MergeMethod } from "../forge/provider.js";
import type { IssueRef } from "../issue-key/ref.js";
import { transitionWithLanding, transitionWithMergeStart, transitionWithPrMerged } from "../state/machine.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import { assertParentLanded, isLocalBase } from "./parent.js";
import { failRun } from "./run-outcome.js";
import { requireAcceptedTip, requireBase, requireBranch, taskInState } from "./task-state.js";

export interface MergeRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The merge reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
  // How long the merge waits for the lock of the clone.
  repoLockWaitMs: number;
  // Tests can supply a forge provider, but the repo still needs forge configuration.
  forge?: ForgeProvider;
}

export interface Merged {
  issueKey: string;
  base: string;
  revision: string;
  pushed: boolean;
}

export interface MergedPullRequest {
  issueKey: string;
  prNumber: number;
  forge: string;
}

// A result with exitCode means that the step already printed the message.
export type MergeTaskResult = Merged | MergedPullRequest | { exitCode: number };

// Merges accepted work to origin or merges a recorded PR. The task lock does not wait. Both paths take the repo lock
// before starting the merge run.
export async function mergeTask(store: TaskStore, request: MergeRequest): Promise<MergeTaskResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => mergeLocked(store, request));
}

async function mergeLocked(store: TaskStore, request: MergeRequest): Promise<MergeTaskResult> {
  const task = taskInState(store, request.taskId, "merge");
  if (task.state === "in_peer_review") return mergePullRequest(store, task, request);
  return mergeAccepted(store, task, request);
}

async function mergeAccepted(store: TaskStore, task: ReturnType<typeof taskInState>, request: MergeRequest) {
  const { config, env, io } = request;
  assertParentLanded(store, task);
  const branch = requireBranch(task);
  const base = requireBase(task);
  if (isLocalBase(base)) {
    throw new Error(
      `the base of ${task.issueKey} is a local branch of the clone: ${base}; tasker merge pushes only to a branch on origin`,
    );
  }
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const baseRevision = vcs.baseRevision(base);
  requireAcceptedTip(task, branch, await vcs.taskRefRevision(ctx, { taskRef: branch }));
  return withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    transitionWithMergeStart(store, task.id, "accepted");
    let revision: string;
    let pushed: boolean;
    try {
      const read = await vcs.taskRefOnBase(ctx, { taskRef: branch, baseRevision });
      requireAcceptedTip(task, branch, read.revision);
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

async function mergePullRequest(store: TaskStore, task: ReturnType<typeof taskInState>, request: MergeRequest) {
  const { config, env, io } = request;
  requireBranch(task);
  const base = requireBase(task);
  assertParentLanded(store, task, "pr");
  if (isLocalBase(base)) {
    throw new Error(
      `the base of ${task.issueKey} is a local branch of the clone: ${base}; tasker merge requires a remote base for a PR`,
    );
  }
  if (task.prNumber === null || task.publishedRevision === null) {
    throw new Error(
      `cannot merge ${task.issueKey}: recorded PR number and published revision are required. If the work merged externally, run tasker mark-landed ${task.issueKey}`,
    );
  }
  const selectedForge = forgeForRepo(config, task.repoKey);
  const forge = request.forge ?? selectedForge;
  const method: MergeMethod = config.repos[task.repoKey].forge!.mergeMethod;
  const forgeId = config.repos[task.repoKey].forge!.provider;
  const prNumber = task.prNumber;
  const headSha = task.publishedRevision;
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const cwd = vcs.localCopyPath(ctx);

  return withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    transitionWithMergeStart(store, task.id, "in_peer_review");
    let requested = false;
    try {
      const alreadyMerged = await forge.isPrMerged(prNumber, cwd, env);
      if (!alreadyMerged) {
        requested = true;
        await forge.mergePr(prNumber, method, headSha, cwd, env);
        const completed = await forge.isPrMerged(prNumber, cwd, env);
        if (!completed) {
          return failRun(
            store,
            task,
            io,
            `merging failed: PR #${prNumber} is not merged. Retry after the merge completes. CAUTION: tasker abort deletes the PR head branch`,
          );
        }
      }
    } catch (error) {
      return failRun(store, task, io, `merging failed: ${errorMessage(error)}`);
    }

    try {
      transitionWithPrMerged(store, task.id, {
        forge: forgeId,
        number: prNumber,
        method,
        expectedHead: headSha,
        requested,
      });
    } catch (error) {
      return failRun(
        store,
        task,
        io,
        `merging failed: PR #${prNumber} is merged, but tasker cannot record the result: ${errorMessage(error)}`,
      );
    }
    return { issueKey: task.issueKey, prNumber, forge: forgeId };
  });
}
