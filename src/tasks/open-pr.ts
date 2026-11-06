import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { ForgeProvider, PullRequest } from "../forge/provider.js";
import { forgeForRepo } from "../forge/registry.js";
import type { IssueRef } from "../issue-key/ref.js";
import { transitionTask, transitionWithPrOpened } from "../state/machine.js";
import type { TaskStore } from "../store/store.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import { vcsForRepo } from "../vcs/provider.js";
import { failRun } from "./run-outcome.js";
import { requireBase, requireBranch, requireWorktree, taskInState } from "./task-state.js";

export interface OpenPrRequest {
  config: Config;
  ref: IssueRef;
  // The task found by issue lookup. The task is read again under its lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
  repoLockWaitMs: number;
  // A provider override for task tests. Commands use the provider in config.
  forge?: ForgeProvider;
}

export interface OpenPrResult {
  pullRequest: PullRequest;
  adopted: boolean;
}

// Opens or adopts the origin PR for a task in pushed. The task lock comes before the repo lock.
export async function openPrTask(
  store: TaskStore,
  request: OpenPrRequest,
): Promise<OpenPrResult | { exitCode: number }> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => openPrLocked(store, request));
}

async function openPrLocked(store: TaskStore, request: OpenPrRequest): Promise<OpenPrResult | { exitCode: number }> {
  const task = taskInState(store, request.taskId, "open-pr");
  const branch = requireBranch(task);
  const worktree = requireWorktree(task);
  const base = requireBase(task);
  const { vcs, ctx } = vcsForRepo(request.config, task.repoKey, request.env);

  return withRepoLock(store, task.repoKey, request.repoLockWaitMs, async () => {
    let resolvedBase: string;
    try {
      resolvedBase = await vcs.defaultBase(ctx);
    } catch (error) {
      throw new Error(
        `the task of ${task.issueKey} has base ${base}, but origin's default base could not be resolved: ${errorMessage(error)}; correct the base before trying again`,
        { cause: error },
      );
    }
    if (base !== resolvedBase) {
      throw new Error(
        `the task of ${task.issueKey} has base ${base}, but origin's default base is ${resolvedBase}; correct the base before trying again`,
      );
    }

    const forge = request.forge ?? forgeForRepo(request.config, task.repoKey);
    transitionTask(store, task.id, "opening_pr");

    let pullRequest: PullRequest;
    let adopted: boolean;
    try {
      const openPrs = await forge.listOpenPrs({ cwd: worktree, head: branch }, request.env);
      const matching = openPrs.find((pr) => pr.base === resolvedBase);
      if (matching !== undefined) {
        pullRequest = matching;
        adopted = true;
      } else if (openPrs.length > 0) {
        const conflict = openPrs[0];
        return failRun(
          store,
          task,
          request.io,
          `opening PR failed: open PR #${conflict.number} (${conflict.url}) for ${branch} has base ${conflict.base}; correct the PR base before trying again`,
        );
      } else {
        const summary = task.title ?? task.issueKey;
        pullRequest = await forge.createPr(
          {
            cwd: worktree,
            head: branch,
            base: resolvedBase,
            title: `${summary} (${task.issueKey})`,
            body: `Task: ${task.issueKey}\n\n${summary}`,
          },
          request.env,
        );
        adopted = false;
      }
    } catch (error) {
      return failRun(store, task, request.io, `opening PR failed: ${errorMessage(error)}`);
    }

    try {
      transitionWithPrOpened(store, task.id, {
        number: pullRequest.number,
        url: pullRequest.url,
        head: branch,
        base: resolvedBase,
        adopted,
      });
    } catch (error) {
      const description = adopted ? "found" : "opened";
      return failRun(
        store,
        task,
        request.io,
        `opening PR failed: ${description} PR #${pullRequest.number} (${pullRequest.url}), but tasker cannot record it: ${errorMessage(error)}`,
      );
    }

    return { pullRequest, adopted };
  });
}
