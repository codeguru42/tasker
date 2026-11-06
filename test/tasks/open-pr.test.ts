import { renameSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPrTask } from "../../src/tasks/open-pr.js";
import { LockBusyError, repoLockName, taskLockName } from "../../src/store/locks.js";
import { openStore, type TaskStore } from "../../src/store/store.js";
import { captureIo } from "../helpers/cli.js";
import { failureOf } from "../helpers/errors.js";
import { copyCloneBranchToOrigin } from "../helpers/git.js";
import { forgeStub } from "../helpers/forge.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  eventsOf,
  latestTaskOf,
  readRunMarker,
  withDataRootStore,
  withRawDatabase,
} from "../helpers/store.js";
import { taskRefOf, useAcceptedTask, type AcceptedTask } from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";

async function pushedTask(): Promise<AcceptedTask> {
  const accepted = await useAcceptedTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
  await copyCloneBranchToOrigin({
    origin: accepted.origin.path,
    clone: accepted.clone,
    branch: accepted.task.branch!,
    env: accepted.env,
  });
  withDataRootStore(accepted.dataRoot, (store) =>
    store.updateTask(accepted.task.id, { state: "pushed", publishedRevision: accepted.revision }),
  );
  return { ...accepted, task: latestTaskOf(accepted.dataRoot, KEY) };
}

async function callOpenPr(
  fixture: AcceptedTask,
  store: TaskStore,
  forge: ReturnType<typeof forgeStub>,
  repoLockWaitMs = 300,
) {
  const io = captureIo();
  const result = await openPrTask(store, {
    config: fixture.config,
    ref: taskRefOf(fixture),
    taskId: fixture.task.id,
    env: fixture.env,
    io,
    repoLockWaitMs,
    forge: forge.provider,
  });
  return { result, io };
}

async function withOpenPrStore<T>(fixture: AcceptedTask, call: (store: TaskStore) => Promise<T>): Promise<T> {
  const store = openStore(databasePathOf(fixture.dataRoot));
  try {
    return await call(store);
  } finally {
    store.close();
  }
}

