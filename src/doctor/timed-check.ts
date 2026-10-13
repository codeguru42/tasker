import type { Check, CheckResult } from "./check.js";
import { errorMessage } from "./error-message.js";

// A check body throws it when its own deadline passes. The wrapper gives the timeout result.
export class DeadlineError extends Error {}

export function timedOut(timeoutMs: number): CheckResult {
  return { status: "error", detail: `the check did not finish in ${timeoutMs} ms` };
}

export interface TimedCheckSpec {
  name: string;
  required: boolean;
  timeoutMs: number;
}

// The one home of the timeout rules of a doctor check. It makes the signal and the deadline,
// catches the errors and gives the timeout result. run() never rejects. A timeout gives the
// timeout result, with no partial result.
export function timedCheck(
  spec: TimedCheckSpec,
  body: (
    env: NodeJS.ProcessEnv,
    limit: { signal: AbortSignal; deadline: number },
  ) => Promise<CheckResult>,
): Check {
  return {
    name: spec.name,
    required: spec.required,
    timeoutMs: spec.timeoutMs,
    async run(env) {
      const signal = AbortSignal.timeout(spec.timeoutMs);
      const deadline = Date.now() + spec.timeoutMs;
      let result: CheckResult;
      try {
        result = await body(env, { signal, deadline });
      } catch (error) {
        result =
          signal.aborted || error instanceof DeadlineError
            ? timedOut(spec.timeoutMs)
            : { status: "error", detail: errorMessage(error) };
      }
      if (signal.aborted && result.status !== "error") {
        result = timedOut(spec.timeoutMs);
      }
      return result;
    },
  };
}
