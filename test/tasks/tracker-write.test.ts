import { describe, expect, it } from "vitest";
import type { RepoConfig } from "../../src/config/schema.js";
import { runTrackerWrite, trackerTargets } from "../../src/tasks/tracker-write.js";
import { withDataRootStore, eventsOf } from "../helpers/store.js";
import { captureIo } from "../helpers/cli.js";
import { useAcceptedTask } from "../helpers/task-fixtures.js";

const ALL_KEYS = {
  inProgressLabel: "in progress",
  doneLabel: "done",
  inProgressStatus: "In Progress",
  doneStatus: "Done",
  reviewLabel: "peer-review",
  reviewStatus: "In Review",
};

// Calls trackerTargets for a tracker of the provider with the keys.
function targetsOf(provider: RepoConfig["issueTracker"]["provider"], keys: Partial<typeof ALL_KEYS> = {}) {
  return trackerTargets({ provider, updateOnStart: false, assignee: "@me", updateOnFinish: false, ...keys });
}

describe("trackerTargets", () => {
  it("gives the labels for github and ignores the status keys", () => {
    expect(targetsOf("github", ALL_KEYS)).toEqual({ inProgress: "in progress", done: "done", review: "peer-review" });
  });

  it("gives the statuses for jira and ignores the label keys", () => {
    expect(targetsOf("jira", ALL_KEYS)).toEqual({ inProgress: "In Progress", done: "Done", review: "In Review" });
  });

  it("gives undefined for keys that are not set", () => {
    expect(targetsOf("github")).toEqual({ inProgress: undefined, done: undefined });
    expect(targetsOf("jira", { inProgressLabel: "x", doneLabel: "y" })).toEqual({
      inProgress: undefined,
      done: undefined,
    });
  });

  it("gives undefined when no review target is set", () => {
    expect((targetsOf("github") as Record<string, unknown>).review).toBeUndefined();
    expect((targetsOf("jira") as Record<string, unknown>).review).toBeUndefined();
  });
});

describe("runTrackerWrite", () => {
  it("returns true for a passed write and false for a failed write", async () => {
    const fixture = await useAcceptedTask();
    const io = captureIo();
    const before = eventsOf(fixture.dataRoot, fixture.key).length;
    const success = await withDataRootStore(fixture.dataRoot, (store) => {
      const result = runTrackerWrite(
        store,
        fixture.task.id,
        {
          action: "done",
          text: `mark ${fixture.key} for review`,
          success: `marked ${fixture.key} for review`,
          run: async () => {},
        },
        io,
      );
      return result;
    });
    const failed = await withDataRootStore(fixture.dataRoot, (store) => {
      const result = runTrackerWrite(
        store,
        fixture.task.id,
        {
          action: "done",
          text: `mark ${fixture.key} for review`,
          success: `marked ${fixture.key} for review`,
          run: async () => {
            throw new Error("denied");
          },
        },
        io,
      );
      return result;
    });
    expect(success).toBe(true);
    expect(failed).toBe(false);
    expect(eventsOf(fixture.dataRoot, fixture.key).slice(before)).toMatchObject([
      { type: "tracker_update", data: { action: "done", result: "ok" } },
      { type: "tracker_update", data: { action: "done", result: "failed", error: "denied" } },
    ]);
    expect(io.out.join("")).toBe(`marked ${fixture.key} for review\n`);
    expect(io.err.join("")).toContain(`warning: cannot mark ${fixture.key} for review on the tracker: denied\n`);
  });

  it("marks a passed board move without setting trackerMarked", async () => {
    const fixture = await useAcceptedTask();
    const io = captureIo();
    const passed = await withDataRootStore(fixture.dataRoot, (store) =>
      runTrackerWrite(
        store,
        fixture.task.id,
        {
          action: "board_in_progress",
          text: `move the card of ${fixture.key} to "In progress"`,
          success: `moved the card of ${fixture.key} to "In progress" on the tracker`,
          run: async () => {},
        },
        io,
      ),
    );
    const task = withDataRootStore(fixture.dataRoot, (store) => store.getTask(fixture.task.id));
    expect(passed).toBe(true);
    expect(task?.cardMarked).toBe(true);
    expect(task?.trackerMarked).toBe(false);
    expect(eventsOf(fixture.dataRoot, fixture.key).at(-1)).toMatchObject({
      type: "tracker_update",
      data: { action: "board_in_progress", result: "ok" },
    });
    expect(io.out.join("")).toBe(`moved the card of ${fixture.key} to "In progress" on the tracker\n`);
  });

  it("records a failed board move without marking the card", async () => {
    const fixture = await useAcceptedTask();
    const io = captureIo();
    const passed = await withDataRootStore(fixture.dataRoot, (store) =>
      runTrackerWrite(
        store,
        fixture.task.id,
        {
          action: "board_in_progress",
          text: `move the card of ${fixture.key} to "In progress"`,
          success: `moved the card of ${fixture.key} to "In progress" on the tracker`,
          run: async () => {
            throw new Error("denied");
          },
        },
        io,
      ),
    );
    const task = withDataRootStore(fixture.dataRoot, (store) => store.getTask(fixture.task.id));
    expect(passed).toBe(false);
    expect(task?.cardMarked).toBe(false);
    expect(task?.trackerMarked).toBe(false);
    expect(eventsOf(fixture.dataRoot, fixture.key).at(-1)).toMatchObject({
      type: "tracker_update",
      data: { action: "board_in_progress", result: "failed", error: "denied" },
    });
    expect(io.err.join("")).toContain(
      `warning: cannot move the card of ${fixture.key} to "In progress" on the tracker: denied\n`,
    );
  });

  it("does not change trackerMarked for a passed board_done move", async () => {
    const fixture = await useAcceptedTask();
    withDataRootStore(fixture.dataRoot, (store) => {
      store.recordTrackerMark(fixture.task.id);
    });
    const io = captureIo();
    await withDataRootStore(fixture.dataRoot, (store) =>
      runTrackerWrite(
        store,
        fixture.task.id,
        {
          action: "board_done",
          text: `move the card of ${fixture.key} to "Done"`,
          success: `moved the card of ${fixture.key} to "Done" on the tracker`,
          run: async () => {},
        },
        io,
      ),
    );
    const task = withDataRootStore(fixture.dataRoot, (store) => store.getTask(fixture.task.id));
    expect(task?.trackerMarked).toBe(true);
    expect(eventsOf(fixture.dataRoot, fixture.key).at(-1)).toMatchObject({
      type: "tracker_update",
      data: { action: "board_done", result: "ok" },
    });
  });
});
