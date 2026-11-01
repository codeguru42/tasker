import { detailSuffix } from "../../detail-suffix.js";
import { errorMessage } from "../../error-message.js";
import { replaceFile } from "../../replace-file.js";
import { childEnv } from "../../process/child-env.js";
import { type AssistantResult, runAssistant } from "../../process/run-assistant.js";
import { codexSchemaPath } from "../../store/layout.js";
import { parseLine } from "../event-line.js";
import type { AssistantEvent, AssistantProvider, RunInput, RunOutcome, TokenUsage } from "../provider.js";
import { codexArgs } from "./args.js";
import { CODEX_NOT_INSTALLED, codexLoginCheck, codexVersionCheck } from "./doctor.js";
import { readThreadId, readUsageTotal, writeThreadId, writeUsageTotal } from "./session.js";
import { type CodexStreamFacts, readCodexStream, threadIdOf, usageTotalOf } from "./stream.js";

type Failure = Extract<RunOutcome, { kind: "failure" }>;

// A failure with no exit code and no signal: a refusal before the spawn, a start that failed, or a
// run that rejected. A refusal passes no events.
function failureWithNoExit(input: RunInput, reason: string, events: AssistantEvent[] = []): Failure {
  return {
    kind: "failure",
    sessionId: input.sessionId,
    events,
    permissionDenials: [],
    usage: "unavailable",
    exitCode: null,
    signal: null,
    reason,
  };
}

// The outcome of a run that started. The first match wins:
// - A signal that tasker passed gives interrupted, and the deadline gives timeout.
// - A signal that killed codex gives a failure.
// - A failure event of the stream gives a failure with its message.
// - A exit code other than 0 gives a failure.
// - A stream with no turn.completed gives a failure.
// - With a schema, an answer that is not JSON gives a failure.
// - Else success.
// Codex has no quota outcome. The stream shows no permission denial, so permissionDenials is always [].
function codexOutcomeOf(
  input: RunInput,
  run: Extract<AssistantResult, { started: true }>,
  events: AssistantEvent[],
  facts: CodexStreamFacts,
): RunOutcome {
  const base = {
    sessionId: input.sessionId,
    events,
    permissionDenials: [],
    usage: facts.usage,
  };
  if (run.passedSignal !== null && run.passedSignal !== undefined) {
    return { ...base, kind: "interrupted", signal: run.passedSignal };
  }
  if (run.timedOut) return { ...base, kind: "timeout" };
  const failure = (reason: string): Failure => ({
    ...base,
    kind: "failure",
    exitCode: run.code,
    signal: run.signal,
    reason,
  });
  if (run.signal !== null) return failure(`codex was killed by ${run.signal}`);
  if (facts.failureReason !== undefined) return failure(facts.failureReason);
  if (run.code !== 0) return failure(`codex exited ${String(run.code)}${detailSuffix(run.stderrTail.trim())}`);
  if (!facts.completed) return failure("the assistant ended with no result");
  if (input.jsonSchema === undefined) return { ...base, kind: "success" };
  try {
    return { ...base, kind: "success", structuredOutput: JSON.parse(facts.answerText ?? "") as unknown };
  } catch {
    return failure("the assistant gave no structured answer");
  }
}

// The provider runs codex for the plan and the review roles, and gives the doctor checks of Codex.
// The sandbox alone enforces deniedCommands. overageStop has no effect.
export function createCodexProvider(): AssistantProvider {
  return {
    id: "codex",
    async run(input) {
      let threadId: string | undefined;
      let previous: TokenUsage | undefined;
      if (input.resume) {
        try {
          threadId = readThreadId(input.sessionDir, input.sessionId);
        } catch (error) {
          return failureWithNoExit(input, errorMessage(error));
        }
        if (threadId === undefined) {
          return failureWithNoExit(
            input,
            `the codex session ${input.sessionId} has no thread id, so the run cannot continue it`,
          );
        }
        previous = readUsageTotal(input.sessionDir, input.sessionId);
      }
      let schemaPath: string | undefined;
      if (input.jsonSchema !== undefined) {
        schemaPath = codexSchemaPath(input.sessionDir, input.sessionId);
        try {
          replaceFile(schemaPath, JSON.stringify(input.jsonSchema));
        } catch (error) {
          return failureWithNoExit(input, errorMessage(error));
        }
      }
      const events: AssistantEvent[] = [];
      let run: AssistantResult;
      try {
        run = await runAssistant("codex", codexArgs(input, { threadId, schemaPath }), {
          cwd: input.cwd,
          env: childEnv(input.env, []),
          prompt: input.prompt,
          deadline: Date.now() + input.timeoutMs,
          onLine: (line) => {
            const event = parseLine(line);
            if (event === undefined) return;
            events.push(event);
            try {
              const id = threadIdOf(event);
              if (id !== undefined) writeThreadId(input.sessionDir, input.sessionId, id);
            } catch {
              // A failed write only means that a later continued run fails.
            }
            try {
              const total = usageTotalOf(event);
              if (total !== undefined) writeUsageTotal(input.sessionDir, input.sessionId, total);
            } catch {
              // A failed write only means that the next run counts too much.
            }
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
        return failureWithNoExit(input, run.notFound ? CODEX_NOT_INSTALLED : run.error, events);
      }
      return codexOutcomeOf(input, run, events, readCodexStream(events, previous));
    },
    doctorChecks: (repos) => (repos.length === 0 ? [] : [codexVersionCheck(), codexLoginCheck()]),
    modelChecks: () => [],
    detectQuotaApprovalWarning: () => undefined,
    isQuotaEvent: () => false,
    shouldSuppressQuotaApprovalPause: () => false,
  };
}
