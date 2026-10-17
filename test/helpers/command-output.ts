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
