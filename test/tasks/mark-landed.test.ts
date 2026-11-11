import { describe, expect, it, vi } from "vitest";
import { repoLockName, taskLockName } from "../../src/store/locks.js";
import { markLandedTask } from "../../src/tasks/mark-landed.js";
import type { TaskStore } from "../../src/store/store.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  eventsOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  withDataRootStore,
} from "../helpers/store.js";
import { failureOf } from "../helpers/errors.js";
import {
  expectRefusedWithoutChange,
  landAcceptedTask,
  taskRefOf,
  useAcceptedTask,
  type AcceptedTask,
} from "../helpers/task-fixtures.js";

// Calls markLandedTask for the task of the fixture with a store.
const callMarkLanded = (fixture: AcceptedTask, store: TaskStore, taskId = fixture.task.id) =>
  markLandedTask(store, {
    ref: taskRefOf(fixture),
    taskId,
  });

describe("markLandedTask", () => {
  it("reads an accepted task once", async () => {
    const accepted = await useAcceptedTask();

    await withDataRootStore(accepted.dataRoot, async (store) => {
      const getTask = vi.spyOn(store, "getTask");

      await callMarkLanded(accepted, store);

      expect(getTask).toHaveBeenCalledTimes(1);
    });
  });

  it("marks landed while the repo lock is busy", async () => {
    const accepted = await useAcceptedTask();
    await landAcceptedTask(accepted);
    const holder = startLockHolder(databasePathOf(accepted.dataRoot), repoLockName(accepted.repoKey));
    await holder.attempt;

    await withDataRootStore(accepted.dataRoot, (store) => callMarkLanded(accepted, store));

    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("landed");
    expect(lockNames(accepted.dataRoot)).toEqual([repoLockName(accepted.repoKey)]);
  });

  it("refuses at once when another process holds the task lock", async () => {
    const accepted = await useAcceptedTask();
    const name = taskLockName(accepted.repoKey, accepted.key);
    const holder = startLockHolder(databasePathOf(accepted.dataRoot), name);
    await holder.attempt;
    await withDataRootStore(accepted.dataRoot, (store) =>
      expectRefusedWithoutChange(accepted, () => callMarkLanded(accepted, store), `the lock ${name} is busy`),
    );
  });

  it("does not change stored data when the task id lookup fails", async () => {
    const accepted = await useAcceptedTask();
    const before = latestTaskOf(accepted.dataRoot, accepted.key);
    const events = eventsOf(accepted.dataRoot, accepted.key);
    const marker = readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id);

    const error = await withDataRootStore(accepted.dataRoot, (store) =>
      failureOf(callMarkLanded(accepted, store, accepted.task.id + 1000), Error),
    );

    expect(error.message).toContain("task");
    expect(latestTaskOf(accepted.dataRoot, accepted.key)).toEqual(before);
    expect(eventsOf(accepted.dataRoot, accepted.key)).toEqual(events);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toEqual(marker);
  });
});
