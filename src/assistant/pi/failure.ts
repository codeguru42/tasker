import type { RunInput, RunOutcome } from "../provider.js";

export type Failure = Extract<RunOutcome, { kind: "failure" }>;

export function failed(input: RunInput, reason: string): Failure {
  return {
    kind: "failure",
    sessionId: input.sessionId,
    events: [],
    permissionDenials: [],
    usage: "unavailable",
    exitCode: null,
    signal: null,
    reason,
  };
}
