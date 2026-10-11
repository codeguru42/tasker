import type { Task, TaskStore } from "../store/store.js";

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

export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  "finished",
  "cancelled",
]);

export function isTaskState(value: string): value is TaskState {
  return (STATES as readonly string[]).includes(value);
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
  reviewing: [
    "awaiting_work_review",
    "reviewed",
    "quota_blocked",
    "awaiting_quota_approval",
    "interrupted",
  ],
  reviewed: ["refining", "awaiting_work_review", "updating_branch"],
  // Landing.
  accepted: ["landed", "merging", "pushing", "refining", "updating_branch"],
  pushing: ["pushed", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  pushed: ["landed", "opening_pr", "refining", "updating_branch"],
  opening_pr: ["in_peer_review", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  in_peer_review: ["landed", "merging", "updating_branch"],
  merging: ["landed", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  landed: ["finishing"],
  finishing: [
    "finished",
    "cleanup_failed",
    "quota_blocked",
    "awaiting_quota_approval",
    "interrupted",
  ],
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

export function transitionTask(store: TaskStore, id: number, to: TaskState): Task {
  return store.updateTask(id, { state: to }, (current) => {
    if (!isTaskState(current.state) || !canTransition(current.state, to)) {
      throw new Error(`illegal state transition: ${current.state} -> ${to}`);
    }
  });
}
