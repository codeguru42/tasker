import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { bootstrapLogPath } from "../../src/phases/bootstrap.js";
import {
  failedFrom,
  lastTransitionError,
  refineFeedbackOf,
  transitionFromEvents,
  transitionTask,
} from "../../src/state/machine.js";
import { taskLogsDir, verifyCommandLogPath } from "../../src/store/layout.js";
import type { TaskStore } from "../../src/store/store.js";
import { thrownBy } from "./errors.js";
import { claudeRateLimitEvent } from "./fake-claude.js";
import { seedPlanSession, seedReviewSession } from "./plan.js";
import { findingEntries, reviewFinding } from "./review.js";
import { useTempDir } from "./temp.js";
import { useThreeRepoDataRoot } from "./config.js";
import { taskNames } from "./git.js";
import {
  dayAt,
  databasePathOf,
  eventDataOf,
  eventsOf,
  failRefineFrom,
  failTaskVia,
  failTaskFrom,
  failVerifyRun,
  pauseRefineFrom,
  pauseTaskFrom,
  pauseTaskVia,
  lastErrorOf,
  latestTaskOf,
  lockNames,
  newReview,
  newVerifyRun,
  quotaEventsOf,
  readRunMarker,
  reviewSessionRows,
  seedCreditsApproval,
  seedCreditsApprovalIn,
  seedQuotaEvent,
  seedDeadRun,
  seedOneTask,
  seedReview,
  seedTask,
  seedTaskWithReviews,
  seedTasks,
  seedVerifyRun,
  tableRowCount,
  withDataRootStore,
  withRawDatabase,
  withStoreFile,
  writeBootstrapLog,
  writeRunMarker,
} from "./store.js";

