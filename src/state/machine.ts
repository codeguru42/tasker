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
