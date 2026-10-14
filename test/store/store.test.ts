import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, schemaVersion } from "../../src/store/migrate.js";
import { migrations } from "../../src/store/migrations.js";
import {
  ActiveTaskError,
  openStore,
  RunMarkerExistsError,
  type Task,
  type TaskStore,
} from "../../src/store/store.js";
import { createDataRoot } from "../../src/store/layout.js";
import { TERMINAL_STATES } from "../../src/state/machine.js";
import { deadPid, useTempDir, repoRoot, seedPlanRevision, startFixture, startWriteLockHolder, readRunMarker, tableNames, thrownBy, validPlanAnswer, withRawDatabase, withStoreFile } from "../helpers.js";

// Makes a database that has only the first migrations, as an old version of tasker left it.
function makeOldDatabase(path: string, version: number): void {
  withRawDatabase(path, (db) => {
    migrate(db, migrations.slice(0, version));
    expect(schemaVersion(db)).toBe(version);
  });
}

describe("task store", () => {
  let dir: string;
  let dbPath: string;
  let clock: Date;
  let store: TaskStore;
  const now = () => clock;

  beforeEach(() => {
    dir = useTempDir("tasker-data-");
    dbPath = join(dir, "tasker.db");
    clock = new Date("2026-01-01T00:00:00.000Z");
    store = openStore(dbPath, { now });
  });

  afterEach(() => {
    store.close();
  });

  const newTask = {
    issueKey: "codeguru42/tasker#6",
    repoKey: "tasker",
    state: "new",
  };

  const eventCount = (): number =>
    withRawDatabase(dbPath, (db) => {
      const row = db.prepare("SELECT COUNT(*) AS n FROM events").get() as {
        n: number;
      };
      return row.n;
    });

  // The plan revision rows of a task, as raw rows.
  const readPlanRows = (taskId: number) =>
    withRawDatabase(dbPath, (db) =>
      db.prepare("SELECT * FROM plan_revisions WHERE task_id = ? ORDER BY version").all(taskId),
    );

  // Checks that a failed call threw message and changed no state, no marker row, no event and no plan revision row.
  const expectNothingChanged = (id: number, run: () => unknown, message: string) => {
    const state = store.getTask(id)?.state;
    const marker = readRunMarker(dbPath, id);
    const events = eventCount();
    const plans = readPlanRows(id);
    const error = thrownBy(run, message);
    expect((error as Error).message).toBe(message);
    expect(store.getTask(id)?.state).toBe(state);
    expect(readRunMarker(dbPath, id)).toEqual(marker);
    expect(eventCount()).toBe(events);
    expect(readPlanRows(id)).toEqual(plans);
  };

  // Writes a raw run marker row for a task.
  const writeRunPid = (taskId: number, state: string, pid: number, childPid: number | null = null) => {
    withRawDatabase(dbPath, (db) => {
      db.prepare(
        "INSERT INTO run_markers (task_id, state, pid, child_pid, started_at) VALUES (?, ?, ?, ?, 't')",
      ).run(taskId, state, pid, childPid);
    });
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
      return withRawDatabase(dbPath, (db) => {
        const row = db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as {
          n: number;
        };
        return row.n;
      });
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
      withRawDatabase(dbPath, (db) => {
        insertRawTask(db, "tasker", "new");
        expect(() => insertRawTask(db, "tasker", "planning")).toThrow(
          /UNIQUE constraint failed/,
        );
        const row = db
          .prepare("SELECT COUNT(*) AS n FROM tasks WHERE repo_key = 'tasker'")
          .get() as { n: number };
        expect(row.n).toBe(1);
      });
      expect(eventCount()).toBe(before);
    });

    it("permits one active row in each of two repos", () => {
      withRawDatabase(dbPath, (db) => {
        insertRawTask(db, "tasker", "planning");
        expect(() => insertRawTask(db, "other", "planning")).not.toThrow();
      });
    });

    it.each(["cancelled", "finished"])(
      "permits an active row after a %s row of the same repo and issue",
      (state) => {
        withRawDatabase(dbPath, (db) => {
          insertRawTask(db, "tasker", state);
          expect(() => insertRawTask(db, "tasker", "planning")).not.toThrow();
          const row = db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as {
            n: number;
          };
          expect(row.n).toBe(2);
        });
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
      withRawDatabase(oldPath, (raw) => {
        raw.exec(
          "INSERT INTO tasks (issue_key, repo_key, state, created_at, updated_at) VALUES ('a/b#1', 'tasker', 'planning', 't', 't')",
        );
      });
      withStoreFile(
        oldPath,
        (upgraded) => {
          expect(upgraded.getTask(1)).toMatchObject({
            attempt: 1,
            title: null,
            shortRef: null,
            base: null,
          });
        },
        { now },
      );
      withRawDatabase(oldPath, (check) => {
        expect(schemaVersion(check)).toBe(migrations.length);
      });
    });

    it("fails and keeps version 3 when two active rows share a repo and issue", () => {
      const oldPath = join(dir, "dup3.db");
      makeOldDatabase(oldPath, 3);
      withRawDatabase(oldPath, (raw) => {
        insertRawTask(raw, "tasker", "planning");
        insertRawTask(raw, "tasker", "new");
      });
      expect(() => openStore(oldPath, { now })).toThrow(/UNIQUE constraint failed/);
      withRawDatabase(oldPath, (check) => {
        expect(schemaVersion(check)).toBe(3);
        const row = check.prepare("SELECT COUNT(*) AS n FROM tasks").get() as {
          n: number;
        };
        expect(row.n).toBe(2);
      });
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
    withRawDatabase(dbPath, (db) => {
      expect(schemaVersion(db)).toBe(migrations.length);
    });
  });

  it("closes the database when the file has a newer schema version", () => {
    const newerPath = join(dir, "newer.db");
    withRawDatabase(newerPath, (raw) => {
      raw.exec(`PRAGMA user_version = ${migrations.length + 1}`);
    });

    expect(() => openStore(newerPath, { now })).toThrow(
      `database schema version ${migrations.length + 1} is newer than this tasker supports (${migrations.length})`,
    );
    // SQLite deletes the WAL file when the last connection closes.
    expect(existsSync(`${newerPath}-wal`)).toBe(false);

    withRawDatabase(newerPath, (again) => {
      again.exec("CREATE TABLE after_failure (x)");
      expect(schemaVersion(again)).toBe(migrations.length + 1);
    });
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
      withRawDatabase(dbPath, (db) => {
        expect(() => db.exec("UPDATE events SET type = 'y'")).toThrow(
          "events are append-only",
        );
        expect(() => db.exec("DELETE FROM events")).toThrow(
          "events are append-only",
        );
      });
      expect(store.listEvents(task.id)).toEqual(before);
    });

    it("upgrades a version-1 database when it opens", () => {
      const oldPath = join(dir, "old.db");
      makeOldDatabase(oldPath, 1);
      withStoreFile(
        oldPath,
        (upgraded) => {
          const task = upgraded.createTask(newTask);
          expect(upgraded.appendEvent(task.id, "note").type).toBe("note");
        },
        { now },
      );
      withRawDatabase(oldPath, (check) => {
        expect(schemaVersion(check)).toBe(migrations.length);
        expect(migrations.length).toBe(7);
      });
    });
  });

  describe("plan revisions", () => {
    const insertRawRevision = (db: DatabaseSync, taskId: number, source: string) =>
      db
        .prepare(
          "INSERT INTO plan_revisions (task_id, version, source, answer, prompt, created_at) VALUES (?, 1, ?, '{}', 'plan@000000000000', 't')",
        )
        .run(taskId, source);

    it("has the plan_revisions table", () => {
      withRawDatabase(dbPath, (db) => {
        expect(tableNames(db)).toContain("plan_revisions");
      });
    });

    it("upgrades a version-6 database and keeps the old rows", () => {
      const oldPath = join(dir, "old6.db");
      makeOldDatabase(oldPath, 6);
      withRawDatabase(oldPath, (raw) => {
        insertRawTask(raw, "tasker", "planning");
        raw
          .prepare("INSERT INTO events (task_id, at, type, data) VALUES (1, 't', 'note', NULL)")
          .run();
      });
      withStoreFile(
        oldPath,
        (upgraded) => {
          expect(upgraded.getTask(1)).toMatchObject({
            id: 1,
            issueKey: "a/b#1",
            repoKey: "tasker",
            state: "planning",
          });
          expect(upgraded.listEvents(1)).toMatchObject([{ taskId: 1, at: "t", type: "note" }]);
        },
        { now },
      );
      withRawDatabase(oldPath, (check) => {
        expect(schemaVersion(check)).toBe(migrations.length);
        expect(tableNames(check)).toContain("plan_revisions");
        check.exec("PRAGMA foreign_keys = ON");
        insertRawRevision(check, 1, "plan");
      });
    });

    const insert = (taskId: number, version: number) =>
      store.insertPlanRevision(taskId, {
        version,
        source: "plan",
        answer: validPlanAnswer(),
        prompt: "plan@000000000000",
      });

    describe("insert and read", () => {
      it("gives next version 1 for a new task and 2 after one revision", () => {
        const task = store.createTask(newTask);
        expect(store.nextPlanVersion(task.id)).toBe(1);
        seedPlanRevision(store, task.id);
        expect(store.nextPlanVersion(task.id)).toBe(2);
      });

      it("stores the answer, no feedback, no approval and the time of the clock", () => {
        const task = store.createTask(newTask);
        const revision = seedPlanRevision(store, task.id);
        expect(revision).toEqual({
          taskId: task.id,
          version: 1,
          source: "plan",
          feedback: null,
          answer: validPlanAnswer(),
          prompt: "plan@000000000000",
          approvedAt: null,
          createdAt: clock.toISOString(),
        });
        expect(store.getPlanRevision(task.id, 1)).toEqual(revision);
      });

      it("gives undefined for a missing version", () => {
        const task = store.createTask(newTask);
        seedPlanRevision(store, task.id);
        expect(store.getPlanRevision(task.id, 2)).toBeUndefined();
      });

      it("gives the highest version as the latest, and undefined with no rows", () => {
        const task = store.createTask(newTask);
        expect(store.latestPlanRevision(task.id)).toBeUndefined();
        seedPlanRevision(store, task.id);
        const second = seedPlanRevision(store, task.id, { feedback: "use main", source: "refine" });
        expect(store.latestPlanRevision(task.id)).toEqual(second);
        expect(second.feedback).toBe("use main");
      });

      it("keeps separate versions for two tasks", () => {
        const a = store.createTask(newTask);
        const b = store.createTask({ ...newTask, issueKey: "codeguru42/tasker#7" });
        seedPlanRevision(store, a.id);
        seedPlanRevision(store, a.id);
        expect(store.nextPlanVersion(b.id)).toBe(1);
        expect(seedPlanRevision(store, b.id).version).toBe(1);
      });

      it("writes no event", () => {
        const task = store.createTask(newTask);
        const before = store.listEvents(task.id);
        seedPlanRevision(store, task.id);
        expect(store.listEvents(task.id)).toEqual(before);
      });

      it("refuses a version that is not the next one", () => {
        const task = store.createTask(newTask);
        seedPlanRevision(store, task.id);
        expectNothingChanged(
          task.id,
          () => insert(task.id, 3),
          `task ${task.id}: plan revision 3 is not the next version (2)`,
        );
      });

      it("refuses a task that does not exist", () => {
        const error = thrownBy(() => insert(9999, 1));
        expect((error as Error).message).toBe("task not found: 9999");
      });
    });

    describe("approval", () => {
      const approvalEvent = (version: number) => ({ type: "approval", data: { version } });

      const approve = (taskId: number, version: number, state = "approved") =>
        store.approvePlanRevision(taskId, version, state, () => approvalEvent(version));

      const clear = (taskId: number, state = "awaiting_plan_review") =>
        store.clearPlanApproval(taskId, state, () => ({ type: "unapproval" }));

      const reviewTask = () => store.createTask({ ...newTask, state: "awaiting_plan_review" });

      it("approves the newest revision with the time of the clock", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        clock = new Date("2026-01-02T00:00:00.000Z");
        const moved = approve(task.id, 1);
        expect(moved.state).toBe("approved");
        expect(store.getPlanRevision(task.id, 1)?.approvedAt).toBe(clock.toISOString());
        expect(store.listEvents(task.id).at(-1)).toMatchObject({
          type: "approval",
          at: clock.toISOString(),
          data: { version: 1 },
        });
      });

      it("sets the new time on a second approve", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        approve(task.id, 1);
        clock = new Date("2026-01-03T00:00:00.000Z");
        approve(task.id, 1, "approved");
        expect(store.getPlanRevision(task.id, 1)?.approvedAt).toBe(clock.toISOString());
      });

      it("refuses an older revision", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        seedPlanRevision(store, task.id);
        expectNothingChanged(
          task.id,
          () => approve(task.id, 1),
          `task ${task.id}: plan revision 1 is not the newest revision (2)`,
        );
      });

      it("refuses a task with no revision", () => {
        const task = reviewTask();
        expectNothingChanged(task.id, () => approve(task.id, 1), `task ${task.id} has no plan revision 1`);
      });

      it("refuses a version that does not exist", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        expectNothingChanged(task.id, () => approve(task.id, 5), `task ${task.id} has no plan revision 5`);
      });

      it("writes nothing when check throws", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        expectNothingChanged(
          task.id,
          () =>
            store.approvePlanRevision(task.id, 1, "approved", () => {
              throw new Error("check refused");
            }),
          "check refused",
        );
      });

      it("refuses a spawning state", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        expectNothingChanged(task.id, () => approve(task.id, 1, "planning"), "planning is a spawning state");
      });

      it("refuses a task that does not exist", () => {
        const error = thrownBy(() => approve(9999, 1));
        expect((error as Error).message).toBe("task not found: 9999");
      });

      it("refuses a clear when no revision is approved", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        expectNothingChanged(task.id, () => clear(task.id), `task ${task.id} has no approved plan revision`);
      });

      it("clears the approval, moves the state and writes the event", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        approve(task.id, 1);
        clock = new Date("2026-01-04T00:00:00.000Z");
        const moved = clear(task.id);
        expect(moved.state).toBe("awaiting_plan_review");
        expect(store.getPlanRevision(task.id, 1)?.approvedAt).toBeNull();
        expect(store.pinnedPlanRevision(task.id)).toBeUndefined();
        expect(store.listEvents(task.id).at(-1)).toMatchObject({
          type: "unapproval",
          at: clock.toISOString(),
        });
      });

      it("pins the approved revision with the highest version, also after a clear", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        approve(task.id, 1);
        const firstTime = store.getPlanRevision(task.id, 1)?.approvedAt;
        seedPlanRevision(store, task.id);
        clock = new Date("2026-01-05T00:00:00.000Z");
        seedPlanRevision(store, task.id);
        approve(task.id, 3);
        expect(store.pinnedPlanRevision(task.id)?.version).toBe(3);
        clear(task.id);
        expect(store.getPlanRevision(task.id, 3)?.approvedAt).toBeNull();
        expect(store.getPlanRevision(task.id, 1)?.approvedAt).toBe(firstTime);
        expect(store.pinnedPlanRevision(task.id)?.version).toBe(1);
      });
    });

    describe("questions", () => {
      const questionsOf = (taskId: number, version: number) => store.planQuestions(taskId, version);

      const a = { id: "a", question: "Which branch?", context: "No base is named." };
      const b = { id: "b", question: "Which test runner?", context: "Two exist." };

      it("resolves a question that the next revision drops, with the feedback as the answer", () => {
        const task = store.createTask(newTask);
        seedPlanRevision(store, task.id, { answer: validPlanAnswer({ questions: [a, b] }) });
        seedPlanRevision(store, task.id, {
          source: "refine",
          feedback: "use main",
          answer: validPlanAnswer({ questions: [a] }),
        });
        expect(questionsOf(task.id, 1)).toEqual([
          { question: a, state: "open" },
          { question: b, state: "resolved", version: 2, answer: "use main" },
        ]);
      });

      it("keeps a question open when the next revision keeps its id with new text", () => {
        const task = store.createTask(newTask);
        seedPlanRevision(store, task.id, { answer: validPlanAnswer({ questions: [a] }) });
        const reworded = { ...a, question: "Which branch is the base?" };
        seedPlanRevision(store, task.id, {
          source: "refine",
          feedback: "unclear",
          answer: validPlanAnswer({ questions: [reworded] }),
        });
        expect(questionsOf(task.id, 1)).toEqual([{ question: a, state: "open" }]);
      });

      it("opens every question of the newest revision", () => {
        const task = store.createTask(newTask);
        seedPlanRevision(store, task.id, { answer: validPlanAnswer({ questions: [a, b] }) });
        expect(questionsOf(task.id, 1)).toEqual([
          { question: a, state: "open" },
          { question: b, state: "open" },
        ]);
      });

      it("refuses a revision that does not exist", () => {
        const task = store.createTask(newTask);
        const error = thrownBy(() => questionsOf(task.id, 5));
        expect((error as Error).message).toBe(`task ${task.id} has no plan revision 5`);
      });
    });

    it("keeps any source text, because the table has no check on it", () => {
      const task = store.createTask(newTask);
      withRawDatabase(dbPath, (db) => {
        insertRawRevision(db, task.id, "review");
      });
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
      withRawDatabase(dbPath, (db) => {
        expect(tableNames(db)).toContain("default_base_branches");
      });
    });

    it("upgrades a version-2 database when it opens", () => {
      const oldPath = join(dir, "old2.db");
      makeOldDatabase(oldPath, 2);
      withStoreFile(
        oldPath,
        (upgraded) => {
          upgraded.setDefaultBaseBranch("tasker", "main");
          expect(upgraded.getDefaultBaseBranch("tasker")).toBe("main");
        },
        { now },
      );
      withRawDatabase(oldPath, (check) => {
        expect(schemaVersion(check)).toBe(migrations.length);
      });
    });

    it("upgrades a version-4 database when it opens", () => {
      const oldPath = join(dir, "old4.db");
      makeOldDatabase(oldPath, 4);
      withStoreFile(
        oldPath,
        (upgraded) => {
          expect(upgraded.tryLock("x")).toEqual({ held: true });
        },
        { now },
      );
      withRawDatabase(oldPath, (check) => {
        expect(tableNames(check)).toContain("locks");
        expect(schemaVersion(check)).toBe(migrations.length);
      });
    });
  });

  describe("run markers", () => {
    it("has the run_markers table", () => {
      withRawDatabase(dbPath, (db) => {
        expect(tableNames(db)).toContain("run_markers");
      });
    });

    it("upgrades a version-5 database when it opens", () => {
      const oldPath = join(dir, "old5.db");
      makeOldDatabase(oldPath, 5);
      withStoreFile(oldPath, () => {}, { now });
      withRawDatabase(oldPath, (check) => {
        expect(schemaVersion(check)).toBe(migrations.length);
        expect(tableNames(check)).toContain("run_markers");
      });
    });

    it("keeps one marker for each task, also for raw SQL", () => {
      const task = store.createTask(newTask);
      const insert = () => {
        withRawDatabase(dbPath, (db) => {
          db.prepare(
            "INSERT INTO run_markers (task_id, state, pid, child_pid, started_at) VALUES (?, 'executing', ?, NULL, 't')",
          ).run(task.id, process.pid);
        });
      };
      insert();
      expect(insert).toThrow("UNIQUE constraint failed");
      expect(readRunMarker(dbPath, task.id)).toMatchObject({ task_id: task.id, pid: process.pid });
    });

    describe("startRun", () => {
      it("moves the task into the spawning state and writes the marker", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        const moved = store.startRun(task.id, "executing");
        expect(moved).toEqual({ ...task, state: "executing" });
        expect(store.getTask(task.id)).toEqual(moved);
        expect(readRunMarker(dbPath, task.id)).toEqual({
          task_id: task.id,
          state: "executing",
          pid: process.pid,
          child_pid: null,
          started_at: "2026-01-01T00:00:00.000Z",
        });
      });

      it("appends the event that check gives, with the time of the clock", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        store.startRun(task.id, "executing", () => ({ type: "transition", data: { to: "executing" } }));
        expect(store.listEvents(task.id).at(-1)).toMatchObject({
          type: "transition",
          at: "2026-01-01T00:00:00.000Z",
          data: { to: "executing" },
        });
      });

      it("appends no event when check gives nothing", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        const before = eventCount();
        store.startRun(task.id, "executing", () => {});
        expect(eventCount()).toBe(before);
      });

      it("refuses a state that is not a spawning state", () => {
        const task = store.createTask({ ...newTask, state: "workspace_ready" });
        expectNothingChanged(task.id, () => store.startRun(task.id, "approved"), "approved is not a spawning state");
      });

      it("throws RunMarkerExistsError when the task has a marker, also of a dead process", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        const dead = deadPid();
        writeRunPid(task.id, "executing", dead);
        expectNothingChanged(
          task.id,
          () => store.startRun(task.id, "planning"),
          `task ${task.id} already has a run marker: state executing, process ${dead}`,
        );
        expect(() => store.startRun(task.id, "planning")).toThrow(RunMarkerExistsError);
      });

      it("writes nothing when check throws", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        expectNothingChanged(
          task.id,
          () =>
            store.startRun(task.id, "executing", () => {
              throw new Error("check refused");
            }),
          "check refused",
        );
      });

      it("throws for a missing task", () => {
        expect(() => store.startRun(9999, "executing")).toThrow("task not found: 9999");
      });
    });

    describe("setRunChildPid", () => {
      it("adds the child pid to the marker of this process", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        store.startRun(task.id, "executing");
        store.setRunChildPid(task.id, 4242);
        expect(readRunMarker(dbPath, task.id)?.child_pid).toBe(4242);
      });

      it("throws when the task has no marker", () => {
        const task = store.createTask({ ...newTask, state: "executing" });
        expectNothingChanged(
          task.id,
          () => store.setRunChildPid(task.id, 4242),
          `task ${task.id} has no run marker of this process`,
        );
      });

      it("throws when the marker belongs to another process", () => {
        const task = store.createTask({ ...newTask, state: "executing" });
        writeRunPid(task.id, "executing", deadPid());
        expectNothingChanged(
          task.id,
          () => store.setRunChildPid(task.id, 4242),
          `task ${task.id} has no run marker of this process`,
        );
      });
    });

    describe("endRun", () => {
      const transition = () => ({ type: "transition", data: { to: "executed" } });

      it("moves the task out of the spawning state and deletes the marker", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        store.startRun(task.id, "executing");
        const moved = store.endRun(task.id, "executed", transition);
        expect(moved).toMatchObject({ id: task.id, state: "executed" });
        expect(store.getTask(task.id)).toEqual(moved);
        expect(readRunMarker(dbPath, task.id)).toBeUndefined();
        expect(store.listEvents(task.id).at(-1)).toMatchObject({
          type: "transition",
          at: "2026-01-01T00:00:00.000Z",
          data: { to: "executed" },
        });
      });

      it("deletes the marker of another process", () => {
        const task = store.createTask({ ...newTask, state: "executing" });
        writeRunPid(task.id, "executing", deadPid());
        store.endRun(task.id, "executed");
        expect(store.getTask(task.id)?.state).toBe("executed");
        expect(readRunMarker(dbPath, task.id)).toBeUndefined();
      });

      it("works for a task with no marker", () => {
        const task = store.createTask({ ...newTask, state: "executing" });
        expect(store.endRun(task.id, "executed").state).toBe("executed");
      });

      it("moves a task that is not in a spawning state and deletes a stale marker", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        writeRunPid(task.id, "executing", deadPid());
        const moved = store.endRun(task.id, "executed", transition);
        expect(moved).toMatchObject({ id: task.id, state: "executed" });
        expect(readRunMarker(dbPath, task.id)).toBeUndefined();
        expect(store.listEvents(task.id).at(-1)).toMatchObject({ type: "transition", data: { to: "executed" } });
      });

      it("refuses a spawning state as the target", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        store.startRun(task.id, "executing");
        expectNothingChanged(
          task.id,
          () => store.endRun(task.id, "planning"),
          "planning is a spawning state",
        );
        expect(readRunMarker(dbPath, task.id)).toBeDefined();
      });

      it("writes nothing when check throws", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        store.startRun(task.id, "executing");
        expectNothingChanged(
          task.id,
          () =>
            store.endRun(task.id, "executed", () => {
              throw new Error("check refused");
            }),
          "check refused",
        );
      });

      it("throws for a missing task", () => {
        expect(() => store.endRun(9999, "executed")).toThrow("task not found: 9999");
      });
    });

    describe("runStatus", () => {
      it("gives none for a task that is not in a spawning state, also with a marker", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        expect(store.runStatus(task.id)).toEqual({ status: "none" });
        writeRunPid(task.id, "executing", deadPid());
        expect(store.runStatus(task.id)).toEqual({ status: "none" });
      });

      it("gives running when the process of the marker is alive", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        store.startRun(task.id, "executing");
        expect(store.runStatus(task.id)).toEqual({ status: "running" });
      });

      it("gives dead with no child pid when a spawning task has no marker", () => {
        const task = store.createTask({ ...newTask, state: "executing" });
        expect(store.runStatus(task.id)).toEqual({ status: "dead", childPid: null });
      });

      it("gives dead when the process of the marker is gone, also when the child is alive", () => {
        const task = store.createTask({ ...newTask, state: "executing" });
        writeRunPid(task.id, "executing", deadPid(), process.pid);
        expect(store.runStatus(task.id)).toEqual({ status: "dead", childPid: process.pid });
      });

      it("sees a process of another tasker end", async () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        const child = startFixture("run-starter.ts", [dbPath, String(task.id), "executing"]);
        expect(await child.firstLine).toBe("started");
        expect(store.runStatus(task.id)).toEqual({ status: "running" });
        process.kill(child.pid, "SIGKILL");
        await child.exited;
        expect(store.runStatus(task.id)).toEqual({ status: "dead", childPid: null });
      }, 20_000);

      it("waits for the write lock", async () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        await startWriteLockHolder(dbPath, 500);
        const start = Date.now();
        store.runStatus(task.id);
        expect(Date.now() - start).toBeGreaterThanOrEqual(400);
      }, 20_000);

      it("throws for a missing task", () => {
        expect(() => store.runStatus(9999)).toThrow("task not found: 9999");
      });
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

      withStoreFile(layout.database, (reader) => {
        withRawDatabase(layout.database, (db) => {
          const tasks = db.prepare("SELECT id FROM tasks").all() as { id: number }[];
          expect(tasks).toHaveLength(2);
          for (const { id } of tasks) {
            expect(reader.listEvents(id)).toHaveLength(count + 1);
            expect(reader.getTask(id)?.state).toBe(String(count - 1));
          }
          expect(schemaVersion(db)).toBe(migrations.length);
        });
      });
    },
    60_000,
  );
});

describe("open of a new database", () => {
  it(
    "waits for another process that holds the write lock of a new database",
    async () => {
      const path = join(useTempDir("tasker-open-"), "tasker.db");
      await startWriteLockHolder(path, 500);

      withStoreFile(path, () => {});

      withRawDatabase(path, (db) => {
        expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
        expect(schemaVersion(db)).toBe(migrations.length);
      });
    },
    20_000,
  );

  it(
    "throws database is locked after the busy timeout when the write lock of a new database stays taken",
    async () => {
      const path = join(useTempDir("tasker-open-"), "tasker.db");
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
      const path = join(useTempDir("tasker-open-"), "tasker.db");
      writeFileSync(path, "x".repeat(4096));

      const start = Date.now();
      expect(() => openStore(path)).toThrow("file is not a database");
      expect(Date.now() - start).toBeLessThan(1000);
    },
    20_000,
  );
});
