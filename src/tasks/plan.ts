import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import { issueProviderFor } from "../issues/provider.js";
import { checkPlanAnswer, planAnswerJsonSchema, type PlanAnswer } from "../plan/answer.js";
import { archivePrompt } from "../prompts/archive.js";
import { PLAN_PROMPT, PLAN_PROMPT_NAME, planIssueText } from "../prompts/plan.js";
import { fillTemplate } from "../prompts/template.js";
import { transitionTask } from "../state/machine.js";
import { planRevisionPath, planTranscriptPath } from "../store/layout.js";
import { withTaskLock } from "../store/locks.js";
import { recordPlanRevision } from "../store/plan-file.js";
import { taskNotFound, type TaskStore } from "../store/store.js";
import { prepareTaskPlanModeRun } from "./assistant-run.js";
import { applyRunOutcome, failRun } from "./run-outcome.js";

export interface PlanRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The plan reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
}

export interface PlannedRevision {
  version: number;
  planPath: string;
  promptPath: string;
  answer: PlanAnswer;
}

// A result with exitCode means that the run step already printed the message.
export type PlanResult = PlannedRevision | { exitCode: number };

// Runs the assistant in plan mode and records the next plan revision. The task lock covers all the steps. It does not wait.
export async function planTask(store: TaskStore, request: PlanRequest): Promise<PlanResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => planLocked(store, request));
}

async function planLocked(store: TaskStore, request: PlanRequest): Promise<PlanResult> {
  const { config, ref, env, io } = request;
  const task = store.getTask(request.taskId);
  if (task === undefined) throw taskNotFound(request.taskId);
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
  });
  store.recordPlanSession(task.id, {
    sessionId: prepared.sessionId,
    provider: prepared.session.provider,
    model: prepared.session.model,
    effort: prepared.session.effort,
  });
  transitionTask(store, task.id, "planning");
  try {
    const path = planTranscriptPath(config.dataRoot, task, version);
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, "a");
    let outcome;
    try {
      outcome = await prepared.start({
        prompt,
        jsonSchema: planAnswerJsonSchema(),
        onEvent: (event) => writeSync(fd, `${JSON.stringify(event)}\n`),
      });
    } finally {
      closeSync(fd);
    }
    const result = applyRunOutcome({
      store,
      task,
      phase: "planning",
      timeoutMinutes: config.limits.planTimeoutMin,
      io,
      outcome,
    });
    if ("exitCode" in result) return result;
    const check = checkPlanAnswer(result.outcome.structuredOutput);
    if (!check.ok) {
      return failRun(
        store,
        task,
        io,
        ["the assistant returned a plan that tasker refuses:", ...check.problems.map((p) => `  - ${p}`)].join("\n"),
      );
    }
    try {
      recordPlanRevision(
        store,
        config.dataRoot,
        task.id,
        { version, source: "plan", answer: check.answer, prompt: archived.version },
        "awaiting_plan_review",
      );
    } catch (error) {
      return failRun(store, task, io, errorMessage(error));
    }
    return {
      version,
      planPath: planRevisionPath(config.dataRoot, task, version),
      promptPath: archived.path,
      answer: check.answer,
    };
  } catch (error) {
    return failRun(store, task, io, `planning failed: ${errorMessage(error)}`);
  }
}
