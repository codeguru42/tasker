import { errorMessage } from "../../error-message.js";
import { childEnv } from "../../process/child-env.js";
import { type AssistantResult, runAssistant } from "../../process/run-assistant.js";
import type { AssistantEvent, AssistantProvider, RunInput, RunOutcome } from "../provider.js";
import { claudeArgs } from "./args.js";
import { claudeModelCheck, claudeVersionCheck } from "./doctor.js";
import { parseLine, readStream, type StreamFacts } from "./stream.js";

type Failure = Extract<RunOutcome, { kind: "failure" }>;

// A failure with no exit code and no signal: a refusal before the spawn, a start that failed, or a
// run that rejected.
function failureWithNoExit(input: RunInput, reason: string, events: AssistantEvent[]): Failure {
  return {
    kind: "failure",
    sessionId: input.sessionId,
    ...outcomeFacts(events, readStream(events)),
    exitCode: null,
    signal: null,
    reason,
  };
}

function errorResultReason(result: Record<string, unknown>): string {
  if (typeof result["result"] === "string" && result["result"] !== "") return result["result"];
  if (typeof result["subtype"] === "string") return `the assistant ended with the error ${result["subtype"]}`;
  return "the assistant ended with an error";
}

// The outcome of a run that started, in this order: the deadline, a signal, an error result, an exit
// code, a missing result, a missing structured answer.
function outcomeOf(
  input: RunInput,
  run: Extract<AssistantResult, { started: true }>,
  events: AssistantEvent[],
  facts: StreamFacts,
): RunOutcome {
  const base = { sessionId: input.sessionId, ...outcomeFacts(events, facts) };
  const fail = (reason: string): Failure => ({ kind: "failure", ...base, exitCode: run.code, signal: run.signal, reason });
  if (run.timedOut) return { kind: "timeout", ...base };
  if (run.signal !== null) return fail(`claude was killed by ${run.signal}`);
  const { result } = facts;
  if (result?.["is_error"] === true) return fail(errorResultReason(result));
  if (run.code !== 0) {
    const tail = run.stderrTail.trim();
    return fail(`claude exited ${run.code}${tail === "" ? "" : `: ${tail}`}`);
  }
  if (result === undefined) return fail("the assistant ended with no result");
  if (input.jsonSchema === undefined) return { kind: "success", ...base };
  if (result["structured_output"] === undefined) return fail("the assistant gave no structured answer");
  return { kind: "success", ...base, structuredOutput: result["structured_output"] };
}

export function createClaudeCodeProvider(): AssistantProvider {
  return {
    id: "claude-code",
    async run(input) {
      if (input.sandbox !== undefined) {
        return failureWithNoExit(input, "the claude-code provider cannot enforce a sandbox in this version", []);
      }
      if (input.overageStop !== undefined) {
        return failureWithNoExit(input, "the claude-code provider cannot enforce an overage stop in this version", []);
      }
      const events: AssistantEvent[] = [];
      let run: AssistantResult;
      try {
        run = await runAssistant("claude", claudeArgs(input), {
          cwd: input.cwd,
          env: childEnv(input.env, []),
          prompt: input.prompt,
          deadline: Date.now() + input.timeoutMs,
          onLine: (line) => {
            const event = parseLine(line);
            if (event === undefined) return;
            events.push(event);
            try {
              input.onEvent?.(event);
            } catch {
              // onLine must not throw, and a broken listener must not stop the run.
            }
          },
          onSpawn: input.onSpawn ?? (() => {}),
        });
      } catch (error) {
        return failureWithNoExit(input, errorMessage(error), events);
      }
      if (!run.started) {
        return failureWithNoExit(input, run.notFound ? "claude is not installed or not on PATH" : run.error, events);
      }
      return outcomeOf(input, run, events, readStream(events));
    },
    doctorChecks: (repos) => (repos.length === 0 ? [] : [claudeVersionCheck()]),
    modelChecks: (model) => [claudeModelCheck(model)],
    // The quota ticket replaces these two.
    detectQuotaApprovalWarning: () => undefined,
    shouldSuppressQuotaApprovalPause: () => false,
  };
}

// The parts of an outcome that come from the events of a run.
function outcomeFacts(
  events: AssistantEvent[],
  facts: StreamFacts,
): Pick<Failure, "events" | "permissionDenials" | "usage" | "reportedModel"> {
  return {
    events,
    permissionDenials: facts.permissionDenials,
    usage: facts.usage,
    ...(facts.reportedModel === undefined ? {} : { reportedModel: facts.reportedModel }),
  };
}
