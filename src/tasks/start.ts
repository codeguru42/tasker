import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { issueProviderFor } from "../issues/provider.js";
import { bootstrapLogPath, runBootstrap } from "../phases/bootstrap.js";
import { commandFailureMessage, readCommandLog } from "../phases/command-step.js";
import { childEnv } from "../process/child-env.js";
import { errorMessage } from "../error-message.js";
import { acceptsState } from "../state/commands.js";
import { failedFrom, failTask, transitionTask } from "../state/machine.js";
import { taskLogsDir } from "../store/layout.js";
import { withRepoLock, withTaskLock } from "../store/locks.js";
import type { Task, TaskStore } from "../store/store.js";
import { runTrackerWrite, trackerTargets } from "./tracker-write.js";
import { vcsForRepo } from "../vcs/provider.js";

export interface StartRequest {
  config: Config;
  ref: IssueRef;
  // The raw --base.
  base?: string;
  env: NodeJS.ProcessEnv;
  // How long the start waits for the lock of the clone.
  repoLockWaitMs: number;
  // Gives the base branch when no other source has one.
  ask: () => Promise<string>;
  // Prints one note of the base resolve.
  note: (line: string) => void;
  // Starts also when the issue already has the in-progress marker.
  reclaim: boolean;
  // Gets the success lines and the warnings of the tracker writes.
  trackerIo: Pick<Io, "stdout" | "stderr">;
}

export interface StartOutcome {
  started: boolean;
  task: Task;
}

// The bootstrap failed. The tail is the text of the end of the log.
export class BootstrapFailedError extends Error {
  constructor(
    message: string,
    readonly tail: string,
  ) {
    super(message);
    this.name = "BootstrapFailedError";
  }
}

// Makes a task for the issue and takes it to workspace_ready. The task lock covers all the steps.
// It does not wait: a second start of the same issue stops at once.
export async function startTask(store: TaskStore, request: StartRequest): Promise<StartOutcome> {
  const { repoKey, key } = request.ref;
  return withTaskLock(store, repoKey, key, () => startLocked(store, request));
}

async function startLocked(store: TaskStore, request: StartRequest): Promise<StartOutcome> {
  const { config, ref, env } = request;
  const repo = config.repos[ref.repoKey];
  const issueProvider = issueProviderFor(config, ref.repoKey);
  const issue = await issueProvider.fetchIssue(ref, env);
  const active = store.findActiveTask(ref.repoKey, ref.key);
  // The table names start for the states it accepts. It cannot hold the rule for a task that failed in
  // provisioning, so that rule stays here.
  const continues =
    active !== undefined &&
    (acceptsState("start", active.state) ||
      (active.state === "failed" && failedFrom(store, active.id) === "provisioning"));
  if (active !== undefined && !continues) return { started: false, task: active };
  if (active === undefined && issue.state === "closed") throw new Error(`the issue is closed: ${ref.key}`);
  if (active === undefined && repo.issueTracker.updateOnStart && !request.reclaim) {
    // The check runs before the task exists, so a refused start leaves no task and no event.
    const marker = trackerTargets(repo.issueTracker).inProgress;
    if (marker !== undefined && issueProvider.inProgressMarker(issue, marker)) {
      throw new Error(
        `the issue ${ref.key} already has the in-progress marker ${marker}. Pass --reclaim to start it anyway, or remove the marker on the tracker.`,
      );
    }
  }
  const task =
    active === undefined
      ? store.createTask({
          issueKey: ref.key,
          repoKey: ref.repoKey,
          state: "provisioning",
          title: issue.title,
          shortRef: ref.shortRef,
        })
      : active.state === "failed"
        ? transitionTask(store, active.id, "provisioning")
        : active;
  // Fails the task with the error of fn, then throws the error again.
  const failOnError = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      failTask(store, task.id, errorMessage(error));
      throw error;
    }
  };
  const { vcs, ctx } = vcsForRepo(config, ref.repoKey, env);
  // The repo lock covers only the steps that use the clone. A busy lock changes no task, so it
  // wraps failOnError and not the other way round. Bootstrap runs after the lock is free.
  const workspace = await withRepoLock(store, ref.repoKey, request.repoLockWaitMs, () =>
    failOnError(async () => {
      await vcs.provision(ctx);
      const hint = issueProvider.baseBranchHint(issue);
      const resolved = await vcs.resolveBase(ctx, {
        memory: store,
        hint,
        explicit: request.base ?? (hint === undefined ? (task.base ?? undefined) : undefined),
        defaultBase: repo.defaultBaseBranch,
        ask: request.ask,
      });
      store.updateTask(task.id, { base: resolved.base }, () => ({
        type: "base",
        data: { base: resolved.base, revision: resolved.revision, source: resolved.source },
      }));
      resolved.notes.forEach(request.note);
      const created = await vcs.createWorkspace(ctx, {
        shortRef: task.shortRef ?? ref.shortRef,
        title: task.title ?? issue.title,
        baseRevision: resolved.revision,
      });
      store.updateTask(task.id, { branch: created.taskRef, worktreePath: created.path }, () => ({
        type: "workspace",
        data: { path: created.path, taskRef: created.taskRef, state: created.state },
      }));
      return created;
    }),
  );
  await failOnError(async () => {
    const logsDir = taskLogsDir(config.dataRoot, task);
    const log = bootstrapLogPath(logsDir);
    const timeoutMin = config.limits.bootstrapTimeoutMin;
    const result = await runBootstrap({
      commands: repo.bootstrap.commands,
      env: childEnv(env, repo.bootstrap.env),
      cwd: workspace.path,
      timeoutMs: timeoutMin * 60_000,
      logsDir,
    });
    store.appendEvent(task.id, "bootstrap", { ...result, log });
    if (result.status === "failed") {
      throw new BootstrapFailedError(
        commandFailureMessage("bootstrap", result, log, timeoutMin),
        readCommandLog(log, 20).tail,
      );
    }
  });
  const ready = transitionTask(store, task.id, "workspace_ready");
  if (repo.issueTracker.updateOnStart) {
    const { assignee } = repo.issueTracker;
    // The writes come after workspace_ready, so a failed start leaves the issue unmarked. A failed write only warns.
    await runTrackerWrite(
      store,
      task.id,
      {
        action: "assign",
        text: `assign ${ref.key} to ${assignee}`,
        success: `assigned ${ref.key} to ${assignee} on the tracker`,
        run: () => issueProvider.assign(ref, assignee, env),
      },
      request.trackerIo,
    );
    const target = trackerTargets(repo.issueTracker).inProgress;
    if (target !== undefined) {
      await runTrackerWrite(
        store,
        task.id,
        {
          action: "in_progress",
          text: `mark ${ref.key} in progress`,
          success: `marked ${ref.key} in progress on the tracker`,
          run: () => issueProvider.transitionStatus(ref, target, env),
        },
        request.trackerIo,
      );
    }
  }
  return { started: true, task: ready };
}
