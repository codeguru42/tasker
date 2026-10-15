import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { archivePrompt } from "../prompts/archive.js";
import { openQuestionsText, REFINE_PROMPT, REFINE_PROMPT_NAME } from "../prompts/refine.js";
import { fillTemplate } from "../prompts/template.js";
import { withTaskLock } from "../store/locks.js";
import { readPlanFile } from "../store/plan-file.js";
import type { TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import { prepareTaskPlanModeRun } from "./assistant-run.js";
import { runPlanRevision, type PlanResult } from "./plan-run.js";
import { assertSessionModel } from "./session-model.js";
import { requireBaseRevision, requireBranch, taskInState } from "./task-state.js";

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
  const task = taskInState(store, request.taskId, "awaiting_plan_review", "refine");
  if (feedback.trim() === "") throw new Error("the feedback is empty");
  const revision = store.latestPlanRevision(task.id);
  if (revision === undefined) throw new Error(`the task of ${task.issueKey} has no plan revision`);
  const session = store.planSession(task.id);
  if (session === undefined) throw new Error(`the task of ${task.issueKey} has no plan session`);
  await assertSessionModel(session, env, `the plan session of ${task.issueKey}`);
  const currentPlan = readPlanFile(config.dataRoot, task, revision.version);
  const baseRevision = requireBaseRevision(store, task);
  const branch = requireBranch(task);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const branchCommits = await vcs.ownCommits(ctx, { taskRef: branch, baseRevision });
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
