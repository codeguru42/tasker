import { describe, expect, it } from "vitest";
import { githubShortRef } from "../../src/issue-key/short-ref.js";
import type { TaskState } from "../../src/state/machine.js";
import type { Task } from "../../src/store/store.js";
import { resumeTask } from "../../src/tasks/resume.js";
import { seedApprovedTaskWithSessions, sessionsOf } from "../helpers/plan.js";
import { wrongStateError } from "../helpers/state-commands.js";
import { expectRefusedWithoutChange } from "../helpers/task-fixtures.js";
import {
  eventDataOf,
  eventsOf,
  latestTaskOf,
  pauseRefineFrom,
  pauseTaskFrom,
  pauseTaskVia,
  withDataRootStore,
} from "../helpers/store.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";
const FEEDBACK = "Keep the loop.";
const NEEDS = "quota_blocked or interrupted";

type Pause = "quota_blocked" | "interrupted";
const BOTH: readonly Pause[] = ["quota_blocked", "interrupted"];

// Calls resumeTask for the task in the data root, in a store that closes after the call.
function resume(dataRoot: string, task: Task) {
  const ref = { key: KEY, repoKey: REPO, shortRef: githubShortRef("5") };
  return withDataRootStore(dataRoot, (store) => resumeTask(store, { ref, taskId: task.id }));
}

const kept = { plan: true, execute: true, review: [1] };

describe("resumeTask origins", () => {
  const rows: {
    origin: TaskState;
    refineOrigin?: TaskState;
    before?: TaskState;
    target: TaskState;
    next: string;
    pauses: readonly Pause[];
    sessions: { plan: boolean; execute: boolean; review: number[] };
  }[] = [
    { origin: "planning", target: "workspace_ready", next: "plan", pauses: BOTH, sessions: kept },
    { origin: "executing", target: "approved", next: "execute", pauses: BOTH, sessions: kept },
    { origin: "verifying", target: "executed", next: "verify", pauses: ["interrupted"], sessions: kept },
    {
      origin: "reviewing",
      target: "awaiting_work_review",
      next: "review",
      pauses: BOTH,
      sessions: { ...kept, review: [] },
    },
    { origin: "finishing", target: "landed", next: "finish", pauses: BOTH, sessions: kept },
    { origin: "merging", before: "accepted", target: "accepted", next: "merge", pauses: BOTH, sessions: kept },
    {
      origin: "refining",
      refineOrigin: "awaiting_plan_review",
      target: "awaiting_plan_review",
      next: "refine",
      pauses: BOTH,
      sessions: kept,
    },
    {
      origin: "refining",
      refineOrigin: "failed",
      target: "awaiting_plan_review",
      next: "refine",
      pauses: BOTH,
      sessions: kept,
    },
    {
      origin: "refining",
      refineOrigin: "reviewed",
      target: "reviewed",
      next: "refine",
      pauses: BOTH,
      sessions: kept,
    },
    {
      origin: "refining",
      refineOrigin: "awaiting_work_review",
      target: "awaiting_work_review",
      next: "review-feedback",
      pauses: BOTH,
      sessions: kept,
    },
  ];

  function rowLabel(row: { origin: TaskState; refineOrigin?: TaskState; before?: TaskState }): string {
    if (row.refineOrigin !== undefined) return `${row.origin} after a refine from ${row.refineOrigin}`;
    if (row.before !== undefined) return `${row.origin} after a move from ${row.before}`;
    return row.origin;
  }

  const cases = rows.flatMap((row) =>
    row.pauses.map((pause) => ({
      ...row,
      pause,
      label: `${rowLabel(row)} in ${pause}`,
    })),
  );

  it.each(cases)("moves a task paused from $label", async (row) => {
    const { origin, refineOrigin, before, target, next, pause, sessions } = row;
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => {
      if (refineOrigin !== undefined) return pauseRefineFrom(store, task.id, refineOrigin, pause, FEEDBACK);
      if (before !== undefined) return pauseTaskVia(store, task.id, before, origin, pause);
      return pauseTaskFrom(store, task.id, origin, pause);
    });

    const result = await resume(dataRoot, task);

    expect(result).toEqual({ origin, target, next, ...(refineOrigin === undefined ? {} : { feedback: FEEDBACK }) });
    expect(latestTaskOf(dataRoot, KEY).state).toBe(target);
    expect(eventDataOf(dataRoot, KEY, "resume")).toEqual([{ origin, target }]);
    const transition = eventsOf(dataRoot, KEY)
      .filter((event) => event.type === "transition")
      .at(-1);
    expect(transition?.data).toEqual({ from: pause, to: target });
    expect(sessionsOf(dataRoot, task)).toEqual(sessions);
  });

  it.each(BOTH)(
    "moves a task paused in %s from finishing after a move from cleanup_failed to landed",
    async (pause) => {
      const { dataRoot, task } = seedApprovedTaskWithSessions();
      withDataRootStore(dataRoot, (store) => pauseTaskVia(store, task.id, "cleanup_failed", "finishing", pause));

      const result = await resume(dataRoot, task);

      expect(result).toEqual({ origin: "finishing", target: "landed", next: "finish" });
      expect(latestTaskOf(dataRoot, KEY).state).toBe("landed");
      expect(eventDataOf(dataRoot, KEY, "resume")).toEqual([{ origin: "finishing", target: "landed" }]);
    },
  );

  it("gives the feedback of a refine from reviewed when one is recorded", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => pauseRefineFrom(store, task.id, "reviewed", "interrupted", FEEDBACK));

    expect(await resume(dataRoot, task)).toEqual({
      origin: "refining",
      target: "reviewed",
      next: "refine",
      feedback: FEEDBACK,
    });
  });

  it("gives no feedback for a refine from reviewed when none is recorded", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => pauseRefineFrom(store, task.id, "reviewed", "interrupted"));

    const result = await resume(dataRoot, task);

    expect(result).toEqual({ origin: "refining", target: "reviewed", next: "refine" });
    expect(result).not.toHaveProperty("feedback");
  });
});

