import type { IssueRef } from "../issue-key/ref.js";
import {
  originText,
  refineFeedbackOf,
  transitionFromEvents,
  transitionWithResume,
  STATES,
  type TaskState,
} from "../state/machine.js";
import { acceptsState } from "../state/commands.js";
import { withTaskLock } from "../store/locks.js";
import type { NewEvent, ResumeWrites, Task, TaskEvent, TaskStore } from "../store/store.js";
import type { RetryNext } from "./retry.js";
import { originRow, type OriginTables } from "./origin-row.js";
import { taskInState } from "./task-state.js";

// The command that runs after the move of a resume. A resume has no start and no refine of findings: retry prints a
// hint for the refine values, and resume runs them. A resume also runs finish, which retry never does.
export type ResumeNext = Exclude<RetryNext, "start" | "refine-findings"> | "finish" | "update-branch";

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
}

// The table of resume: the origin (the state that the task left when the run stopped) gives the row. The rows of
// refining are in REFINE_RESUME_TABLE. Of the pauses, the state machine allows only interrupted from verifying.
const RESUME_TABLE: Partial<Record<TaskState, ResumeRow>> = {
  planning: { target: "workspace_ready", next: "plan", clearReview: false },
  executing: { target: "approved", next: "execute", clearReview: false },
  verifying: { target: "executed", next: "verify", clearReview: false },
  reviewing: { target: "awaiting_work_review", next: "review", clearReview: true },
  // The target is landed also when the task came to finishing from cleanup_failed: finish runs from landed too.
  finishing: { target: "landed", next: "finish", clearReview: false },
};

const PLAIN_REFINE_ROW: ResumeRow = {
  target: "awaiting_plan_review",
  next: "refine",
  clearReview: false,
};

// The rows of a task that stopped in refining: the origin of the refine (the state that the task left when the last
// refine started) gives the row.
const REFINE_RESUME_TABLE: Partial<Record<TaskState, ResumeRow>> = {
  awaiting_plan_review: PLAIN_REFINE_ROW,
  failed: PLAIN_REFINE_ROW,
  reviewed: { target: "reviewed", next: "refine", clearReview: false },
  awaiting_work_review: {
    target: "awaiting_work_review",
    next: "review-feedback",
    clearReview: false,
  },
};

// The rows of a task that stopped in updating_branch: the origin of the update (the state that the task left when
// tasker update-branch started) gives the row, and the task goes back to it. Nothing runs after the move, because a
// crash during tasker update-branch can leave the worktree in a rebase or with changes, so the operator looks at the
// worktree first.
const UPDATE_BRANCH_RESUME_TABLE: Partial<Record<TaskState, ResumeRow>> = Object.fromEntries(
  STATES.filter((state) => acceptsState("update-branch", state)).map((state) => [
    state,
    { target: state, next: "update-branch", clearReview: false },
  ]),
);

// The refining entry has no fallback, so resume refuses a refine origin with no row. The merging and updating_branch
// entries have none too: the merge origin (the state that the task left when the last merge started) and the update
// origin give the row. Of the pauses, the state machine allows only interrupted from merging, finishing and
// updating_branch.
const RESUME_TABLES: OriginTables<ResumeRow> = {
  rows: RESUME_TABLE,
  byOriginOf: {
    refining: { rows: REFINE_RESUME_TABLE },
    updating_branch: { rows: UPDATE_BRANCH_RESUME_TABLE },
    merging: {
      rows: { accepted: { target: "accepted", next: "merge", clearReview: false } },
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
// accepts. It refuses an origin with no row.
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
  if (origin === undefined || row === undefined) {
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
