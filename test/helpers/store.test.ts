import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { bootstrapLogPath } from "../../src/phases/bootstrap.js";
import { taskLogsDir, verifyCommandLogPath } from "../../src/store/layout.js";
import type { TaskStore } from "../../src/store/store.js";
import { thrownBy } from "./errors.js";
import { useTempDir } from "./temp.js";
import { useThreeRepoDataRoot } from "./config.js";
import { taskNames } from "./git.js";
import {
  dayAt,
  databasePathOf,
  eventsOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  seedTask,
  seedTasks,
  seedVerifyRun,
  withDataRootStore,
  withRawDatabase,
  withStoreFile,
  writeBootstrapLog,
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
      expect(store.listTasks({ states: ["planning", "finished"] }).map((t) => t.id)).toEqual(
        tasks.map((t) => t.id),
      );
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
    const [seeded] = seedTasks(dataRoot, [
      { issueKey: "a/b#1", repoKey: "a/b", state: "planning", at: dayAt(1) },
    ]);

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
