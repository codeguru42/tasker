import { describe, expect, it } from "vitest";
import { updateBranch } from "../../src/commands/update-branch.js";
import { failedFrom } from "../../src/state/machine.js";
import { LockBusyError, repoLockName } from "../../src/store/locks.js";
import { mergeTask } from "../../src/tasks/merge.js";
import type { TaskStore } from "../../src/store/store.js";
import { captureIo, runCommand } from "../helpers/cli.js";
import { failureOf } from "../helpers/errors.js";
import { realCommandPath } from "../helpers/fake-commands.js";
import { gitBeforeCommandEnv } from "../helpers/git.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  eventsOf,
  lastErrorOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  withDataRootStore,
} from "../helpers/store.js";
import {
  taskBranchTipOf,
  taskRefOf,
  unacceptedTipError,
  useAcceptedTask,
  type AcceptedTask,
} from "../helpers/task-fixtures.js";
import { useTempDir } from "../helpers/temp.js";

// Calls mergeTask for the task of the fixture with a store, and gives the result and the io.
const callMerge = async (fixture: AcceptedTask, store: TaskStore, waitMs = 300, env = process.env) => {
  const io = captureIo();
  const result = await mergeTask(store, {
    config: fixture.config,
    ref: taskRefOf(fixture),
    taskId: fixture.task.id,
    env,
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
    expect(lastErrorOf(accepted.dataRoot, accepted.task.id)).toBe(error);
    expect(events.some((event) => event.type === "landed")).toBe(false);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("failed");
    withDataRootStore(accepted.dataRoot, (store) => expect(failedFrom(store, accepted.task.id)).toBe("merging"));
    expect(await accepted.origin.branchHead("main")).toBe(accepted.revision);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("fails the task when a commit reaches the tip during the merge", async () => {
    const accepted = await useAcceptedTask();
    const dir = useTempDir("tasker-merge-late-");
    const env = gitBeforeCommandEnv(dir, process.env, "fetch", [
      realCommandPath("git"),
      "-C",
      accepted.task.worktreePath!,
      "commit",
      "--allow-empty",
      "-m",
      "late",
    ]);

    const { result, io } = await withDataRootStore(accepted.dataRoot, (store) => callMerge(accepted, store, 300, env));

    const tip = await taskBranchTipOf(accepted);
    expect(tip).not.toBe(accepted.revision);
    const error = `merging failed: ${unacceptedTipError(accepted.task.branch!, tip, accepted.revision)}`;
    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(`${error}\n`);
    expect(lastErrorOf(accepted.dataRoot, accepted.task.id)).toBe(error);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("failed");
    withDataRootStore(accepted.dataRoot, (store) => expect(failedFrom(store, accepted.task.id)).toBe("merging"));
    expect(await accepted.origin.branchHead("main")).not.toBe(tip);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();

    const updated = await runCommand(updateBranch, "update-branch", accepted.key, "--repo", accepted.repoKey);
    expect(updated.code).toBe(0);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("executed");
  });
});
