import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, schemaVersion } from "../../src/store/migrate.js";
import { migrations } from "../../src/store/migrations.js";
import {
  ActiveTaskError,
  openStore,
  type Task,
  type TaskStore,
} from "../../src/store/store.js";
import { createDataRoot } from "../../src/store/layout.js";
import { TERMINAL_STATES } from "../../src/state/machine.js";
import { makeTempDir, repoRoot, startWriteLockHolder, tableNames } from "../helpers.js";

// Makes a database that has only the first migrations, as an old version of tasker left it.
function makeOldDatabase(path: string, version: number): void {
  const db = new DatabaseSync(path);
  try {
    migrate(db, migrations.slice(0, version));
    expect(schemaVersion(db)).toBe(version);
  } finally {
    db.close();
  }
}

describe("task store", () => {
  let dir: string;
  let dbPath: string;
  let clock: Date;
  let store: TaskStore;
  const now = () => clock;

  beforeEach(() => {
    dir = makeTempDir("tasker-data-");
    dbPath = join(dir, "tasker.db");
    clock = new Date("2026-01-01T00:00:00.000Z");
    store = openStore(dbPath, { now });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const newTask = {
    issueKey: "codeguru42/tasker#6",
    repoKey: "tasker",
    state: "new",
  };

  const rawDb = () => new DatabaseSync(dbPath);

  const eventCount = (): number => {
    const db = rawDb();
    try {
      const row = db.prepare("SELECT COUNT(*) AS n FROM events").get() as {
        n: number;
      };
      return row.n;
    } finally {
      db.close();
    }
  };

  // The raw run marker row of a task, or undefined.
  const readRun = (taskId: number) => {
    const db = rawDb();
    try {
      return db.prepare("SELECT * FROM run_markers WHERE task_id = ?").get(taskId) as
        | { task_id: number; state: string; pid: number; child_pid: number | null; started_at: string }
        | undefined;
    } finally {
      db.close();
    }
  };

  const insertRawTask = (db: DatabaseSync, repoKey: string, state: string) =>
    db
      .prepare(
        "INSERT INTO tasks (issue_key, repo_key, state, created_at, updated_at) VALUES ('a/b#1', ?, ?, 't', 't')",
      )
      .run(repoKey, state);

  it("creates a task with equal timestamps and no branch", () => {
    const task = store.createTask(newTask);
    expect(typeof task.id).toBe("number");
    expect(task).toEqual({
      id: task.id,
      ...newTask,
      branch: null,
      worktreePath: null,
      title: null,
      shortRef: null,
      base: null,
      attempt: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("stores the title, short ref and base of a new task", () => {
    const task = store.createTask({
      ...newTask,
      title: "Add a store",
      shortRef: "t6",
      base: "main",
    });
    expect(task).toMatchObject({ title: "Add a store", shortRef: "t6", base: "main" });
    expect(store.getTask(task.id)).toEqual(task);
  });

  it("sets the title, short ref and base, and clears each with null", () => {
    const task = store.createTask({ ...newTask, branch: "issue-6" });
    const set = store.updateTask(task.id, {
      title: "T",
      shortRef: "r",
      base: "main",
    });
    expect(set).toMatchObject({ title: "T", shortRef: "r", base: "main", branch: "issue-6" });
    const kept = store.updateTask(task.id, { state: "planned" });
    expect(kept).toMatchObject({ title: "T", shortRef: "r", base: "main" });
    const cleared = store.updateTask(task.id, {
      title: null,
      shortRef: null,
      base: null,
    });
    expect(cleared).toMatchObject({
      title: null,
      shortRef: null,
      base: null,
      branch: "issue-6",
    });
    expect(store.getTask(task.id)).toEqual(cleared);
  });

  describe("attempts", () => {
    it("gives attempt 1 to the first task of an issue", () => {
      expect(store.createTask(newTask).attempt).toBe(1);
    });

    it("counts one more after a cancelled task and after a finished task", () => {
      const first = store.createTask(newTask);
      store.updateTask(first.id, { state: "cancelled" });
      const second = store.createTask(newTask);
      expect(second.attempt).toBe(2);
      store.updateTask(second.id, { state: "finished" });
      expect(store.createTask(newTask).attempt).toBe(3);
    });

    it("continues the count in another repo with the same issue key", () => {
      const first = store.createTask(newTask);
      store.updateTask(first.id, { state: "cancelled" });
      expect(store.createTask({ ...newTask, repoKey: "other" }).attempt).toBe(2);
    });

    it("starts another issue at 1", () => {
      const first = store.createTask(newTask);
      store.updateTask(first.id, { state: "cancelled" });
      const other = store.createTask({ ...newTask, issueKey: "codeguru42/tasker#99" });
      expect(other.attempt).toBe(1);
    });

    it("keeps the attempt when an update names one", () => {
      const task = store.createTask(newTask);
      // @ts-expect-error attempt is not a field of TaskChanges
      store.updateTask(task.id, { attempt: 5 });
      expect(store.getTask(task.id)?.attempt).toBe(1);
    });
  });

  describe("one active task for each issue", () => {
    const rowCount = (): number => {
      const db = rawDb();
      try {
        const row = db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as {
          n: number;
        };
        return row.n;
      } finally {
        db.close();
      }
    };

    it("refuses a second active task for the same repo and issue", () => {
      const first = store.createTask(newTask);
      const events = eventCount();
      let caught: unknown;
      try {
        store.createTask(newTask);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ActiveTaskError);
      expect((caught as ActiveTaskError).taskId).toBe(first.id);
      const message = (caught as ActiveTaskError).message;
      expect(message).toContain(newTask.issueKey);
      expect(message).toContain(newTask.repoKey);
      expect(message).toContain("new");
      expect(rowCount()).toBe(1);
      expect(store.getTask(first.id)).toEqual(first);
      expect(eventCount()).toBe(events);
    });

    it("permits the same issue in another repo", () => {
      store.createTask(newTask);
      const other = store.createTask({ ...newTask, repoKey: "other" });
      expect(other.repoKey).toBe("other");
      expect(rowCount()).toBe(2);
    });

    it.each(["cancelled", "finished"])(
      "creates a new active task after the first task is %s",
      (state) => {
        const first = store.createTask(newTask);
        store.updateTask(first.id, { state });
        const second = store.createTask(newTask);
        expect(second.id).not.toBe(first.id);
        expect(second.state).toBe("new");
        expect(rowCount()).toBe(2);
      },
    );
  });

  describe("find the active task and the latest task", () => {
    const find = { repo: "tasker", issue: "codeguru42/tasker#6" };

    it("finds no active task when the issue has no task", () => {
      expect(store.findActiveTask(find.repo, find.issue)).toBeUndefined();
    });

    it("finds the active task", () => {
      const task = store.createTask(newTask);
      expect(store.findActiveTask(find.repo, find.issue)).toEqual(task);
    });

    it("finds no active task when the only task is cancelled", () => {
      const task = store.createTask(newTask);
      store.updateTask(task.id, { state: "cancelled" });
      expect(store.findActiveTask(find.repo, find.issue)).toBeUndefined();
    });

    it("ignores the active task of the same issue in another repo", () => {
      store.createTask({ ...newTask, repoKey: "other" });
      expect(store.findActiveTask(find.repo, find.issue)).toBeUndefined();
    });

    it("finds no latest task when the issue has no task", () => {
      expect(store.findLatestTask(find.repo, find.issue)).toBeUndefined();
    });

    it("finds the inactive task with the highest id", () => {
      const a = store.createTask(newTask);
      store.updateTask(a.id, { state: "cancelled" });
      const b = store.createTask(newTask);
      const finished = store.updateTask(b.id, { state: "finished" });
      expect(store.findLatestTask(find.repo, find.issue)).toEqual(finished);
    });

    it("prefers the active task over an inactive task with a higher id", () => {
      const active = store.createTask(newTask);
      store.createTask({ ...newTask, state: "finished" });
      expect(store.findLatestTask(find.repo, find.issue)).toEqual(active);
    });

    it("ignores the tasks of another repo", () => {
      store.createTask({ ...newTask, repoKey: "other" });
      expect(store.findLatestTask(find.repo, find.issue)).toBeUndefined();
    });
  });

  describe("list tasks", () => {
    const issueA = "codeguru42/tasker#6";
    const issueB = "codeguru42/tasker#99";
    const ids = (tasks: Task[]) => tasks.map((t) => t.id);

    it("lists only the active tasks when there is no filter", () => {
      const done = store.createTask(newTask);
      store.updateTask(done.id, { state: "cancelled" });
      const active = store.createTask(newTask);
      store.createTask({ ...newTask, state: "finished" });
      expect(ids(store.listTasks())).toEqual([active.id]);
    });

    it("filters by repo key, by issue key and by both", () => {
      const a = store.createTask(newTask);
      const b = store.createTask({ ...newTask, issueKey: issueB });
      const c = store.createTask({ ...newTask, repoKey: "other" });
      expect(ids(store.listTasks({ repoKey: "other" }))).toEqual([c.id]);
      expect(ids(store.listTasks({ issueKey: issueB }))).toEqual([b.id]);
      expect(ids(store.listTasks({ issueKey: issueA }))).toEqual([c.id, a.id]);
      expect(
        ids(store.listTasks({ repoKey: "tasker", issueKey: issueA })),
      ).toEqual([a.id]);
    });

    it("lists the tasks in the given states", () => {
      const cancelled = store.createTask(newTask);
      store.updateTask(cancelled.id, { state: "cancelled" });
      const active = store.createTask(newTask);
      const finished = store.createTask({ ...newTask, state: "finished" });
      expect(ids(store.listTasks({ states: ["cancelled"] }))).toEqual([
        cancelled.id,
      ]);
      expect(ids(store.listTasks({ states: ["new", "finished"] }))).toEqual([
        finished.id,
        active.id,
      ]);
    });

    it("lists no task when states is an empty array", () => {
      store.createTask(newTask);
      expect(store.listTasks({ states: [] })).toEqual([]);
    });

    it("puts the task that changed last first, even with a lower id", () => {
      const a = store.createTask(newTask);
      const b = store.createTask({ ...newTask, issueKey: issueB });
      clock = new Date("2026-01-02T00:00:00.000Z");
      store.updateTask(a.id, { state: "planned" });
      expect(ids(store.listTasks())).toEqual([a.id, b.id]);
    });

    it("puts the higher id first when the update times are equal", () => {
      const a = store.createTask(newTask);
      const b = store.createTask({ ...newTask, issueKey: issueB });
      expect(ids(store.listTasks())).toEqual([b.id, a.id]);
    });
  });

  describe("active task index", () => {
    it("rejects a second active row for one repo and issue", () => {
      const before = eventCount();
      const db = rawDb();
      try {
        insertRawTask(db, "tasker", "new");
        expect(() => insertRawTask(db, "tasker", "planning")).toThrow(
          /UNIQUE constraint failed/,
        );
        const row = db
          .prepare("SELECT COUNT(*) AS n FROM tasks WHERE repo_key = 'tasker'")
          .get() as { n: number };
        expect(row.n).toBe(1);
      } finally {
        db.close();
      }
      expect(eventCount()).toBe(before);
    });

    it("permits one active row in each of two repos", () => {
      const db = rawDb();
      try {
        insertRawTask(db, "tasker", "planning");
        expect(() => insertRawTask(db, "other", "planning")).not.toThrow();
      } finally {
        db.close();
      }
    });

    it.each(["cancelled", "finished"])(
      "permits an active row after a %s row of the same repo and issue",
      (state) => {
        const db = rawDb();
        try {
          insertRawTask(db, "tasker", state);
          expect(() => insertRawTask(db, "tasker", "planning")).not.toThrow();
          const row = db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as {
            n: number;
          };
          expect(row.n).toBe(2);
        } finally {
          db.close();
        }
      },
    );

    it("lists in the migration the same states as TERMINAL_STATES", () => {
      const list = /NOT IN \(([^)]*)\)/.exec(migrations[3])?.[1] ?? "";
      const states = list
        .split(",")
        .map((s) => s.trim().replace(/^'|'$/g, ""))
        .sort();
      expect(states).toEqual([...TERMINAL_STATES].sort());
    });
  });

  describe("upgrade from version 3", () => {
    it("gives old rows attempt 1 and null fields", () => {
      const oldPath = join(dir, "old3.db");
      makeOldDatabase(oldPath, 3);
      const raw = new DatabaseSync(oldPath);
      try {
        raw.exec(
          "INSERT INTO tasks (issue_key, repo_key, state, created_at, updated_at) VALUES ('a/b#1', 'tasker', 'planning', 't', 't')",
        );
      } finally {
        raw.close();
      }
      const upgraded = openStore(oldPath, { now });
      try {
        expect(upgraded.getTask(1)).toMatchObject({
          attempt: 1,
          title: null,
          shortRef: null,
          base: null,
        });
      } finally {
        upgraded.close();
      }
      const check = new DatabaseSync(oldPath);
      try {
        expect(schemaVersion(check)).toBe(migrations.length);
      } finally {
        check.close();
      }
    });

    it("fails and keeps version 3 when two active rows share a repo and issue", () => {
      const oldPath = join(dir, "dup3.db");
      makeOldDatabase(oldPath, 3);
      const raw = new DatabaseSync(oldPath);
      try {
        insertRawTask(raw, "tasker", "planning");
        insertRawTask(raw, "tasker", "new");
      } finally {
        raw.close();
      }
      expect(() => openStore(oldPath, { now })).toThrow(/UNIQUE constraint failed/);
      const check = new DatabaseSync(oldPath);
      try {
        expect(schemaVersion(check)).toBe(3);
        const row = check.prepare("SELECT COUNT(*) AS n FROM tasks").get() as {
          n: number;
        };
        expect(row.n).toBe(2);
      } finally {
        check.close();
      }
    });
  });

  it("reads a task back, and returns undefined for a missing id", () => {
    const task = store.createTask(newTask);
    expect(store.getTask(task.id)).toEqual(task);
    expect(store.getTask(999)).toBeUndefined();
  });

  it("updates the changed fields and keeps createdAt", () => {
    const task = store.createTask(newTask);
    clock = new Date("2026-01-02T00:00:00.000Z");
    const updated = store.updateTask(task.id, {
      state: "planned",
      branch: "issue-6",
      worktreePath: "/w",
    });
    expect(updated).toEqual({
      ...task,
      state: "planned",
      branch: "issue-6",
      worktreePath: "/w",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(store.getTask(task.id)).toEqual(updated);
  });

  it("throws when the task to update does not exist", () => {
    expect(() => store.updateTask(999, { state: "x" })).toThrow(
      "task not found: 999",
    );
  });

  it("passes the current task to the check", () => {
    const task = store.createTask(newTask);
    let seen: Task | undefined;
    store.updateTask(task.id, { state: "planned" }, (current) => {
      seen = current;
    });
    expect(seen).toEqual(task);
  });

  it("appends the event that the check returns, with the update time", () => {
    const task = store.createTask(newTask);
    clock = new Date("2026-01-02T00:00:00.000Z");
    store.updateTask(task.id, { state: "planned" }, () => ({
      type: "x",
      data: { n: 1 },
    }));
    expect(store.listEvents(task.id).at(-1)).toEqual({
      id: expect.any(Number),
      taskId: task.id,
      at: "2026-01-02T00:00:00.000Z",
      type: "x",
      data: { n: 1 },
    });
  });

  it("appends no event when the check returns nothing", () => {
    const task = store.createTask(newTask);
    const before = eventCount();
    store.updateTask(task.id, { state: "planned" }, () => {});
    expect(eventCount()).toBe(before);
  });

  it("writes no row and no event when the check throws", () => {
    const task = store.createTask(newTask);
    const before = eventCount();
    const error = new Error("no");
    expect(() =>
      store.updateTask(task.id, { state: "planned" }, () => {
        throw error;
      }),
    ).toThrow(error);
    expect(store.getTask(task.id)).toEqual(task);
    expect(eventCount()).toBe(before);
  });

  it("keeps the row and rethrows when the check throws", () => {
    const task = store.createTask(newTask);
    clock = new Date("2026-01-02T00:00:00.000Z");
    const error = new Error("no");
    let caught: unknown;
    try {
      store.updateTask(task.id, { state: "planned" }, () => {
        throw error;
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
    expect(store.getTask(task.id)).toEqual(task);
  });

  it("reads the task again after a reopen", () => {
    const task = store.createTask(newTask);
    store.close();
    store = openStore(dbPath, { now });
    expect(store.getTask(task.id)).toEqual(task);
    const db = new DatabaseSync(dbPath);
    try {
      expect(schemaVersion(db)).toBe(migrations.length);
    } finally {
      db.close();
    }
  });

  it("closes the database when the file has a newer schema version", () => {
    const newerPath = join(dir, "newer.db");
    const raw = new DatabaseSync(newerPath);
    raw.exec(`PRAGMA user_version = ${migrations.length + 1}`);
    raw.close();

    expect(() => openStore(newerPath, { now })).toThrow(
      `database schema version ${migrations.length + 1} is newer than this tasker supports (${migrations.length})`,
    );
    // SQLite deletes the WAL file when the last connection closes.
    expect(existsSync(`${newerPath}-wal`)).toBe(false);

    const again = new DatabaseSync(newerPath);
    try {
      again.exec("CREATE TABLE after_failure (x)");
      expect(schemaVersion(again)).toBe(migrations.length + 1);
    } finally {
      again.close();
    }
  });

  describe("events", () => {
    it("writes one created event when a task is created", () => {
      const task = store.createTask(newTask);
      expect(store.listEvents(task.id)).toEqual([
        {
          id: expect.any(Number),
          taskId: task.id,
          at: "2026-01-01T00:00:00.000Z",
          type: "created",
          data: { state: "new" },
        },
      ]);
    });

    it("writes no event when a create is refused", () => {
      store.createTask(newTask);
      const before = eventCount();
      expect(() => store.createTask(newTask)).toThrow(ActiveTaskError);
      expect(eventCount()).toBe(before);
    });

    it("appends an event with the time and the JSON data", () => {
      const task = store.createTask(newTask);
      const event = store.appendEvent(task.id, "state-changed", {
        from: "new",
        to: "planned",
      });
      expect(event).toEqual({
        id: event.id,
        taskId: task.id,
        at: "2026-01-01T00:00:00.000Z",
        type: "state-changed",
        data: { from: "new", to: "planned" },
      });
    });

    it("stores null data when the event has none", () => {
      const task = store.createTask(newTask);
      const event = store.appendEvent(task.id, "note");
      expect(event.data).toBeNull();
      expect(store.listEvents(task.id).at(-1)?.data).toBeNull();
    });

    it("lists the events of one task in the order they were added", () => {
      const a = store.createTask(newTask);
      const b = store.createTask({ ...newTask, issueKey: "codeguru42/tasker#99" });
      store.appendEvent(a.id, "one");
      store.appendEvent(b.id, "other");
      store.appendEvent(a.id, "two", { n: 2 });
      const events = store.listEvents(a.id);
      expect(events.map((event) => event.type)).toEqual([
        "created",
        "one",
        "two",
      ]);
      expect(events[2].id).toBeGreaterThan(events[1].id);
      expect(events[2].data).toEqual({ n: 2 });
    });

    it("throws when the task of the event does not exist", () => {
      expect(() => store.appendEvent(999, "x")).toThrow();
    });

    it("rejects a raw UPDATE or DELETE and keeps the events", () => {
      const task = store.createTask(newTask);
      store.appendEvent(task.id, "one");
      const before = store.listEvents(task.id);
      const db = new DatabaseSync(dbPath);
      try {
        expect(() => db.exec("UPDATE events SET type = 'y'")).toThrow(
          "events are append-only",
        );
        expect(() => db.exec("DELETE FROM events")).toThrow(
          "events are append-only",
        );
      } finally {
        db.close();
      }
      expect(store.listEvents(task.id)).toEqual(before);
    });

    it("upgrades a version-1 database when it opens", () => {
      const oldPath = join(dir, "old.db");
      makeOldDatabase(oldPath, 1);
      const upgraded = openStore(oldPath, { now });
      try {
        const task = upgraded.createTask(newTask);
        expect(upgraded.appendEvent(task.id, "note").type).toBe("note");
      } finally {
        upgraded.close();
      }
      const check = new DatabaseSync(oldPath);
      try {
        expect(schemaVersion(check)).toBe(migrations.length);
        expect(migrations.length).toBe(6);
      } finally {
        check.close();
      }
    });
  });

  describe("default base branch", () => {
    it("reads undefined on a new store", () => {
      expect(store.getDefaultBaseBranch("tasker")).toBeUndefined();
    });

    it("saves a value and replaces it with a second save", () => {
      store.setDefaultBaseBranch("tasker", "main");
      expect(store.getDefaultBaseBranch("tasker")).toBe("main");
      store.setDefaultBaseBranch("tasker", "develop");
      expect(store.getDefaultBaseBranch("tasker")).toBe("develop");
    });

    it("keeps one value for each repo key", () => {
      store.setDefaultBaseBranch("tasker", "main");
      store.setDefaultBaseBranch("other", "develop");
      expect(store.getDefaultBaseBranch("tasker")).toBe("main");
      expect(store.getDefaultBaseBranch("other")).toBe("develop");
    });

    it("forgets a stored value when the branch matches", () => {
      store.setDefaultBaseBranch("tasker", "main");
      store.forgetDefaultBaseBranch("tasker", "main");
      expect(store.getDefaultBaseBranch("tasker")).toBeUndefined();
    });

    it("keeps a stored value when the branch differs", () => {
      store.setDefaultBaseBranch("tasker", "main");
      store.forgetDefaultBaseBranch("tasker", "old");
      expect(store.getDefaultBaseBranch("tasker")).toBe("main");
    });

    it("keeps the value after a reopen", () => {
      store.setDefaultBaseBranch("tasker", "main");
      store.close();
      store = openStore(dbPath, { now });
      expect(store.getDefaultBaseBranch("tasker")).toBe("main");
    });

    it("has the default_base_branches table", () => {
      const db = new DatabaseSync(dbPath);
      try {
        expect(tableNames(db)).toContain("default_base_branches");
      } finally {
        db.close();
      }
    });

    it("upgrades a version-2 database when it opens", () => {
      const oldPath = join(dir, "old2.db");
      makeOldDatabase(oldPath, 2);
      const upgraded = openStore(oldPath, { now });
      try {
        upgraded.setDefaultBaseBranch("tasker", "main");
        expect(upgraded.getDefaultBaseBranch("tasker")).toBe("main");
      } finally {
        upgraded.close();
      }
      const check = new DatabaseSync(oldPath);
      try {
        expect(schemaVersion(check)).toBe(migrations.length);
      } finally {
        check.close();
      }
    });

    it("upgrades a version-4 database when it opens", () => {
      const oldPath = join(dir, "old4.db");
      makeOldDatabase(oldPath, 4);
      const upgraded = openStore(oldPath, { now });
      try {
        expect(upgraded.tryLock("x")).toEqual({ held: true });
      } finally {
        upgraded.close();
      }
      const check = new DatabaseSync(oldPath);
      try {
        expect(tableNames(check)).toContain("locks");
        expect(schemaVersion(check)).toBe(migrations.length);
      } finally {
        check.close();
      }
    });
  });

  describe("run markers", () => {
    it("has the run_markers table", () => {
      const db = rawDb();
      try {
        expect(tableNames(db)).toContain("run_markers");
      } finally {
        db.close();
      }
    });

    it("upgrades a version-5 database when it opens", () => {
      const oldPath = join(dir, "old5.db");
      makeOldDatabase(oldPath, 5);
      openStore(oldPath, { now }).close();
      const check = new DatabaseSync(oldPath);
      try {
        expect(schemaVersion(check)).toBe(migrations.length);
        expect(tableNames(check)).toContain("run_markers");
      } finally {
        check.close();
      }
    });

    it("keeps one marker for each task, also for raw SQL", () => {
      const task = store.createTask(newTask);
      const insert = () => {
        const db = rawDb();
        try {
          db.prepare(
            "INSERT INTO run_markers (task_id, state, pid, child_pid, started_at) VALUES (?, 'executing', ?, NULL, 't')",
          ).run(task.id, process.pid);
        } finally {
          db.close();
        }
      };
      insert();
      expect(insert).toThrow("UNIQUE constraint failed");
      expect(readRun(task.id)).toMatchObject({ task_id: task.id, pid: process.pid });
    });
  });

  it(
    "lets two processes write to one new database at once",
    async () => {
      const layout = createDataRoot(join(dir, "root"));
      const count = 300;
      const run = (issueKey: string) =>
        new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              "--import",
              "tsx",
              "test/fixtures/store-writer.ts",
              layout.database,
              issueKey,
              String(count),
            ],
            { cwd: repoRoot },
          );
          let stderr = "";
          child.stderr.on("data", (chunk) => (stderr += chunk));
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, stderr }));
        });

      const results = await Promise.all([run("a/b#1"), run("a/b#2")]);
      for (const result of results) {
        expect(result.stderr).not.toContain("database is locked");
        expect(result.code).toBe(0);
      }

      const reader = openStore(layout.database);
      const db = new DatabaseSync(layout.database);
      try {
        const tasks = db.prepare("SELECT id FROM tasks").all() as { id: number }[];
        expect(tasks).toHaveLength(2);
        for (const { id } of tasks) {
          expect(reader.listEvents(id)).toHaveLength(count + 1);
          expect(reader.getTask(id)?.state).toBe(String(count - 1));
        }
        expect(schemaVersion(db)).toBe(migrations.length);
      } finally {
        db.close();
        reader.close();
      }
    },
    60_000,
  );
});

describe("open of a new database", () => {
  it(
    "waits for another process that holds the write lock of a new database",
    async () => {
      const path = join(makeTempDir("tasker-open-"), "tasker.db");
      await startWriteLockHolder(path, 500);

      const store = openStore(path);
      store.close();

      const db = new DatabaseSync(path);
      try {
        expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
        expect(schemaVersion(db)).toBe(migrations.length);
      } finally {
        db.close();
      }
    },
    20_000,
  );

  it(
    "throws database is locked after the busy timeout when the write lock of a new database stays taken",
    async () => {
      const path = join(makeTempDir("tasker-open-"), "tasker.db");
      await startWriteLockHolder(path, 8000);

      const start = Date.now();
      expect(() => openStore(path)).toThrow("database is locked");
      expect(Date.now() - start).toBeGreaterThanOrEqual(4500);
    },
    20_000,
  );

  it(
    "fails at once on an error that is not SQLITE_BUSY on the switch to WAL",
    () => {
      const path = join(makeTempDir("tasker-open-"), "tasker.db");
      writeFileSync(path, "x".repeat(4096));

      const start = Date.now();
      expect(() => openStore(path)).toThrow("file is not a database");
      expect(Date.now() - start).toBeLessThan(1000);
    },
    20_000,
  );
});