describe("resumeTask checks", () => {
  // Expects that resume refuses with message, and that the state, the events and the sessions stay the same.
  async function expectResumeRefused(dataRoot: string, task: Task, message: string) {
    const sessions = sessionsOf(dataRoot, task);
    await expectRefusedWithoutChange({ dataRoot, key: KEY }, () => resume(dataRoot, task), message);
    expect(sessionsOf(dataRoot, task)).toEqual(sessions);
  }

  const noStep = (state: string) => `the task of ${KEY} was paused from ${state}; tasker resume has no step for it`;

  it("refuses a task in executed", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => store.updateTask(task.id, { state: "executed" }));

    await expectResumeRefused(dataRoot, task, wrongStateError("executed", KEY, "resume", NEEDS));
  });

  it("refuses a task in awaiting_quota_approval", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => store.updateTask(task.id, { state: "awaiting_quota_approval" }));

    await expectResumeRefused(dataRoot, task, wrongStateError("awaiting_quota_approval", KEY, "resume", NEEDS));
  });

  it("refuses a task paused from pushing", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => pauseTaskFrom(store, task.id, "pushing", "interrupted"));

    await expectResumeRefused(dataRoot, task, noStep("pushing"));
  });

  it("refuses merging after a move from in_peer_review", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => pauseTaskVia(store, task.id, "in_peer_review", "merging", "interrupted"));

    await expectResumeRefused(dataRoot, task, noStep("merging"));
  });

  it("refuses a refine from accepted", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => pauseRefineFrom(store, task.id, "accepted", "interrupted"));

    await expectResumeRefused(dataRoot, task, noStep("refining"));
  });

  it("refuses verifying from quota_blocked", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => pauseTaskFrom(store, task.id, "verifying", "quota_blocked"));

    await expectResumeRefused(dataRoot, task, noStep("verifying"));
  });
});
