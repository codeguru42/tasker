import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeCodeProvider } from "../../src/assistant/claude-code/provider.js";
import type { AssistantEvent, RunOutcome, Usage } from "../../src/assistant/provider.js";
import { transitionTask } from "../../src/state/machine.js";
import { createDataRoot } from "../../src/store/layout.js";
import type { Task, TaskStore } from "../../src/store/store.js";
import { applyRunOutcome, failRunTo } from "../../src/tasks/run-outcome.js";
import { captureIo } from "../helpers/cli.js";
import { TEST_SESSION_ID, claudeApprovalWarningEvent, claudeRateLimitEvent } from "../helpers/fake-claude.js";
import { seedPlanSession } from "../helpers/plan.js";
import { dayAt, eventsOf, readRunMarker, seedTasks, withDataRootStore } from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";

const KEY = "codeguru42/tasker#101";

const USAGE = { inputTokens: 10, outputTokens: 20, cacheCreationInputTokens: 3, cacheReadInputTokens: 4 };

// The fields that all outcomes share.
function base(usage: Usage = USAGE) {
  return { sessionId: TEST_SESSION_ID, events: [], permissionDenials: [], usage };
}

// A task of KEY that moved from workspace_ready to planning, so it has the run marker of this process.
function planningTask(): { dataRoot: string; task: Task } {
  const dataRoot = join(useTempDir("tasker-outcome-"), "data");
  const [seeded] = seedTasks(dataRoot, [
    { issueKey: KEY, repoKey: "codeguru42/tasker", state: "workspace_ready", at: dayAt(1) },
  ]);
  const task = withDataRootStore(dataRoot, (store) => transitionTask(store, seeded.id, "planning"));
  return { dataRoot, task };
}

// The quota check of a run: the policy of the repo, the threshold 0.9 and a prepared-like object with the
// claude-code provider and the approved window, if any.
function quotaOf(overagePolicy: "decline" | "ask", approvedResetsAt?: number) {
  return {
    repo: { overagePolicy, quotaApprovalThreshold: 0.9 },
    prepared: { provider: createClaudeCodeProvider(), approvedResetsAt },
  };
}

// The one call helper: applies outcome to a new planning task with a 30-minute deadline.
// events holds only the events after the setup (created and the move to planning).
// quota is the quota check of the run. Its default is the decline policy with no approved window.
function applyTo(
  outcome: RunOutcome,
  before?: (store: TaskStore, task: Task) => void,
  quota: ReturnType<typeof quotaOf> = quotaOf("decline"),
) {
  const { dataRoot, task } = planningTask();
  const io = captureIo();
  const result = withDataRootStore(dataRoot, (store) => {
    before?.(store, task);
    return applyRunOutcome({ store, task, phase: "planning", timeoutMinutes: 30, io, outcome, quota });
  });
  const state = withDataRootStore(dataRoot, (store) => store.getTask(task.id)!.state);
  const marker = readRunMarker(createDataRoot(dataRoot).database, task.id);
  return { dataRoot, task, io, result, state, marker, events: eventsOf(dataRoot, KEY).slice(2) };
}

describe("applyRunOutcome with a success", () => {
  it("records the usage and leaves the task in planning", () => {
    const outcome: RunOutcome = { kind: "success", ...base(), structuredOutput: { a: 1 } };

    const { result, state, marker, events, io } = applyTo(outcome);

    expect(result).toEqual({ outcome });
    expect((result as { outcome: RunOutcome }).outcome).toBe(outcome);
    expect(state).toBe("planning");
    expect(marker).toBeDefined();
    expect(events).toEqual([{ type: "usage", data: { usage: USAGE } }]);
    expect(io.out).toEqual([]);
    expect(io.err).toEqual([]);
  });

  it("records the usage when it is unavailable", () => {
    const { events } = applyTo({ kind: "success", ...base("unavailable") });

    expect(events).toEqual([{ type: "usage", data: { usage: "unavailable" } }]);
  });
});

describe("applyRunOutcome with a quota warning", () => {
  const withEvent = (event: AssistantEvent): RunOutcome => ({ kind: "success", ...base(), events: [event] });
  const noReset = (info: Record<string, unknown>) => {
    delete info.resetsAt;
    delete (info.unifiedWindows as { seven_day: Record<string, unknown> }).seven_day.resetsAt;
  };

  it("gives the warning of a use above the threshold under ask and leaves the task in planning", () => {
    const outcome = withEvent(claudeApprovalWarningEvent());

    const { result, state, marker, events, io } = applyTo(outcome, undefined, quotaOf("ask"));

    expect(result).toEqual({ outcome, warning: { utilization: 0.95, resetsAt: 1792206000 } });
    expect(state).toBe("planning");
    expect(marker).toBeDefined();
    expect(events).toEqual([{ type: "usage", data: { usage: USAGE } }]);
    expect(io.out).toEqual([]);
    expect(io.err).toEqual([]);
  });

  it("gives no warning for a use below the threshold under ask", () => {
    const outcome = withEvent(claudeRateLimitEvent());

    const { result } = applyTo(outcome, undefined, quotaOf("ask"));

    expect(result).toEqual({ outcome });
  });

  it("gives no warning when the approved window is the window of the warning", () => {
    const outcome = withEvent(claudeApprovalWarningEvent());

    const { result } = applyTo(outcome, undefined, quotaOf("ask", 1792206000));

    expect(result).toEqual({ outcome });
  });

  it("keeps a warning with no resetsAt when a window is approved", () => {
    const outcome = withEvent(claudeApprovalWarningEvent(noReset));

    const { result } = applyTo(outcome, undefined, quotaOf("ask", 1792206000));

    expect(result).toEqual({ outcome, warning: { utilization: 0.95 } });
  });

  it("gives no warning under decline", () => {
    const outcome = withEvent(claudeApprovalWarningEvent());

    const { result } = applyTo(outcome, undefined, quotaOf("decline"));

    expect(result).toEqual({ outcome });
  });
});