describe("seedTasks", () => {
  it("returns the tasks in input order with their times", () => {
    const dir = useTempDir("tasker-seed-");
    const dataRoot = join(dir, "data");

    const tasks = seedTasks(dataRoot, [
      { issueKey: "a/b#2", repoKey: "a/b", state: "planning", at: "2026-01-02T00:00:00.000Z" },
      { issueKey: "a/b#1", repoKey: "a/c", state: "finished", at: "2026-01-01T00:00:00.000Z" },
    ]);

    expect(tasks.map((t) => [t.issueKey, t.repoKey, t.state])).toEqual([
      ["a/b#2", "a/b", "planning"],
      ["a/b#1", "a/c", "finished"],
    ]);
    expect(tasks.map((t) => [t.createdAt, t.updatedAt])).toEqual([
      ["2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z"],
      ["2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    ]);
    withDataRootStore(dataRoot, (store) => {
      expect(store.listTasks({ states: ["planning", "finished"] }).map((t) => t.id)).toEqual(tasks.map((t) => t.id));
    });
  });
});

describe("seedOneTask", () => {
  it("creates one task in a new data root", () => {
    const { dataRoot, task } = seedOneTask("approved", "a/b#1", "a/b");

    expect(task).toMatchObject({ state: "approved", issueKey: "a/b#1", repoKey: "a/b", createdAt: dayAt(1) });
    expect(withDataRootStore(dataRoot, (store) => store.getTask(task.id))).toEqual(task);
  });
});

describe("seedTasks run markers", () => {
  it("gives a task in a spawning state a live run of the test process", () => {
    const { dataRoot, task } = seedOneTask("executing", "a/b#1", "a/b");

    expect(withDataRootStore(dataRoot, (store) => store.runStatus(task.id))).toMatchObject({ status: "running" });
  });

  it("gives a task in a state that is not spawning no run", () => {
    const { dataRoot, task } = seedOneTask("approved", "a/b#1", "a/b");

    expect(withDataRootStore(dataRoot, (store) => store.runStatus(task.id))).toEqual({ status: "none" });
    expect(readRunMarker(databasePathOf(dataRoot), task.id)).toBeUndefined();
  });
});

describe("seedDeadRun", () => {
  it.each([null, 4242])("gives a dead run with the child pid %s", (childPid) => {
    const dataRoot = join(useTempDir("tasker-seed-dead-"), "data");
    const [task] = seedTasks(dataRoot, [{ issueKey: "a/b#1", repoKey: "a/b", state: "approved", at: dayAt(1) }]);

    const moved = seedDeadRun(dataRoot, task.id, "executing", childPid);

    expect(moved.state).toBe("executing");
    expect(withDataRootStore(dataRoot, (store) => store.runStatus(task.id))).toEqual({ status: "dead", childPid });
    expect(readRunMarker(databasePathOf(dataRoot), task.id)).toMatchObject({
      task_id: task.id,
      state: "executing",
      child_pid: childPid,
    });
  });
});

describe("writeRunMarker", () => {
  it("writes the row of the run marker", () => {
    const dataRoot = join(useTempDir("tasker-write-marker-"), "data");
    const [task] = seedTasks(dataRoot, [{ issueKey: "a/b#1", repoKey: "a/b", state: "approved", at: dayAt(1) }]);
    const dbPath = databasePathOf(dataRoot);

    writeRunMarker(dbPath, task.id, "planning", 77, 78);

    expect(readRunMarker(dbPath, task.id)).toEqual({
      task_id: task.id,
      state: "planning",
      pid: 77,
      child_pid: 78,
      started_at: "t",
    });
  });
});

describe("eventsOf", () => {
  it("gives the events of the task in order", () => {
    const dataRoot = join(useTempDir("tasker-events-"), "data");
    seedTasks(dataRoot, [
      {
        issueKey: "codeguru42/tasker#9",
        repoKey: "codeguru42/tasker",
        state: "provisioning",
        at: dayAt(1),
        failWith: "boom",
      },
    ]);

    expect(eventsOf(dataRoot, "codeguru42/tasker#9")).toEqual([
      { type: "created", data: { state: "provisioning" } },
      { type: "transition", data: { from: "provisioning", to: "failed", error: "boom" } },
    ]);
  });

  it("throws for an issue key with no task", () => {
    const dataRoot = join(useTempDir("tasker-events-"), "data");
    withDataRootStore(dataRoot, () => {});

    expect((thrownBy(() => eventsOf(dataRoot, "codeguru42/tasker#9")) as Error).message).toBe(
      "no task of codeguru42/tasker#9",
    );
  });
});

describe("eventDataOf", () => {
  function seedFailedTask(): string {
    const dataRoot = join(useTempDir("tasker-event-data-"), "data");
    seedTasks(dataRoot, [
      {
        issueKey: "codeguru42/tasker#9",
        repoKey: "codeguru42/tasker",
        state: "provisioning",
        at: dayAt(1),
        failWith: "boom",
      },
    ]);
    return dataRoot;
  }

  it("gives the data of the events of the type in order", () => {
    const dataRoot = seedFailedTask();

    expect(eventDataOf(dataRoot, "codeguru42/tasker#9", "transition")).toEqual([
      { from: "provisioning", to: "failed", error: "boom" },
    ]);
  });

  it("gives an empty list for a type with no event", () => {
    const dataRoot = seedFailedTask();

    expect(eventDataOf(dataRoot, "codeguru42/tasker#9", "tracker_update")).toEqual([]);
  });
});

describe("lastErrorOf", () => {
  it("gives the error of the last transition event", () => {
    const dataRoot = join(useTempDir("tasker-last-error-"), "data");
    const [task] = seedTasks(dataRoot, [
      {
        issueKey: "codeguru42/tasker#9",
        repoKey: "codeguru42/tasker",
        state: "provisioning",
        at: dayAt(1),
        failWith: "boom",
      },
    ]);

    expect(lastErrorOf(dataRoot, task.id)).toBe("boom");
  });

  it("gives undefined when the last transition event has no error", () => {
    const dataRoot = join(useTempDir("tasker-last-error-"), "data");
    const [task] = seedTasks(dataRoot, [
      { issueKey: "codeguru42/tasker#9", repoKey: "codeguru42/tasker", state: "provisioning", at: dayAt(1) },
    ]);
    withDataRootStore(dataRoot, (store) => transitionTask(store, task.id, "workspace_ready"));

    expect(lastErrorOf(dataRoot, task.id)).toBeUndefined();
  });
});

describe("latestTaskOf", () => {
  it("gives the newest of two tasks of the issue", () => {
    const dataRoot = join(useTempDir("tasker-latest-"), "data");
    const issueKey = "codeguru42/tasker#9";
    const [, second] = seedTasks(dataRoot, [
      { issueKey, repoKey: "codeguru42/tasker", state: "finished", at: dayAt(1) },
      { issueKey, repoKey: "codeguru42/tasker", state: "planning", at: dayAt(2) },
    ]);

    expect(latestTaskOf(dataRoot, issueKey).id).toBe(second.id);
  });

  it("throws for an issue key with no task", () => {
    const dataRoot = join(useTempDir("tasker-latest-"), "data");
    withDataRootStore(dataRoot, () => {});

    expect((thrownBy(() => latestTaskOf(dataRoot, "codeguru42/tasker#9")) as Error).message).toBe(
      "no task of codeguru42/tasker#9",
    );
  });
});

describe("databasePathOf", () => {
  it("gives the database file that withDataRootStore opens", () => {
    const dataRoot = join(useTempDir("tasker-dbpath-"), "data");
    const [seeded] = seedTasks(dataRoot, [{ issueKey: "a/b#1", repoKey: "a/b", state: "planning", at: dayAt(1) }]);

    const found = withStoreFile(databasePathOf(dataRoot), (store) => store.getTask(seeded.id));

    expect(found?.issueKey).toBe("a/b#1");
  });
});

describe("seedTasks with more fields", () => {
  it("stores the title, base, branch and worktreePath when given", () => {
    const dir = useTempDir("tasker-seed-");
    const names = taskNames("/tmp/wt", 1, "A title");

    const [task] = seedTasks(join(dir, "data"), [
      {
        issueKey: "a/b#1",
        repoKey: "a/b",
        state: "workspace_ready",
        at: "2026-01-02T00:00:00.000Z",
        title: "A title",
        base: "main",
        branch: names.branch,
        worktreePath: names.worktree,
      },
    ]);

    expect(task).toMatchObject({
      title: "A title",
      base: "main",
      branch: names.branch,
      worktreePath: names.worktree,
    });
  });

  it("fails the task at its time with failWith", () => {
    const dir = useTempDir("tasker-seed-");
    const dataRoot = join(dir, "data");
    const at = "2026-01-04T00:00:00.000Z";

    const [task] = seedTasks(dataRoot, [
      { issueKey: "a/b#1", repoKey: "a/b", state: "executing", at, failWith: "git push failed" },
    ]);

    expect(task.state).toBe("failed");
    expect(task.updatedAt).toBe(at);
    withDataRootStore(dataRoot, (store) => {
      const last = store.listEvents(task.id).at(-1);
      expect(last).toMatchObject({
        at,
        type: "transition",
        data: { error: "git push failed", from: "executing", to: "failed" },
      });
    });
  });
});

describe("dayAt", () => {
  it("gives 00:00 UTC of a day in January 2026", () => {
    expect(dayAt(2)).toBe("2026-01-02T00:00:00.000Z");
    expect(dayAt(12)).toBe("2026-01-12T00:00:00.000Z");
  });
});

describe("writeBootstrapLog", () => {
  it("writes the text to the bootstrap log in the logs folder of the attempt of the task", () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [task] = seedTasks(dataRoot, [
      { issueKey: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", state: "workspace_ready", at: dayAt(2) },
    ]);

    writeBootstrapLog(dataRoot, task, "=== bootstrap run ===\n");

    const expected = bootstrapLogPath(taskLogsDir(dataRoot, task));
    expect(readFileSync(expected, "utf8")).toBe("=== bootstrap run ===\n");
  });
});

describe("seedVerifyRun", () => {
  const setup = () => {
    const dataRoot = join(useTempDir("tasker-seed-"), "data");
    const [task] = seedTasks(dataRoot, [{ issueKey: "a/b#1", repoKey: "a/b", state: "verifying", at: dayAt(1) }]);
    return { dataRoot, task };
  };

  it("writes the row with the defaults and the default log", () => {
    const { dataRoot, task } = setup();

    const { run, stored } = withDataRootStore(dataRoot, (store) => {
      const seeded = seedVerifyRun(store, dataRoot, task);
      return { run: seeded, stored: store.getVerifyRun(task.id, 1) };
    });

    expect(stored).toEqual(run);
    expect(run).toEqual({
      taskId: task.id,
      number: 1,
      result: "passed",
      commands: ["npm run check"],
      failingCommand: null,
      startedAt: dayAt(1),
      endedAt: dayAt(1),
    });
    expect(readFileSync(verifyCommandLogPath(dataRoot, task, 1, 1), "utf8")).toBe("$ npm run check\n--- exit code 0\n");
  });

  it("writes the given logs at the positions 1 and 2", () => {
    const { dataRoot, task } = setup();

    withDataRootStore(dataRoot, (store) =>
      seedVerifyRun(store, dataRoot, task, { commands: ["a", "b"] }, ["log one\n", "log two\n"]),
    );

    expect(readFileSync(verifyCommandLogPath(dataRoot, task, 1, 1), "utf8")).toBe("log one\n");
    expect(readFileSync(verifyCommandLogPath(dataRoot, task, 1, 2), "utf8")).toBe("log two\n");
  });

  it("seeds the number 2 on a second call", () => {
    const { dataRoot, task } = setup();

    const numbers = withDataRootStore(dataRoot, (store) => {
      const first = seedVerifyRun(store, dataRoot, task);
      const second = seedVerifyRun(store, dataRoot, task);
      return [first.number, second.number];
    });

    expect(numbers).toEqual([1, 2]);
  });

  it("ends the task in awaiting_work_review, or in the given state", () => {
    const { dataRoot, task } = setup();

    const states = withDataRootStore(dataRoot, (store) => {
      seedVerifyRun(store, dataRoot, task);
      const first = store.getTask(task.id)?.state;
      seedVerifyRun(store, dataRoot, task, {}, undefined, "failed");
      return [first, store.getTask(task.id)?.state];
    });

    expect(states).toEqual(["awaiting_work_review", "failed"]);
  });
});

describe("newVerifyRun", () => {
  const setup = () => {
    const dataRoot = join(useTempDir("tasker-seed-"), "data");
    const [task] = seedTasks(dataRoot, [{ issueKey: "a/b#1", repoKey: "a/b", state: "verifying", at: dayAt(1) }]);
    return { dataRoot, task };
  };

  it("gives the next number and the defaults", () => {
    const { dataRoot, task } = setup();

    const run = withDataRootStore(dataRoot, (store) => newVerifyRun(store, task.id));

    expect(run).toEqual({
      number: 1,
      result: "passed",
      commands: ["npm run check"],
      failingCommand: null,
      startedAt: dayAt(1),
      endedAt: dayAt(1),
    });
  });

  it("gives the number after the stored runs", () => {
    const { dataRoot, task } = setup();

    const run = withDataRootStore(dataRoot, (store) => {
      seedVerifyRun(store, dataRoot, task);
      return newVerifyRun(store, task.id);
    });

    expect(run.number).toBe(2);
  });

  it("gives the number of the change", () => {
    const { dataRoot, task } = setup();

    const run = withDataRootStore(dataRoot, (store) => newVerifyRun(store, task.id, { number: 5 }));

    expect(run.number).toBe(5);
  });

  it("replaces only the keys of the change", () => {
    const { dataRoot, task } = setup();

    const run = withDataRootStore(dataRoot, (store) =>
      newVerifyRun(store, task.id, { result: "failed", failingCommand: 1 }),
    );

    expect(run).toEqual({
      number: 1,
      result: "failed",
      commands: ["npm run check"],
      failingCommand: 1,
      startedAt: dayAt(1),
      endedAt: dayAt(1),
    });
  });
});

describe("lockNames", () => {
  it("gives the sorted names of the lock rows, and none after unlock", () => {
    const dataRoot = useTempDir("tasker-lock-names-");
    withDataRootStore(dataRoot, (store) => {
      store.tryLock("repo:b");
      store.tryLock("repo:a");
      expect(lockNames(dataRoot)).toEqual(["repo:a", "repo:b"]);

      store.unlock("repo:a");
      store.unlock("repo:b");
      expect(lockNames(dataRoot)).toEqual([]);
    });
  });
});

describe("tableRowCount", () => {
  const withTables = <T>(fn: (db: DatabaseSync) => T): T =>
    withRawDatabase(join(useTempDir("tasker-row-count-"), "t.db"), (db) => {
      db.exec("CREATE TABLE t (x); CREATE TABLE u (x)");
      return fn(db);
    });

  it("gives 0 for an empty table", () => {
    withTables((db) => expect(tableRowCount(db, "t")).toBe(0));
  });

  it("gives the number of all rows of the table", () => {
    withTables((db) => {
      db.exec("INSERT INTO t (x) VALUES (1), (1)");

      expect(tableRowCount(db, "t")).toBe(2);
    });
  });

  it("counts only the named table", () => {
    withTables((db) => {
      db.exec("INSERT INTO t (x) VALUES (1), (2); INSERT INTO u (x) VALUES (3)");

      expect(tableRowCount(db, "u")).toBe(1);
    });
  });
});

describe("withRawDatabase", () => {
  it("gives the value of fn and closes the database", () => {
    const path = join(useTempDir("tasker-raw-db-"), "t.db");
    let captured: DatabaseSync | undefined;

    const value = withRawDatabase(path, (db) => {
      captured = db;
      return db.prepare("SELECT 1 AS n").get();
    });

    expect(value).toEqual({ n: 1 });
    expect(captured?.isOpen).toBe(false);
  });

  it("keeps the database open across an await and closes it after the promise resolves", async () => {
    const path = join(useTempDir("tasker-raw-db-"), "t.db");
    let captured: DatabaseSync | undefined;
    let openInside: boolean | undefined;

    const value = await withRawDatabase(path, async (db) => {
      captured = db;
      await new Promise((done) => setTimeout(done, 5));
      openInside = db.isOpen;
      return 7;
    });

    expect(openInside).toBe(true);
    expect(value).toBe(7);
    expect(captured?.isOpen).toBe(false);
  });

  it("closes the database after the promise rejects and passes the rejection on", async () => {
    const path = join(useTempDir("tasker-raw-db-"), "t.db");
    const error = new Error("late boom");
    let captured: DatabaseSync | undefined;

    await expect(
      withRawDatabase(path, async (db) => {
        captured = db;
        await new Promise((done) => setTimeout(done, 5));
        throw error;
      }),
    ).rejects.toBe(error);

    expect(captured?.isOpen).toBe(false);
  });

  it("closes the database when fn throws and passes the error on", () => {
    const path = join(useTempDir("tasker-raw-db-"), "t.db");
    const error = new Error("boom");
    let captured: DatabaseSync | undefined;
    let caught: unknown;

    try {
      withRawDatabase(path, (db) => {
        captured = db;
        throw error;
      });
    } catch (thrown) {
      caught = thrown;
    }

    expect(caught).toBe(error);
    expect(captured?.isOpen).toBe(false);
  });
});

describe("readRunMarker", () => {
  const newTask = { issueKey: "codeguru42/tasker#6", repoKey: "tasker", state: "approved" } as const;

  it("gives the run marker row of a task that has a child pid", () => {
    const path = join(useTempDir("tasker-store-"), "tasker.db");
    const id = withStoreFile(path, (store) => {
      const task = store.createTask(newTask);
      store.startRun(task.id, "executing");
      store.setRunChildPid(task.id, 4242);
      return task.id;
    });

    expect(readRunMarker(path, id)).toMatchObject({
      task_id: id,
      state: "executing",
      pid: process.pid,
      child_pid: 4242,
    });
  });

  it("gives undefined for a task with no run marker", () => {
    const path = join(useTempDir("tasker-store-"), "tasker.db");
    const id = withStoreFile(path, (store) => store.createTask(newTask).id);

    expect(readRunMarker(path, id)).toBeUndefined();
  });
});

describe("withStoreFile", () => {
  it("gives the value of fn, and the store is closed after the call", () => {
    const path = join(useTempDir("tasker-store-"), "tasker.db");
    let captured: TaskStore | undefined;

    const value = withStoreFile(path, (store) => {
      captured = store;
      expect(store.listTasks()).toEqual([]);
      return 42;
    });

    expect(value).toBe(42);
    expect(() => captured?.listTasks()).toThrow();
    expect(existsSync(path)).toBe(true);
  });

  it("keeps the store open across an await and closes it after the promise settles", async () => {
    const path = join(useTempDir("tasker-store-"), "tasker.db");
    let captured: TaskStore | undefined;

    const value = await withStoreFile(path, async (store) => {
      captured = store;
      await Promise.resolve();
      expect(store.listTasks()).toEqual([]);
      return "done";
    });

    expect(value).toBe("done");
    expect(() => captured?.listTasks()).toThrow();
  });

  it("closes the store and throws again when fn throws", () => {
    const path = join(useTempDir("tasker-store-"), "tasker.db");
    let captured: TaskStore | undefined;

    expect(() =>
      withStoreFile(path, (store) => {
        captured = store;
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(() => captured?.listTasks()).toThrow();
  });

  it("closes the store when the promise of fn rejects", async () => {
    const path = join(useTempDir("tasker-store-"), "tasker.db");
    let captured: TaskStore | undefined;

    await expect(
      withStoreFile(path, async (store) => {
        captured = store;
        throw new Error("late boom");
      }),
    ).rejects.toThrow("late boom");
    expect(() => captured?.listTasks()).toThrow();
  });

  it("uses options.now", () => {
    const path = join(useTempDir("tasker-store-"), "tasker.db");
    const at = new Date("2026-02-03T00:00:00.000Z");

    const task = withStoreFile(path, seedTask, { now: () => at });

    expect(task.createdAt).toBe(at.toISOString());
  });

  it("opens the database at path", () => {
    const path = join(useTempDir("tasker-store-"), "tasker.db");

    const task = withStoreFile(path, seedTask);

    expect(withStoreFile(path, (store) => store.getTask(task.id))).toEqual(task);
  });
});

describe("withDataRootStore", () => {
  it("gives the value of fn, and the store is closed after the call", () => {
    const dataRoot = join(useTempDir("tasker-store-"), "data");
    let captured: TaskStore | undefined;

    const value = withDataRootStore(dataRoot, (store) => {
      captured = store;
      expect(store.listTasks()).toEqual([]);
      return 42;
    });

    expect(value).toBe(42);
    expect(() => captured?.listTasks()).toThrow();
  });

  it("keeps the store open across an await and closes it after the promise settles", async () => {
    const dataRoot = join(useTempDir("tasker-store-"), "data");
    let captured: TaskStore | undefined;

    const value = await withDataRootStore(dataRoot, async (store) => {
      captured = store;
      await Promise.resolve();
      expect(store.listTasks()).toEqual([]);
      return "done";
    });

    expect(value).toBe("done");
    expect(() => captured?.listTasks()).toThrow();
  });

  it("closes the store and throws again when fn throws", () => {
    const dataRoot = join(useTempDir("tasker-store-"), "data");
    let captured: TaskStore | undefined;

    expect(() =>
      withDataRootStore(dataRoot, (store) => {
        captured = store;
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(() => captured?.listTasks()).toThrow();
  });

  it("closes the store when the promise of fn rejects", async () => {
    const dataRoot = join(useTempDir("tasker-store-"), "data");
    let captured: TaskStore | undefined;

    await expect(
      withDataRootStore(dataRoot, async (store) => {
        captured = store;
        throw new Error("late boom");
      }),
    ).rejects.toThrow("late boom");
    expect(() => captured?.listTasks()).toThrow();
  });

  it("uses options.now", () => {
    const dataRoot = join(useTempDir("tasker-store-"), "data");
    const at = new Date("2026-02-03T00:00:00.000Z");

    const task = withDataRootStore(dataRoot, seedTask, { now: () => at });

    expect(task.createdAt).toBe(at.toISOString());
  });
});

const seedTaskIn = (state: string) => {
  const dataRoot = join(useTempDir("tasker-fail-from-"), "data");
  const [task] = seedTasks(dataRoot, [{ issueKey: "a/b#1", repoKey: "a/b", state, at: dayAt(1) }]);
  return { dataRoot, task };
};

describe("failTaskFrom", () => {
  it.each(["verifying", "provisioning", "planning"] as const)(
    "fails the task from %s with the default message",
    (origin) => {
      const { dataRoot, task } = seedTaskIn("workspace_ready");

      withDataRootStore(dataRoot, (store) => {
        failTaskFrom(store, task.id, origin);

        expect(store.getTask(task.id)?.state).toBe("failed");
        expect(failedFrom(store, task.id)).toBe(origin);
        expect(lastTransitionError(store.listEvents(task.id))).toBe(`${origin} failed: test`);
      });
    },
  );

  it("uses the given message", () => {
    const { dataRoot, task } = seedTaskIn("approved");

    withDataRootStore(dataRoot, (store) => {
      failTaskFrom(store, task.id, "executing", "boom");

      expect(failedFrom(store, task.id)).toBe("executing");
      expect(lastTransitionError(store.listEvents(task.id))).toBe("boom");
    });
  });
});

describe("failTaskVia", () => {
  it("fails the task in origin after a recorded move from before", () => {
    const { dataRoot, task } = seedTaskIn("workspace_ready");

    withDataRootStore(dataRoot, (store) => {
      failTaskVia(store, task.id, "accepted", "merging");

      expect(store.getTask(task.id)?.state).toBe("failed");
      expect(failedFrom(store, task.id)).toBe("merging");
      expect(transitionFromEvents(store.listEvents(task.id), "merging")).toBe("accepted");
      expect(lastTransitionError(store.listEvents(task.id))).toBe("merging failed: test");
    });
  });

  it("uses the given message", () => {
    const { dataRoot, task } = seedTaskIn("accepted");

    withDataRootStore(dataRoot, (store) => {
      failTaskVia(store, task.id, "accepted", "merging", "boom");

      expect(lastTransitionError(store.listEvents(task.id))).toBe("boom");
    });
  });
});

describe("pauseTaskVia", () => {
  it.each(["quota_blocked", "interrupted"] as const)("pauses the task in %s after a recorded move", (pause) => {
    const { dataRoot, task } = seedTaskIn("workspace_ready");

    withDataRootStore(dataRoot, (store) => {
      pauseTaskVia(store, task.id, "accepted", "merging", pause);

      expect(store.getTask(task.id)?.state).toBe(pause);
      expect(transitionFromEvents(store.listEvents(task.id), pause)).toBe("merging");
      expect(transitionFromEvents(store.listEvents(task.id), "merging")).toBe("accepted");
    });
  });
});

describe("failRefineFrom", () => {
  it.each(["reviewed", "failed"] as const)("fails the task in refining after a move from %s", (refineOrigin) => {
    const { dataRoot, task } = seedTaskIn("workspace_ready");

    withDataRootStore(dataRoot, (store) => {
      failRefineFrom(store, task.id, refineOrigin);

      expect(store.getTask(task.id)?.state).toBe("failed");
      expect(failedFrom(store, task.id)).toBe("refining");
      expect(transitionFromEvents(store.listEvents(task.id), "refining")).toBe(refineOrigin);
      expect(lastTransitionError(store.listEvents(task.id))).toBe("refining failed: test");
    });
  });

  it("uses the given message", () => {
    const { dataRoot, task } = seedTaskIn("reviewed");

    withDataRootStore(dataRoot, (store) => {
      failRefineFrom(store, task.id, "reviewed", "boom");

      expect(lastTransitionError(store.listEvents(task.id))).toBe("boom");
    });
  });
});

describe("pauseTaskFrom", () => {
  it.each(["quota_blocked", "awaiting_quota_approval", "interrupted"] as const)(
    "pauses the task in %s from the origin",
    (pause) => {
      const { dataRoot, task } = seedTaskIn("workspace_ready");

      withDataRootStore(dataRoot, (store) => {
        pauseTaskFrom(store, task.id, "executing", pause);

        expect(store.getTask(task.id)?.state).toBe(pause);
        expect(transitionFromEvents(store.listEvents(task.id), pause)).toBe("executing");
      });
    },
  );

  it("writes the detail of src by default", () => {
    const { dataRoot, task } = seedTaskIn("workspace_ready");

    withDataRootStore(dataRoot, (store) => {
      pauseTaskFrom(store, task.id, "planning", "quota_blocked");
      pauseTaskFrom(store, task.id, "executing", "interrupted");

      const moves = store.listEvents(task.id).filter((event) => event.type === "transition");
      expect(moves.map((event) => event.data)).toEqual([
        { cause: "rate_limit", from: "planning", to: "quota_blocked" },
        { cause: "dead_run", childPid: null, from: "executing", to: "interrupted" },
      ]);
    });
  });

  it("writes the detail of a quota warning by default in awaiting_quota_approval", () => {
    const { dataRoot, task } = seedTaskIn("workspace_ready");

    withDataRootStore(dataRoot, (store) => {
      pauseTaskFrom(store, task.id, "planning", "awaiting_quota_approval");

      expect(store.listEvents(task.id).at(-1)?.data).toEqual({
        utilization: 0.95,
        from: "planning",
        to: "awaiting_quota_approval",
      });
    });
  });

  it("writes the given detail in place of the default", () => {
    const { dataRoot, task } = seedTaskIn("workspace_ready");

    withDataRootStore(dataRoot, (store) => {
      pauseTaskFrom(store, task.id, "planning", "quota_blocked", { cause: "overage", resetsAt: 1792206000 });

      expect(store.listEvents(task.id).at(-1)?.data).toEqual({
        cause: "overage",
        resetsAt: 1792206000,
        from: "planning",
        to: "quota_blocked",
      });
    });
  });
});

describe("pauseRefineFrom", () => {
  it.each(["quota_blocked", "interrupted"] as const)("pauses the task in %s after a refine", (pause) => {
    const { dataRoot, task } = seedTaskIn("workspace_ready");

    withDataRootStore(dataRoot, (store) => {
      pauseRefineFrom(store, task.id, "reviewed", pause);

      const events = store.listEvents(task.id);
      expect(store.getTask(task.id)?.state).toBe(pause);
      expect(transitionFromEvents(events, pause)).toBe("refining");
      expect(transitionFromEvents(events, "refining")).toBe("reviewed");
    });
  });

  it("records the feedback in the move into refining", () => {
    const { dataRoot, task } = seedTaskIn("workspace_ready");

    withDataRootStore(dataRoot, (store) => {
      pauseRefineFrom(store, task.id, "awaiting_plan_review", "interrupted", "Keep the loop.");

      expect(refineFeedbackOf(store.listEvents(task.id))).toBe("Keep the loop.");
    });
  });

  it("records no feedback key when none is given", () => {
    const { dataRoot, task } = seedTaskIn("workspace_ready");

    withDataRootStore(dataRoot, (store) => {
      pauseRefineFrom(store, task.id, "reviewed", "quota_blocked");

      const move = store.listEvents(task.id).find((event) => (event.data as { to?: string }).to === "refining");
      expect(move?.data).toEqual({ from: "reviewed", to: "refining" });
    });
  });
});

describe("failVerifyRun", () => {
  it("records a failed run and fails the task from verifying, with the logs", () => {
    const dataRoot = join(useTempDir("tasker-fail-verify-"), "data");
    const [task] = seedTasks(dataRoot, [{ issueKey: "a/b#1", repoKey: "a/b", state: "executed", at: dayAt(1) }]);

    withDataRootStore(dataRoot, (store) => {
      const run = failVerifyRun(
        store,
        dataRoot,
        task,
        { result: "failed", commands: ["a", "b"], failingCommand: 2 },
        ["log one\n", "log two\n"],
        "command 2 failed",
      );

      expect(run.number).toBe(1);
      expect(store.getTask(task.id)?.state).toBe("failed");
      expect(failedFrom(store, task.id)).toBe("verifying");
      const events = store.listEvents(task.id);
      expect(events.slice(-2).map((event) => event.type)).toEqual(["verify_run", "transition"]);
      expect(events.at(-2)?.data).toMatchObject({ number: 1 });
      expect(events.at(-1)?.data).toMatchObject({ from: "verifying", to: "failed", error: "command 2 failed" });
      expect(lastTransitionError(events)).toBe("command 2 failed");
    });
    expect(readFileSync(verifyCommandLogPath(dataRoot, task, 1, 1), "utf8")).toBe("log one\n");
    expect(readFileSync(verifyCommandLogPath(dataRoot, task, 1, 2), "utf8")).toBe("log two\n");
  });
});

describe("newReview", () => {
  it("gives the number and the defaults", () => {
    expect(newReview(1)).toEqual({
      number: 1,
      revision: "4b825dc642cb",
      prompt: "review@3f9a1c04b2e7",
      startedAt: dayAt(1),
      endedAt: dayAt(1),
      findings: [
        reviewFinding(),
        reviewFinding({
          file: "src/b.ts",
          line: 9,
          summary: "The count is off by one.",
          failure_scenario: "A list of three items gives the count 2.",
        }),
      ],
    });
  });

  it("gives the number that it is given", () => {
    expect(newReview(3).number).toBe(3);
  });

  it("replaces only the keys of the change", () => {
    const findings = [reviewFinding({ file: "src/c.ts" })];

    expect(newReview(2, { findings, revision: "abc123" })).toEqual({
      ...newReview(2),
      findings,
      revision: "abc123",
    });
  });
});

describe("seedReview", () => {
  const withSeededTask = <T>(fn: (store: TaskStore, taskId: number) => T): T =>
    withStoreFile(join(useTempDir("tasker-seed-"), "tasker.db"), (store) => fn(store, seedTask(store).id));

  it("stores the defaults with two open findings", () => {
    withSeededTask((store, taskId) => {
      const review = seedReview(store, taskId);

      expect(store.getReview(taskId, 1)).toEqual(review);
      const expected = newReview(1);
      expect(review).toEqual({
        taskId,
        number: 1,
        revision: expected.revision,
        prompt: expected.prompt,
        startedAt: expected.startedAt,
        endedAt: expected.endedAt,
        findings: findingEntries(expected.findings),
      });
    });
  });

  it("seeds the number 2 on a second call", () => {
    withSeededTask((store, taskId) => {
      seedReview(store, taskId);

      expect(seedReview(store, taskId).number).toBe(2);
      expect(store.reviewCount(taskId)).toBe(2);
    });
  });

  it("ends the task in reviewed by default and in the given state", () => {
    withSeededTask((store, taskId) => {
      seedReview(store, taskId);
      expect(store.getTask(taskId)?.state).toBe("reviewed");

      seedReview(store, taskId, {}, "awaiting_work_review");
      expect(store.getTask(taskId)?.state).toBe("awaiting_work_review");
    });
  });

  it("replaces the default findings with the given findings", () => {
    withSeededTask((store, taskId) => {
      const review = seedReview(store, taskId, { findings: [reviewFinding({ file: "src/c.ts" })] });

      expect(review.findings).toHaveLength(1);
      expect(review.findings[0]?.finding.file).toBe("src/c.ts");
    });
  });
});

describe("seedTaskWithReviews", () => {
  const seed = (...args: [Parameters<typeof seedTaskWithReviews>[2]?, Parameters<typeof seedTaskWithReviews>[3]?]) => {
    const { dataRoot } = useThreeRepoDataRoot();
    const task = seedTaskWithReviews(
      dataRoot,
      { issueKey: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", state: "planning", at: dayAt(1) },
      ...args,
    );
    return { dataRoot, task };
  };

  it("seeds one review for each change and ends the task in reviewed", () => {
    const { dataRoot, task } = seed([{}, {}]);

    expect(task.state).toBe("reviewed");
    withDataRootStore(dataRoot, (store) => {
      expect(store.reviewCount(task.id)).toBe(2);
      expect(store.getTask(task.id)?.state).toBe("reviewed");
    });
  });

  it("ends the task in the given state", () => {
    const { task } = seed([{}], "awaiting_work_review");

    expect(task.state).toBe("awaiting_work_review");
  });

  it("stores the change of a review", () => {
    const { dataRoot, task } = seed([{ revision: "abc" }]);

    withDataRootStore(dataRoot, (store) => {
      expect(store.getReview(task.id, 1)?.revision).toBe("abc");
    });
  });

  it("seeds no review and keeps the state of the seed when it gets no change", () => {
    const { dataRoot, task } = seed();

    expect(task.state).toBe("planning");
    withDataRootStore(dataRoot, (store) => {
      expect(store.reviewCount(task.id)).toBe(0);
    });
  });
});

describe("reviewSessionRows", () => {
  it("gives the review sessions of the task in the order of review_number", () => {
    const dataRoot = join(useTempDir("tasker-review-rows-"), "data");
    const [first, second] = withDataRootStore(dataRoot, (store) => {
      const one = store.createTask({ issueKey: "a/b#1", repoKey: "a/b", state: "planning" });
      const two = store.createTask({ issueKey: "a/b#2", repoKey: "a/b", state: "planning" });
      seedReviewSession(store, one.id, 2, { sessionId: "review-two" });
      seedReviewSession(store, one.id, 1, { sessionId: "review-one" });
      seedPlanSession(store, one.id, { sessionId: "plan-one" });
      seedReviewSession(store, two.id, 1, { sessionId: "other-task" });
      return [one, two];
    });

    expect(reviewSessionRows(dataRoot, first.id).map((row) => [row.review_number, row.session_id])).toEqual([
      [1, "review-one"],
      [2, "review-two"],
    ]);
    expect(reviewSessionRows(dataRoot, second.id).map((row) => row.session_id)).toEqual(["other-task"]);
  });

  it("gives no rows for a task with no review session", () => {
    const dataRoot = join(useTempDir("tasker-review-rows-"), "data");
    const task = withDataRootStore(dataRoot, (store) => {
      const created = store.createTask({ issueKey: "a/b#1", repoKey: "a/b", state: "planning" });
      seedPlanSession(store, created.id, { sessionId: "plan-one" });
      return created;
    });

    expect(reviewSessionRows(dataRoot, task.id)).toEqual([]);
  });
});

describe("seedCreditsApproval", () => {
  it("records a credits_approved event with the reset time and gives the event", () => {
    const dataRoot = join(useTempDir("tasker-seed-approval-"), "data");

    const { event, events } = withDataRootStore(dataRoot, (store) => {
      const task = seedTask(store);
      return { event: seedCreditsApproval(store, task.id, 1792206000), events: store.listEvents(task.id) };
    });

    expect(event).toMatchObject({ type: "credits_approved", data: { resetsAt: 1792206000 } });
    expect(events.at(-1)).toEqual(event);
  });
});

describe("seedCreditsApprovalIn", () => {
  it("records a credits_approved event in the store of the data root and gives the event", () => {
    const dataRoot = join(useTempDir("tasker-seed-approval-in-"), "data");
    const [task] = seedTasks(dataRoot, [
      { issueKey: "codeguru42/tasker#1", repoKey: "codeguru42/tasker", state: "planning", at: dayAt(1) },
    ]);

    const event = seedCreditsApprovalIn(dataRoot, task.id, 1792206000);

    expect(event).toMatchObject({ type: "credits_approved", data: { resetsAt: 1792206000 } });
    expect(eventsOf(dataRoot, "codeguru42/tasker#1").at(-1)).toEqual({ type: event.type, data: event.data });
  });
});

describe("seedQuotaEvent", () => {
  it("records the default event of the repo with the provider claude-code and gives the record", () => {
    const dataRoot = join(useTempDir("tasker-seed-quota-"), "data");

    const record = seedQuotaEvent(dataRoot, "a/b");

    expect(record).toMatchObject({ repoKey: "a/b", provider: "claude-code", event: claudeRateLimitEvent() });
    expect(quotaEventsOf(dataRoot)).toEqual([record]);
  });

  it("records the event that it gets", () => {
    const dataRoot = join(useTempDir("tasker-seed-quota-"), "data");
    const event = claudeRateLimitEvent((info) => {
      info.utilization = 0.5;
    });

    expect(seedQuotaEvent(dataRoot, "a/b", event).event).toEqual(event);
  });
});

describe("quotaEventsOf", () => {
  it("gives the records of the data root sorted by repo key", () => {
    const dataRoot = join(useTempDir("tasker-quota-events-"), "data");
    const b = seedQuotaEvent(dataRoot, "b/repo");
    const a = seedQuotaEvent(dataRoot, "a/repo");

    expect(quotaEventsOf(dataRoot)).toEqual([a, b]);
  });

  it("gives no record for a data root with none", () => {
    const dataRoot = join(useTempDir("tasker-quota-events-"), "data");

    expect(quotaEventsOf(dataRoot)).toEqual([]);
  });
});
