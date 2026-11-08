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

type Failure = Extract<RunOutcome, { kind: "failure" }>;

const DEFAULT_FILES: PiFiles = {
  guardFile: guardExtensionPath,
  answerFile: fileURLToPath(new URL("./answer-extension.js", import.meta.url)),
};

function failed(input: RunInput, reason: string): Failure {
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

function outcomeOfRun(
  input: RunInput,
  run: Extract<AssistantResult, { started: true }>,
  events: AssistantEvent[],
  sessionPath: string | undefined,
  startSize: number,
): RunOutcome {
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

  if (run.passedSignal !== null) return { ...base, kind: "interrupted", signal: run.passedSignal };
  if (run.timedOut) return { ...base, kind: "timeout" };
  if (run.signal !== null) return fail(`pi was killed by ${run.signal}${detailSuffix(run.stderrTail.trim())}`);
  if (lastAssistant?.stopReason === "error" || lastAssistant?.stopReason === "aborted") {
    const message = typeof lastAssistant.errorMessage === "string" ? lastAssistant.errorMessage.slice(0, 500) : "";
    return fail(message || `pi ended its turn with ${lastAssistant.stopReason}`);
  }
  if (run.code !== 0) return fail(`pi exited ${String(run.code)}${detailSuffix(run.stderrTail.trim())}`);
  if (lastAssistant === undefined) return fail("the assistant ended with no result");
  if (input.jsonSchema !== undefined) {
    const answer = piAnswer(messages);
    if (answer === undefined) return fail("the assistant gave no structured answer");
    return { ...base, kind: "success", structuredOutput: answer };
  }
  return { ...base, kind: "success" };
}

export function createPiProvider(files: PiFiles = DEFAULT_FILES): AssistantProvider {
  return {
    id: "pi",
    async run(input) {
      if (os.platform() !== "linux") {
        return failed(input, `the pi assistant runs only on Linux; this host is ${os.platform()}`);
      }
      if (input.access !== "read-only") {
        return failed(input, "the pi assistant cannot run the execute role in this version");
      }

      const childEnvironment = piChildEnv(input.env);
      if ("reason" in childEnvironment) return failed(input, childEnvironment.reason);
      const extensionReason = piExtensionRefusal(
        childEnvironment.env.PI_CODING_AGENT_DIR,
        input.cwd,
        input.trustedExtensions,
      );
      if (extensionReason !== undefined) return failed(input, extensionReason);

      const previousSession = input.resume ? sessionFile(input.sessionDir, input.sessionId) : undefined;
      if (input.resume && previousSession === undefined) {
        return failed(input, `the pi session ${input.sessionId} has no session file, so the run cannot continue it`);
      }
      const startSize = fileSize(previousSession);

      if (!isFile(files.guardFile)) return failed(input, `pi guard extension is not a file: ${files.guardFile}`);
      if (!isFile(files.answerFile)) {
        return failed(input, `pi answer extension is not a file: ${files.answerFile}`);
      }

      const events: AssistantEvent[] = [];
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
      try {
        args = piArgs(input, files, limitsPath, schemaPath);
      } catch (error) {
        return failed(input, errorMessage(error));
      }

      let run: AssistantResult;
      try {
        run = await runAssistant(program, args, {
          cwd: input.cwd,
          env: childEnvironment.env,
          prompt: input.prompt,
          deadline: Date.now() + input.timeoutMs,
          onLine: (line) => appendEventLine(line, events, input.onEvent),
          onSpawn: input.onSpawn ?? (() => {}),
        });
      } catch (error) {
        return failed(input, errorMessage(error));
      }

      if (!run.started) return failed(input, run.notFound ? piNotInstalled(program) : run.error);

      const path = previousSession ?? sessionFile(input.sessionDir, input.sessionId);
      return outcomeOfRun(input, run, events, path, startSize);
    },
    doctorChecks: (repos) => piDoctorChecks(repos),
    modelChecks: (model) => [assistantModelCheck("pi", `pi model: ${model}`, model)],
    detectQuotaApprovalWarning: () => undefined,
    isQuotaEvent: () => false,
    shouldSuppressQuotaApprovalPause: () => false,
  };
}
