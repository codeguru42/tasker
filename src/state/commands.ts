import { STATES, type TaskState, isTaskState } from "./machine.js";

export type TaskCommand =
  | "start"
  | "plan"
  | "refine"
  | "approve"
  | "unapprove"
  | "execute"
  | "verify"
  | "review"
  | "dismiss-review"
  | "accept"
  | "merge"
  | "mark-landed"
  | "finish"
  | "retry"
  | "abort";

export interface StateCommands {
  // The clear next step. When there is one, it is the first of the commands.
  readonly primary?: TaskCommand;
  // All valid commands of the state, in order. abort is last.
  readonly commands: readonly TaskCommand[];
}

const ABORT_ONLY: StateCommands = { commands: ["abort"] };

// The one home of the commands that are valid from each state. A terminal state has no row.
// docs/statemachine.md, "The commands of each state", shows the same table.
export const STATE_COMMANDS: Readonly<Partial<Record<TaskState, StateCommands>>> = {
  provisioning: { primary: "start", commands: ["start", "abort"] },
  workspace_ready: { primary: "plan", commands: ["plan", "abort"] },
  planning: ABORT_ONLY,
  awaiting_plan_review: { commands: ["refine", "approve", "abort"] },
  refining: ABORT_ONLY,
  approved: { primary: "execute", commands: ["execute", "unapprove", "abort"] },
  executing: ABORT_ONLY,
  executed: { primary: "verify", commands: ["verify", "abort"] },
  verifying: ABORT_ONLY,
  awaiting_work_review: { commands: ["review", "accept", "abort"] },
  reviewing: ABORT_ONLY,
  reviewed: { commands: ["refine", "dismiss-review", "abort"] },
  accepted: { primary: "merge", commands: ["merge", "mark-landed", "abort"] },
  pushing: ABORT_ONLY,
  pushed: { commands: ["mark-landed", "abort"] },
  opening_pr: ABORT_ONLY,
  in_peer_review: { commands: ["mark-landed", "abort"] },
  merging: ABORT_ONLY,
  landed: { primary: "finish", commands: ["finish", "abort"] },
  finishing: ABORT_ONLY,
  cleanup_failed: { primary: "finish", commands: ["finish", "abort"] },
  updating_branch: ABORT_ONLY,
  quota_blocked: ABORT_ONLY,
  awaiting_quota_approval: ABORT_ONLY,
  interrupted: ABORT_ONLY,
  failed: { primary: "retry", commands: ["retry", "abort"] },
};

// The row of a state, or undefined for a terminal or unknown state.
export function stateCommands(state: string): StateCommands | undefined {
  return isTaskState(state) ? STATE_COMMANDS[state] : undefined;
}

// The states whose row names the command, in the order of STATES.
export function acceptedStates(command: TaskCommand): TaskState[] {
  return STATES.filter((state) => STATE_COMMANDS[state]?.commands.includes(command) ?? false);
}

// The command as the user types it for the task of the issue key.
function render(command: TaskCommand, issueKey: string): string {
  return `tasker ${command} ${issueKey}`;
}

// The lines that tasker show prints after the fields. No row gives no line.
export function showLines(state: string, issueKey: string): string[] {
  const row = stateCommands(state);
  if (row === undefined) return [];
  if (row.primary === undefined) {
    return [`commands: ${row.commands.map((c) => render(c, issueKey)).join(", ")}`];
  }
  const also = row.commands.filter((c) => c !== row.primary).map((c) => render(c, issueKey));
  return [`next: ${render(row.primary, issueKey)}`, `also: ${also.join(", ")}`];
}

// The NEXT cell of tasker status. No row gives an empty string.
export function nextCell(state: string): string {
  const row = stateCommands(state);
  if (row === undefined) return "";
  if (row.primary === undefined) return row.commands.join(", ");
  return `${row.primary} (also: ${row.commands.filter((c) => c !== row.primary).join(", ")})`;
}
