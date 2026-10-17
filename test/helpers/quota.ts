// The expected ISO text of a reset time in Unix seconds. It is built here, apart from the code under test.
function isoTimeExpected(resetsAt: number): string {
  return new Date(resetsAt * 1000).toISOString();
}

// The line that tasker prints when it pauses a task for a quota approval. It is built here from the parts, apart from
// the code under test. percent is the whole-number use of the quota window. resetsAt is in Unix seconds.
export function quotaPauseLineExpected(phase: string, percent: number, resetsAt?: number): string {
  const reset = resetsAt === undefined ? "the reset time is unknown" : `it resets at ${isoTimeExpected(resetsAt)}`;
  return `${phase} paused by a quota warning: the use of the quota window is ${percent}%; ${reset}\n`;
}

// The first line of tasker approve-credits. resetsAt is the reset time of the approved window in Unix seconds. The
// line has another form for a pause that named no window.
export function approvedCreditsLineExpected(key: string, resetsAt?: number): string {
  const window =
    resetsAt === undefined
      ? "the pause named no window, so the next warning pauses again"
      : `the quota window that resets at ${isoTimeExpected(resetsAt)}`;
  return `approved credits for ${key}: ${window}\n`;
}
