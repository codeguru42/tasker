import type {
  NewEvent,
  NewReview,
  RetryWrites,
  NewPlanRevision,
  NewVerifyRun,
  Task,
  TaskEvent,
  TaskStore,
} from "../store/store.js";

export const STATES = [
  "provisioning",
  "workspace_ready",
  "planning",
  "awaiting_plan_review",
  "refining",
  "approved",
  "executing",
  "executed",
  "verifying",
  "awaiting_work_review",
  "reviewing",
  "reviewed",
  "accepted",
  "pushing",
  "pushed",
  "opening_pr",
  "in_peer_review",
  "merging",
  "landed",
  "finishing",
  "cleanup_failed",
  "finished",
  "updating_branch",
  "quota_blocked",
  "awaiting_quota_approval",
  "interrupted",
  "failed",
  "cancelled",
] as const;

export type TaskState = (typeof STATES)[number];

export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set<TaskState>(["finished", "cancelled"]);

export function isTaskState(value: string): value is TaskState {
  return (STATES as readonly string[]).includes(value);
}

// The states in which tasker runs a process for the task. A run marker covers each of them.
export const SPAWNING_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  "planning",
  "refining",
  "executing",
  "verifying",
  "reviewing",
  "pushing",
  "opening_pr",
  "merging",
  "finishing",
  "updating_branch",
]);

export function isSpawningState(value: string): boolean {
  return (SPAWNING_STATES as ReadonlySet<string>).has(value);
}

// True when value is a state in TERMINAL_STATES.
export function isTerminalState(value: string): boolean {
  return (TERMINAL_STATES as ReadonlySet<string>).has(value);
}

