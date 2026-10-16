import { describe, expect, it } from "vitest";
import { failedFrom } from "../../src/state/machine.js";
import { LockBusyError, repoLockName } from "../../src/store/locks.js";
import { mergeTask } from "../../src/tasks/merge.js";
import type { TaskStore } from "../../src/store/store.js";
import { captureIo } from "../helpers/cli.js";
import { failureOf } from "../helpers/errors.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  eventsOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  withDataRootStore,
} from "../helpers/store.js";
import { taskRefOf, useAcceptedTask, type AcceptedTask } from "../helpers/task-fixtures.js";
import { lastTransitionError } from "../../src/state/machine.js";

// The error of the last transition event of the task.
const errorOf = (task: Pick<AcceptedTask, "dataRoot" | "task">) =>
  withDataRootStore(task.dataRoot, (store) => lastTransitionError(store.listEvents(task.task.id)));

// Calls mergeTask for the task of the fixture with a store, and gives the result and the io.
const callMerge = async (fixture: AcceptedTask, store: TaskStore, waitMs = 300) => {
  const io = captureIo();
  const result = await mergeTask(store, {
    config: fixture.config,
    ref: taskRefOf(fixture),
    taskId: fixture.task.id,
    env: process.env,
    io,
    repoLockWaitMs: waitMs,
  });
  return { result, io };
};

describe("mergeTask", () => {
  it("leaves everything and releases the task lock when the repo lock is busy", async () => {
    const accepted = await useAcceptedTask();
    const events = eventsOf(accepted.dataRoot, accepted.key);
    const head = await accepted.origin.branchHead("main");
    const holder = startLockHolder(databasePathOf(accepted.dataRoot), repoLockName(accepted.repoKey));
    await holder.attempt;

    const error = await withDataRootStore(accepted.dataRoot, (store) =>
      failureOf(callMerge(accepted, store), LockBusyError),
    );

    expect(error.message).toContain(`the lock ${repoLockName(accepted.repoKey)} is busy`);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("accepted");
    expect(eventsOf(accepted.dataRoot, accepted.key)).toEqual(events);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
    expect(await accepted.origin.branchHead("main")).toBe(head);
    expect(lockNames(accepted.dataRoot)).toEqual([repoLockName(accepted.repoKey)]);
  });

  it("fails the task and names the push when the record of the landing fails", async () => {
    const accepted = await useAcceptedTask();

    const { result, io } = await withDataRootStore(accepted.dataRoot, (store) => {
      const failing: TaskStore = {
        ...store,
        endRun(id, state, check) {
          if (state === "landed") throw new Error("disk full");
          return store.endRun(id, state, check);
        },
      };
      return callMerge(accepted, failing);
    });

    const error = `merging failed: pushed ${accepted.revision} to origin/main, but tasker cannot record the result: disk full`;
    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(`${error}\n`);
    const events = eventsOf(accepted.dataRoot, accepted.key);
    expect(errorOf(accepted)).toBe(error);
    expect(events.some((event) => event.type === "landed")).toBe(false);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("failed");
    withDataRootStore(accepted.dataRoot, (store) => expect(failedFrom(store, accepted.task.id)).toBe("merging"));
    expect(await accepted.origin.branchHead("main")).toBe(accepted.revision);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });
});
