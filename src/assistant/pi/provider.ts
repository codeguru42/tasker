import * as os from "node:os";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { detailSuffix } from "../../detail-suffix.js";
import { errorMessage } from "../../error-message.js";
import { type AssistantResult, runAssistant } from "../../process/run-assistant.js";
import { assistantSchemaPath } from "../../store/layout.js";
import { isObject } from "../../object.js";
import { appendEventLine } from "../event-line.js";
import type { AssistantEvent, AssistantProvider, RunInput, RunOutcome } from "../provider.js";
import { assistantModelCheck } from "../model-check.js";
import { piAnswer } from "./answer.js";
import { correctivePrompt } from "./corrective-prompt.js";
import { type PiFiles, piArgs } from "./args.js";
import { piChildEnv } from "./child-env.js";
import { piDoctorChecks } from "./doctor.js";
import { piExtensionRefusal } from "./extensions.js";
import { builtInTool, guardLimits, writeGuardLimits } from "./guard-limits.js";
import { PI_READ_TOOL_NAMES } from "./args.js";
import { PI_ANSWER_TOOL_NAME } from "./answer-tool.js";
import { piNotInstalled, piProgram } from "./program.js";
import { piMessages } from "./stream.js";
import { guardExtensionPath } from "./guard-start.js";
import { quotaStopOf } from "./quota.js";
import { failed, type Failure } from "./failure.js";

const DEFAULT_FILES: PiFiles = {
  guardFile: guardExtensionPath,
  answerFile: fileURLToPath(new URL("./answer-extension.js", import.meta.url)),
};

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function sessionFile(sessionDir: string, sessionId: string): string | undefined {
  try {
    const entry = readdirSync(sessionDir, { withFileTypes: true }).find(
      (candidate) => candidate.isFile() && candidate.name.endsWith(`_${sessionId}.jsonl`),
    );
    return entry === undefined ? undefined : join(sessionDir, entry.name);
  } catch {
    return undefined;
  }
}

