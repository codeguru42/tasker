import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config/schema.js";
import type { IssueRef } from "../../src/issue-key/ref.js";
import { taskRefOf, useAcceptedTask, type AcceptedTask } from "../helpers/task-fixtures.js";
import { LockBusyError, repoLockName } from "../../src/store/locks.js";
import type { TaskStore } from "../../src/store/store.js";
import { captureIo } from "../helpers/cli.js";
import { failureOf } from "../helpers/errors.js";
import { realCommandPath } from "../helpers/fake-commands.js";
import { copyCloneBranchToOrigin, gitBeforePushEnv } from "../helpers/git.js";
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
import { useTempDir } from "../helpers/temp.js";

// Calls pushTask for the accepted fixture with a store, and gives the result and its output.
const callPush = async (fixture: AcceptedTask, store: TaskStore, env = fixture.env, waitMs = 300) => {
  const io = captureIo();
  const module = (await import("../../src/tasks/push.js")) as unknown as {
    pushTask: (
      taskStore: TaskStore,
      request: {
        config: Config;
        ref: IssueRef;
        taskId: number;
        env: NodeJS.ProcessEnv;
        io: ReturnType<typeof captureIo>;
        repoLockWaitMs: number;
      },
    ) => Promise<unknown>;
  };
  const result = await module.pushTask(store, {
    config: fixture.config,
    ref: taskRefOf(fixture),
    taskId: fixture.task.id,
    env,
    io,
    repoLockWaitMs: waitMs,
  });
  return { result, io };
};

describe("pushTask", () => {
  it("publishes the accepted task branch and records the result", async () => {
    const accepted = await useAcceptedTask();
    const main = await accepted.origin.branchHead("main");

    const { result, io } = await withDataRootStore(accepted.dataRoot, (store) => callPush(accepted, store));

    expect(result).toMatchObject({ issueKey: accepted.key, branch: accepted.task.branch, revision: accepted.revision });
    expect(io.out.join("")).toBe("");
    expect(io.err.join("")).toBe("");
    expect(await accepted.origin.branchHead(accepted.task.branch!)).toBe(accepted.revision);
    expect(await accepted.origin.branchHead("main")).toBe(main);
    expect(latestTaskOf(accepted.dataRoot, accepted.key)).toMatchObject({
      state: "pushed",
      publishedRevision: accepted.revision,
    });
    expect(eventsOf(accepted.dataRoot, accepted.key).at(-1)).toMatchObject({
      type: "published",
      data: { revision: accepted.revision, branch: accepted.task.branch, lease: true, pushed: true },
    });
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("leaves the task unchanged when origin holds an unexpected branch tip", async () => {
    const accepted = await useAcceptedTask();
    await copyCloneBranchToOrigin({
      origin: accepted.origin.path,
      clone: accepted.clone,
      branch: accepted.task.branch!,
      env: accepted.env,
    });
    await accepted.origin.addCommit(accepted.task.branch!, { file: "moved.txt" });
    const before = eventsOf(accepted.dataRoot, accepted.key);

    const { result, io } = await withDataRootStore(accepted.dataRoot, (store) => callPush(accepted, store));

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toContain("pushing failed: the task branch moved on origin");
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("failed");
    expect(eventsOf(accepted.dataRoot, accepted.key)).not.toEqual(before);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("fails when origin moves after the provider reads it, without replacing that tip", async () => {
    const accepted = await useAcceptedTask();
    const moved = await accepted.origin.branchHead("main");
    const dir = useTempDir("tasker-push-lease-");
    const env = gitBeforePushEnv(dir, accepted.env, [
      realCommandPath("git"),
      "--git-dir",
      accepted.origin.path,
      "update-ref",
      `refs/heads/${accepted.task.branch!}`,
      moved!,
    ]);

    const { result } = await withDataRootStore(accepted.dataRoot, (store) => callPush(accepted, store, env));

    expect(result).toEqual({ exitCode: 1 });
    expect(await accepted.origin.branchHead(accepted.task.branch!)).toBe(moved);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("failed");
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("releases the task lock when the repo lock is busy", async () => {
    const accepted = await useAcceptedTask();
    const name = repoLockName(accepted.repoKey);
    const holder = startLockHolder(databasePathOf(accepted.dataRoot), name);
    await holder.attempt;

    const error = await withDataRootStore(accepted.dataRoot, (store) =>
      failureOf(callPush(accepted, store), LockBusyError),
    );

    expect(error.message).toContain(`the lock ${name} is busy`);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("accepted");
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
    expect(lockNames(accepted.dataRoot)).toEqual([name]);
  });

  it("fails the task when the remote push succeeds but recording fails", async () => {
    const accepted = await useAcceptedTask();

    const { result, io } = await withDataRootStore(accepted.dataRoot, (store) => {
      const failing: TaskStore = {
        ...store,
        recordPublication() {
          throw new Error("disk full");
        },
      };
      return callPush(accepted, failing);
    });

    const message = `pushing failed: pushed ${accepted.revision} to origin/${accepted.task.branch!}, but tasker cannot record the result: disk full`;
    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(`${message}\n`);
    expect(lastErrorOf(accepted.dataRoot, accepted.task.id)).toBe(message);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("failed");
    expect(await accepted.origin.branchHead(accepted.task.branch!)).toBe(accepted.revision);
  });

  it("uses the stored revision to recognize an already published branch", async () => {
    const accepted = await useAcceptedTask();
    await copyCloneBranchToOrigin({
      origin: accepted.origin.path,
      clone: accepted.clone,
      branch: accepted.task.branch!,
      env: accepted.env,
    });
    withDataRootStore(accepted.dataRoot, (store) => {
      store.updateTask(accepted.task.id, { publishedRevision: accepted.revision });
    });

    const { result } = await withDataRootStore(accepted.dataRoot, (store) => callPush(accepted, store));

    expect(result).toMatchObject({ revision: accepted.revision, pushed: false });
    expect(await accepted.origin.branchHead(accepted.task.branch!)).toBe(accepted.revision);
  });
});
