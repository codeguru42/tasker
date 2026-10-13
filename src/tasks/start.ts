import { readFileSync } from "node:fs";
import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { issueProviderFor } from "../issues/provider.js";
import { type BootstrapResult, bootstrapLogPath, runBootstrap } from "../phases/bootstrap.js";
import { phaseEnv } from "../phases/env.js";
import { errorMessage } from "../doctor/error-message.js";
import { failTask, transitionTask } from "../state/machine.js";
import { taskLogsDir } from "../store/layout.js";
import type { Task, TaskStore } from "../store/store.js";
import { createVcsProvider } from "../vcs/provider.js";

export interface StartRequest {
  config: Config;
  ref: IssueRef;
  // The raw --base.
  base?: string;
  env: NodeJS.ProcessEnv;
  // Gives the base branch when no other source has one.
  ask: () => Promise<string>;
  // Prints one note of the base resolve.
  note: (line: string) => void;
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

export function bootstrapFailureMessage(
  result: Extract<BootstrapResult, { status: "failed" }>,
  log: string,
  timeoutMin: number,
): string {
  const outcome = result.timedOut
    ? `timed out after ${timeoutMin} min`
    : result.signal === undefined
      ? `exit code ${result.exitCode}`
      : `stopped by signal ${result.signal}`;
  return `bootstrap command ${result.index} failed: ${result.command}: ${outcome}. The log is ${log}.`;
}

// The last count lines of the log, with a header that gives the real count. It never throws.
export function bootstrapLogTail(log: string, count: number): string {
  let text: string;
  try {
    text = readFileSync(log, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? `the log is missing: ${log}\n` : `cannot read the log ${log}: ${code}\n`;
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const last = lines.slice(-count);
  return `the last ${last.length} lines of the log:\n${last.map((line) => `${line}\n`).join("")}`;
}

// Makes a task for the issue and takes it to workspace_ready.
export async function startTask(store: TaskStore, request: StartRequest): Promise<StartOutcome> {
  const { config, ref, env } = request;
  const repo = config.repos[ref.repoKey];
  const issueProvider = issueProviderFor(config, ref.repoKey);
  const issue = await issueProvider.fetchIssue(ref, env);
  const task = store.createTask({
    issueKey: ref.key,
    repoKey: ref.repoKey,
    state: "provisioning",
    title: issue.title,
    shortRef: ref.shortRef,
  });
  // Fails the task with the error of fn, then throws the error again.
  const failOnError = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      failTask(store, task.id, errorMessage(error));
      throw error;
    }
  };
  const vcs = createVcsProvider(repo);
  const ctx = { dataRoot: config.dataRoot, repoKey: ref.repoKey, env };
  const workspace = await failOnError(async () => {
    await vcs.provision(ctx);
    const resolved = await vcs.resolveBase(ctx, {
      memory: store,
      hint: issueProvider.baseBranchHint(issue),
      explicit: request.base,
      defaultBase: repo.defaultBaseBranch,
      ask: request.ask,
    });
    store.updateTask(task.id, { base: resolved.base }, () => ({
      type: "base",
      data: { base: resolved.base, revision: resolved.revision, source: resolved.source },
    }));
    resolved.notes.forEach(request.note);
    const created = await vcs.createWorkspace(ctx, {
      shortRef: ref.shortRef,
      title: issue.title,
      baseRevision: resolved.revision,
    });
    store.updateTask(task.id, { branch: created.taskRef, worktreePath: created.path }, () => ({
      type: "workspace",
      data: { path: created.path, taskRef: created.taskRef, state: created.state },
    }));
    return created;
  });
  await failOnError(async () => {
    const logsDir = taskLogsDir(config.dataRoot, task);
    const log = bootstrapLogPath(logsDir);
    const timeoutMin = config.limits.bootstrapTimeoutMin;
    const result = await runBootstrap({
      commands: repo.bootstrap.commands,
      env: phaseEnv(env, repo.bootstrap.env),
      cwd: workspace.path,
      timeoutMs: timeoutMin * 60_000,
      logsDir,
    });
    store.appendEvent(task.id, "bootstrap", { ...result, log });
    if (result.status === "failed") {
      throw new BootstrapFailedError(bootstrapFailureMessage(result, log, timeoutMin), bootstrapLogTail(log, 20));
    }
  });
  return { started: true, task: transitionTask(store, task.id, "workspace_ready") };
}
