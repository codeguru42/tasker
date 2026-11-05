import { describe, expect, it } from "vitest";
import { RunMarkerExistsError, type TaskStore } from "../../src/store/store.js";
import { LockBusyError, repoLockName, taskLockName } from "../../src/store/locks.js";
import { pushTask } from "../../src/tasks/push.js";
import { expectNoAssistantRun, taskRefOf, useAcceptedTask, type AcceptedTask } from "../helpers/task-fixtures.js";
import { captureIo } from "../helpers/cli.js";
import { failureOf } from "../helpers/errors.js";
import { realCommandPath } from "../helpers/fake-commands.js";
import {
  copyCloneBranchToOrigin,
  gitBeforePushEnv,
  gitOutput,
  gitRecorderEnv,
  recordedPushCalls,
} from "../helpers/git.js";
import { useFakeClaudeOnPath } from "../helpers/fake-claude.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  failPublicationRecord,
  databasePathOf,
  eventsOf,
  lastErrorOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  writeRunMarker,
  withDataRootStore,
} from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";

// Calls pushTask for the accepted fixture with a store, and gives the result and its output.
const callPush = async (fixture: AcceptedTask, store: TaskStore, env = fixture.env, waitMs = 300) => {
  const io = captureIo();
  const result = await pushTask(store, {
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
    const claude = useFakeClaudeOnPath({});
    const main = await accepted.origin.branchHead("main");
    const ghCalls = accepted.gh.calls();
    const recorder = gitRecorderEnv(useTempDir("tasker-push-git-log-"), accepted.env);

    const { result, io } = await withDataRootStore(accepted.dataRoot, (store) =>
      callPush(accepted, store, recorder.env),
    );

    expect(result).toMatchObject({ branch: accepted.task.branch, revision: accepted.revision });
    expect(io.out.join("")).toBe("");
    expect(io.err.join("")).toBe("");
    expect(await accepted.origin.branchHead(accepted.task.branch!)).toBe(accepted.revision);
    expect(await accepted.origin.branchHead("main")).toBe(main);
    expect(latestTaskOf(accepted.dataRoot, accepted.key)).toMatchObject({
      state: "pushed",
      publishedRevision: accepted.revision,
    });
    expect(eventsOf(accepted.dataRoot, accepted.key).at(-1)).toEqual({
      type: "published",
      data: {
        branch: accepted.task.branch,
        revision: accepted.revision,
        lease: true,
        pushed: true,
        from: "pushing",
        to: "pushed",
      },
    });
    expect(recordedPushCalls(recorder.log)).toHaveLength(1);
    expect(accepted.gh.calls()).toEqual(ghCalls);
    expectNoAssistantRun({ claude, started: { dataRoot: accepted.dataRoot } });
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

  it("refuses to run while another process holds the task lock", async () => {
    const accepted = await useAcceptedTask();
    const name = taskLockName(accepted.repoKey, accepted.key);
    const holder = startLockHolder(databasePathOf(accepted.dataRoot), name);
    await holder.attempt;

    const error = await withDataRootStore(accepted.dataRoot, (store) =>
      failureOf(callPush(accepted, store), LockBusyError),
    );

    expect(error.message).toContain(name);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("accepted");
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("refuses to run while a live task marker exists", async () => {
    const accepted = await useAcceptedTask();
    writeRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id, "executing", process.pid);

    const error = await withDataRootStore(accepted.dataRoot, (store) =>
      failureOf(callPush(accepted, store), RunMarkerExistsError),
    );

    expect(error.message).toContain("already has a run marker");
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("accepted");
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toMatchObject({ state: "executing" });
  });

  it("fails the task when the remote push succeeds but recording fails", async () => {
    const accepted = await useAcceptedTask();

    const { result, io } = await withDataRootStore(accepted.dataRoot, (store) => {
      return callPush(accepted, failPublicationRecord(store));
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
    const ghCalls = accepted.gh.calls();
    await copyCloneBranchToOrigin({
      origin: accepted.origin.path,
      clone: accepted.clone,
      branch: accepted.task.branch!,
      env: accepted.env,
    });
    withDataRootStore(accepted.dataRoot, (store) => {
      store.updateTask(accepted.task.id, { publishedRevision: accepted.revision });
    });

    const recorder = gitRecorderEnv(useTempDir("tasker-push-git-log-"), accepted.env);
    const { result } = await withDataRootStore(accepted.dataRoot, (store) => callPush(accepted, store, recorder.env));

    expect(result).toMatchObject({ revision: accepted.revision, pushed: false });
    expect(await accepted.origin.branchHead(accepted.task.branch!)).toBe(accepted.revision);
    expect(eventsOf(accepted.dataRoot, accepted.key).at(-1)).toEqual({
      type: "published",
      data: {
        branch: accepted.task.branch,
        revision: accepted.revision,
        lease: false,
        pushed: false,
        from: "pushing",
        to: "pushed",
      },
    });
    expect(recordedPushCalls(recorder.log)).toHaveLength(0);
    expect(accepted.gh.calls()).toEqual(ghCalls);
  });

  it("updates a remote branch from an older stored revision to the accepted tip", async () => {
    const accepted = await useAcceptedTask();
    const claude = useFakeClaudeOnPath({});
    await accepted.origin.addCommit("main", { file: "remote-base.txt" });
    const oldRemote = await accepted.origin.branchHead("main");
    await gitOutput(
      { gitDir: accepted.origin.path },
      accepted.env,
      "update-ref",
      `refs/heads/${accepted.task.branch!}`,
      oldRemote!,
    );
    withDataRootStore(accepted.dataRoot, (store) => {
      store.updateTask(accepted.task.id, { publishedRevision: oldRemote });
    });
    const recorder = gitRecorderEnv(useTempDir("tasker-push-git-log-"), accepted.env);

    const { result } = await withDataRootStore(accepted.dataRoot, (store) => callPush(accepted, store, recorder.env));

    expect(result).toMatchObject({ revision: accepted.revision, pushed: true });
    expect(await accepted.origin.branchHead(accepted.task.branch!)).toBe(accepted.revision);
    expect(await accepted.origin.branchHead("main")).toBe(oldRemote);
    expect(latestTaskOf(accepted.dataRoot, accepted.key)).toMatchObject({
      state: "pushed",
      publishedRevision: accepted.revision,
    });
    expect(recordedPushCalls(recorder.log)).toHaveLength(1);
    expectNoAssistantRun({ claude, started: { dataRoot: accepted.dataRoot } });
  });

  it("reports only the recording error when an already published result cannot be stored", async () => {
    const accepted = await useAcceptedTask();
    const ghCalls = accepted.gh.calls();
    await copyCloneBranchToOrigin({
      origin: accepted.origin.path,
      clone: accepted.clone,
      branch: accepted.task.branch!,
      env: accepted.env,
    });
    const recorder = gitRecorderEnv(useTempDir("tasker-push-git-log-"), accepted.env);

    const { result, io } = await withDataRootStore(accepted.dataRoot, (store) => {
      return callPush(accepted, failPublicationRecord(store), recorder.env);
    });

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe("pushing failed: disk full\n");
    expect(lastErrorOf(accepted.dataRoot, accepted.task.id)).toBe("pushing failed: disk full");
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("failed");
    expect(await accepted.origin.branchHead(accepted.task.branch!)).toBe(accepted.revision);
    expect(recordedPushCalls(recorder.log)).toHaveLength(0);
    expect(accepted.gh.calls()).toEqual(ghCalls);
  });
});
