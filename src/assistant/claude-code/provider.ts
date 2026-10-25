import { permissionHookSettings } from "./permission-hook.js";
import { tmpdir } from "node:os";
import { detailSuffix } from "../../detail-suffix.js";
import { errorMessage } from "../../error-message.js";
import { childEnv } from "../../process/child-env.js";
import { type AssistantResult, runAssistant } from "../../process/run-assistant.js";
import type { AssistantEvent, AssistantProvider, RunInput, RunOutcome } from "../provider.js";
import { claudeArgs } from "./args.js";
import { CLAUDE_NOT_INSTALLED, claudeModelCheck, claudeVersionCheck, sandboxProgramCheck } from "./doctor.js";
import { removePlaceholders } from "./placeholders.js";
import {
  detectQuotaApprovalWarning,
  isQuotaEvent,
  overageStopOf,
  quotaStopOf,
  shouldSuppressQuotaApprovalPause,
} from "./quota.js";
import {
  LINUX_SANDBOX_PROGRAMS,
  sandboxHostRefusal,
  sandboxSettings,
  sandboxSocketFolder,
  sharedFolderRefusal,
} from "./sandbox.js";
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
  if (typeof result.result === "string" && result.result !== "") return result.result;
  if (typeof result.subtype === "string") return `the assistant ended with the error ${result.subtype}`;
  return "the assistant ended with an error";
}

// The outcome of a run that started. The first match wins:
// - An overage stop (the provider recorded an event that shows the start of paid usage) gives quota with
//   cause "overage". It wins over every other outcome, also the timeout, because it rests on the parsed
//   event, not on whether the stop beat the exit of the child.
// - A signal that tasker passed to the run (passedSignal) gives interrupted with that signal. It wins over the
//   timeout, the failures and success. Only the overage stop and the quota stop below win over it, because a
//   quota outcome rests on a parsed event.
// - The deadline gives timeout.
// - A quota stop (the last event is a result with terminal_reason "api_error" and api_error_status 429,
//   and the exit code is not 0) gives quota with cause "rate_limit". It wins over each failure below,
//   because the next step is a resume, not a fix.
// - A signal that stopped the leader gives failure.
// - A result with is_error true gives failure.
// - An exit code other than 0 gives failure.
// - A missing result gives failure.
// - A missing structured answer (with a schema) gives failure.
// - Else success.
function outcomeOf(
  input: RunInput,
  run: Extract<AssistantResult, { started: true }>,
  events: AssistantEvent[],
  facts: StreamFacts,
  overage: { resetsAt?: number } | undefined,
): RunOutcome {
  const base = { sessionId: input.sessionId, ...outcomeFacts(events, facts) };
  const fail = (reason: string): Failure => ({
    kind: "failure",
    ...base,
    exitCode: run.code,
    signal: run.signal,
    reason,
  });
  if (overage !== undefined) return { kind: "quota", cause: "overage", ...base, ...overage };
  const quotaStop = quotaStopOf(events, run.code);
  if (run.passedSignal !== null) {
    if (quotaStop !== undefined) return { kind: "quota", cause: "rate_limit", ...base, ...quotaStop };
    return { kind: "interrupted", ...base, signal: run.passedSignal };
  }
  if (run.timedOut) return { kind: "timeout", ...base };
  if (quotaStop !== undefined) return { kind: "quota", cause: "rate_limit", ...base, ...quotaStop };
  if (run.signal !== null) return fail(`claude was killed by ${run.signal}`);
  const { result } = facts;
  if (result?.is_error === true) return fail(errorResultReason(result));
  if (run.code !== 0) {
    return fail(`claude exited ${String(run.code)}${detailSuffix(run.stderrTail.trim())}`);
  }
  if (result === undefined) return fail("the assistant ended with no result");
  if (input.jsonSchema === undefined) return { kind: "success", ...base };
  if (result.structured_output === undefined) return fail("the assistant gave no structured answer");
  return { kind: "success", ...base, structuredOutput: result.structured_output };
}

// platform and tmpRoot are for tests. The defaults are the platform of the host and "/tmp".
export function createClaudeCodeProvider(
  options: { platform?: NodeJS.Platform; tmpRoot?: string } = {},
): AssistantProvider {
  const platform = options.platform ?? process.platform;
  return {
    id: "claude-code",
    async run(input) {
      const env = childEnv(input.env, []);
      const { sandbox } = input;
      if (sandbox !== undefined) {
        const refusal = sandboxHostRefusal(platform, env) ?? sharedFolderRefusal(sandbox.sharedFolder);
        if (refusal !== undefined) return failureWithNoExit(input, refusal, []);
      }
      let settings: Record<string, unknown> | undefined;
      if (sandbox !== undefined) {
        try {
          const folder = sandboxSocketFolder({
            uid: process.getuid?.(),
            tmpRoot: options.tmpRoot ?? "/tmp",
            sharedTemps: ["/tmp", "/private/tmp", "/var/tmp", tmpdir(), ...(env.TMPDIR ? [env.TMPDIR] : [])],
          });
          settings = sandboxSettings(sandbox, folder);
        } catch (error) {
          return failureWithNoExit(input, errorMessage(error), []);
        }
      }
      if (input.allowSkillWrites === true) settings = { ...settings, ...permissionHookSettings(input.cwd) };
      // After a sandboxed run, the leftover placeholders go. The cleanup never changes the kind.
      const finish = async (outcome: RunOutcome): Promise<RunOutcome> =>
        sandbox === undefined
          ? outcome
          : { ...outcome, sandboxCleanup: await removePlaceholders(input.cwd, sandbox.trackedPaths) };
      const events: AssistantEvent[] = [];
      const stop = new AbortController();
      let overage: { resetsAt?: number } | undefined;
      let run: AssistantResult;
      try {
        run = await runAssistant("claude", claudeArgs(input, settings), {
          cwd: input.cwd,
          env,
          prompt: input.prompt,
          deadline: Date.now() + input.timeoutMs,
          signal: stop.signal,
          onLine: (line) => {
            const event = parseLine(line);
            if (event === undefined) return;
            events.push(event);
            if (input.overageStop !== undefined && overage === undefined) {
              overage = overageStopOf(event, input.overageStop);
              if (overage !== undefined) stop.abort();
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
        return finish(failureWithNoExit(input, run.notFound ? CLAUDE_NOT_INSTALLED : run.error, events));
      }
      return finish(outcomeOf(input, run, events, readStream(events), overage));
    },
    doctorChecks: (repos) =>
      repos.length === 0
        ? []
        : [
            claudeVersionCheck(),
            ...(platform === "linux"
              ? LINUX_SANDBOX_PROGRAMS.map(({ program, pkg }) => sandboxProgramCheck(program, pkg))
              : []),
          ],
    modelChecks: (model) => [claudeModelCheck(model)],
    detectQuotaApprovalWarning,
    isQuotaEvent,
    shouldSuppressQuotaApprovalPause,
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