function fileSize(path: string | undefined): number {
  if (path === undefined) return 0;
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

interface ProcessOutcome {
  outcome: RunOutcome;
  noAnswerProblems?: string[];
}

function outcomeOfRun(
  input: RunInput,
  run: Extract<AssistantResult, { started: true }>,
  events: AssistantEvent[],
  sessionPath: string | undefined,
  startSize: number,
): ProcessOutcome {
  const messages = piMessages(events, sessionPath, startSize);
  const lastAssistant = messages
    .filter((message): message is Record<string, unknown> => isObject(message) && message.role === "assistant")
    .at(-1);
  const base = {
    sessionId: input.sessionId,
    events,
    permissionDenials: [],
    usage: "unavailable" as const,
    ...(sessionPath !== undefined && isFile(sessionPath) ? { transcriptPath: sessionPath } : {}),
  };
  const fail = (reason: string): Failure => ({
    ...base,
    kind: "failure",
    exitCode: run.code,
    signal: run.signal,
    reason,
  });

  const quotaStop = quotaStopOf(lastAssistant);
  if (run.passedSignal !== null) {
    if (quotaStop) return { outcome: { ...base, kind: "quota", cause: "rate_limit", ...quotaStop } };
    return { outcome: { ...base, kind: "interrupted", signal: run.passedSignal } };
  }
  if (run.timedOut) return { outcome: { ...base, kind: "timeout" } };
  if (quotaStop) return { outcome: { ...base, kind: "quota", cause: "rate_limit", ...quotaStop } };
  if (run.signal !== null)
    return { outcome: fail(`pi was killed by ${run.signal}${detailSuffix(run.stderrTail.trim())}`) };
  if (lastAssistant?.stopReason === "error" || lastAssistant?.stopReason === "aborted") {
    const message = typeof lastAssistant.errorMessage === "string" ? lastAssistant.errorMessage.slice(0, 500) : "";
    return { outcome: fail(message || `pi ended its turn with ${lastAssistant.stopReason}`) };
  }
  if (run.code !== 0) return { outcome: fail(`pi exited ${String(run.code)}${detailSuffix(run.stderrTail.trim())}`) };
  if (lastAssistant === undefined) return { outcome: fail("the assistant ended with no result") };
  if (input.jsonSchema !== undefined) {
    const checked = piAnswer(messages, input.checkAnswer!);
    if (!checked.ok) {
      return {
        outcome: fail(
          ["the assistant gave no structured answer:", ...checked.problems.map((problem) => `  - ${problem}`)].join(
            "\n",
          ),
        ),
        noAnswerProblems: checked.problems,
      };
    }
    return { outcome: { ...base, kind: "success", structuredOutput: checked.answer } };
  }
  return { outcome: { ...base, kind: "success" } };
}

export function createPiProvider(files: PiFiles = DEFAULT_FILES): AssistantProvider {
  return {
    id: "pi",
    async run(input) {
      const checkBeforeSpawn = (
        processInput: RunInput,
      ): { failure: Failure } | { childEnvironment: NodeJS.ProcessEnv; previousSession?: string } => {
        if (os.platform() !== "linux") {
          return { failure: failed(input, `the pi assistant runs only on Linux; this host is ${os.platform()}`) };
        }
        if (processInput.access !== "read-only") {
          return { failure: failed(input, "the pi assistant cannot run the execute role in this version") };
        }

        const childEnvironment = piChildEnv(processInput.env);
        if ("reason" in childEnvironment) return { failure: failed(input, childEnvironment.reason) };
        const extensionReason = piExtensionRefusal(
          childEnvironment.env.PI_CODING_AGENT_DIR,
          processInput.cwd,
          processInput.trustedExtensions,
        );
        if (extensionReason !== undefined) return { failure: failed(input, extensionReason) };

        const previousSession = processInput.resume
          ? sessionFile(processInput.sessionDir, processInput.sessionId)
          : undefined;
        if (processInput.resume && previousSession === undefined) {
          return {
            failure: failed(
              input,
              `the pi session ${processInput.sessionId} has no session file, so the run cannot continue it`,
            ),
          };
        }
        if (!isFile(files.guardFile)) {
          return { failure: failed(input, `pi guard extension is not a file: ${files.guardFile}`) };
        }
        if (!isFile(files.answerFile)) {
          return { failure: failed(input, `pi answer extension is not a file: ${files.answerFile}`) };
        }
        if (processInput.jsonSchema !== undefined && processInput.checkAnswer === undefined) {
          return { failure: failed(input, "a run with a JSON Schema needs RunInput.checkAnswer") };
        }
        return { childEnvironment: childEnvironment.env, previousSession };
      };

      const initialCheck = checkBeforeSpawn(input);
      if ("failure" in initialCheck) return initialCheck.failure;

      const schemaPath =
        input.jsonSchema === undefined ? undefined : assistantSchemaPath(input.sessionDir, input.sessionId);
      let limitsPath: string;
      try {
        const tools = PI_READ_TOOL_NAMES.map(builtInTool);
        if (schemaPath !== undefined) {
          tools.push({ name: PI_ANSWER_TOOL_NAME, path: files.answerFile, source: "cli" });
        }
        limitsPath = writeGuardLimits(input, guardLimits(input, tools));
        if (schemaPath !== undefined) writeFileSync(schemaPath, JSON.stringify(input.jsonSchema), { mode: 0o600 });
      } catch (error) {
        return failed(input, errorMessage(error));
      }

      let program: string;
      try {
        program = piProgram(input.env);
      } catch (error) {
        return failed(input, errorMessage(error));
      }

      let args: string[];
      let continuedArgs: string[];
      try {
        args = piArgs(input, files, limitsPath, schemaPath);
        continuedArgs = piArgs({ ...input, resume: true }, files, limitsPath, schemaPath);
      } catch (error) {
        return failed(input, errorMessage(error));
      }

      const deadline = Date.now() + input.timeoutMs;
      const allEvents: AssistantEvent[] = [];
      const permissionDenials = [] as RunOutcome["permissionDenials"];
      const cleanupErrors: string[] = [];
      let path = initialCheck.previousSession;
      let corrections = 0;
      let prompt = input.prompt;
      let priorOutcome: RunOutcome | undefined;
      let childEnvironment = initialCheck.childEnvironment;

      const combined = (chosen: RunOutcome): RunOutcome => ({
        ...chosen,
        sessionId: input.sessionId,
        events: allEvents,
        permissionDenials,
        usage: "unavailable",
        ...(path !== undefined && isFile(path) ? { transcriptPath: path } : {}),
        ...(cleanupErrors.length > 0 ? { sandboxCleanup: { error: cleanupErrors.join("\n") } } : {}),
      });

      while (true) {
        const processInput = corrections === 0 ? input : { ...input, resume: true };
        if (corrections > 0) {
          const check = checkBeforeSpawn(processInput);
          if ("failure" in check) return combined(priorOutcome!);
          childEnvironment = check.childEnvironment;
          path = check.previousSession;
        }
        const processArgs = corrections === 0 ? args : continuedArgs;

        const startSize = fileSize(path);
        const processEvents: AssistantEvent[] = [];
        let run: AssistantResult;
        try {
          run = await runAssistant(program, processArgs, {
            cwd: input.cwd,
            env: childEnvironment,
            prompt,
            deadline,
            onLine: (line) => appendEventLine(line, processEvents, input.onEvent),
            onSpawn: input.onSpawn ?? (() => {}),
          });
        } catch (error) {
          const failedProcess = failed(input, errorMessage(error));
          return priorOutcome === undefined
            ? failedProcess
            : { ...priorOutcome, events: [...allEvents, ...processEvents], permissionDenials };
        }

        allEvents.push(...processEvents);
        path ??= sessionFile(input.sessionDir, input.sessionId);
        if (!run.started) {
          const failedProcess = failed(input, run.notFound ? piNotInstalled(program) : run.error);
          return priorOutcome === undefined
            ? { ...failedProcess, events: allEvents, permissionDenials }
            : { ...priorOutcome, events: allEvents, permissionDenials };
        }

        const processResult = outcomeOfRun(input, run, processEvents, path, startSize);
        const current = processResult.outcome;
        permissionDenials.push(...current.permissionDenials);
        if (current.sandboxCleanup !== undefined && "error" in current.sandboxCleanup) {
          cleanupErrors.push(current.sandboxCleanup.error);
        }

        if (processResult.noAnswerProblems === undefined) {
          if (corrections > 0 && (current.kind === "failure" || current.kind === "timeout")) {
            return combined(priorOutcome!);
          }
          return combined(current);
        }

        priorOutcome = combined(current);
        if (corrections >= input.correctiveTurns || Date.now() >= deadline) return priorOutcome;
        corrections += 1;
        prompt = correctivePrompt(processResult.noAnswerProblems, input.jsonSchema!);
      }
    },
    doctorChecks: (repos) => piDoctorChecks(repos, os.platform()),
    modelChecks: (model) => [assistantModelCheck("pi", `pi model: ${model}`, model)],
    detectQuotaApprovalWarning: () => undefined,
    isQuotaEvent: () => false,
    shouldSuppressQuotaApprovalPause: () => false,
  };
}
