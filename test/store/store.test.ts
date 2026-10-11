import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/store/migrations.js";
import { schemaVersion } from "../../src/store/migrate.js";
import { openStore, type TaskStore } from "../../src/store/store.js";
import { makeTempDir } from "../helpers.js";

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
});
