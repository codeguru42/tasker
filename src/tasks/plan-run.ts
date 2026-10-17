import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import { checkPlanAnswer, planAnswerJsonSchema, type PlanAnswer } from "../plan/answer.js";
import { transitionTask } from "../state/machine.js";
import { planRevisionPath, planTranscriptPath } from "../store/layout.js";
import { PlanFileWriteError, recordPlanRevision } from "../store/plan-file.js";
import type { PlanRevisionSource, Task, TaskStore } from "../store/store.js";
import type { PreparedPlanModeRun } from "./assistant-run.js";
import { applyRunOutcome, failRun } from "./run-outcome.js";

export interface PlannedRevision {
  version: number;
  planPath: string;
  promptPath: string;
  answer: PlanAnswer;
}

// A result with exitCode means that the run step already printed the message.
export type PlanResult = PlannedRevision | { exitCode: number };

export interface PlanRunRequest {
  store: TaskStore;
  config: Config;
  task: Task;
  io: Io;
  // The spawning state of the run: planning or refining. The messages name it.
  phase: "planning" | "refining";
  prompt: string;
  archived: { version: string; path: string };
  version: number;
  prepared: PreparedPlanModeRun;
  source: PlanRevisionSource;
  feedback?: string;
}

// The request of one plan-mode run that ends in a structured answer. A is the answer, R is the result of record.
export interface PlanModeAnswerRequest<A, R> {
  store: TaskStore;
  config: Config;
  task: Task;
  io: Io;
  // The spawning state of the run. The messages name it.
  phase: "planning" | "refining" | "reviewing";
  prompt: string;
  prepared: PreparedPlanModeRun;
  transcriptPath: string;
  jsonSchema: Record<string, unknown>;
  check: (output: unknown) => { ok: true; answer: A } | { ok: false; problems: string[] };
  // The noun of the refused message: "a plan" or "findings".
  refused: string;
  // Records the answer and moves the task. The times are the start and the end of the assistant run.
  record: (answer: A, times: { startedAt: string; endedAt: string }) => R | { exitCode: number };
}

// Runs the assistant in plan mode, writes its events to the transcript and checks its answer. The caller holds the
// task lock. A failure moves the task to failed through failRun, so a result with exitCode already printed its message.
export async function runPlanModeAnswer<A, R>(request: PlanModeAnswerRequest<A, R>): Promise<R | { exitCode: number }> {
  const { store, config, task, io, phase, prompt, prepared, transcriptPath, jsonSchema, check, refused, record } =
    request;
  transitionTask(store, task.id, phase);
  try {
    const startedAt = new Date().toISOString();
    mkdirSync(dirname(transcriptPath), { recursive: true });
    const fd = openSync(transcriptPath, "a");
    let outcome;
    try {
      outcome = await prepared.start({
        prompt,
        jsonSchema,
        onEvent: (event) => writeSync(fd, `${JSON.stringify(event)}\n`),
      });
    } finally {
      closeSync(fd);
    }
    const endedAt = new Date().toISOString();
    const result = applyRunOutcome({
      store,
      task,
      phase,
      timeoutMinutes: config.limits.planTimeoutMin,
      io,
      outcome,
      quota: { repo: config.repos[task.repoKey], prepared },
    });
    if ("exitCode" in result) return result;
    const checked = check(result.outcome.structuredOutput);
    if (!checked.ok) {
      return failRun(
        store,
        task,
        io,
        [`the assistant returned ${refused} that tasker refuses:`, ...checked.problems.map((p) => `  - ${p}`)].join(
          "\n",
        ),
      );
    }
    return record(checked.answer, { startedAt, endedAt });
  } catch (error) {
    return failRun(store, task, io, `${phase} failed: ${errorMessage(error)}`);
  }
}

// Runs the assistant in plan mode and records the plan revision. The caller holds the task lock.
export function runPlanRevision(request: PlanRunRequest): Promise<PlanResult> {
  const { store, config, task, io, phase, prompt, archived, version, prepared, source, feedback } = request;
  return runPlanModeAnswer({
    store,
    config,
    task,
    io,
    phase,
    prompt,
    prepared,
    transcriptPath: planTranscriptPath(config.dataRoot, task, version),
    jsonSchema: planAnswerJsonSchema(),
    check: checkPlanAnswer,
    refused: "a plan",
    record: (answer): PlanResult => {
      try {
        recordPlanRevision(
          store,
          config.dataRoot,
          task.id,
          {
            version,
            source,
            ...(feedback === undefined ? {} : { feedback }),
            answer,
            prompt: archived.version,
          },
          "awaiting_plan_review",
        );
      } catch (error) {
        // Only the write of the plan file has its own message. Each other error goes to the outer catch.
        if (!(error instanceof PlanFileWriteError)) throw error;
        return failRun(store, task, io, error.message);
      }
      return {
        version,
        planPath: planRevisionPath(config.dataRoot, task, version),
        promptPath: archived.path,
        answer,
      };
    },
  });
}
