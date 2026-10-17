import type { QuotaApprovalWarning, RunOutcome } from "../assistant/provider.js";
import type { Io } from "../cli.js";
import type { RepoConfig } from "../config/schema.js";
import { type TaskState, transitionTask } from "../state/machine.js";
import type { Task, TaskStore } from "../store/store.js";
import type { PreparedPlanModeRun } from "./assistant-run.js";

export type SuccessOutcome = Extract<RunOutcome, { kind: "success" }>;

// What the result step needs to look for a quota warning: the policy of the repo and the prepared run, which gives the
// provider and the approved quota window.
export interface QuotaApprovalCheck {
  repo: Pick<RepoConfig, "overagePolicy" | "quotaApprovalThreshold">;
  prepared: Pick<PreparedPlanModeRun, "provider" | "approvedResetsAt">;
}

export interface RunOutcomeRequest {
  store: TaskStore;
  task: Task;
  // The spawning state of the run, for example planning. The messages name it.
  phase: TaskState;
  // The deadline of the run.
  timeoutMinutes: number;
  io: Io;
  outcome: RunOutcome;
  quota: QuotaApprovalCheck;
  // With true, an interrupted run prints no resume line. The caller prints it with interruptedLine.
  omitInterruptedLine?: boolean;
}

// The line that tells the operator how to continue after a signal stopped the run.
export function interruptedLine(phase: TaskState, signal: NodeJS.Signals, issueKey: string): string {
  return `${phase} interrupted by ${signal}; run tasker resume ${issueKey} to continue\n`;
}

// success: the caller makes its checks and its move. A success has a warning when the run reached the quota approval
// threshold in a window that the operator did not approve. Any other outcome: the task moved, and the command stops
// with exitCode.
export type RunOutcomeResult = { outcome: SuccessOutcome; warning?: QuotaApprovalWarning } | { exitCode: number };

// Records the usage of the run, then moves the task for an outcome that is not success.
export function applyRunOutcome(request: RunOutcomeRequest): RunOutcomeResult {
  const { store, task, phase, io, outcome } = request;
  store.appendEvent(task.id, "usage", { usage: outcome.usage });
  switch (outcome.kind) {
    case "success": {
      const warning = quotaWarningOf(request.quota, outcome);
      return warning === undefined ? { outcome } : { outcome, warning };
    }
    case "failure":
      return failRun(store, task, io, `${phase} failed: ${outcome.reason}`);
    case "timeout":
      return failRun(store, task, io, `${phase} timed out after ${request.timeoutMinutes} min`);
    case "quota": {
      const { cause, resetsAt } = outcome;
      transitionTask(store, task.id, "quota_blocked", resetsAt === undefined ? { cause } : { cause, resetsAt });
      io.stdout(`${phase} stopped by a quota limit; ${resetText(resetsAt)}\n`);
      return { exitCode: 1 };
    }
    case "interrupted": {
      transitionTask(store, task.id, "interrupted", { cause: "signal", signal: outcome.signal });
      if (request.omitInterruptedLine !== true) io.stdout(interruptedLine(phase, outcome.signal, task.issueKey));
      return { exitCode: 1 };
    }
  }
}

// The ISO text of a reset time in Unix seconds.
export function resetIsoTime(resetsAt: number): string {
  return new Date(resetsAt * 1000).toISOString();
}

// The part of a quota message that names the reset time of the window.
function resetText(resetsAt: number | undefined): string {
  return resetsAt === undefined ? "the reset time is unknown" : `it resets at ${resetIsoTime(resetsAt)}`;
}

// Moves the task to awaiting_quota_approval with the warning, prints the pause line on stdout and gives exit code 1.
export function pauseForQuotaApproval(
  store: TaskStore,
  task: Task,
  io: Io,
  phase: TaskState,
  warning: QuotaApprovalWarning,
): { exitCode: number } {
  const { utilization, resetsAt } = warning;
  transitionTask(
    store,
    task.id,
    "awaiting_quota_approval",
    resetsAt === undefined ? { utilization } : { utilization, resetsAt },
  );
  const percent = Math.round(utilization * 100);
  io.stdout(`${phase} paused by a quota warning: the use of the quota window is ${percent}%; ${resetText(resetsAt)}\n`);
  return { exitCode: 1 };
}

// The warning that pauses the task, or undefined. Only the policy ask looks for one. The provider reads the events.
function quotaWarningOf(
  { repo, prepared }: QuotaApprovalCheck,
  outcome: SuccessOutcome,
): QuotaApprovalWarning | undefined {
  if (repo.overagePolicy !== "ask") return undefined;
  const warning = prepared.provider.detectQuotaApprovalWarning(outcome, repo.quotaApprovalThreshold);
  if (warning === undefined) return undefined;
  return prepared.provider.shouldSuppressQuotaApprovalPause(warning, prepared.approvedResetsAt) ? undefined : warning;
}

// Moves the task to `to` with the message as the error of the event, prints the message on stderr and gives exit
// code 1. The caller picks the target state.
export function failRunTo(store: TaskStore, task: Task, io: Io, to: TaskState, message: string): { exitCode: number } {
  transitionTask(store, task.id, to, { error: message });
  io.stderr(`${message}\n`);
  return { exitCode: 1 };
}

// Moves the task to failed with failRunTo. Each command that fails the task after its run uses it.
export function failRun(store: TaskStore, task: Task, io: Io, message: string): { exitCode: number } {
  return failRunTo(store, task, io, "failed", message);
}
