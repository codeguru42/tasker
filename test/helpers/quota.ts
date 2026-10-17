// The line that tasker prints when it pauses a task for a quota approval. It is built here from the parts, apart from
// the code under test. percent is the whole-number use of the quota window. resetsAt is in Unix seconds.
export function quotaPauseLineExpected(phase: string, percent: number, resetsAt?: number): string {
  const reset =
    resetsAt === undefined ? "the reset time is unknown" : `it resets at ${new Date(resetsAt * 1000).toISOString()}`;
  return `${phase} paused by a quota warning: the use of the quota window is ${percent}%; ${reset}\n`;
}
