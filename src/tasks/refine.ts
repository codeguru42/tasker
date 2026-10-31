import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { archivePrompt } from "../prompts/archive.js";
import {
  failureContextText,
  openQuestionsText,
  PLAIN_REFINE_CONTEXT,
  promotionContextText,
  REFINE_PROMPT,
  REFINE_PROMPT_NAME,
} from "../prompts/refine.js";
import { fillTemplate } from "../prompts/template.js";
import { approvedResetsAtOf, originText, lastTransitionError } from "../state/machine.js";
import { withTaskLock } from "../store/locks.js";
import { readPlanFile } from "../store/plan-file.js";
import type { PlanRevisionSource, Task, TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import { prepareTaskPlanModeRun } from "./assistant-run.js";
import { runPlanRevision, type PlanResult } from "./plan-run.js";
import { assertSessionModel } from "./session-model.js";
import { assertBaseMoved } from "./parent.js";
import { requireBaseRevision, requireBranch, taskInState } from "./task-state.js";

export interface RefineRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The refine reads it again under the task lock.
  taskId: number;
  // The feedback of the user, as given, or none.
  feedback?: string;
  env: NodeJS.ProcessEnv;
  io: Io;
}

// Continues the plan session of the task with the feedback and records the next plan revision. A task in reviewed
// needs no feedback: the open findings of its latest review go to the plan session. A task in failed needs the
// feedback as its instruction for the fix: the origin and the error of the failure go to the plan session.
// The task lock covers all the steps. It does not wait.
export async function refineTask(store: TaskStore, request: RefineRequest): Promise<PlanResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => refineLocked(store, request));
}

// The context of a promotion: the open findings of the latest review of a task in reviewed.
function promotionContext(store: TaskStore, task: Task): string {
  const review = store.latestReview(task.id);
  const open = review?.findings.filter((entry) => entry.dismissed === null) ?? [];
  if (review === undefined || open.length === 0) {
    throw new Error(
      `the latest review of ${task.issueKey} has no open finding; run tasker dismiss-review or tasker review`,
    );
  }
  // A task reaches reviewed only after a passed verify run, so the latest run is the run of that work.
  return promotionContextText(review, open, store.latestVerifyRun(task.id)?.number);
}

// The context of a refine from failed: the origin and the error of the failure. The task needs a plan revision.
function failureContext(store: TaskStore, task: Task): string {
  const events = store.listEvents(task.id);
  if (store.latestPlanRevision(task.id) === undefined) {
    throw new Error(
      `the task of ${task.issueKey} failed in ${originText(events, "failed")} and has no plan revision; run tasker retry ${task.issueKey}`,
    );
  }
  return failureContextText(originText(events, "failed"), lastTransitionError(events, "failed") ?? "");
}

// The context and the source of the plan revision of a refine, by the state of the task.
function refineContext(store: TaskStore, task: Task): { context: string; source: PlanRevisionSource } {
  if (task.state === "reviewed") return { context: promotionContext(store, task), source: "review" };
  if (task.state === "failed") return { context: failureContext(store, task), source: "refine" };
  return { context: PLAIN_REFINE_CONTEXT, source: "refine" };
}

async function refineLocked(store: TaskStore, request: RefineRequest): Promise<PlanResult> {
  const { config, env, io, feedback } = request;
  const task = taskInState(store, request.taskId, "refine");
  assertBaseMoved(store, task);
  const promotion = task.state === "reviewed";
  if (!promotion && feedback === undefined) {
    throw new Error("the feedback is missing; tasker refine needs it unless the task is in reviewed");
  }
  if (feedback?.trim() === "") throw new Error("the feedback is empty");
  const { context, source } = refineContext(store, task);
  return runRefine(store, { config, env, io, task, source, context, feedback });
}

export interface RefineRun {
  config: Config;
  env: NodeJS.ProcessEnv;
  io: Io;
  task: Task;
  source: PlanRevisionSource;
  // The text of the context block.
  context: string;
  // The feedback of the user to store, or none. None gives "None." in the prompt.
  feedback?: string;
}

// Continues the plan session of the task with the context and the feedback, and records the next plan revision.
// The caller holds the task lock and has checked the state and the feedback.
export async function runRefine(store: TaskStore, run: RefineRun): Promise<PlanResult> {
  const { config, env, io, task, source, context, feedback } = run;
  const revision = store.latestPlanRevision(task.id);
  if (revision === undefined) throw new Error(`the task of ${task.issueKey} has no plan revision`);
  const session = store.planSession(task.id);
  if (session === undefined) throw new Error(`the task of ${task.issueKey} has no plan session`);
  await assertSessionModel(session, env, `the plan session of ${task.issueKey}`);
  const currentPlan = readPlanFile(config.dataRoot, task, revision.version);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const baseRevision = requireBaseRevision(vcs, task);
  const branch = requireBranch(task);
  const branchCommits = await vcs.ownCommits(ctx, { taskRef: branch, baseRevision });
  const prompt = fillTemplate(REFINE_PROMPT_NAME, REFINE_PROMPT, {
    CURRENT_PLAN: currentPlan,
    BRANCH_COMMITS: branchCommits,
    CONTEXT: context,
    FEEDBACK: feedback ?? "None.",
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
    approvedResetsAt: approvedResetsAtOf(store, task.id),
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
    source,
    feedback,
  });
}
