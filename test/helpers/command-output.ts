// The first line of the output of the plan, refine, execute, verify and review commands, built by hand.
// Tests that compare this text use these functions, so the text has one home.

export function plannedLine(key: string, version: number): string {
  return `planned ${key} as revision v${version}`;
}

export function refinedLine(key: string, version: number): string {
  return `refined ${key} as revision v${version}`;
}

export function executedLine(key: string, version: number): string {
  return `executed ${key} at revision v${version}`;
}

export function verifiedLine(key: string, run: number): string {
  return `verified ${key}: run ${run}`;
}

// The review line goes on with the count of findings, so only its prefix is shared.
export function reviewedLinePrefix(key: string, number: number): string {
  return `reviewed ${key}: review ${number}`;
}

// The first line of tasker resume and tasker approve-credits after the move. Unlike the lines above, it ends with a
// newline, because the next command goes on in the line after it.
export function resumedLine(key: string, origin: string, target: string): string {
  return `resumed ${key}: paused in ${origin}, back in ${target}\n`;
}

// The note on stderr of tasker update-branch for a task branch that origin does not have.
export function absentRemoteNote(branch: string): string {
  return `note: origin/${branch} does not exist; nothing to sync from\n`;
}

// The hint line of tasker update-branch after a run that moved the head. It ends with a newline, because the next line
// follows it.
export function undoHint(key: string, head: string): string {
  return `previous HEAD was ${head}; run tasker update-branch ${key} --undo to restore it\n`;
}
