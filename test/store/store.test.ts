import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, schemaVersion } from "../../src/store/migrate.js";
import { migrations } from "../../src/store/migrations.js";
import { openStore, type TaskStore } from "../../src/store/store.js";
import { createDataRoot } from "../../src/store/layout.js";
import { makeTempDir, repoRoot } from "../helpers.js";

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

  it("creates a task with equal timestamps and no branch", () => {
    const task = store.createTask(newTask);
    expect(typeof task.id).toBe("number");
    expect(task).toEqual({
      id: task.id,
      ...newTask,
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
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

  it("allows two tasks for the same repo and issue", () => {
    const first = store.createTask(newTask);
    const second = store.createTask(newTask);
    expect(second.id).not.toBe(first.id);
    expect(store.getTask(first.id)).toEqual(first);
    expect(store.getTask(second.id)).toEqual(second);
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
      expect(store.listEvents(task.id)[0].data).toBeNull();
    });

    it("lists the events of one task in the order they were added", () => {
      const a = store.createTask(newTask);
      const b = store.createTask(newTask);
      store.appendEvent(a.id, "one");
      store.appendEvent(b.id, "other");
      store.appendEvent(a.id, "two", { n: 2 });
      const events = store.listEvents(a.id);
      expect(events.map((event) => event.type)).toEqual(["one", "two"]);
      expect(events[1].id).toBeGreaterThan(events[0].id);
      expect(events[1].data).toEqual({ n: 2 });
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
      const db = new DatabaseSync(oldPath);
      try {
        migrate(db, migrations.slice(0, 1));
        expect(schemaVersion(db)).toBe(1);
      } finally {
        db.close();
      }
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
        expect(migrations.length).toBe(2);
      } finally {
        check.close();
      }
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
          expect(reader.listEvents(id)).toHaveLength(count);
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
