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

const EDGES: Record<TaskState, readonly TaskState[]> = {
  provisioning: [],
  workspace_ready: [],
  planning: [],
  awaiting_plan_review: [],
  refining: [],
  approved: [],
  executing: [],
  executed: [],
  verifying: [],
  awaiting_work_review: [],
  reviewing: [],
  reviewed: [],
  accepted: [],
  pushing: [],
  pushed: [],
  opening_pr: [],
  in_peer_review: [],
  merging: [],
  landed: [],
  finishing: [],
  cleanup_failed: [],
  finished: [],
  updating_branch: [],
  quota_blocked: [],
  awaiting_quota_approval: [],
  interrupted: [],
  failed: [],
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
