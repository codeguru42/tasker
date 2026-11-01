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
import { type PlaceholderList, removePlaceholders } from "../placeholders.js";
import { absentPlaceholders } from "./placeholders.js";
import { EDIT_HOOK_SCRIPT, editHookCommand, editHookRefusal } from "./edit-hook.js";
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
  if (run.passedSignal !== null) {
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

// The provider runs codex for each role, and gives the doctor checks of Codex. A run with workspace-write
// access gets write keys and the PreToolUse hook of apply_patch, which holds deniedEditPaths. The sandbox is
// the only limit on deniedCommands, and it does not block every entry. overageStop has no effect.
// hookScript is for tests. The default is EDIT_HOOK_SCRIPT.
export function createCodexProvider(options: { hookScript?: string } = {}): AssistantProvider {
  const hookScript = options.hookScript ?? EDIT_HOOK_SCRIPT;
  return {
    id: "codex",
    async run(input) {
      let hookCommand: string | undefined;
      if (input.access === "workspace-write") {
        // Codex lets each patch pass when the file of the hook command is missing.
        const refusal = editHookRefusal(hookScript);
        if (refusal !== undefined) return failureWithNoExit(input, refusal);
        hookCommand = editHookCommand(hookScript, input.cwd, input.deniedEditPaths);
      }
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
      // A write run leaves empty folders in the cwd. The list names the ones that do not exist before the spawn.
      let placeholders: PlaceholderList | undefined;
      if (input.access === "workspace-write") {
        try {
          placeholders = absentPlaceholders(input.cwd);
        } catch (error) {
          return failureWithNoExit(input, errorMessage(error));
        }
      }
      const finish = async (outcome: RunOutcome): Promise<RunOutcome> =>
        placeholders === undefined
          ? outcome
          : {
              ...outcome,
              sandboxCleanup: await removePlaceholders(
                input.cwd,
                placeholders,
                input.sandbox?.trackedPaths ?? (async () => []),
              ),
            };
      let run: AssistantResult;
      try {
        run = await runAssistant("codex", codexArgs(input, { threadId, schemaPath, hookCommand }), {
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
        return finish(failureWithNoExit(input, errorMessage(error), events));
      }
      if (!run.started) {
        return finish(failureWithNoExit(input, run.notFound ? CODEX_NOT_INSTALLED : run.error, events));
      }
      return finish(codexOutcomeOf(input, run, events, readCodexStream(events, previous)));
    },
    doctorChecks: (repos) => (repos.length === 0 ? [] : [codexVersionCheck(), codexLoginCheck()]),
    modelChecks: () => [],
    detectQuotaApprovalWarning: () => undefined,
    isQuotaEvent: () => false,
    shouldSuppressQuotaApprovalPause: () => false,
  };
}
