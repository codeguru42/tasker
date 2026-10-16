import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { archivePrompt } from "../prompts/archive.js";
import { earlierReviewsText, REVIEW_PROMPT, REVIEW_PROMPT_NAME } from "../prompts/review.js";
import { fillTemplate } from "../prompts/template.js";
import { checkReviewAnswer, reviewAnswerJsonSchema } from "../review/answer.js";
import type { FindingEntry } from "../review/findings-text.js";
import { transitionWithReview } from "../state/machine.js";
import { reviewTranscriptPath } from "../store/layout.js";
import { withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import { prepareTaskPlanModeRun } from "./assistant-run.js";
import { runPlanModeAnswer } from "./plan-run.js";
import { requireBaseRevision, requireBranch, requireWorktree, taskInState } from "./task-state.js";

export interface ReviewRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The review reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
}

export interface Reviewed {
  issueKey: string;
  number: number;
  findings: FindingEntry[];
  promptPath: string;
  transcriptPath: string;
}

// A result with exitCode means that the run step already printed the message.
export type ReviewResult = Reviewed | { exitCode: number };

// Reviews the committed work of the task in a new session of the assistant and records the review.
// The task lock covers all the steps. It does not wait.
export async function reviewTask(store: TaskStore, request: ReviewRequest): Promise<ReviewResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => reviewLocked(store, request));
}

async function reviewLocked(store: TaskStore, request: ReviewRequest): Promise<ReviewResult> {
  const { config, env, io } = request;
  const task = taskInState(store, request.taskId, "awaiting_work_review", "review");
  requireWorktree(task);
  const branch = requireBranch(task);
  const baseRevision = requireBaseRevision(store, task);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const revision = await vcs.taskRefRevision(ctx, { taskRef: branch });
  const branchCommits = await vcs.ownCommits(ctx, { taskRef: branch, baseRevision });
  const earlier = earlierReviewsText(store.listReviews(task.id), store.listPlanRevisions(task.id));
  const prompt = fillTemplate(REVIEW_PROMPT_NAME, REVIEW_PROMPT, {
    EARLIER_REVIEWS: earlier,
    BRANCH_COMMITS: branchCommits,
  });
  const archived = archivePrompt(config.dataRoot, REVIEW_PROMPT_NAME, REVIEW_PROMPT);
  const prepared = await prepareTaskPlanModeRun({
    config,
    store,
    task,
    role: "review",
    env,
    session: { resume: false },
  });
  const number = store.nextReview(task.id);
  store.recordReviewSession(task.id, number, {
    sessionId: prepared.sessionId,
    provider: prepared.session.provider,
    model: prepared.session.model,
    effort: prepared.session.effort,
  });
  const transcriptPath = reviewTranscriptPath(config.dataRoot, task, number);
  return runPlanModeAnswer({
    store,
    config,
    task,
    io,
    phase: "reviewing",
    prompt,
    prepared,
    transcriptPath,
    jsonSchema: reviewAnswerJsonSchema(),
    check: checkReviewAnswer,
    refused: "findings",
    record: ({ findings }, { startedAt, endedAt }): Reviewed => {
      transitionWithReview(store, task.id, findings.length === 0 ? "awaiting_work_review" : "reviewed", {
        number,
        revision,
        prompt: archived.version,
        startedAt,
        endedAt,
        findings,
      });
      return {
        issueKey: task.issueKey,
        number,
        findings: store.getReview(task.id, number)!.findings,
        promptPath: archived.path,
        transcriptPath,
      };
    },
  });
}