describe("applyRunOutcome with a failure or a timeout", () => {
  const failure: RunOutcome = {
    kind: "failure",
    ...base(),
    exitCode: 2,
    signal: null,
    reason: "claude exited with code 2",
  };
  const timeout: RunOutcome = { kind: "timeout", ...base() };

  it.each([
    ["a failure", failure, "planning failed: claude exited with code 2"],
    ["a timeout", timeout, "planning timed out after 30 min"],
  ])("fails the task for %s", (_name, outcome, error) => {
    const { result, state, marker, events, io } = applyTo(outcome);

    expect(result).toEqual({ exitCode: 1 });
    expect(state).toBe("failed");
    expect(marker).toBeUndefined();
    expect(events).toEqual([
      { type: "usage", data: { usage: USAGE } },
      { type: "transition", data: { from: "planning", to: "failed", error } },
    ]);
    expect(io.err).toEqual([`${error}\n`]);
    expect(io.out).toEqual([]);
  });

  it("records the usage of a failure when it is unavailable", () => {
    const { events } = applyTo({ ...failure, usage: "unavailable" });

    expect(events).toEqual([
      { type: "usage", data: { usage: "unavailable" } },
      {
        type: "transition",
        data: { from: "planning", to: "failed", error: "planning failed: claude exited with code 2" },
      },
    ]);
  });
});

describe("applyRunOutcome with a quota stop", () => {
  const resetsAt = Date.parse(dayAt(2)) / 1000;

  it("blocks the task and names the reset time", () => {
    const { result, state, marker, events, io } = applyTo({
      kind: "quota",
      ...base(),
      cause: "rate_limit",
      resetsAt,
    });

    expect(result).toEqual({ exitCode: 1 });
    expect(state).toBe("quota_blocked");
    expect(marker).toBeUndefined();
    expect(events).toEqual([
      { type: "usage", data: { usage: USAGE } },
      { type: "transition", data: { from: "planning", to: "quota_blocked", cause: "rate_limit", resetsAt } },
    ]);
    expect(io.out).toEqual([`planning stopped by a quota limit; it resets at ${dayAt(2)}\n`]);
    expect(io.err).toEqual([]);
  });

  it("blocks the task when the reset time is unknown", () => {
    const { result, state, events, io } = applyTo({ kind: "quota", ...base(), cause: "overage" });

    expect(result).toEqual({ exitCode: 1 });
    expect(state).toBe("quota_blocked");
    expect(events).toEqual([
      { type: "usage", data: { usage: USAGE } },
      { type: "transition", data: { from: "planning", to: "quota_blocked", cause: "overage" } },
    ]);
    expect(io.out).toEqual(["planning stopped by a quota limit; the reset time is unknown\n"]);
    expect(io.err).toEqual([]);
  });

  it("keeps the plan session of the task", () => {
    const { dataRoot, task } = applyTo({ kind: "quota", ...base(), cause: "rate_limit", resetsAt }, (store, seeded) => {
      seedPlanSession(store, seeded.id);
    });

    const session = withDataRootStore(dataRoot, (store) => store.planSession(task.id));
    expect(session?.sessionId).toBe(TEST_SESSION_ID);
  });
});

describe("failRunTo", () => {
  it("moves the task to the target state with the error, prints the message and gives exit code 1", () => {
    const dataRoot = join(useTempDir("tasker-outcome-"), "data");
    const [seeded] = seedTasks(dataRoot, [
      { issueKey: KEY, repoKey: "codeguru42/tasker", state: "landed", at: dayAt(1) },
    ]);
    const task = withDataRootStore(dataRoot, (store) => transitionTask(store, seeded.id, "finishing"));
    const io = captureIo();

    const result = withDataRootStore(dataRoot, (store) =>
      failRunTo(store, task, io, "cleanup_failed", "finishing failed: boom"),
    );

    const state = withDataRootStore(dataRoot, (store) => store.getTask(task.id)!.state);
    expect(result).toEqual({ exitCode: 1 });
    expect(state).toBe("cleanup_failed");
    expect(eventsOf(dataRoot, KEY).at(-1)).toEqual({
      type: "transition",
      data: { from: "finishing", to: "cleanup_failed", error: "finishing failed: boom" },
    });
    expect(io.err).toEqual(["finishing failed: boom\n"]);
    expect(io.out).toEqual([]);
    expect(readRunMarker(createDataRoot(dataRoot).database, task.id)).toBeUndefined();
  });
});
