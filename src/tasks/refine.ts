import { readFileSync } from "node:fs";
import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { createSessionProvider } from "../assistant/provider.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import { archivePrompt } from "../prompts/archive.js";
import { openQuestionsText, REFINE_PROMPT, REFINE_PROMPT_NAME } from "../prompts/refine.js";
import { fillTemplate } from "../prompts/template.js";
import { planRevisionPath } from "../store/layout.js";
import { withTaskLock } from "../store/locks.js";
import { taskNotFound, type TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import { prepareTaskPlanModeRun } from "./assistant-run.js";
import { baseRevisionOf } from "./base-revision.js";
import { runPlanRevision, type PlanResult } from "./plan-run.js";

export interface RefineRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The refine reads it again under the task lock.
  taskId: number;
  // The feedback of the operator, as given.
  feedback: string;
  env: NodeJS.ProcessEnv;
  io: Io;
}

// Continues the plan session of the task with the feedback and records the next plan revision.
// The task lock covers all the steps. It does not wait.
export async function refineTask(store: TaskStore, request: RefineRequest): Promise<PlanResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => refineLocked(store, request));
}

async function refineLocked(store: TaskStore, request: RefineRequest): Promise<PlanResult> {
  const { config, env, io, feedback } = request;
  const task = store.getTask(request.taskId);
  if (task === undefined) throw taskNotFound(request.taskId);
  if (task.state !== "awaiting_plan_review") {
    throw new Error(`the task of ${task.issueKey} is in ${task.state}; tasker refine needs awaiting_plan_review`);
  }
  if (feedback.trim() === "") throw new Error("the feedback is empty");
  const revision = store.latestPlanRevision(task.id);
  if (revision === undefined) throw new Error(`the task of ${task.issueKey} has no plan revision`);
  const session = store.planSession(task.id);
  if (session === undefined) throw new Error(`the task of ${task.issueKey} has no plan session`);
  const selected = createSessionProvider(session);
  for (const check of selected.provider.modelChecks(session.model)) {
    const result = await check.run(env);
    if (result.status === "error") {
      throw new Error(
        `the plan session of ${task.issueKey} runs on ${session.model}, and ${session.provider} refuses it: ${result.detail}`,
      );
    }
  }
  let currentPlan: string;
  try {
    currentPlan = readFileSync(planRevisionPath(config.dataRoot, task, revision.version), "utf8");
  } catch (error) {
    throw new Error(`cannot read the plan file of revision v${revision.version}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  const baseRevision = baseRevisionOf(store, task.id);
  if (baseRevision === undefined) throw new Error(`the task of ${task.issueKey} has no base revision`);
  if (task.branch === null) throw new Error(`the task of ${task.issueKey} has no branch`);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const branchCommits = await vcs.ownCommits(ctx, { taskRef: task.branch, baseRevision });
  const prompt = fillTemplate(REFINE_PROMPT_NAME, REFINE_PROMPT, {
    CURRENT_PLAN: currentPlan,
    BRANCH_COMMITS: branchCommits,
    FEEDBACK: feedback,
    OPEN_QUESTIONS: openQuestionsText(revision.answer.questions),
  });
  const archived = archivePrompt(config.dataRoot, REFINE_PROMPT_NAME, REFINE_PROMPT);
  const version = store.nextPlanVersion(task.id);
  // The session is already recorded, so refine does not record it again.
  const prepared = await prepareTaskPlanModeRun({
    config,
    store,
    task,
    role: "plan",
    env,
    session: { resume: true, sessionId: session.sessionId, recorded: session },
  });
  return runPlanRevision({
    store,
    config,
    task,
    io,
    phase: "refining",
    prompt,
    archived,
    version,
    prepared,
    source: "refine",
    feedback,
  });
}
