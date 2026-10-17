import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { issueProviderFor } from "../issues/provider.js";
import { archivePrompt } from "../prompts/archive.js";
import { PLAN_PROMPT, PLAN_PROMPT_NAME, planIssueText } from "../prompts/plan.js";
import { fillTemplate } from "../prompts/template.js";
import { approvedResetsAtOf } from "../state/machine.js";
import { withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { prepareTaskPlanModeRun } from "./assistant-run.js";
import { runPlanRevision, type PlanResult } from "./plan-run.js";
import { taskInState } from "./task-state.js";

export interface PlanRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The plan reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
}

// Runs the assistant in plan mode and records the next plan revision. The task lock covers all the steps. It does not wait.
export async function planTask(store: TaskStore, request: PlanRequest): Promise<PlanResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => planLocked(store, request));
}

async function planLocked(store: TaskStore, request: PlanRequest): Promise<PlanResult> {
  const { config, ref, env, io } = request;
  const task = taskInState(store, request.taskId, "plan");
  const issue = await issueProviderFor(config, ref.repoKey).fetchIssue(ref, env);
  const prompt = fillTemplate(PLAN_PROMPT_NAME, PLAN_PROMPT, {
    ISSUE_TEXT: planIssueText({ key: task.issueKey, title: issue.title, body: issue.body }),
  });
  const archived = archivePrompt(config.dataRoot, PLAN_PROMPT_NAME, PLAN_PROMPT);
  const version = store.nextPlanVersion(task.id);
  const stored = store.planSession(task.id);
  const prepared = await prepareTaskPlanModeRun({
    config,
    store,
    task,
    role: "plan",
    env,
    session: stored ? { resume: true, sessionId: stored.sessionId, recorded: stored } : { resume: false },
    approvedResetsAt: approvedResetsAtOf(store, task.id),
  });
  store.recordPlanSession(task.id, {
    sessionId: prepared.sessionId,
    provider: prepared.session.provider,
    model: prepared.session.model,
    effort: prepared.session.effort,
  });
  return runPlanRevision({
    store,
    config,
    task,
    io,
    phase: "planning",
    prompt,
    archived,
    version,
    prepared,
    source: "plan",
  });
}
