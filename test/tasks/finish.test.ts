import { describe, expect, it } from "vitest";
import { LockBusyError, repoLockName } from "../../src/store/locks.js";
import type { TaskStore } from "../../src/store/store.js";
import { finishTask } from "../../src/tasks/finish.js";
import { captureIo } from "../helpers/cli.js";
import { failureOf } from "../helpers/errors.js";
import { rejectOriginPush } from "../helpers/git.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  eventDataOf,
  eventsOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  rejectFinishedEvent,
  withDataRootStore,
} from "../helpers/store.js";
import {
  taskRefOf,
  taskWorkspaceState,
  usePublishedLandedTask,
  useLandedTask,
  fixtureTrackerAnswer,
  fixtureTrackerCall,
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
  it("records the board move after the done write and before the finished transition", async () => {
    const boardArgs = [
      "project",
      "item-edit",
      "42",
      "--owner",
      "octo",
      "--url",
      "https://github.com/codeguru42/tasker/issues/5",
      "--field",
      "Status",
      "--value",
      "Done",
    ];
    const landed = await useLandedTask({
      repo: {
        issueTracker: {
          provider: "github",
          account: "codeguru42",
          updateOnFinish: true,
          doneLabel: "done",
          board: { owner: "octo", number: 42, done: "Done" },
        },
      },
      ghAnswers: [fixtureTrackerAnswer("doneLabel"), { args: boardArgs }],
    });

    await withDataRootStore(landed.dataRoot, (store) => callFinish(landed, store));

    const entries = eventsOf(landed.dataRoot, landed.key);
    expect(entries.slice(-3).map((event) => event.type)).toEqual(["tracker_update", "tracker_update", "finished"]);
    expect(eventDataOf(landed.dataRoot, landed.key, "tracker_update").slice(-2)).toEqual([
      { action: "done", result: "ok" },
      { action: "board_done", result: "ok" },
    ]);
    const writes = landed.gh
      .calls()
      .map((call) => call.args)
      .filter((args) => args[0] === "issue" || args[0] === "project");
    expect(writes.slice(-2)).toEqual([fixtureTrackerCall("doneLabel"), boardArgs]);
  });

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
    const removeTrigger = rejectFinishedEvent(databasePathOf(landed.dataRoot));
    const { result, io } = await withDataRootStore(landed.dataRoot, (store) => callFinish(landed, store));

    expect(result).toEqual({ exitCode: 1 });
    expect(io.out.join("")).toContain(`removed the worktree ${landed.worktree}\n`);
    expect(io.err.join("")).toContain("external cleanup succeeded");
    expect(io.err.join("")).toContain("completion record failed");
    expect(io.err.join("")).toContain("event rejected");
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

    removeTrigger();
    await withDataRootStore(landed.dataRoot, async (store) => callFinish(landed, store));
    expect(latestTaskOf(landed.dataRoot, landed.key).state).toBe("finished");
  });

  it("reports failed remote cleanup when the completion record also fails", async () => {
    const landed = await usePublishedLandedTask();
    const removeRejectingHook = rejectOriginPush(landed.origin);
    const removeTrigger = rejectFinishedEvent(databasePathOf(landed.dataRoot));

    const {
      first,
      second,
      remoteBranchAfterFirst,
      stateAfterFirst,
      markerAfterFirst,
      finishedEventsAfterFirst,
      workspaceAfterFirst,
    } = await withDataRootStore(landed.dataRoot, async (store) => {
      const first = await callFinish(landed, store);
      const remoteBranchAfterFirst = await landed.origin.branchHead(landed.branch);
      const stateAfterFirst = latestTaskOf(landed.dataRoot, landed.key).state;
      const markerAfterFirst = readRunMarker(databasePathOf(landed.dataRoot), landed.task.id);
      const finishedEventsAfterFirst = eventsOf(landed.dataRoot, landed.key).filter(
        (event) => event.type === "finished",
      );
      const workspaceAfterFirst = await taskWorkspaceState(landed);
      removeRejectingHook();
      removeTrigger();
      const second = await callFinish(landed, store);
      return {
        first,
        second,
        remoteBranchAfterFirst,
        stateAfterFirst,
        markerAfterFirst,
        finishedEventsAfterFirst,
        workspaceAfterFirst,
      };
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
    expect(first.io.err.join("")).toContain("event rejected");
    expect(first.io.err.join("")).not.toContain("external cleanup succeeded");
    expect(remoteBranchAfterFirst).toBe(landed.publishedRevision);
    expect(stateAfterFirst).toBe("cleanup_failed");
    expect(markerAfterFirst).toBeUndefined();
    expect(finishedEventsAfterFirst).toEqual([]);
    expect(workspaceAfterFirst).toEqual({
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
