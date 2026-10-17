import { describe, expect, it } from "vitest";
import { SPAWNING_STATES } from "../../src/state/machine.js";
import type { Task } from "../../src/store/store.js";
import { handleDeadRun } from "../../src/tasks/dead-run.js";
import { deadPid, isAlive, startSleeper, startWriteLockHolder, waitUntilGone } from "../helpers/processes.js";
import {
  databasePathOf,
  eventDataOf,
  eventsOf,
  readRunMarker,
  seedDeadRun,
  seedOneTask,
  latestTaskOf,
  withDataRootStore,
} from "../helpers/store.js";
import { deadRunNote } from "../helpers/state-commands.js";

const KEY = "codeguru42/tasker#6";
const REPO = "codeguru42/tasker";

// Seeds the task KEY in approved, then moves it to a dead run in state with childPid.
function seedDead(state: string, childPid: number | null = null): { dataRoot: string; task: Task } {
  const { dataRoot, task } = seedOneTask("approved", KEY, REPO);
  return { dataRoot, task: seedDeadRun(dataRoot, task.id, state, childPid) };
}

// Runs handleDeadRun on the stored task of dataRoot, in a store that it opens and closes.
function handle(dataRoot: string, task: Task) {
  return withDataRootStore(dataRoot, (store) => handleDeadRun(store, task));
}

describe("handleDeadRun", () => {
  it("changes nothing and gives no notes for a task with no run", async () => {
    const { dataRoot, task } = seedOneTask("approved", KEY, REPO);
    const events = eventsOf(dataRoot, KEY).length;

    const result = await handle(dataRoot, task);

    expect(result.notes).toEqual([]);
    expect(result.task.state).toBe("approved");
    expect(eventsOf(dataRoot, KEY)).toHaveLength(events);
  });

  it("changes nothing and gives no notes for a live run", async () => {
    const { dataRoot, task } = seedOneTask("executing", KEY, REPO);
    const events = eventsOf(dataRoot, KEY).length;

    const result = await handle(dataRoot, task);

    expect(result.notes).toEqual([]);
    expect(result.task.state).toBe("executing");
    expect(eventsOf(dataRoot, KEY)).toHaveLength(events);
    expect(readRunMarker(databasePathOf(dataRoot), task.id)).toMatchObject({ pid: process.pid });
  });

  it("gives the task as the store holds it when another command moved it", async () => {
    const { dataRoot, task } = seedOneTask("approved", KEY, REPO);

    const result = await handle(dataRoot, { ...task, state: "executing" });

    expect(result.task.state).toBe("approved");
  });

  it("moves a dead run with no child to interrupted and gives one note", async () => {
    const { dataRoot, task } = seedDead("executing");

    const result = await handle(dataRoot, task);

    expect(result.task.state).toBe("interrupted");
    expect(latestTaskOf(dataRoot, KEY).state).toBe("interrupted");
    expect(result.notes).toEqual([deadRunNote(KEY, "executing")]);
    expect(eventDataOf(dataRoot, KEY, "transition").at(-1)).toEqual({
      cause: "dead_run",
      childPid: null,
      from: "executing",
      to: "interrupted",
    });
    expect(readRunMarker(databasePathOf(dataRoot), task.id)).toBeUndefined();
  });

  it("moves a task in a spawning state that has no marker", async () => {
    const { dataRoot, task } = seedOneTask("approved", KEY, REPO);
    withDataRootStore(dataRoot, (store) => store.updateTask(task.id, { state: "planning" }));

    const result = await handle(dataRoot, latestTaskOf(dataRoot, KEY));

    expect(result.task.state).toBe("interrupted");
    expect(result.notes).toEqual([deadRunNote(KEY, "planning")]);
  });

  it("stops the live child group of a dead run and gives a second note", async () => {
    const child = startSleeper();
    const { dataRoot, task } = seedDead("executing", child);

    const result = await handle(dataRoot, task);

    await waitUntilGone(child, 5000);
    expect(isAlive(child)).toBe(false);
    expect(result.task.state).toBe("interrupted");
    expect(result.notes).toEqual([
      deadRunNote(KEY, "executing"),
      `note: stopped the process group ${child} of the dead run`,
    ]);
  });

  it("gives one note and records the child pid when the child is gone", async () => {
    const child = deadPid();
    const { dataRoot, task } = seedDead("executing", child);

    const result = await handle(dataRoot, task);

    expect(result.task.state).toBe("interrupted");
    expect(result.notes).toEqual([deadRunNote(KEY, "executing")]);
    expect(eventDataOf(dataRoot, KEY, "transition").at(-1)).toMatchObject({ childPid: child });
  });

  it("moves the task once when two steps follow each other through two stores", async () => {
    const { dataRoot, task } = seedDead("executing");

    const first = await handle(dataRoot, task);
    const second = await handle(dataRoot, task);

    expect(first.notes).toEqual([deadRunNote(KEY, "executing")]);
    expect(second.notes).toEqual([]);
    expect(second.task.state).toBe("interrupted");
    expect(
      eventDataOf(dataRoot, KEY, "transition").filter((data) => (data as { to?: string }).to === "interrupted"),
    ).toHaveLength(1);
  });

  it("moves the task once when two stores run the step at the same time", async () => {
    const { dataRoot, task } = seedDead("executing");

    const results = await Promise.all([handle(dataRoot, task), handle(dataRoot, task)]);

    expect(results.flatMap((result) => result.notes)).toEqual([deadRunNote(KEY, "executing")]);
    expect(
      eventDataOf(dataRoot, KEY, "transition").filter((data) => (data as { to?: string }).to === "interrupted"),
    ).toHaveLength(1);
  });

  it("keeps the move and says so when the stop of the child group fails", async () => {
    const { dataRoot, task } = seedDead("executing", 1);

    const result = await handle(dataRoot, task);

    expect(result.task.state).toBe("interrupted");
    expect(result.notes).toEqual([
      deadRunNote(KEY, "executing"),
      "note: cannot stop the process group 1 of the dead run: cannot stop the process group of pid 1: the pid must be a whole number of 2 or more",
    ]);
  });

  it.each([...SPAWNING_STATES])("moves a dead run in %s to interrupted", async (state) => {
    const { dataRoot, task } = seedDead(state);

    const result = await handle(dataRoot, task);

    expect(result.task.state).toBe("interrupted");
    expect(result.notes).toEqual([deadRunNote(KEY, state)]);
    expect(eventDataOf(dataRoot, KEY, "transition").at(-1)).toMatchObject({ from: state, to: "interrupted" });
  });

  it("opens no write transaction for a task that is not in a spawning state", async () => {
    const { dataRoot, task } = seedOneTask("approved", KEY, REPO);

    await withDataRootStore(dataRoot, async (store) => {
      await startWriteLockHolder(databasePathOf(dataRoot), 1000);
      const start = Date.now();

      const result = await handleDeadRun(store, task);

      expect(Date.now() - start).toBeLessThan(500);
      expect(result.notes).toEqual([]);
      expect(result.task).toEqual(task);
    });
  }, 20_000);
});
