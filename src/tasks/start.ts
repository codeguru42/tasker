import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { issueProviderFor } from "../issues/provider.js";
import { bootstrapLogPath, runBootstrap } from "../phases/bootstrap.js";
import { phaseEnv } from "../phases/env.js";
import { transitionTask } from "../state/machine.js";
import { taskLogsDir } from "../store/layout.js";
import type { Task, TaskStore } from "../store/store.js";
import { createVcsProvider } from "../vcs/provider.js";

export interface StartRequest {
  config: Config;
  ref: IssueRef;
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
  const vcs = createVcsProvider(repo);
  const ctx = { dataRoot: config.dataRoot, repoKey: ref.repoKey, env };
  await vcs.provision(ctx);
  const resolved = await vcs.resolveBase(ctx, {
    memory: store,
    hint: issueProvider.baseBranchHint(issue),
    defaultBase: repo.defaultBaseBranch,
    ask: request.ask,
  });
  store.updateTask(task.id, { base: resolved.base }, () => ({
    type: "base",
    data: { base: resolved.base, revision: resolved.revision, source: resolved.source },
  }));
  resolved.notes.forEach(request.note);
  const workspace = await vcs.createWorkspace(ctx, {
    shortRef: ref.shortRef,
    title: issue.title,
    baseRevision: resolved.revision,
  });
  store.updateTask(task.id, { branch: workspace.taskRef, worktreePath: workspace.path }, () => ({
    type: "workspace",
    data: { path: workspace.path, taskRef: workspace.taskRef, state: workspace.state },
  }));
  const logsDir = taskLogsDir(config.dataRoot, task);
  const result = await runBootstrap({
    commands: repo.bootstrap.commands,
    env: phaseEnv(env, repo.bootstrap.env),
    cwd: workspace.path,
    timeoutMs: config.limits.bootstrapTimeoutMin * 60_000,
    logsDir,
  });
  store.appendEvent(task.id, "bootstrap", { ...result, log: bootstrapLogPath(logsDir) });
  return { started: true, task: transitionTask(store, task.id, "workspace_ready") };
}
