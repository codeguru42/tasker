import { describe, expect, it } from "vitest";
import { repoLockName, taskLockName } from "../../src/store/locks.js";
import { markLandedTask } from "../../src/tasks/mark-landed.js";
import type { TaskStore } from "../../src/store/store.js";
import { startLockHolder } from "../helpers/processes.js";
import { databasePathOf, latestTaskOf, lockNames, withDataRootStore } from "../helpers/store.js";
import {
  expectRefusedWithoutChange,
  landAcceptedTask,
  taskRefOf,
  useAcceptedTask,
  type AcceptedTask,
} from "../helpers/task-fixtures.js";

// Calls markLandedTask for the task of the fixture with a store.
const callMarkLanded = (fixture: AcceptedTask, store: TaskStore, waitMs = 300) =>
  markLandedTask(store, {
    config: fixture.config,
    ref: taskRefOf(fixture),
    taskId: fixture.task.id,
    env: process.env,
    repoLockWaitMs: waitMs,
  });

describe("markLandedTask", () => {
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
});
