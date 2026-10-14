import type { RunOutcome } from "../assistant/provider.js";
import type { Io } from "../cli.js";
import { failTask, type TaskState, transitionTask } from "../state/machine.js";
import type { Task, TaskStore } from "../store/store.js";

export type SuccessOutcome = Extract<RunOutcome, { kind: "success" }>;

export interface RunOutcomeRequest {
  store: TaskStore;
  task: Task;
  // The spawning state of the run, for example planning. The messages name it.
  phase: TaskState;
  // The deadline of the run.
  timeoutMinutes: number;
  io: Io;
  outcome: RunOutcome;
}

// success: the caller makes its checks and its move. Any other outcome: the task moved, and the
// command stops with exitCode.
export type RunOutcomeResult = { outcome: SuccessOutcome } | { exitCode: number };

// Records the usage of the run, then moves the task for an outcome that is not success.
export function applyRunOutcome(request: RunOutcomeRequest): RunOutcomeResult {
  const { store, task, phase, io, outcome } = request;
  store.appendEvent(task.id, "usage", { usage: outcome.usage });
  switch (outcome.kind) {
    case "success":
      return { outcome };
    case "failure":
      return failRun(store, task, io, `${phase} failed: ${outcome.reason}`);
    case "timeout":
      return failRun(store, task, io, `${phase} timed out after ${request.timeoutMinutes} min`);
    case "quota": {
      const { cause, resetsAt } = outcome;
      transitionTask(store, task.id, "quota_blocked", resetsAt === undefined ? { cause } : { cause, resetsAt });
      const reset =
        resetsAt === undefined ? "the reset time is unknown" : `it resets at ${new Date(resetsAt * 1000).toISOString()}`;
      io.stdout(`${phase} stopped by a quota limit; ${reset}\n`);
      return { exitCode: 1 };
    }
  }
}

// The message is the error of the event and the line on stderr.
function failRun(store: TaskStore, task: Task, io: Io, message: string): RunOutcomeResult {
  failTask(store, task.id, message);
  io.stderr(`${message}\n`);
  return { exitCode: 1 };
}