// The specific edges. The rule edges (to failed and to cancelled) are added
// in buildTransitions.
const EDGES: Record<TaskState, readonly TaskState[]> = {
  // The main path: each state moves to the next one.
  provisioning: ["workspace_ready"],
  workspace_ready: ["planning", "updating_branch"],
  // Plan.
  planning: ["awaiting_plan_review", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  awaiting_plan_review: ["refining", "approved", "updating_branch"],
  refining: ["awaiting_plan_review", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  approved: ["awaiting_plan_review", "executing", "updating_branch"],
  // Build.
  executing: ["executed", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  executed: ["verifying", "updating_branch"],
  verifying: ["awaiting_work_review", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  // Work review.
  awaiting_work_review: ["reviewing", "refining", "accepted", "updating_branch"],
  reviewing: ["awaiting_work_review", "reviewed", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  reviewed: ["refining", "awaiting_work_review", "updating_branch"],
  // Landing.
  accepted: ["landed", "merging", "pushing", "refining", "updating_branch"],
  pushing: ["pushed", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  pushed: ["landed", "opening_pr", "refining", "updating_branch"],
  opening_pr: ["in_peer_review", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  in_peer_review: ["landed", "merging", "updating_branch"],
  merging: ["landed", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  landed: ["finishing"],
  finishing: ["finished", "cleanup_failed", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  cleanup_failed: ["finishing", "updating_branch"],
  finished: [],
  // Update branch.
  updating_branch: [
    "workspace_ready",
    "awaiting_plan_review",
    "approved",
    "executed",
    "awaiting_work_review",
    "reviewed",
    "accepted",
    "pushed",
    "in_peer_review",
    "failed",
    "cleanup_failed",
    "quota_blocked",
    "awaiting_quota_approval",
    "interrupted",
  ],
  // Pauses.
  quota_blocked: [
    "workspace_ready",
    "awaiting_plan_review",
    "approved",
    "awaiting_work_review",
    "accepted",
    "reviewed",
  ],
  awaiting_quota_approval: [
    "workspace_ready",
    "awaiting_plan_review",
    "approved",
    "awaiting_work_review",
    "accepted",
    "reviewed",
  ],
  interrupted: [
    "workspace_ready",
    "awaiting_plan_review",
    "approved",
    "awaiting_work_review",
    "accepted",
    "reviewed",
    "executed",
    "in_peer_review",
    "pushed",
    "cleanup_failed",
    "landed",
  ],
  // Failure and abort.
  failed: [
    "provisioning",
    "workspace_ready",
    "awaiting_plan_review",
    "approved",
    "executed",
    "accepted",
    "awaiting_work_review",
    "reviewed",
    "in_peer_review",
    "refining",
    "pushed",
    "updating_branch",
  ],
  cancelled: [],
};

function buildTransitions(): Record<TaskState, ReadonlySet<TaskState>> {
  const table = {} as Record<TaskState, ReadonlySet<TaskState>>;
  for (const from of STATES) {
    const targets = new Set<TaskState>(EDGES[from]);
    if (!TERMINAL_STATES.has(from)) {
      targets.add("failed");
      targets.add("cancelled");
    }
    targets.delete(from); // a self-transition is never legal
    table[from] = targets;
  }
  return table;
}

const TRANSITIONS = buildTransitions();

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].has(to);
}

// detail cannot set from or to: the type rejects them, and the values of the machine win at run time.
export type TransitionDetail = Record<string, unknown> & { from?: never; to?: never };

// The from and to of a move of current to `to`. An illegal edge throws.
function legalMove(current: Task, to: TaskState): { from: TaskState; to: TaskState } {
  if (!isTaskState(current.state) || !canTransition(current.state, to)) {
    throw new Error(`illegal state transition: ${current.state} -> ${to}`);
  }
  return { from: current.state, to };
}

// The check of a move of current to `to`: it gives an event of the type with the data { ...detail, from, to }. An
// illegal edge throws, so the store writes nothing.
function transitionCheck(type: string, to: TaskState, detail?: TransitionDetail) {
  return (current: Task): NewEvent => ({ type, data: { ...detail, ...legalMove(current, to) } });
}

// Writes the new state, the run marker change and one transition event { ...detail, from, to } in
// one transaction. A move into a spawning state writes the marker, and each other move deletes it.
// The target alone picks the store function, so no read of the task happens outside the transaction.
// An illegal edge writes nothing: no state change, no marker change and no event.
export function transitionTask(store: TaskStore, id: number, to: TaskState, detail?: TransitionDetail): Task {
  const check = transitionCheck("transition", to, detail);
  return isSpawningState(to) ? store.startRun(id, to, check) : store.endRun(id, to, check);
}

// Moves the task to interrupted when its run is dead, in one transaction with the read of the run status. It writes
// one transition event { cause: "dead_run", childPid, from, to }. It gives undefined and writes nothing when the run
// is not dead. from is the state before the move.
export function interruptDeadRun(
  store: TaskStore,
  id: number,
): { task: Task; from: string; childPid: number | null } | undefined {
  return store.endDeadRun(id, "interrupted", (current, childPid) =>
    transitionCheck("transition", "interrupted", { cause: "dead_run", childPid })(current),
  );
}

// Inserts the revision, appends its plan_revision event and moves the task to `to`, in one transaction.
export function transitionWithPlanRevision(
  store: TaskStore,
  id: number,
  to: TaskState,
  revision: NewPlanRevision,
): Task {
  return store.addPlanRevision(id, revision, to, transitionCheck("transition", to));
}

// Inserts the review and its findings, appends its review event and moves the task to `to`, in one transaction.
export function transitionWithReview(store: TaskStore, id: number, to: TaskState, review: NewReview): Task {
  return store.addReview(id, review, to, transitionCheck("transition", to));
}

// Inserts the verify run, appends its verify_run event and moves the task to `to` with one transition event
// { ...detail, from, to }, in one transaction. An illegal edge writes nothing.
export function transitionWithVerifyRun(
  store: TaskStore,
  id: number,
  to: TaskState,
  run: NewVerifyRun,
  detail?: TransitionDetail,
): Task {
  return store.addVerifyRun(id, run, to, transitionCheck("transition", to, detail));
}

// Moves the task to to, writes writes and appends one retry event { origin, target, resumeExecute, from, to } in
// place of the transition event, in one transaction. An illegal edge or a failing write writes nothing.
export function transitionWithRetry(
  store: TaskStore,
  id: number,
  to: TaskState,
  detail: { origin: TaskState; resumeExecute: boolean },
  writes: RetryWrites,
): Task {
  const check = transitionCheck("retry", to, {
    origin: detail.origin,
    target: to,
    resumeExecute: detail.resumeExecute,
  });
  return store.retryTask(id, to, writes, check);
}

// Approves revision version, appends the approved event { version, openQuestions, from, to } and moves the task to
// approved, in one transaction. An illegal edge writes nothing.
export function transitionWithPlanApproval(store: TaskStore, id: number, version: number, openQuestions: number): Task {
  return store.approvePlanRevision(
    id,
    version,
    "approved",
    transitionCheck("approved", "approved", { version, openQuestions }),
  );
}

// Clears the approval of the pinned revision version, appends the unapproved event { version, from, to } and moves
// the task to awaiting_plan_review, in one transaction. An illegal edge writes nothing.
export function transitionWithPlanUnapproval(store: TaskStore, id: number, version: number): Task {
  return store.clearPlanApproval(
    id,
    version,
    "awaiting_plan_review",
    transitionCheck("unapproved", "awaiting_plan_review", { version }),
  );
}

// Dismisses positions of review number with reason and appends the review_dismissed event. When no finding of the
// review is open after that, it moves the task to awaiting_work_review with one transition event { from, to }, in the
// same transaction. It gives back the open positions. An illegal edge writes nothing.
export function transitionWithReviewDismissal(
  store: TaskStore,
  id: number,
  number: number,
  positions: number[],
  reason: string,
): number[] {
  return store.dismissReviewFindings(
    id,
    number,
    positions,
    reason,
    "awaiting_work_review",
    transitionCheck("transition", "awaiting_work_review"),
  );
}

// Appends the executed event { version, prompts, from, to } and moves the task to executed, in one transaction.
// prompts holds the versions of the prompts that the run sent. An illegal edge writes nothing.
export function transitionWithExecution(
  store: TaskStore,
  id: number,
  version: number,
  prompts: readonly string[],
): Task {
  return store.endRun(id, "executed", transitionCheck("executed", "executed", { version, prompts: [...prompts] }));
}

// Appends the accepted event { revision, baseTip, from, to } and moves the task to accepted, in one transaction.
// An illegal edge writes nothing.
export function transitionWithAcceptance(store: TaskStore, id: number, revision: string, baseTip: string): Task {
  return store.endRun(id, "accepted", transitionCheck("accepted", "accepted", { revision, baseTip }));
}

// Appends the landed event { revision, base, pushed, from, to } and moves the task to landed, in one transaction.
// An illegal edge writes nothing.
export function transitionWithLanding(
  store: TaskStore,
  id: number,
  landing: { revision: string; base: string; pushed: boolean },
): Task {
  return store.endRun(id, "landed", transitionCheck("landed", "landed", landing));
}

// Appends the marked_landed event { revision, baseTip, from, to } and moves the task to landed, in one transaction.
// An illegal edge writes nothing.
export function transitionWithMarkedLanding(store: TaskStore, id: number, revision: string, baseTip: string): Task {
  return store.endRun(id, "landed", transitionCheck("marked_landed", "landed", { revision, baseTip }));
}

export function failTask(store: TaskStore, id: number, message: string): Task {
  return transitionTask(store, id, "failed", { error: message });
}

// The index of the last transition event into the state to, or -1 when events has none.
export function lastTransitionIndex(events: readonly TaskEvent[], to: TaskState): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const data = events[i].data as { to?: unknown } | null;
    if (events[i].type === "transition" && data?.to === to) return i;
  }
  return -1;
}

// The from of the last transition event into the state to, or undefined. It reads no older event, so an invalid
// from in the last such event gives undefined.
export function transitionFromEvents(events: readonly TaskEvent[], to: TaskState): TaskState | undefined {
  const index = lastTransitionIndex(events, to);
  if (index < 0) return undefined;
  const from = (events[index].data as { from?: unknown }).from;
  return typeof from === "string" && isTaskState(from) ? from : undefined;
}

// The origin of the last move into the state as text for an error, or "unknown".
export function originText(events: readonly TaskEvent[], to: TaskState): string {
  return transitionFromEvents(events, to) ?? "unknown";
}

// The from of the last transition into failed, or undefined when the task is not in failed.
export function failedFrom(store: TaskStore, id: number): TaskState | undefined {
  if (store.getTask(id)?.state !== "failed") return undefined;
  return transitionFromEvents(store.listEvents(id), "failed");
}

// The reset time of the quota window that the last credits_approved event of the task approved, or undefined when
// there is none.
export function approvedResetsAtOf(store: TaskStore, id: number): number | undefined {
  const approval = store
    .listEvents(id)
    .filter((event) => event.type === "credits_approved")
    .at(-1);
  const resetsAt = (approval?.data as { resetsAt?: unknown } | undefined)?.resetsAt;
  return typeof resetsAt === "number" ? resetsAt : undefined;
}

// The error of the last transition event, when it is a string.
export function lastTransitionError(events: TaskEvent[]): string | undefined {
  const transition = events.filter((event) => event.type === "transition").at(-1);
  const data = transition?.data;
  if (typeof data !== "object" || data === null || !("error" in data)) return undefined;
  return typeof data.error === "string" ? data.error : undefined;
}
