import type { IssueRef } from "../issue-key/ref.js";
import {
  originText,
  refineFeedbackOf,
  transitionFromEvents,
  transitionWithResume,
  type TaskState,
} from "../state/machine.js";
import { withTaskLock } from "../store/locks.js";
import type { ResumeWrites, TaskEvent, TaskStore } from "../store/store.js";
import type { RetryNext } from "./retry.js";
import { taskInState } from "./task-state.js";

// The command that runs after the move of a resume. A resume has no start and no refine of findings: retry prints a
// hint for the refine values, and resume runs them.
export type ResumeNext = Exclude<RetryNext, "start" | "refine-findings">;

export interface ResumeRequest {
  ref: IssueRef;
  // The task that the lookup found. The resume reads it again under the task lock.
  taskId: number;
}

export interface ResumeResult {
  origin: TaskState;
  target: TaskState;
  next: ResumeNext;
  // The feedback that the move into refining recorded. Only a refine row gives it.
  feedback?: string;
}

interface ResumeRow {
  // The state that the task moves to.
  target: TaskState;
  next: ResumeNext;
  // Whether the resume deletes the review session of the next review number.
  clearReview: boolean;
  // The pause states that the row accepts.
  pauses: readonly TaskState[];
}

const BOTH_PAUSES: readonly TaskState[] = ["quota_blocked", "interrupted"];

// The table of resume: the origin (the state that the task left when the run stopped) gives the row. The rows of
// refining are in REFINE_RESUME_TABLE. A verify run spawns no assistant, so verifying accepts only interrupted.
const RESUME_TABLE: Partial<Record<TaskState, ResumeRow>> = {
  planning: { target: "workspace_ready", next: "plan", clearReview: false, pauses: BOTH_PAUSES },
  executing: { target: "approved", next: "execute", clearReview: false, pauses: BOTH_PAUSES },
  verifying: { target: "executed", next: "verify", clearReview: false, pauses: ["interrupted"] },
  reviewing: { target: "awaiting_work_review", next: "review", clearReview: true, pauses: BOTH_PAUSES },
};

const PLAIN_REFINE_ROW: ResumeRow = {
  target: "awaiting_plan_review",
  next: "refine",
  clearReview: false,
  pauses: BOTH_PAUSES,
};

// The rows of a task that stopped in refining: the origin of the refine (the state that the task left when the last
// refine started) gives the row.
const REFINE_RESUME_TABLE: Partial<Record<TaskState, ResumeRow>> = {
  awaiting_plan_review: PLAIN_REFINE_ROW,
  failed: PLAIN_REFINE_ROW,
  reviewed: { target: "reviewed", next: "refine", clearReview: false, pauses: BOTH_PAUSES },
  awaiting_work_review: {
    target: "awaiting_work_review",
    next: "review-feedback",
    clearReview: false,
    pauses: BOTH_PAUSES,
  },
};

// Moves a task in quota_blocked or interrupted back to the state before the run that stopped, under the task lock,
// and says which command runs next. The caller runs that command after the lock is free.
export async function resumeTask(store: TaskStore, request: ResumeRequest): Promise<ResumeResult> {
  const { repoKey, key } = request.ref;
  return withTaskLock(store, repoKey, key, () => resumeLocked(store, request));
}

function rowOf(events: readonly TaskEvent[], origin: TaskState): ResumeRow | undefined {
  if (origin !== "refining") return RESUME_TABLE[origin];
  const refineOrigin = transitionFromEvents(events, "refining");
  return refineOrigin === undefined ? undefined : REFINE_RESUME_TABLE[refineOrigin];
}

function resumeLocked(store: TaskStore, request: ResumeRequest): ResumeResult {
  const { taskId } = request;
  const task = taskInState(store, taskId, "resume");
  const events = store.listEvents(taskId);
  // taskInState made sure that the task is in a pause, so its state is a task state.
  const pause = task.state as TaskState;
  const origin = transitionFromEvents(events, pause);
  const row = origin === undefined ? undefined : rowOf(events, origin);
  if (origin === undefined || !row?.pauses.includes(pause)) {
    throw new Error(
      `the task of ${task.issueKey} was paused from ${originText(events, pause)}; tasker resume has no step for it`,
    );
  }
  const writes: ResumeWrites = {};
  if (row.clearReview) writes.clearReviewSession = store.nextReview(taskId);
  transitionWithResume(store, taskId, row.target, origin, writes);
  const result: ResumeResult = { origin, target: row.target, next: row.next };
  const feedback = origin === "refining" ? refineFeedbackOf(events) : undefined;
  return feedback === undefined ? result : { ...result, feedback };
}