describe("openPrTask", () => {
  it("creates the PR with the stored title and exact body, then records the result", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub();
    const before = eventsOf(fixture.dataRoot, KEY);

    const { result, io } = await withOpenPrStore(fixture, (store) => callOpenPr(fixture, store, fake));

    expect(result).toEqual({ pullRequest: { number: 42, url: "https://example.test/pull/42" }, adopted: false });
    expect(fake.calls.created).toEqual([
      {
        cwd: fixture.task.worktreePath!,
        head: fixture.task.branch!,
        base: "main",
        title: `${fixture.task.title ?? KEY} (${KEY})`,
        body: `Task: ${KEY}\n\n${fixture.task.title ?? KEY}`,
      },
    ]);
    expect(fake.calls.listed).toEqual([{ cwd: fixture.task.worktreePath!, head: fixture.task.branch! }]);
    expect(io.out.join("")).toBe("");
    expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ state: "in_peer_review", prNumber: 42 });
    expect(eventsOf(fixture.dataRoot, KEY).slice(before.length)).toEqual([
      {
        type: "transition",
        data: { from: "pushed", to: "opening_pr" },
      },
      {
        type: "pr_opened",
        data: {
          number: 42,
          url: "https://example.test/pull/42",
          head: fixture.task.branch,
          base: "main",
          adopted: false,
          from: "opening_pr",
          to: "in_peer_review",
        },
      },
    ]);
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("adopts an open PR on the resolved base without creating another PR", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub({
      openPrs: [{ number: 19, url: "https://example.test/pull/19", base: "main" }],
    });

    await withOpenPrStore(fixture, (store) => callOpenPr(fixture, store, fake));

    expect(fake.calls.created).toEqual([]);
    expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ state: "in_peer_review", prNumber: 19 });
    expect(eventsOf(fixture.dataRoot, KEY).at(-1)).toMatchObject({
      type: "pr_opened",
      data: { number: 19, adopted: true, base: "main" },
    });
  });

  it("refuses a different stored base before calling the forge", async () => {
    const fixture = await pushedTask();
    withDataRootStore(fixture.dataRoot, (store) => store.updateTask(fixture.task.id, { base: "refs/heads/topic" }));
    const fake = forgeStub();
    const before = eventsOf(fixture.dataRoot, KEY);

    const failure = await failureOf(
      withOpenPrStore(fixture, (store) => callOpenPr(fixture, store, fake)),
      Error,
    );

    expect(failure.message).toContain("refs/heads/topic");
    expect(failure.message).toContain("main");
    expect(failure.message.toLowerCase()).toContain("correct");
    expect(fake.calls).toEqual({ listed: [], created: [] });
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("pushed");
    expect(eventsOf(fixture.dataRoot, KEY)).toEqual(before);
  });

  it("refuses required task data before calling the forge", async () => {
    for (const [field, value, message] of [
      ["branch", null, "has no branch"],
      ["worktreePath", null, "has no worktree"],
      ["base", null, "has no base"],
    ] as const) {
      const fixture = await pushedTask();
      withDataRootStore(fixture.dataRoot, (store) => store.updateTask(fixture.task.id, { [field]: value }));
      const fake = forgeStub();

      const failure = await failureOf(
        withOpenPrStore(fixture, (store) => callOpenPr(fixture, store, fake)),
        Error,
      );

      expect(failure.message).toContain(message);
      expect(fake.calls).toEqual({ listed: [], created: [] });
      expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("pushed");
    }
  });

  it("does not enter opening_pr when fetching origin fails", async () => {
    const fixture = await pushedTask();
    const hidden = `${fixture.origin.path}.hidden`;
    const fake = forgeStub();
    renameSync(fixture.origin.path, hidden);

    let failure: Error | undefined;
    try {
      failure = await failureOf(
        withOpenPrStore(fixture, (store) => callOpenPr(fixture, store, fake)),
        Error,
      );
    } finally {
      renameSync(hidden, fixture.origin.path);
    }

    expect(failure?.message).toBeTruthy();
    expect(fake.calls).toEqual({ listed: [], created: [] });
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("pushed");
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("uses the issue key when the stored title is absent", async () => {
    const fixture = await pushedTask();
    withDataRootStore(fixture.dataRoot, (store) => store.updateTask(fixture.task.id, { title: null }));
    const fake = forgeStub();

    await withOpenPrStore(fixture, (store) => callOpenPr(fixture, store, fake));

    expect(fake.calls.created[0]).toMatchObject({ title: `${KEY} (${KEY})`, body: `Task: ${KEY}\n\n${KEY}` });
  });

  it("refuses an open PR on another base and gives its identity", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub({
      openPrs: [{ number: 28, url: "https://example.test/pull/28", base: "release" }],
    });

    const { result, io } = await withOpenPrStore(fixture, (store) => callOpenPr(fixture, store, fake));

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toContain("#28");
    expect(io.err.join("")).toContain("https://example.test/pull/28");
    expect(io.err.join("")).toContain("release");
    expect(io.err.join("").toLowerCase()).toContain("correct");
    expect(fake.calls.created).toEqual([]);
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("failed");
  });

  it("does not create a PR when lookup fails", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub();
    fake.failList(new Error("lookup denied"));

    const { result, io } = await withOpenPrStore(fixture, (store) => callOpenPr(fixture, store, fake));

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toContain("lookup denied");
    expect(fake.calls.created).toEqual([]);
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("failed");
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("fails opening when the forge cannot create a PR", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub();
    fake.failCreate(new Error("create denied"));

    const { result, io } = await withOpenPrStore(fixture, (store) => callOpenPr(fixture, store, fake));

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toContain("create denied");
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("failed");
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("fails the run if the PR record transaction fails and reports the created PR", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub();
    withRawDatabase(databasePathOf(fixture.dataRoot), (db) =>
      db.exec(
        "CREATE TRIGGER reject_pr_opened BEFORE INSERT ON events WHEN NEW.type = 'pr_opened' BEGIN SELECT RAISE(ABORT, 'event rejected'); END",
      ),
    );

    const { result, io } = await withOpenPrStore(fixture, (store) => callOpenPr(fixture, store, fake));

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toContain("#42");
    expect(io.err.join("")).toContain("https://example.test/pull/42");
    expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ state: "failed", prNumber: null });
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("honors task and repo locks before contacting the forge", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub();
    const dbPath = databasePathOf(fixture.dataRoot);
    const taskHolder = startLockHolder(dbPath, taskLockName(fixture.repoKey, KEY));
    await taskHolder.attempt;
    const taskFailure = await failureOf(
      withOpenPrStore(fixture, (store) => callOpenPr(fixture, store, fake)),
      LockBusyError,
    );
    expect(taskFailure).toBeInstanceOf(LockBusyError);
    expect(fake.calls).toEqual({ listed: [], created: [] });

    process.kill(taskHolder.pid, "SIGKILL");
    await taskHolder.exited;
    const repoHolder = startLockHolder(dbPath, repoLockName(fixture.repoKey));
    await repoHolder.attempt;
    const repoFailure = await failureOf(
      withOpenPrStore(fixture, (store) => callOpenPr(fixture, store, fake, 0)),
      LockBusyError,
    );
    expect(repoFailure).toBeInstanceOf(LockBusyError);
    expect(fake.calls).toEqual({ listed: [], created: [] });
    process.kill(repoHolder.pid, "SIGKILL");
    await repoHolder.exited;
  });
});
