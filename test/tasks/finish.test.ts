import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LockBusyError, repoLockName } from "../../src/store/locks.js";
import type { TaskStore } from "../../src/store/store.js";
import { finishTask } from "../../src/tasks/finish.js";
import { captureIo } from "../helpers/cli.js";
import { failureOf } from "../helpers/errors.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  eventDataOf,
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

  it("reports failed remote cleanup when the completion record also fails", async () => {
    const landed = await usePublishedLandedTask();
    const hookDir = join(landed.origin.path, "hooks");
    mkdirSync(hookDir, { recursive: true });
    const hook = join(hookDir, "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho 'remote delete refused' >&2\nexit 1\n", { mode: 0o755 });

    const { first, second } = await withDataRootStore(landed.dataRoot, async (store) => {
      const endRun = store.endRun.bind(store);
      let failCompletion = true;
      store.endRun = (id, state, check) =>
        endRun(id, state, (current) => {
          const event = check?.(current);
          if (state === "finished" && failCompletion) throw new Error("injected completion record failure");
          return event;
        });
      const first = await callFinish(landed, store);
      failCompletion = false;
      rmSync(hook);
      const second = await callFinish(landed, store);
      return { first, second };
    });

    expect(first.result).toEqual({ exitCode: 1 });
    expect(first.io.out.join("")).toContain(`removed the worktree ${landed.worktree}\n`);
    expect(first.io.out.join("")).toContain(`deleted the branch ${landed.branch}\n`);
    const [warning] = eventDataOf(landed.dataRoot, landed.key, "remote_cleanup_warning") as {
      branch: string;
      publishedRevision: string;
      error: string;
    }[];
    expect(warning).toEqual({
      branch: landed.branch,
      publishedRevision: landed.publishedRevision,
      error: expect.stringContaining("remote delete refused"),
    });
    expect(first.io.err.join("")).toContain(`warning: cannot delete the task branch ${landed.branch} on origin:`);
    expect(first.io.err.join("")).toContain("remote branch failed");
    expect(first.io.err.join("")).toContain("completion record failed");
    expect(first.io.err.join("")).toContain("injected completion record failure");
    expect(first.io.err.join("")).not.toContain("external cleanup succeeded");
    expect(await landed.origin.branchHead(landed.branch)).toBe(landed.publishedRevision);
    expect(latestTaskOf(landed.dataRoot, landed.key).state).toBe("cleanup_failed");
    expect(readRunMarker(databasePathOf(landed.dataRoot), landed.task.id)).toBeUndefined();
    expect(eventsOf(landed.dataRoot, landed.key).filter((event) => event.type === "finished")).toEqual([]);
    expect(await taskWorkspaceState(landed)).toEqual({
      state: "cleanup_failed",
      worktree: false,
      listed: false,
      branch: false,
    });

    expect(second.result).toEqual({ issueKey: landed.key });
    expect(latestTaskOf(landed.dataRoot, landed.key).state).toBe("finished");
    expect(await landed.origin.branchHead(landed.branch)).toBeUndefined();
  });
});
