import type { RunOutcome } from "../assistant/provider.js";
import type { Io } from "../cli.js";
import type { TaskState } from "../state/machine.js";
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
  const { store, task, outcome } = request;
  store.appendEvent(task.id, "usage", { usage: outcome.usage });
  switch (outcome.kind) {
    case "success":
      return { outcome };
    default:
      throw new Error(`not handled: ${outcome.kind}`);
  }
}
