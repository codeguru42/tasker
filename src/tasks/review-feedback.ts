import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import { reviewFeedbackContextText } from "../prompts/refine.js";
import { withTaskLock } from "../store/locks.js";
import type { TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import type { PlanResult } from "./plan-run.js";
import { runRefine } from "./refine.js";
import { requireBranch, requireWorktree, taskInState } from "./task-state.js";

export interface ReviewFeedbackRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The command reads it again under the task lock.
  taskId: number;
  feedback: string;
  env: NodeJS.ProcessEnv;
  io: Io;
}

// Continues the plan session of a task in awaiting_work_review with the feedback of the operator on the committed
// work, and records the next plan revision. The task lock covers all the steps. It does not wait.
export async function reviewFeedbackTask(store: TaskStore, request: ReviewFeedbackRequest): Promise<PlanResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, async () => {
    const { config, env, io, feedback } = request;
    const task = taskInState(store, request.taskId, "review");
    if (feedback.trim() === "") throw new Error("the feedback is empty");
    requireWorktree(task);
    const branch = requireBranch(task);
    const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
    const revision = await vcs.taskRefRevision(ctx, { taskRef: branch });
    const context = reviewFeedbackContextText(revision, store.latestVerifyRun(task.id)?.number);
    return runRefine(store, { config, env, io, task, source: "review-feedback", context, feedback });
  });
}
