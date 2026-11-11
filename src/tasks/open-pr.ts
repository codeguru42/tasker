import type { Io } from "../cli.js";
import { asciiFold } from "../ascii-fold.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { ForgeProvider, PullRequest } from "../forge/provider.js";
import { forgeForRepo } from "../forge/registry.js";
import type { IssueRef } from "../issue-key/ref.js";
import { issueProviderFor } from "../issues/provider.js";
import { transitionTask, transitionWithPrOpened } from "../state/machine.js";
import type { TaskStore } from "../store/store.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import { vcsForRepo } from "../vcs/provider.js";
import { failRun } from "./run-outcome.js";
import { requireBase, requireBranch, requireWorktree, taskInState } from "./task-state.js";
import { clearMarkerWrite, runTrackerWrite, trackerTargets, type TrackerWrite } from "./tracker-write.js";

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
          `opening_pr failed: open PR #${conflict.number} (${conflict.url}) for ${branch} has base ${conflict.base}; correct that PR base and run tasker retry`,
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
      return failRun(store, task, request.io, `opening_pr failed: ${errorMessage(error)}`);
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
        `opening_pr failed: ${description} PR #${pullRequest.number} (${pullRequest.url}), but tasker cannot record it: ${errorMessage(error)}`,
      );
    }

    const { issueTracker } = request.config.repos[task.repoKey];
    const reviewTarget = trackerTargets(issueTracker).review;
    if (reviewTarget !== undefined) {
      const github = issueTracker.provider === "github";
      const text = github
        ? `add the label ${JSON.stringify(reviewTarget)} to ${task.issueKey}`
        : `move ${task.issueKey} to the status ${JSON.stringify(reviewTarget)}`;
      const success = github
        ? `added the label ${JSON.stringify(reviewTarget)} to ${task.issueKey} on the tracker`
        : `moved ${task.issueKey} to the status ${JSON.stringify(reviewTarget)} on the tracker`;
      const reviewWrite: TrackerWrite = {
        action: "review",
        text,
        success,
        run: () => issueProviderFor(request.config, task.repoKey).markReview(request.ref, reviewTarget, request.env),
      };
      const reviewPassed = await runTrackerWrite(store, task.id, reviewWrite, request.io);
      if (reviewPassed && github) {
        const marker = trackerTargets(issueTracker).inProgress;
        if (marker !== undefined && asciiFold(marker) !== asciiFold(reviewTarget)) {
          const clearWrite = clearMarkerWrite(request.config, request.ref, task, request.env);
          if (clearWrite !== undefined) await runTrackerWrite(store, task.id, clearWrite, request.io);
        }
      }
    }

    return { pullRequest, adopted };
  });
}
