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
  | "resume"
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
  quota_blocked: { primary: "resume", commands: ["resume", "abort"] },
  awaiting_quota_approval: ABORT_ONLY,
  interrupted: { primary: "resume", commands: ["resume", "abort"] },
  failed: { primary: "retry", commands: ["retry", "refine", "abort"] },
};

// The row of a state, or undefined for a terminal or unknown state.
export function stateCommands(state: string): StateCommands | undefined {
  return isTaskState(state) ? STATE_COMMANDS[state] : undefined;
}

// True when the row of the state names the command. A terminal or unknown state has no row and gives false.
export function acceptsState(command: TaskCommand, state: string): boolean {
  return stateCommands(state)?.commands.includes(command) ?? false;
}

// The states whose row names the command, in the order of STATES.
export function acceptedStates(command: TaskCommand): TaskState[] {
  return STATES.filter((state) => acceptsState(command, state));
}

// The command as the user types it for the task of the issue key.
function render(command: TaskCommand, issueKey: string): string {
  return `tasker ${command} ${issueKey}`;
}

// The primary command of a row and its other commands. Without a primary, the others are all commands.
function splitRow(row: StateCommands): { primary?: TaskCommand; others: readonly TaskCommand[] } {
  if (row.primary === undefined) return { others: row.commands };
  return { primary: row.primary, others: row.commands.filter((c) => c !== row.primary) };
}

function renderAll(commands: readonly TaskCommand[], issueKey: string): string {
  return commands.map((c) => render(c, issueKey)).join(", ");
}

// The lines that tasker show prints after the fields. No row gives no line.
export function showLines(state: string, issueKey: string): string[] {
  const row = stateCommands(state);
  if (row === undefined) return [];
  const { primary, others } = splitRow(row);
  if (primary === undefined) return [`commands: ${renderAll(others, issueKey)}`];
  return [`next: ${render(primary, issueKey)}`, `also: ${renderAll(others, issueKey)}`];
}

// The NEXT cell of tasker status. No row gives an empty string.
export function nextCell(state: string): string {
  const row = stateCommands(state);
  if (row === undefined) return "";
  const { primary, others } = splitRow(row);
  if (primary === undefined) return others.join(", ");
  return `${primary} (also: ${others.join(", ")})`;
}

// The sentence that the wrong-state error ends with. No row gives undefined.
export function errorSentence(state: string, issueKey: string): string | undefined {
  const row = stateCommands(state);
  if (row === undefined) return undefined;
  const { primary, others } = splitRow(row);
  if (primary === undefined) return `commands: ${renderAll(others, issueKey)}`;
  return `next: ${render(primary, issueKey)} (also: ${renderAll(others, issueKey)})`;
}
