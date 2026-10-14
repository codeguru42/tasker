import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunOutcome, Usage } from "../../src/assistant/provider.js";
import { transitionTask } from "../../src/state/machine.js";
import { createDataRoot } from "../../src/store/layout.js";
import type { Task, TaskStore } from "../../src/store/store.js";
import { applyRunOutcome } from "../../src/tasks/run-outcome.js";
import {
  captureIo,
  dayAt,
  eventsOf,
  readRunMarker,
  seedTasks,
  TEST_SESSION_ID,
  useTempDir,
  withDataRootStore,
} from "../helpers.js";

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

// The one call helper: applies outcome to a new planning task with a 30-minute deadline.
// events holds only the events after the setup (created and the move to planning).
function applyTo(outcome: RunOutcome, before?: (store: TaskStore, task: Task) => void) {
  const { dataRoot, task } = planningTask();
  const io = captureIo();
  const result = withDataRootStore(dataRoot, (store) => {
    before?.(store, task);
    return applyRunOutcome({ store, task, phase: "planning", timeoutMinutes: 30, io, outcome });
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
