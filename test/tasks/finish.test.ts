import { describe, expect, it } from "vitest";
import { LockBusyError, repoLockName } from "../../src/store/locks.js";
import type { TaskStore } from "../../src/store/store.js";
import { finishTask } from "../../src/tasks/finish.js";
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
import {
  taskRefOf,
  taskWorkspaceState,
  usePublishedLandedTask,
  useLandedTask,
  type LandedTask,
} from "../helpers/task-fixtures.js";

// Calls finishTask for the task of the fixture with a store, and gives the result and the io.
const callFinish = async (fixture: LandedTask, store: TaskStore, waitMs = 300) => {
  const io = captureIo();
  const result = await finishTask(store, {
    config: fixture.config,
    ref: taskRefOf(fixture),
    taskId: fixture.task.id,
    env: process.env,
    io,
    repoLockWaitMs: waitMs,
  });
  return { result, io };
};

describe("finishTask", () => {
  it("leaves everything and releases the task lock when the repo lock is busy", async () => {
    const landed = await useLandedTask();
    const events = eventsOf(landed.dataRoot, landed.key);
    const before = await taskWorkspaceState(landed);
    const holder = startLockHolder(databasePathOf(landed.dataRoot), repoLockName(landed.repoKey));
    await holder.attempt;

    const error = await withDataRootStore(landed.dataRoot, (store) =>
      failureOf(callFinish(landed, store), LockBusyError),
    );

    expect(error.message).toContain(`the lock ${repoLockName(landed.repoKey)} is busy`);
    expect(latestTaskOf(landed.dataRoot, landed.key).state).toBe("landed");
    expect(eventsOf(landed.dataRoot, landed.key)).toEqual(events);
    expect(await taskWorkspaceState(landed)).toEqual(before);
    expect(readRunMarker(databasePathOf(landed.dataRoot), landed.task.id)).toBeUndefined();
    expect(lockNames(landed.dataRoot)).toEqual([repoLockName(landed.repoKey)]);
  });

  it("rolls back a failed completion record and names the external cleanup", async () => {
    const landed = await usePublishedLandedTask();
    const { result, io } = await withDataRootStore(landed.dataRoot, async (store) => {
      const endRun = store.endRun.bind(store);
      store.endRun = (id, state, check) =>
        endRun(id, state, (current) => {
          const event = check?.(current);
          if (state === "finished") throw new Error("injected completion record failure");
          return event;
        });
      return callFinish(landed, store);
    });

    expect(result).toEqual({ exitCode: 1 });
    expect(io.out.join("")).toContain(`removed the worktree ${landed.worktree}\n`);
    expect(io.err.join("")).toContain("external cleanup succeeded");
    expect(io.err.join("")).toContain("completion record failed");
    expect(io.err.join("")).toContain("injected completion record failure");
    expect(latestTaskOf(landed.dataRoot, landed.key).state).toBe("cleanup_failed");
    expect(readRunMarker(databasePathOf(landed.dataRoot), landed.task.id)).toBeUndefined();
    expect(eventsOf(landed.dataRoot, landed.key).filter((event) => event.type === "finished")).toEqual([]);
    expect(await taskWorkspaceState(landed)).toEqual({
      state: "cleanup_failed",
      worktree: false,
      listed: false,
      branch: false,
    });
    expect(await landed.origin.branchHead(landed.branch)).toBeUndefined();
  });
});
