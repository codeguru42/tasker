// The expected commands of each state, written by hand from the table in docs/statemachine.md. It does not read
// src/state/commands.ts, so a test can compare the table with it.
interface Expected {
  primary?: string;
  commands: string[];
}

const ABORT_ONLY: Expected = { commands: ["abort"] };

const EXPECTED: Record<string, Expected> = {
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
  quota_blocked: { primary: "resume", commands: ["resume", "approve-credits", "abort"] },
  awaiting_quota_approval: { primary: "approve-credits", commands: ["approve-credits", "abort"] },
  interrupted: { primary: "resume", commands: ["resume", "abort"] },
  failed: { primary: "retry", commands: ["retry", "refine", "abort"] },
};

// The row of a state, or undefined for a terminal or unknown state.
export function expectedStateCommands(state: string): Expected | undefined {
  return EXPECTED[state];
}

function tasker(name: string, issueKey: string): string {
  return `tasker ${name} ${issueKey}`;
}

// The primary command, rendered, and the rendered list of the other commands (all commands without a primary).
function splitExpected(row: Expected, issueKey: string): { primary?: string; others: string } {
  const others = (row.primary === undefined ? row.commands : row.commands.filter((c) => c !== row.primary))
    .map((c) => tasker(c, issueKey))
    .join(", ");
  return row.primary === undefined ? { others } : { primary: tasker(row.primary, issueKey), others };
}

// The lines that tasker show prints after the fields, each with a line end. An empty string when the state has no row.
export function expectedShowLines(state: string, issueKey: string): string {
  const row = expectedStateCommands(state);
  if (row === undefined) return "";
  const { primary, others } = splitExpected(row, issueKey);
  if (primary === undefined) return `commands: ${others}\n`;
  return `next: ${primary}\nalso: ${others}\n`;
}

// The note that a command prints on stderr when it finds a dead run, without a line end. state is the state that the
// task was in when its run died, for example "executing". The text is built here, without the code under test.
export function deadRunNote(issueKey: string, state: string): string {
  return `note: the run of ${issueKey} died in ${state}; the task is now interrupted`;
}

// The full wrong-state error, without a line end. needs is the text of the accepted states, for example
// "landed or cleanup_failed".
export function wrongStateError(state: string, issueKey: string, command: string, needs: string): string {
  const base = `the task of ${issueKey} is in ${state}; tasker ${command} needs ${needs}`;
  const row = expectedStateCommands(state);
  if (row === undefined) return base;
  const { primary, others } = splitExpected(row, issueKey);
  if (primary === undefined) return `${base}. commands: ${others}`;
  return `${base}. next: ${primary} (also: ${others})`;
}
