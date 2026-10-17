import type { IssueRef } from "../issue-key/ref.js";
import {
  originText,
  refineFeedbackOf,
  transitionFromEvents,
  transitionWithResume,
  type TaskState,
} from "../state/machine.js";
import { withTaskLock } from "../store/locks.js";
import type { NewEvent, ResumeWrites, Task, TaskEvent, TaskStore } from "../store/store.js";
import type { RetryNext } from "./retry.js";
import { originRow, type OriginTables } from "./origin-row.js";
import { taskInState } from "./task-state.js";

// The command that runs after the move of a resume. A resume has no start and no refine of findings: retry prints a
// hint for the refine values, and resume runs them. A resume also runs finish, which retry never does.
export type ResumeNext = Exclude<RetryNext, "start" | "refine-findings"> | "finish";

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

// The pause states that a row accepts. tasker resume never reaches awaiting_quota_approval, because its state check
// refuses that state first. tasker approve-credits never reaches interrupted, for the same reason.
const PAUSES: readonly TaskState[] = ["quota_blocked", "awaiting_quota_approval", "interrupted"];

// The table of resume: the origin (the state that the task left when the run stopped) gives the row. The rows of
// refining are in REFINE_RESUME_TABLE. A verify run spawns no assistant, so verifying accepts only interrupted.
const RESUME_TABLE: Partial<Record<TaskState, ResumeRow>> = {
  planning: { target: "workspace_ready", next: "plan", clearReview: false, pauses: PAUSES },
  executing: { target: "approved", next: "execute", clearReview: false, pauses: PAUSES },
  verifying: { target: "executed", next: "verify", clearReview: false, pauses: ["interrupted"] },
  reviewing: { target: "awaiting_work_review", next: "review", clearReview: true, pauses: PAUSES },
  // The target is landed also when the task came to finishing from cleanup_failed: finish runs from landed too.
  finishing: { target: "landed", next: "finish", clearReview: false, pauses: PAUSES },
};

const PLAIN_REFINE_ROW: ResumeRow = {
  target: "awaiting_plan_review",
  next: "refine",
  clearReview: false,
  pauses: PAUSES,
};

// The rows of a task that stopped in refining: the origin of the refine (the state that the task left when the last
// refine started) gives the row.
const REFINE_RESUME_TABLE: Partial<Record<TaskState, ResumeRow>> = {
  awaiting_plan_review: PLAIN_REFINE_ROW,
  failed: PLAIN_REFINE_ROW,
  reviewed: { target: "reviewed", next: "refine", clearReview: false, pauses: PAUSES },
  awaiting_work_review: {
    target: "awaiting_work_review",
    next: "review-feedback",
    clearReview: false,
    pauses: PAUSES,
  },
};

// The refining entry has no fallback, so resume refuses a refine origin with no row. The merging entry has none too:
// the merge origin (the state that the task left when the last merge started) gives the row. Merge and finish spawn no
// assistant, so only interrupted reaches the merging row and the finishing row in practice. They accept the quota
// pauses too, because the state machine has the edges into them from merging and from finishing.
const RESUME_TABLES: OriginTables<ResumeRow> = {
  rows: RESUME_TABLE,
  byOriginOf: {
    refining: { rows: REFINE_RESUME_TABLE },
    merging: {
      rows: { accepted: { target: "accepted", next: "merge", clearReview: false, pauses: PAUSES } },
    },
  },
};

// Moves a task in quota_blocked or interrupted back to the state before the run that stopped, under the task lock,
// and says which command runs next. The caller runs that command after the lock is free.
export async function resumeTask(store: TaskStore, request: ResumeRequest): Promise<ResumeResult> {
  const { repoKey, key } = request.ref;
  return withTaskLock(store, repoKey, key, () => resumeLocked(store, request));
}

function resumeLocked(store: TaskStore, request: ResumeRequest): ResumeResult {
  const { taskId } = request;
  const task = taskInState(store, taskId, "resume");
  return moveFromPause(store, task, store.listEvents(taskId), "resume");
}

// Moves a task in a pause back to the state before the run that stopped, with the events of extra after the resume
// event, in one transaction. The caller holds the task lock and made sure that the task is in a pause that command
// accepts. It refuses an origin with no row that accepts the pause.
export function moveFromPause(
  store: TaskStore,
  task: Task,
  events: readonly TaskEvent[],
  command: "resume" | "approve-credits",
  extra: readonly NewEvent[] = [],
): ResumeResult {
  // The state check made sure that the task is in a pause, so its state is a task state.
  const pause = task.state as TaskState;
  const origin = transitionFromEvents(events, pause);
  const row = origin === undefined ? undefined : originRow(events, origin, RESUME_TABLES);
  if (origin === undefined || !row?.pauses.includes(pause)) {
    throw new Error(
      `the task of ${task.issueKey} was paused from ${originText(events, pause)}; tasker ${command} has no step for it`,
    );
  }
  const writes: ResumeWrites = {};
  if (row.clearReview) writes.clearReviewSession = store.nextReview(task.id);
  transitionWithResume(store, task.id, row.target, origin, writes, extra);
  const result: ResumeResult = { origin, target: row.target, next: row.next };
  const feedback = origin === "refining" ? refineFeedbackOf(events) : undefined;
  return feedback === undefined ? result : { ...result, feedback };
}
