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

// Runs the assistant in plan mode and records the plan revision. The caller holds the task lock.
export async function runPlanRevision(request: PlanRunRequest): Promise<PlanResult> {
  const { store, config, task, io, phase, prompt, archived, version, prepared, source, feedback } = request;
  transitionTask(store, task.id, phase);
  try {
    const path = planTranscriptPath(config.dataRoot, task, version);
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, "a");
    let outcome;
    try {
      outcome = await prepared.start({
        prompt,
        jsonSchema: planAnswerJsonSchema(),
        onEvent: (event) => writeSync(fd, `${JSON.stringify(event)}\n`),
      });
    } finally {
      closeSync(fd);
    }
    const result = applyRunOutcome({
      store,
      task,
      phase,
      timeoutMinutes: config.limits.planTimeoutMin,
      io,
      outcome,
    });
    if ("exitCode" in result) return result;
    const check = checkPlanAnswer(result.outcome.structuredOutput);
    if (!check.ok) {
      return failRun(
        store,
        task,
        io,
        ["the assistant returned a plan that tasker refuses:", ...check.problems.map((p) => `  - ${p}`)].join("\n"),
      );
    }
    try {
      recordPlanRevision(
        store,
        config.dataRoot,
        task.id,
        {
          version,
          source,
          ...(feedback === undefined ? {} : { feedback }),
          answer: check.answer,
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
      answer: check.answer,
    };
  } catch (error) {
    return failRun(store, task, io, `${phase} failed: ${errorMessage(error)}`);
  }
}
