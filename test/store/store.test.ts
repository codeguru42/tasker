import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, schemaVersion } from "../../src/store/migrate.js";
import { migrations } from "../../src/store/migrations.js";
import {
  ActiveTaskError,
  openStore,
  RunMarkerExistsError,
  type ExecuteTodoState,
  type NewExecuteFixTurn,
  type NewReview,
  type NewSession,
  type NewVerifyRun,
  type Task,
  type TaskStore,
  type VerifyRunResult,
} from "../../src/store/store.js";
import { createDataRoot } from "../../src/store/layout.js";
import { TERMINAL_STATES } from "../../src/state/machine.js";
import { thrownBy } from "../helpers/errors.js";
import { claudeRateLimitEvent } from "../helpers/fake-claude.js";
import { findingEntries, reviewFindingWithout } from "../helpers/review.js";
import {
  seedExecuteSession,
  seedExecuteTodoStates,
  seedPlanRevision,
  seedPlanSession,
  seedReviewSession,
  validPlanAnswer,
} from "../helpers/plan.js";
import { deadPid, startFixture, startWriteLockHolder } from "../helpers/processes.js";
import {
  newReview,
  newVerifyRun,
  readRunMarker,
  seedReview,
  tableNames,
  tableRowCount,
  withRawDatabase,
  withStoreFile,
  writeRunMarker,
} from "../helpers/store.js";
import { useTempDir, useTempFile } from "../helpers/temp.js";

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

  const eventCount = (): number => withRawDatabase(dbPath, (db) => tableRowCount(db, "events"));

  // The plan revision rows of a task, as raw rows.
  const readPlanRows = (taskId: number) =>
    withRawDatabase(dbPath, (db) =>
      db.prepare("SELECT * FROM plan_revisions WHERE task_id = ? ORDER BY version").all(taskId),
    );

  // All rows of the sessions table, as raw rows.
  const readSessionRows = () =>
    withRawDatabase(dbPath, (db) => db.prepare("SELECT * FROM sessions ORDER BY rowid").all());

  // All rows of the execute_todos table, as raw rows.
  const readTodoRows = () =>
    withRawDatabase(dbPath, (db) => db.prepare("SELECT * FROM execute_todos ORDER BY plan_version, todo_id").all());

  // All rows of the execute_fix_turns table, as raw rows.
  const readFixTurnRows = () =>
    withRawDatabase(dbPath, (db) => db.prepare("SELECT * FROM execute_fix_turns ORDER BY plan_version").all());

  // The review rows of a task, as raw rows.
  const readReviewRows = (taskId: number) =>
    withRawDatabase(dbPath, (db) => db.prepare("SELECT * FROM reviews WHERE task_id = ? ORDER BY number").all(taskId));

  // The review finding rows of a task, as raw rows.
  const readFindingRows = (taskId: number) =>
    withRawDatabase(dbPath, (db) =>
      db.prepare("SELECT * FROM review_findings WHERE task_id = ? ORDER BY number, position").all(taskId),
    );

  // Checks that a failed call threw message and changed no state, no marker row, no event, no plan revision row, no session row, no todo row, no fix turn row, no review row and no finding row.
  const expectNothingChanged = (id: number, run: () => unknown, message: string) => {
    const state = store.getTask(id)?.state;
    const marker = readRunMarker(dbPath, id);
    const events = eventCount();
    const plans = readPlanRows(id);
    const sessions = readSessionRows();
    const todos = readTodoRows();
    const fixTurns = readFixTurnRows();
    const reviews = readReviewRows(id);
    const findings = readFindingRows(id);
    const error = thrownBy(run, message);
    expect((error as Error).message).toBe(message);
    expect(store.getTask(id)?.state).toBe(state);
    expect(readRunMarker(dbPath, id)).toEqual(marker);
    expect(eventCount()).toBe(events);
    expect(readPlanRows(id)).toEqual(plans);
    expect(readSessionRows()).toEqual(sessions);
    expect(readTodoRows()).toEqual(todos);
    expect(readFixTurnRows()).toEqual(fixTurns);
    expect(readReviewRows(id)).toEqual(reviews);
    expect(readFindingRows(id)).toEqual(findings);
  };

  // Creates a task in state with a raw run marker of the same state.
  const runningTask = (state: string, pid = process.pid, childPid: number | null = null) => {
    const task = store.createTask({ ...newTask, state });
    writeRunMarker(dbPath, task.id, state, pid, childPid);
    return task;
  };

  const endDeadRun = (
    id: number,
    state: string,
    check: Parameters<TaskStore["endDeadRun"]>[2] = () => ({ type: "transition", data: { to: state } }),
    on: TaskStore = store,
  ) => on.endDeadRun(id, state, check);

  const nextReview = (taskId: number) => store.nextReview(taskId);
  const addReview = (taskId: number, input: NewReview, state: string, check?: Parameters<TaskStore["addReview"]>[3]) =>
    store.addReview(taskId, input, state, check);
  const getReview = (taskId: number, number: number) => store.getReview(taskId, number);
  const latestReview = (taskId: number) => store.latestReview(taskId);
  const reviewCount = (taskId: number) => store.reviewCount(taskId);
  const listReviews = (taskId: number) => store.listReviews(taskId);
  const listRevisions = (taskId: number) => store.listPlanRevisions(taskId);
  const dismissFindings = (
    taskId: number,
    number: number,
    positions: number[],
    reason: string,
    state: string,
    check?: Parameters<TaskStore["dismissReviewFindings"]>[5],
  ) => store.dismissReviewFindings(taskId, number, positions, reason, state, check);

  const insertRawTask = (db: DatabaseSync, repoKey: string, state: string) =>
    db
      .prepare(
        "INSERT INTO tasks (issue_key, repo_key, state, created_at, updated_at) VALUES ('a/b#1', ?, ?, 't', 't')",
      )
      .run(repoKey, state);

  const setTodoState = (taskId: number, version: number, todoId: string, state: ExecuteTodoState) =>
    store.setExecuteTodoState(taskId, version, todoId, state);
  const todoProgress = (taskId: number, version: number) => store.executeTodoProgress(taskId, version);

  const markTodosDone = (taskId: number, version: number) => store.markExecuteTodosDone(taskId, version);

  const queueFixTurn = (taskId: number, version: number, turn: NewExecuteFixTurn) =>
    store.queueExecuteFixTurn(taskId, version, turn);
  const queuedFixTurn = (taskId: number, version: number) => store.queuedExecuteFixTurn(taskId, version);
  const fixTurnState = (taskId: number, version: number) => store.executeFixTurnState(taskId, version);
  const markFixTurnDone = (taskId: number, version: number) => store.markExecuteFixTurnDone(taskId, version);

  const clearPlan = (taskId: number) => store.clearPlanSession(taskId);
  const clearExecute = (taskId: number, version: number) => store.clearExecuteSession(taskId, version);
  const recordReview = (taskId: number, number: number, change: Partial<NewSession> = {}) =>
    store.recordReviewSession(taskId, number, {
      sessionId: "r-1",
      provider: "claude-code",
      model: "opus",
      effort: "high",
      ...change,
    });
  const clearReview = (taskId: number, number: number) => store.clearReviewSession(taskId, number);

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
    const rowCount = (): number => withRawDatabase(dbPath, (db) => tableRowCount(db, "tasks"));

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

    it.each(["cancelled", "finished"])("creates a new active task after the first task is %s", (state) => {
      const first = store.createTask(newTask);
      store.updateTask(first.id, { state });
      const second = store.createTask(newTask);
      expect(second.id).not.toBe(first.id);
      expect(second.state).toBe("new");
      expect(rowCount()).toBe(2);
    });
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
      expect(ids(store.listTasks({ repoKey: "tasker", issueKey: issueA }))).toEqual([a.id]);
    });

    it("lists the tasks in the given states", () => {
      const cancelled = store.createTask(newTask);
      store.updateTask(cancelled.id, { state: "cancelled" });
      const active = store.createTask(newTask);
      const finished = store.createTask({ ...newTask, state: "finished" });
      expect(ids(store.listTasks({ states: ["cancelled"] }))).toEqual([cancelled.id]);
      expect(ids(store.listTasks({ states: ["new", "finished"] }))).toEqual([finished.id, active.id]);
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
        expect(() => insertRawTask(db, "tasker", "planning")).toThrow(/UNIQUE constraint failed/);
        const row = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE repo_key = 'tasker'").get() as { n: number };
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

    it.each(["cancelled", "finished"])("permits an active row after a %s row of the same repo and issue", (state) => {
      withRawDatabase(dbPath, (db) => {
        insertRawTask(db, "tasker", state);
        expect(() => insertRawTask(db, "tasker", "planning")).not.toThrow();
        expect(tableRowCount(db, "tasks")).toBe(2);
      });
    });

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
        expect(tableRowCount(check, "tasks")).toBe(2);
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
    expect(() => store.updateTask(999, { state: "x" })).toThrow("task not found: 999");
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
      expect(events.map((event) => event.type)).toEqual(["created", "one", "two"]);
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
        expect(() => db.exec("UPDATE events SET type = 'y'")).toThrow("events are append-only");
        expect(() => db.exec("DELETE FROM events")).toThrow("events are append-only");
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
        expect(migrations.length).toBe(12);
      });
    });
  });

  describe("reviews", () => {
    const insertRawReview = (db: DatabaseSync, taskId: number, number: number) =>
      db
        .prepare(
          "INSERT INTO reviews (task_id, number, revision, prompt, started_at, ended_at) VALUES (?, ?, '4b825dc642cb', 'review@3f9a1c04b2e7', 't', 't')",
        )
        .run(taskId, number);

    const insertRawFinding = (
      db: DatabaseSync,
      taskId: number,
      number: number,
      position: number,
      dismissedAt: string | null = null,
      dismissReason: string | null = null,
    ) =>
      db
        .prepare(
          "INSERT INTO review_findings (task_id, number, position, file, summary, failure_scenario, dismissed_at, dismiss_reason) VALUES (?, ?, ?, 'src/a.ts', 'A summary.', 'A scenario.', ?, ?)",
        )
        .run(taskId, number, position, dismissedAt, dismissReason);

    const refusal = (db: DatabaseSync, run: () => unknown, message: string) => {
      const error = thrownBy(run, message);
      expect((error as Error).message).toBe(message);
      expect(tableRowCount(db, "review_findings")).toBe(0);
    };

    it("has the review tables and the review session index", () => {
      withRawDatabase(dbPath, (db) => {
        expect(tableNames(db)).toEqual(expect.arrayContaining(["reviews", "review_findings"]));
        const index = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'sessions_task_review'")
          .all();
        expect(index).toEqual([{ name: "sessions_task_review" }]);
      });
    });

    it("upgrades a version-10 database and adds both tables", () => {
      const oldPath = join(dir, "old10.db");
      makeOldDatabase(oldPath, 10);
      withStoreFile(oldPath, () => {}, { now });
      withRawDatabase(oldPath, (check) => {
        expect(schemaVersion(check)).toBe(migrations.length);
        expect(tableNames(check)).toEqual(expect.arrayContaining(["reviews", "review_findings"]));
      });
    });

    it("refuses a finding with no review row", () => {
      withRawDatabase(dbPath, (db) => {
        db.exec("PRAGMA foreign_keys = ON");
        insertRawTask(db, "one", "reviewing");
        refusal(db, () => insertRawFinding(db, 1, 1, 1), "FOREIGN KEY constraint failed");
      });
    });

    it("refuses the position 0", () => {
      withRawDatabase(dbPath, (db) => {
        db.exec("PRAGMA foreign_keys = ON");
        insertRawTask(db, "one", "reviewing");
        insertRawReview(db, 1, 1);
        refusal(db, () => insertRawFinding(db, 1, 1, 0), "CHECK constraint failed: position >= 1");
      });
    });

    it("refuses a dismissal time without a reason and the reverse", () => {
      withRawDatabase(dbPath, (db) => {
        db.exec("PRAGMA foreign_keys = ON");
        insertRawTask(db, "one", "reviewing");
        insertRawReview(db, 1, 1);
        const message = "CHECK constraint failed: (dismissed_at IS NULL) = (dismiss_reason IS NULL)";
        refusal(db, () => insertRawFinding(db, 1, 1, 1, "t", null), message);
        refusal(db, () => insertRawFinding(db, 1, 1, 1, null, "A reason."), message);
        insertRawFinding(db, 1, 1, 1, "t", "A reason.");
        expect(tableRowCount(db, "review_findings")).toBe(1);
      });
    });
  });

  describe("reviews store", () => {
    const toReviewed = () => ({ type: "transition", data: { to: "reviewed" } });

    it("inserts the rows and the events, sets the state and deletes the marker", () => {
      const task = runningTask("reviewing");
      const before = store.listEvents(task.id).length;
      const input = newReview(1);
      const moved = addReview(task.id, input, "reviewed", toReviewed);
      expect(moved.state).toBe("reviewed");
      expect(store.getTask(task.id)).toEqual(moved);
      expect(readRunMarker(dbPath, task.id)).toBeUndefined();
      expect(store.listEvents(task.id).slice(before)).toMatchObject([
        { type: "review", data: { number: 1, revision: input.revision, findings: input.findings.length } },
        { type: "transition", data: { to: "reviewed" } },
      ]);
      expect(readReviewRows(task.id)).toEqual([
        {
          task_id: task.id,
          number: 1,
          revision: input.revision,
          prompt: input.prompt,
          started_at: input.startedAt,
          ended_at: input.endedAt,
        },
      ]);
      expect(readFindingRows(task.id)).toMatchObject([
        {
          number: 1,
          position: 1,
          file: input.findings[0]?.file,
          line: input.findings[0]?.line,
          dismissed_at: null,
          dismiss_reason: null,
        },
        {
          number: 1,
          position: 2,
          file: input.findings[1]?.file,
          line: input.findings[1]?.line,
          dismissed_at: null,
          dismiss_reason: null,
        },
      ]);
    });

    it("writes nothing for a wrong number", () => {
      const task = runningTask("reviewing");
      expectNothingChanged(
        task.id,
        () => addReview(task.id, newReview(2), "reviewed"),
        `task ${task.id}: review 2 is not the next number (1)`,
      );
      expect(readReviewRows(task.id)).toEqual([]);
    });

    it("writes nothing when check throws", () => {
      const task = runningTask("reviewing");
      expectNothingChanged(
        task.id,
        () =>
          addReview(task.id, newReview(1), "reviewed", () => {
            throw new Error("check refused");
          }),
        "check refused",
      );
      expect(readReviewRows(task.id)).toEqual([]);
      expect(readFindingRows(task.id)).toEqual([]);
    });

    it("writes nothing for a spawning state", () => {
      const task = runningTask("reviewing");
      expectNothingChanged(
        task.id,
        () => addReview(task.id, newReview(1), "executing"),
        "executing is a spawning state",
      );
      expect(readReviewRows(task.id)).toEqual([]);
    });

    it("numbers, counts and lists the reviews of a task", () => {
      const task = runningTask("reviewing");
      expect(nextReview(task.id)).toBe(1);
      addReview(task.id, newReview(1), "reviewed");
      expect(nextReview(task.id)).toBe(2);
      store.startRun(task.id, "reviewing");
      addReview(task.id, newReview(2, { revision: "aaaaaaaaaaaa" }), "reviewed");
      expect(nextReview(task.id)).toBe(3);
      expect(reviewCount(task.id)).toBe(2);
      expect(listReviews(task.id).map((item) => item.number)).toEqual([1, 2]);
      expect(latestReview(task.id)?.number).toBe(2);
      expect(latestReview(task.id)?.revision).toBe("aaaaaaaaaaaa");
    });

    it("gives nothing for a missing review or an empty task", () => {
      const task = runningTask("reviewing");
      expect(getReview(task.id, 1)).toBeUndefined();
      expect(latestReview(task.id)).toBeUndefined();
      expect(listReviews(task.id)).toEqual([]);
      expect(reviewCount(task.id)).toBe(0);
      addReview(task.id, newReview(1), "reviewed");
      expect(getReview(task.id, 2)).toBeUndefined();
    });

    it("gives the full review", () => {
      const task = runningTask("reviewing");
      const input = newReview(1);
      addReview(task.id, input, "reviewed");
      expect(getReview(task.id, 1)).toEqual({
        taskId: task.id,
        number: 1,
        revision: input.revision,
        prompt: input.prompt,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        findings: findingEntries(input.findings),
      });
    });

    it("gives a finding without line and category with no such keys", () => {
      const task = runningTask("reviewing");
      const finding = reviewFindingWithout("line", "category");
      addReview(task.id, newReview(1, { findings: [finding] }), "reviewed");
      const stored = getReview(task.id, 1)?.findings[0]?.finding;
      expect(stored).toEqual(finding);
      expect(Object.keys(stored ?? {})).not.toContain("line");
      expect(Object.keys(stored ?? {})).not.toContain("category");
    });

    it("stores a review with no findings", () => {
      const task = runningTask("reviewing");
      const before = store.listEvents(task.id).length;
      addReview(task.id, newReview(1, { findings: [] }), "reviewed");
      expect(readFindingRows(task.id)).toEqual([]);
      expect(getReview(task.id, 1)?.findings).toEqual([]);
      expect(store.listEvents(task.id).slice(before)).toMatchObject([{ type: "review", data: { findings: 0 } }]);
    });
  });

  describe("dismiss review findings", () => {
    const reviewedTask = () => {
      const task = store.createTask({ ...newTask, state: "reviewed" });
      seedReview(store, task.id);
      return task;
    };
    const toWorkReview = () => ({ type: "transition", data: { to: "awaiting_work_review" } });

    it("keeps the task and returns the open positions on a partial dismissal", () => {
      const task = reviewedTask();
      const before = store.getTask(task.id);
      const events = store.listEvents(task.id).length;
      clock = new Date("2026-01-02T00:00:00.000Z");
      let checks = 0;
      const open = dismissFindings(task.id, 1, [1], "A false alarm.", "awaiting_work_review", () => {
        checks += 1;
        return toWorkReview();
      });
      expect(open).toEqual([2]);
      expect(checks).toBe(0);
      expect(store.getTask(task.id)).toEqual(before);
      expect(store.listEvents(task.id).slice(events)).toMatchObject([
        { type: "review_dismissed", data: { number: 1, positions: [1], reason: "A false alarm." } },
      ]);
      expect(readFindingRows(task.id)).toMatchObject([
        { position: 1, dismissed_at: "2026-01-02T00:00:00.000Z", dismiss_reason: "A false alarm." },
        { position: 2, dismissed_at: null, dismiss_reason: null },
      ]);
      expect(getReview(task.id, 1)?.findings[0]?.dismissed).toEqual({
        at: "2026-01-02T00:00:00.000Z",
        reason: "A false alarm.",
      });
    });

    it("moves the task on the last dismissal", () => {
      const task = reviewedTask();
      dismissFindings(task.id, 1, [1], "One.", "awaiting_work_review");
      const events = store.listEvents(task.id).length;
      const open = dismissFindings(task.id, 1, [2], "Two.", "awaiting_work_review", toWorkReview);
      expect(open).toEqual([]);
      expect(store.getTask(task.id)?.state).toBe("awaiting_work_review");
      expect(store.listEvents(task.id).slice(events)).toMatchObject([
        { type: "review_dismissed", data: { number: 1, positions: [2], reason: "Two." } },
        { type: "transition", data: { to: "awaiting_work_review" } },
      ]);
    });

    it("moves the task when one call dismisses all findings", () => {
      const task = reviewedTask();
      const events = store.listEvents(task.id).length;
      expect(dismissFindings(task.id, 1, [1, 2], "Both.", "awaiting_work_review", toWorkReview)).toEqual([]);
      expect(store.getTask(task.id)?.state).toBe("awaiting_work_review");
      expect(store.listEvents(task.id).slice(events)).toMatchObject([
        { type: "review_dismissed", data: { positions: [1, 2] } },
        { type: "transition" },
      ]);
    });

    it("writes nothing for a missing position", () => {
      const task = reviewedTask();
      const message = `review 1 of task ${task.id} has no finding 9`;
      expectNothingChanged(task.id, () => dismissFindings(task.id, 1, [9], "x", "awaiting_work_review"), message);
      expectNothingChanged(task.id, () => dismissFindings(task.id, 1, [1, 9], "x", "awaiting_work_review"), message);
    });

    it("writes nothing for a dismissed position", () => {
      const task = reviewedTask();
      dismissFindings(task.id, 1, [1], "First.", "awaiting_work_review");
      const message = `finding 1 of review 1 of task ${task.id} is already dismissed`;
      expectNothingChanged(task.id, () => dismissFindings(task.id, 1, [1], "x", "awaiting_work_review"), message);
      expectNothingChanged(task.id, () => dismissFindings(task.id, 1, [2, 1], "x", "awaiting_work_review"), message);
    });

    it("writes nothing for a position that the list repeats", () => {
      const task = reviewedTask();
      expectNothingChanged(
        task.id,
        () => dismissFindings(task.id, 1, [1, 1], "x", "awaiting_work_review"),
        `finding 1 of review 1 of task ${task.id} is already dismissed`,
      );
    });

    it("keeps the first time and reason after a later try", () => {
      const task = reviewedTask();
      dismissFindings(task.id, 1, [1], "First.", "awaiting_work_review");
      clock = new Date("2026-01-05T00:00:00.000Z");
      expect(() => dismissFindings(task.id, 1, [1], "Second.", "awaiting_work_review")).toThrow("already dismissed");
      expect(getReview(task.id, 1)?.findings[0]?.dismissed).toEqual({
        at: "2026-01-01T00:00:00.000Z",
        reason: "First.",
      });
    });

    it("writes nothing for a missing review", () => {
      const task = reviewedTask();
      expectNothingChanged(
        task.id,
        () => dismissFindings(task.id, 2, [1], "x", "awaiting_work_review"),
        `task ${task.id} has no review 2`,
      );
    });

    it("writes nothing for an empty list", () => {
      const task = reviewedTask();
      expectNothingChanged(
        task.id,
        () => dismissFindings(task.id, 1, [], "x", "awaiting_work_review"),
        `the dismissal of review 1 of task ${task.id} names no finding`,
      );
    });

    it("writes nothing when check throws on the last dismissal", () => {
      const task = reviewedTask();
      expectNothingChanged(
        task.id,
        () =>
          dismissFindings(task.id, 1, [1, 2], "x", "awaiting_work_review", () => {
            throw new Error("check refused");
          }),
        "check refused",
      );
      expect(getReview(task.id, 1)?.findings.map((entry) => entry.dismissed)).toEqual([null, null]);
    });

    it("refuses a missing task", () => {
      expect(() => dismissFindings(999, 1, [1], "x", "awaiting_work_review")).toThrow("task not found: 999");
    });
  });

  describe("sessions table", () => {
    const insertRawSession = (
      db: DatabaseSync,
      taskId: number,
      role: string,
      sessionId: string,
      planVersion: number | null = null,
      reviewNumber: number | null = null,
    ) =>
      db
        .prepare(
          "INSERT INTO sessions (task_id, role, session_id, provider, model, effort, created_at, plan_version, review_number) VALUES (?, ?, ?, 'claude-code', 'opus', 'high', 't', ?, ?)",
        )
        .run(taskId, role, sessionId, planVersion, reviewNumber);

    it("has the sessions table", () => {
      withRawDatabase(dbPath, (db) => {
        expect(tableNames(db)).toContain("sessions");
      });
    });

    it("upgrades a version-7 database and keeps the old rows", () => {
      const oldPath = join(dir, "old7.db");
      makeOldDatabase(oldPath, 7);
      withRawDatabase(oldPath, (raw) => {
        insertRawTask(raw, "tasker", "planning");
        raw.prepare("INSERT INTO events (task_id, at, type, data) VALUES (1, 't', 'note', NULL)").run();
        raw
          .prepare(
            "INSERT INTO plan_revisions (task_id, version, source, answer, prompt, created_at) VALUES (1, 1, 'plan', '{}', 'plan@000000000000', 't')",
          )
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
        expect(check.prepare("SELECT task_id, version, source FROM plan_revisions").all()).toEqual([
          { task_id: 1, version: 1, source: "plan" },
        ]);
        check.exec("PRAGMA foreign_keys = ON");
        insertRawSession(check, 1, "plan", "s-1");
      });
    });

    it("allows one plan session for each task", () => {
      withRawDatabase(dbPath, (db) => {
        insertRawTask(db, "one", "planning");
        insertRawTask(db, "two", "planning");
        insertRawSession(db, 1, "plan", "s-1");
        const message = "UNIQUE constraint failed: sessions.task_id, sessions.role";
        const error = thrownBy(() => insertRawSession(db, 1, "plan", "s-2"), message);
        expect((error as Error).message).toBe(message);
        insertRawSession(db, 2, "plan", "s-3");
      });
    });

    it("allows one execute row for each plan version of a task", () => {
      withRawDatabase(dbPath, (db) => {
        insertRawTask(db, "one", "planning");
        insertRawSession(db, 1, "execute", "s-1", 1);
        insertRawSession(db, 1, "execute", "s-2", 2);
        const message = "UNIQUE constraint failed: sessions.task_id, sessions.plan_version";
        const error = thrownBy(() => insertRawSession(db, 1, "execute", "s-3", 1), message);
        expect((error as Error).message).toBe(message);
        expect(tableRowCount(db, "sessions")).toBe(2);
      });
    });

    it("allows one review row for each review number of a task", () => {
      withRawDatabase(dbPath, (db) => {
        insertRawTask(db, "one", "planning");
        insertRawSession(db, 1, "review", "s-1", null, 1);
        insertRawSession(db, 1, "review", "s-2", null, 2);
        const message = "UNIQUE constraint failed: sessions.task_id, sessions.review_number";
        const error = thrownBy(() => insertRawSession(db, 1, "review", "s-3", null, 1), message);
        expect((error as Error).message).toBe(message);
        expect(tableRowCount(db, "sessions")).toBe(2);
      });
    });

    it("upgrades a version-8 database and keeps the plan session without a plan version", () => {
      const oldPath = join(dir, "old8.db");
      makeOldDatabase(oldPath, 8);
      withRawDatabase(oldPath, (raw) => {
        insertRawTask(raw, "tasker", "planning");
        raw
          .prepare(
            "INSERT INTO sessions (task_id, role, session_id, provider, model, effort, created_at) VALUES (1, 'plan', 's-1', 'claude-code', 'opus', 'high', 't')",
          )
          .run();
      });
      withStoreFile(oldPath, () => {}, { now });
      withRawDatabase(oldPath, (check) => {
        expect(schemaVersion(check)).toBe(migrations.length);
        expect(check.prepare("SELECT session_id, plan_version FROM sessions").all()).toEqual([
          { session_id: "s-1", plan_version: null },
        ]);
        const message = "UNIQUE constraint failed: sessions.task_id, sessions.role";
        const error = thrownBy(() => insertRawSession(check, 1, "plan", "s-2"), message);
        expect((error as Error).message).toBe(message);
      });
    });

    it("has the execute_todos and execute_fix_turns tables", () => {
      withRawDatabase(dbPath, (db) => {
        expect(tableNames(db)).toContain("execute_todos");
        expect(tableNames(db)).toContain("execute_fix_turns");
      });
    });

    it("refuses a todo state or a fix turn of a plan revision that does not exist", () => {
      withRawDatabase(dbPath, (db) => {
        db.exec("PRAGMA foreign_keys = ON");
        insertRawTask(db, "one", "planning");
        const message = "FOREIGN KEY constraint failed";
        const todo = () =>
          db
            .prepare(
              "INSERT INTO execute_todos (task_id, plan_version, todo_id, state, updated_at) VALUES (1, 1, 'a', 'done', 't')",
            )
            .run();
        const turn = () =>
          db
            .prepare(
              "INSERT INTO execute_fix_turns (task_id, plan_version, verify_failure, queued_at) VALUES (1, 1, 'f', 't')",
            )
            .run();
        expect((thrownBy(todo, message) as Error).message).toBe(message);
        expect((thrownBy(turn, message) as Error).message).toBe(message);
        for (const table of ["execute_todos", "execute_fix_turns"]) {
          expect(tableRowCount(db, table)).toBe(0);
        }
      });
    });

    it("refuses a todo state other than in_progress and done", () => {
      withRawDatabase(dbPath, (db) => {
        db.exec("PRAGMA foreign_keys = ON");
        insertRawTask(db, "one", "planning");
        db.prepare(
          "INSERT INTO plan_revisions (task_id, version, source, answer, prompt, created_at) VALUES (1, 1, 'plan', '{}', 'plan@000000000000', 't')",
        ).run();
        const insert = () =>
          db
            .prepare(
              "INSERT INTO execute_todos (task_id, plan_version, todo_id, state, updated_at) VALUES (1, 1, 'a', 'started', 't')",
            )
            .run();
        const error = thrownBy(insert, "CHECK constraint failed");
        expect((error as Error).message).toContain("CHECK constraint failed");
      });
    });

    it("refuses a session id that another row uses", () => {
      withRawDatabase(dbPath, (db) => {
        insertRawTask(db, "one", "planning");
        insertRawTask(db, "two", "planning");
        insertRawSession(db, 1, "plan", "s-1");
        const message = "UNIQUE constraint failed: sessions.session_id";
        const error = thrownBy(() => insertRawSession(db, 2, "plan", "s-1"), message);
        expect((error as Error).message).toBe(message);
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
        raw.prepare("INSERT INTO events (task_id, at, type, data) VALUES (1, 't', 'note', NULL)").run();
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
    });

    describe("approval", () => {
      const approvalEvent = (version: number) => ({ type: "approval", data: { version } });

      const approve = (taskId: number, version: number, state = "approved") =>
        store.approvePlanRevision(taskId, version, state, () => approvalEvent(version));

      const clear = (taskId: number, version: number, state = "awaiting_plan_review") =>
        store.clearPlanApproval(taskId, version, state, () => ({ type: "unapproval" }));

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
        expectNothingChanged(task.id, () => clear(task.id, 1), `task ${task.id} has no approved plan revision`);
      });

      it("clears the approval, moves the state and writes the event", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        approve(task.id, 1);
        clock = new Date("2026-01-04T00:00:00.000Z");
        const moved = clear(task.id, 1);
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
        clear(task.id, 3);
        expect(store.getPlanRevision(task.id, 3)?.approvedAt).toBeNull();
        expect(store.getPlanRevision(task.id, 1)?.approvedAt).toBe(firstTime);
        expect(store.pinnedPlanRevision(task.id)?.version).toBe(1);
      });

      it("refuses a clear of a version that is not pinned", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        approve(task.id, 1);
        seedPlanRevision(store, task.id);
        seedPlanRevision(store, task.id);
        approve(task.id, 3);
        const v1 = store.getPlanRevision(task.id, 1)?.approvedAt;
        const v3 = store.getPlanRevision(task.id, 3)?.approvedAt;
        expectNothingChanged(
          task.id,
          () => clear(task.id, 1),
          `task ${task.id}: plan revision 1 is not the pinned revision (3)`,
        );
        expect(store.getPlanRevision(task.id, 1)?.approvedAt).toBe(v1);
        expect(store.getPlanRevision(task.id, 3)?.approvedAt).toBe(v3);
        expect(store.pinnedPlanRevision(task.id)?.version).toBe(3);
      });
    });

    describe("updateBranchTask", () => {
      const branchUpdated = () => ({ type: "branch_updated", data: { how: "rebase" } });
      const base = { base: "main", revision: "refs/remotes/origin/main", source: "update" as const };
      const reviewTask = () => store.createTask({ ...newTask, state: "awaiting_plan_review" });
      const approve = (taskId: number, version: number) => store.approvePlanRevision(taskId, version, "approved");

      it("appends the base event before the event of check and moves the task", () => {
        const task = runningTask("updating_branch");
        const moved = store.updateBranchTask(task.id, "executed", { base }, branchUpdated);
        expect(moved).toMatchObject({ id: task.id, state: "executed" });
        expect(store.getTask(task.id)).toEqual(moved);
        expect(store.listEvents(task.id).slice(-2)).toMatchObject([
          { type: "base", at: "2026-01-01T00:00:00.000Z", data: base },
          { type: "branch_updated", data: { how: "rebase" } },
        ]);
      });

      it("writes only the event of check when writes is empty", () => {
        const task = runningTask("updating_branch");
        const events = eventCount();
        store.updateBranchTask(task.id, "awaiting_work_review", {}, branchUpdated);
        expect(eventCount()).toBe(events + 1);
        expect(store.listEvents(task.id).at(-1)?.type).toBe("branch_updated");
      });

      it("deletes the run marker", () => {
        const task = runningTask("updating_branch");
        store.updateBranchTask(task.id, "executed", {}, branchUpdated);
        expect(readRunMarker(dbPath, task.id)).toBeUndefined();
      });

      it("clears the approval of the pinned version", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        approve(task.id, 1);
        writeRunMarker(dbPath, task.id, "updating_branch", process.pid);
        store.updateBranchTask(task.id, "awaiting_plan_review", { base, clearPlanApproval: 1 }, branchUpdated);
        expect(store.getPlanRevision(task.id, 1)?.approvedAt).toBeNull();
        expect(store.pinnedPlanRevision(task.id)).toBeUndefined();
        expect(store.getTask(task.id)?.state).toBe("awaiting_plan_review");
        expect(
          store
            .listEvents(task.id)
            .slice(-2)
            .map((e) => e.type),
        ).toEqual(["base", "branch_updated"]);
      });

      it("writes nothing when the version is not pinned", () => {
        const task = reviewTask();
        seedPlanRevision(store, task.id);
        approve(task.id, 1);
        seedPlanRevision(store, task.id);
        approve(task.id, 2);
        writeRunMarker(dbPath, task.id, "updating_branch", process.pid);
        expectNothingChanged(
          task.id,
          () => store.updateBranchTask(task.id, "awaiting_plan_review", { base, clearPlanApproval: 1 }, branchUpdated),
          `task ${task.id}: plan revision 1 is not the pinned revision (2)`,
        );
        expect(store.pinnedPlanRevision(task.id)?.version).toBe(2);
      });

      it("writes nothing when check throws", () => {
        const task = runningTask("updating_branch");
        expectNothingChanged(
          task.id,
          () =>
            store.updateBranchTask(task.id, "executed", { base }, () => {
              throw new Error("check failed");
            }),
          "check failed",
        );
        expect(store.getTask(task.id)?.state).toBe("updating_branch");
        expect(readRunMarker(dbPath, task.id)).toBeDefined();
      });
    });

    describe("questions", () => {
      const questionsOf = (taskId: number, version: number) => store.planQuestions(taskId, version);

      const resolvedThrough = (taskId: number, version: number) => store.resolvedQuestionsThrough(taskId, version);

      const a = { id: "a", question: "Which branch?", context: "No base is named." };
      const b = { id: "b", question: "Which test runner?", context: "Two exist." };
      const c = { id: "c", question: "Which linter?", context: "None is set." };

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

      describe("resolved through a version", () => {
        // v1 has a, b, c. v2 has b, c. v3 has c.
        const seedThreeRevisions = (taskId: number) => {
          seedPlanRevision(store, taskId, { answer: validPlanAnswer({ questions: [a, b, c] }) });
          seedPlanRevision(store, taskId, {
            source: "refine",
            feedback: "f2",
            answer: validPlanAnswer({ questions: [b, c] }),
          });
          seedPlanRevision(store, taskId, {
            source: "refine",
            feedback: "f3",
            answer: validPlanAnswer({ questions: [c] }),
          });
        };

        it("gives the resolved questions in the order of the resolving version", () => {
          const task = store.createTask(newTask);
          seedThreeRevisions(task.id);
          expect(resolvedThrough(task.id, 3)).toEqual([
            { question: a, state: "resolved", version: 2, answer: "f2" },
            { question: b, state: "resolved", version: 3, answer: "f3" },
          ]);
        });

        it("gives only the questions that an earlier version resolves", () => {
          const task = store.createTask(newTask);
          seedThreeRevisions(task.id);
          expect(resolvedThrough(task.id, 2)).toEqual([{ question: a, state: "resolved", version: 2, answer: "f2" }]);
        });

        it("gives nothing for the first version", () => {
          const task = store.createTask(newTask);
          seedThreeRevisions(task.id);
          expect(resolvedThrough(task.id, 1)).toEqual([]);
        });

        it("gives an empty list for a task with no question", () => {
          const task = store.createTask(newTask);
          seedPlanRevision(store, task.id, { answer: validPlanAnswer({ questions: [] }) });
          seedPlanRevision(store, task.id, {
            source: "refine",
            feedback: "f2",
            answer: validPlanAnswer({ questions: [] }),
          });
          expect(resolvedThrough(task.id, 2)).toEqual([]);
        });

        it("refuses a revision that does not exist", () => {
          const task = store.createTask(newTask);
          seedThreeRevisions(task.id);
          const error = thrownBy(() => resolvedThrough(task.id, 5));
          expect((error as Error).message).toBe(`task ${task.id} has no plan revision 5`);
        });
      });
    });

    it("keeps any source text, because the table has no check on it", () => {
      const task = store.createTask(newTask);
      withRawDatabase(dbPath, (db) => {
        insertRawRevision(db, task.id, "review");
      });
    });
  });

  describe("plan session", () => {
    const record = (taskId: number, change: Partial<NewSession> = {}) =>
      seedPlanSession(store, taskId, { sessionId: "s-1", effort: "low", ...change });

    it("gives no session for a task with no plan session", () => {
      const task = store.createTask(newTask);
      expect(store.planSession(task.id)).toBeUndefined();
    });

    it("records the first session and gives back the provider, model and effort as written", () => {
      const task = store.createTask(newTask);
      const expected = {
        sessionId: "s-1",
        repoKey: "tasker",
        provider: "claude-code",
        model: "opus",
        effort: "low",
      };
      expect(record(task.id)).toEqual(expected);
      expect(store.planSession(task.id)).toEqual(expected);
      expect(readSessionRows()).toEqual([
        {
          task_id: task.id,
          role: "plan",
          session_id: "s-1",
          provider: "claude-code",
          model: "opus",
          effort: "low",
          created_at: "2026-01-01T00:00:00.000Z",
          plan_version: null,
          review_number: null,
        },
      ]);
    });

    it("gives the repo key of the task", () => {
      const task = store.createTask({ ...newTask, repoKey: "other" });
      expect(record(task.id).repoKey).toBe("other");
      expect(store.planSession(task.id)?.repoKey).toBe("other");
    });

    it("writes nothing on a second record with the same id", () => {
      const task = store.createTask(newTask);
      const first = record(task.id);
      const rows = readSessionRows();
      clock = new Date("2026-01-02T00:00:00.000Z");
      expect(record(task.id, { model: "sonnet", effort: "high" })).toEqual(first);
      expect(readSessionRows()).toEqual(rows);
    });

    it("refuses a second record with another id and names both ids", () => {
      const task = store.createTask(newTask);
      record(task.id);
      expectNothingChanged(
        task.id,
        () => record(task.id, { sessionId: "s-2" }),
        `task ${task.id} already has the plan session s-1, not s-2`,
      );
    });

    it("refuses a task that does not exist", () => {
      const task = store.createTask(newTask);
      record(task.id);
      expectNothingChanged(task.id, () => record(999, { sessionId: "s-9" }), "task not found: 999");
    });

    it("refuses a session id of another task and writes nothing", () => {
      const a = store.createTask(newTask);
      const b = store.createTask({ ...newTask, issueKey: "codeguru42/tasker#7" });
      record(a.id);
      expectNothingChanged(b.id, () => record(b.id), "UNIQUE constraint failed: sessions.session_id");
      expect(store.planSession(b.id)).toBeUndefined();
    });

    it("keeps the plan sessions of two tasks apart", () => {
      const a = store.createTask(newTask);
      const b = store.createTask({ ...newTask, issueKey: "codeguru42/tasker#7" });
      record(a.id);
      record(b.id, { sessionId: "s-2", effort: "medium" });
      expect(store.planSession(a.id)).toMatchObject({ sessionId: "s-1", effort: "low" });
      expect(store.planSession(b.id)).toMatchObject({ sessionId: "s-2", effort: "medium" });
    });
  });

  describe("execute session", () => {
    it("records the first session and gives it back", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      const expected = {
        sessionId: "s-1",
        repoKey: "tasker",
        provider: "claude-code",
        model: "sonnet",
        effort: "medium",
      };
      expect(seedExecuteSession(store, task.id, 1, { sessionId: "s-1" })).toEqual(expected);
      expect(store.executeSession(task.id, 1)).toEqual(expected);
      expect(readSessionRows()).toEqual([
        {
          task_id: task.id,
          role: "execute",
          session_id: "s-1",
          provider: "claude-code",
          model: "sonnet",
          effort: "medium",
          created_at: "2026-01-01T00:00:00.000Z",
          plan_version: 1,
          review_number: null,
        },
      ]);
    });

    it("writes nothing on a second record with the same id", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      const first = seedExecuteSession(store, task.id, 1, { sessionId: "s-1" });
      const rows = readSessionRows();
      clock = new Date("2026-01-02T00:00:00.000Z");
      expect(seedExecuteSession(store, task.id, 1, { sessionId: "s-1", model: "opus", effort: "high" })).toEqual(first);
      expect(readSessionRows()).toEqual(rows);
    });

    it("refuses a second record with another id and names both ids", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      seedExecuteSession(store, task.id, 1, { sessionId: "s-1" });
      expectNothingChanged(
        task.id,
        () => seedExecuteSession(store, task.id, 1, { sessionId: "s-2" }),
        `task ${task.id} already has the execute session s-1 of plan revision 1, not s-2`,
      );
    });

    it("refuses a version with no plan revision and writes nothing", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      expectNothingChanged(
        task.id,
        () => seedExecuteSession(store, task.id, 5, { sessionId: "s-1" }),
        `task ${task.id} has no plan revision 5`,
      );
      expect(store.executeSession(task.id, 5)).toBeUndefined();
    });

    it("refuses a task that does not exist and writes nothing", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      seedExecuteSession(store, task.id, 1, { sessionId: "s-1" });
      expectNothingChanged(
        task.id,
        () => seedExecuteSession(store, 999, 1, { sessionId: "s-9" }),
        "task not found: 999",
      );
      expect(store.executeSession(999, 1)).toBeUndefined();
    });

    it("keeps the plan session and the execute session of one task apart", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      seedPlanSession(store, task.id);
      seedExecuteSession(store, task.id, 1, { sessionId: "s-2" });
      expect(store.planSession(task.id)).toMatchObject({ model: "opus" });
      expect(store.planSession(task.id)?.sessionId).not.toBe("s-2");
      expect(store.executeSession(task.id, 1)).toMatchObject({ sessionId: "s-2", model: "sonnet" });
    });

    it("gives each plan revision its own execute session", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      seedPlanRevision(store, task.id);
      seedExecuteSession(store, task.id, 1, { sessionId: "s-1" });
      seedExecuteSession(store, task.id, 2, { sessionId: "s-2" });
      expect(store.executeSession(task.id, 1)?.sessionId).toBe("s-1");
      expect(store.executeSession(task.id, 2)?.sessionId).toBe("s-2");
    });

    it("gives no session for a version with no execute session", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      expect(store.executeSession(task.id, 1)).toBeUndefined();
      expect(store.executeSession(task.id, 7)).toBeUndefined();
    });
  });

  describe("review session", () => {
    it("records a session before the review row exists", () => {
      const task = store.createTask(newTask);
      expect(recordReview(task.id, 1)).toEqual({
        sessionId: "r-1",
        repoKey: "tasker",
        provider: "claude-code",
        model: "opus",
        effort: "high",
      });
      expect(readReviewRows(task.id)).toEqual([]);
      expect(readSessionRows()).toEqual([
        {
          task_id: task.id,
          role: "review",
          session_id: "r-1",
          provider: "claude-code",
          model: "opus",
          effort: "high",
          created_at: "2026-01-01T00:00:00.000Z",
          plan_version: null,
          review_number: 1,
        },
      ]);
    });

    it("writes nothing on a second record with the same id", () => {
      const task = store.createTask(newTask);
      const first = recordReview(task.id, 1);
      const rows = readSessionRows();
      clock = new Date("2026-01-02T00:00:00.000Z");
      expect(recordReview(task.id, 1)).toEqual(first);
      expect(readSessionRows()).toEqual(rows);
    });

    it("refuses another id for the same review number and writes nothing", () => {
      const task = store.createTask(newTask);
      recordReview(task.id, 1);
      expectNothingChanged(
        task.id,
        () => recordReview(task.id, 1, { sessionId: "r-2" }),
        `task ${task.id} already has the review session r-1 of review 1, not r-2`,
      );
    });

    it("refuses a task that does not exist", () => {
      expect(() => recordReview(999, 1)).toThrow("task not found: 999");
    });

    it("gives two rows for two review numbers", () => {
      const task = store.createTask(newTask);
      recordReview(task.id, 1);
      recordReview(task.id, 2, { sessionId: "r-2" });
      expect(readSessionRows()).toMatchObject([
        { role: "review", session_id: "r-1", review_number: 1 },
        { role: "review", session_id: "r-2", review_number: 2 },
      ]);
    });

    it("clears only its own row", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      seedPlanSession(store, task.id);
      seedExecuteSession(store, task.id, 1);
      recordReview(task.id, 1);
      recordReview(task.id, 2, { sessionId: "r-2" });
      clearReview(task.id, 1);
      expect(readSessionRows()).toMatchObject([
        { role: "plan" },
        { role: "execute" },
        { role: "review", session_id: "r-2", review_number: 2 },
      ]);
    });

    it("changes nothing when there is no row to clear", () => {
      const task = store.createTask(newTask);
      recordReview(task.id, 1);
      const rows = readSessionRows();
      clearReview(task.id, 2);
      clearReview(9999, 1);
      expect(readSessionRows()).toEqual(rows);
    });
  });

  describe("clear a session", () => {
    it("clears the plan session so that a new id is recorded", () => {
      const task = store.createTask(newTask);
      seedPlanSession(store, task.id);
      clearPlan(task.id);
      expect(store.planSession(task.id)).toBeUndefined();
      expect(readSessionRows()).toEqual([]);
      expect(seedPlanSession(store, task.id, { sessionId: "s-new" }).sessionId).toBe("s-new");
      expect(store.planSession(task.id)?.sessionId).toBe("s-new");
    });

    it("clears the execute session so that a new id is recorded", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      seedExecuteSession(store, task.id, 1);
      clearExecute(task.id, 1);
      expect(store.executeSession(task.id, 1)).toBeUndefined();
      expect(readSessionRows()).toEqual([]);
      expect(seedExecuteSession(store, task.id, 1, { sessionId: "s-new" }).sessionId).toBe("s-new");
      expect(store.executeSession(task.id, 1)?.sessionId).toBe("s-new");
    });

    it("does not throw and changes nothing when there is no row to clear", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      seedPlanSession(store, task.id);
      const rows = readSessionRows();
      clearExecute(task.id, 1);
      clearExecute(task.id, 9);
      expect(readSessionRows()).toEqual(rows);
      const other = store.createTask({ ...newTask, issueKey: "codeguru42/tasker#7" });
      clearPlan(other.id);
      expect(readSessionRows()).toEqual(rows);
    });

    it("keeps the other sessions when it clears the execute session of one version", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      seedPlanRevision(store, task.id);
      seedPlanSession(store, task.id);
      seedExecuteSession(store, task.id, 1);
      seedExecuteSession(store, task.id, 2, { sessionId: "s-2" });
      clearExecute(task.id, 1);
      expect(store.executeSession(task.id, 1)).toBeUndefined();
      expect(store.executeSession(task.id, 2)?.sessionId).toBe("s-2");
      expect(store.planSession(task.id)).toBeDefined();
    });
  });

  describe("retry write", () => {
    const retryCheck = () => ({ type: "retry", data: { origin: "executing" } });
    const failedTask = () => {
      const task = store.createTask({ ...newTask, state: "failed" });
      seedPlanRevision(store, task.id, {}, "failed");
      seedPlanRevision(store, task.id, {}, "failed");
      return task;
    };

    it("moves the state, drops the run marker and writes the event of the check", () => {
      const task = failedTask();
      writeRunMarker(dbPath, task.id, "failed", process.pid);

      const moved = store.retryTask(task.id, "approved", {}, retryCheck);

      expect(moved.state).toBe("approved");
      expect(store.getTask(task.id)?.state).toBe("approved");
      expect(readRunMarker(dbPath, task.id)).toBeUndefined();
      expect(store.listEvents(task.id).at(-1)).toMatchObject({
        type: "retry",
        data: { origin: "executing" },
      });
    });

    it("clears the plan session and keeps the execute session", () => {
      const task = failedTask();
      seedPlanSession(store, task.id);
      seedExecuteSession(store, task.id, 1);

      store.retryTask(task.id, "workspace_ready", { clearPlanSession: true }, retryCheck);

      expect(store.planSession(task.id)).toBeUndefined();
      expect(store.executeSession(task.id, 1)).toBeDefined();
    });

    it("clears the execute session of one version only", () => {
      const task = failedTask();
      seedPlanSession(store, task.id);
      seedExecuteSession(store, task.id, 1);
      seedExecuteSession(store, task.id, 2, { sessionId: "s-2" });

      store.retryTask(task.id, "approved", { clearExecuteSession: 1 }, retryCheck);

      expect(store.executeSession(task.id, 1)).toBeUndefined();
      expect(store.executeSession(task.id, 2)?.sessionId).toBe("s-2");
      expect(store.planSession(task.id)).toBeDefined();
    });

    it("clears the review session of the given number only", () => {
      const task = failedTask();
      seedReviewSession(store, task.id, 1, { sessionId: "r-1" });
      seedReviewSession(store, task.id, 2, { sessionId: "r-2" });

      store.retryTask(task.id, "awaiting_work_review", { clearReviewSession: 2 }, retryCheck);

      expect(readSessionRows()).toMatchObject([{ role: "review", review_number: 1, session_id: "r-1" }]);
    });

    it("marks every todo done and queues the fix turn", () => {
      const task = failedTask();
      seedExecuteTodoStates(store, task.id, 1, { "write-test": "in_progress" });

      store.retryTask(
        task.id,
        "approved",
        { resumeExecute: { version: 1, fixTurn: { verifyFailure: "npm test failed", verifyLogTail: "line 1\n" } } },
        retryCheck,
      );

      expect(todoProgress(task.id, 1).map((entry) => entry.state)).toEqual(["done", "done"]);
      expect(queuedFixTurn(task.id, 1)).toMatchObject({ verifyFailure: "npm test failed", verifyLogTail: "line 1\n" });
      expect(fixTurnState(task.id, 1)).toBe("queued");
    });

    it("writes nothing when resumeExecute names a version with no revision", () => {
      const task = failedTask();
      seedPlanSession(store, task.id);
      seedExecuteSession(store, task.id, 1);
      writeRunMarker(dbPath, task.id, "failed", process.pid);

      expectNothingChanged(
        task.id,
        () =>
          store.retryTask(
            task.id,
            "approved",
            {
              clearPlanSession: true,
              clearExecuteSession: 1,
              resumeExecute: { version: 5, fixTurn: { verifyFailure: "f", verifyLogTail: null } },
            },
            retryCheck,
          ),
        `task ${task.id} has no plan revision 5`,
      );
      expect(store.getTask(task.id)?.state).toBe("failed");
      expect(store.planSession(task.id)).toBeDefined();
      expect(store.executeSession(task.id, 1)).toBeDefined();
    });

    it("writes nothing when the check throws", () => {
      const task = failedTask();
      seedPlanSession(store, task.id);

      expectNothingChanged(
        task.id,
        () =>
          store.retryTask(task.id, "workspace_ready", { clearPlanSession: true }, () => {
            throw new Error("no edge");
          }),
        "no edge",
      );
      expect(store.planSession(task.id)).toBeDefined();
    });
  });

  describe("execute todo states", () => {
    const todos = validPlanAnswer().todos;

    it("inserts a state and updates it with a later time", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      setTodoState(task.id, 1, "write-test", "in_progress");
      expect(readTodoRows()).toEqual([
        {
          task_id: task.id,
          plan_version: 1,
          todo_id: "write-test",
          state: "in_progress",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ]);
      clock = new Date("2026-01-02T00:00:00.000Z");
      setTodoState(task.id, 1, "write-test", "done");
      expect(readTodoRows()).toEqual([
        {
          task_id: task.id,
          plan_version: 1,
          todo_id: "write-test",
          state: "done",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
      ]);
    });

    it("refuses a todo id that the plan revision does not have", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      expectNothingChanged(
        task.id,
        () => setTodoState(task.id, 1, "nope", "done"),
        `plan revision 1 of task ${task.id} has no todo nope`,
      );
    });

    it("gives the progress in the plan order with not_started for a todo with no row", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      setTodoState(task.id, 1, "make-it-pass", "in_progress");
      expect(todoProgress(task.id, 1)).toEqual([
        { todo: todos[0], state: "not_started" },
        { todo: todos[1], state: "in_progress" },
      ]);
    });

    it("refuses a plan revision that does not exist", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      const message = `task ${task.id} has no plan revision 5`;
      expectNothingChanged(task.id, () => setTodoState(task.id, 5, "write-test", "done"), message);
      expectNothingChanged(task.id, () => todoProgress(task.id, 5), message);
    });
  });

  describe("mark every todo done", () => {
    it("sets each todo to done with one time", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      seedExecuteTodoStates(store, task.id, 1, { "write-test": "in_progress" });
      clock = new Date("2026-01-02T00:00:00.000Z");
      markTodosDone(task.id, 1);
      expect(readTodoRows()).toEqual([
        {
          task_id: task.id,
          plan_version: 1,
          todo_id: "make-it-pass",
          state: "done",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
        {
          task_id: task.id,
          plan_version: 1,
          todo_id: "write-test",
          state: "done",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
      ]);
    });

    it("refuses a plan revision that does not exist and writes nothing", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      seedExecuteTodoStates(store, task.id, 1, { "write-test": "in_progress" });
      expectNothingChanged(task.id, () => markTodosDone(task.id, 5), `task ${task.id} has no plan revision 5`);
      expect(readTodoRows()).toHaveLength(1);
    });
  });

  describe("execute fix turn", () => {
    it("queues a fix turn and reads it with a log tail", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      queueFixTurn(task.id, 1, { verifyFailure: "npm test failed", verifyLogTail: "line 1\nline 2" });
      expect(queuedFixTurn(task.id, 1)).toEqual({
        verifyFailure: "npm test failed",
        verifyLogTail: "line 1\nline 2",
        queuedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    it("queues a fix turn and reads it with no log tail", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      queueFixTurn(task.id, 1, { verifyFailure: "npm test failed", verifyLogTail: null });
      expect(queuedFixTurn(task.id, 1)).toEqual({
        verifyFailure: "npm test failed",
        verifyLogTail: null,
        queuedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    it("gives no fix turn for a revision that has none", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      expect(queuedFixTurn(task.id, 1)).toBeUndefined();
    });

    it("marks the fix turn done and keeps the time", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      queueFixTurn(task.id, 1, { verifyFailure: "f", verifyLogTail: null });
      clock = new Date("2026-01-02T00:00:00.000Z");
      markFixTurnDone(task.id, 1);
      expect(queuedFixTurn(task.id, 1)).toBeUndefined();
      expect(readFixTurnRows()).toEqual([
        {
          task_id: task.id,
          plan_version: 1,
          verify_failure: "f",
          verify_log_tail: null,
          queued_at: "2026-01-01T00:00:00.000Z",
          done_at: "2026-01-02T00:00:00.000Z",
        },
      ]);
    });

    it("refuses done for a fix turn that is already done and keeps its first done time", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      queueFixTurn(task.id, 1, { verifyFailure: "f", verifyLogTail: null });
      clock = new Date("2026-01-02T00:00:00.000Z");
      markFixTurnDone(task.id, 1);
      clock = new Date("2026-01-03T00:00:00.000Z");
      expectNothingChanged(
        task.id,
        () => markFixTurnDone(task.id, 1),
        `task ${task.id} has no queued fix turn of plan revision 1`,
      );
      expect(readFixTurnRows()[0]).toMatchObject({ done_at: "2026-01-02T00:00:00.000Z" });
    });

    it("queues the fix turn again after it is done, with the new texts and time", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      queueFixTurn(task.id, 1, { verifyFailure: "old", verifyLogTail: "old tail" });
      markFixTurnDone(task.id, 1);
      clock = new Date("2026-01-03T00:00:00.000Z");
      queueFixTurn(task.id, 1, { verifyFailure: "new", verifyLogTail: null });
      expect(queuedFixTurn(task.id, 1)).toEqual({
        verifyFailure: "new",
        verifyLogTail: null,
        queuedAt: "2026-01-03T00:00:00.000Z",
      });
      expect(readFixTurnRows()).toHaveLength(1);
      expect(readFixTurnRows()[0]).toMatchObject({ done_at: null });
    });

    it("gives no fix turn state for a revision that has none", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      expect(fixTurnState(task.id, 1)).toBeUndefined();
    });

    it("gives the state queued for a queued fix turn", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      queueFixTurn(task.id, 1, { verifyFailure: "f", verifyLogTail: null });
      expect(fixTurnState(task.id, 1)).toBe("queued");
    });

    it("gives the state done for a fix turn that is marked done", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      queueFixTurn(task.id, 1, { verifyFailure: "f", verifyLogTail: null });
      markFixTurnDone(task.id, 1);
      expect(fixTurnState(task.id, 1)).toBe("done");
    });

    it("gives the state queued for a fix turn that is queued again after it is done", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      queueFixTurn(task.id, 1, { verifyFailure: "old", verifyLogTail: null });
      markFixTurnDone(task.id, 1);
      queueFixTurn(task.id, 1, { verifyFailure: "new", verifyLogTail: null });
      expect(fixTurnState(task.id, 1)).toBe("queued");
    });

    it("refuses done for a fix turn that does not exist", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      expectNothingChanged(
        task.id,
        () => markFixTurnDone(task.id, 1),
        `task ${task.id} has no queued fix turn of plan revision 1`,
      );
      expect(readFixTurnRows()).toEqual([]);
    });

    it("refuses to queue a fix turn for a plan revision that does not exist", () => {
      const task = store.createTask(newTask);
      seedPlanRevision(store, task.id);
      expectNothingChanged(
        task.id,
        () => queueFixTurn(task.id, 5, { verifyFailure: "f", verifyLogTail: null }),
        `task ${task.id} has no plan revision 5`,
      );
      expect(readFixTurnRows()).toEqual([]);
    });
  });

  describe("quota events", () => {
    it("lists nothing on a new store", () => {
      expect(store.listQuotaEvents()).toEqual([]);
    });

    it("keeps the event as it came, with the provider and the injected time", () => {
      const event = { ...claudeRateLimitEvent(), unknown_field: { kept: true } };
      store.recordQuotaEvent("a/repo", "claude-code", event);
      expect(store.listQuotaEvents()).toEqual([
        { repoKey: "a/repo", provider: "claude-code", receivedAt: "2026-01-01T00:00:00.000Z", event },
      ]);
    });

    it("replaces the record of the same repo with a newer event", () => {
      store.recordQuotaEvent("a/repo", "claude-code", claudeRateLimitEvent());
      clock = new Date("2026-01-02T00:00:00.000Z");
      const newer = claudeRateLimitEvent((info) => {
        info.utilization = 0.9;
      });
      store.recordQuotaEvent("a/repo", "claude-code", newer);
      expect(store.listQuotaEvents()).toEqual([
        { repoKey: "a/repo", provider: "claude-code", receivedAt: "2026-01-02T00:00:00.000Z", event: newer },
      ]);
    });

    it("lists the records sorted by repo key", () => {
      store.recordQuotaEvent("b/repo", "claude-code", claudeRateLimitEvent());
      store.recordQuotaEvent("a/repo", "claude-code", claudeRateLimitEvent());
      expect(store.listQuotaEvents().map((record) => record.repoKey)).toEqual(["a/repo", "b/repo"]);
    });

    it("lists only the record of the repo key that it gets", () => {
      store.recordQuotaEvent("b/repo", "claude-code", claudeRateLimitEvent());
      store.recordQuotaEvent("a/repo", "claude-code", claudeRateLimitEvent());
      expect(store.listQuotaEvents("b/repo").map((record) => record.repoKey)).toEqual(["b/repo"]);
      expect(store.listQuotaEvents("missing/repo")).toEqual([]);
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
        writeRunMarker(dbPath, task.id, "executing", dead);
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

    describe("addPlanRevision", () => {
      const revision = (version: number) => ({
        version,
        source: "plan" as const,
        answer: validPlanAnswer(),
        prompt: "plan@000000000000",
      });

      it("inserts the row and the events, sets the state and deletes the marker", () => {
        const task = runningTask("planning");
        const before = store.listEvents(task.id).length;
        const moved = store.addPlanRevision(task.id, revision(1), "awaiting_plan_review", () => ({
          type: "transition",
          data: { to: "awaiting_plan_review" },
        }));
        expect(moved.state).toBe("awaiting_plan_review");
        expect(store.getTask(task.id)).toEqual(moved);
        expect(store.getPlanRevision(task.id, 1)).toMatchObject({ version: 1, prompt: "plan@000000000000" });
        expect(readRunMarker(dbPath, task.id)).toBeUndefined();
        expect(store.listEvents(task.id).slice(before)).toMatchObject([
          { type: "plan_revision", data: { version: 1, prompt: "plan@000000000000" } },
          { type: "transition", data: { to: "awaiting_plan_review" } },
        ]);
      });

      it("writes nothing when check throws", () => {
        const task = runningTask("planning");
        expectNothingChanged(
          task.id,
          () =>
            store.addPlanRevision(task.id, revision(1), "awaiting_plan_review", () => {
              throw new Error("check refused");
            }),
          "check refused",
        );
      });

      it("writes nothing for a version that is not the next one", () => {
        const task = runningTask("planning");
        expectNothingChanged(
          task.id,
          () => store.addPlanRevision(task.id, revision(2), "awaiting_plan_review"),
          `task ${task.id}: plan revision 2 is not the next version (1)`,
        );
      });

      it("writes nothing for a spawning state", () => {
        const task = runningTask("planning");
        expectNothingChanged(
          task.id,
          () => store.addPlanRevision(task.id, revision(1), "executing"),
          "executing is a spawning state",
        );
      });

      it("refuses a task that does not exist", () => {
        const error = thrownBy(() => store.addPlanRevision(9999, revision(1), "awaiting_plan_review"));
        expect((error as Error).message).toBe("task not found: 9999");
      });
    });

    describe("listPlanRevisions", () => {
      it("gives an empty list for a task with no revision", () => {
        const task = runningTask("planning");
        expect(listRevisions(task.id)).toEqual([]);
      });

      it("gives the revisions oldest first with the source, the feedback and the time", () => {
        const task = runningTask("planning");
        store.addPlanRevision(
          task.id,
          { version: 1, source: "plan", answer: validPlanAnswer(), prompt: "plan@000000000000" },
          "awaiting_plan_review",
        );
        clock = new Date("2026-01-02T00:00:00.000Z");
        store.addPlanRevision(
          task.id,
          {
            version: 2,
            source: "refine",
            feedback: "Keep the loop.",
            answer: validPlanAnswer(),
            prompt: "plan@000000000000",
          },
          "awaiting_plan_review",
        );
        expect(listRevisions(task.id)).toMatchObject([
          { version: 1, source: "plan", feedback: null, createdAt: "2026-01-01T00:00:00.000Z" },
          { version: 2, source: "refine", feedback: "Keep the loop.", createdAt: "2026-01-02T00:00:00.000Z" },
        ]);
      });
    });

    describe("verify runs", () => {
      // The keys of a failed run that differ from the defaults of newVerifyRun.
      const failedRun = {
        result: "failed",
        commands: ["npm run lint", "npm test"],
        failingCommand: 2,
        endedAt: "2026-01-01T00:01:00.000Z",
      } satisfies Partial<NewVerifyRun>;

      // The verify run rows of a task, as raw rows.
      const readVerifyRows = (taskId: number) =>
        withRawDatabase(dbPath, (db) =>
          db.prepare("SELECT * FROM verify_runs WHERE task_id = ? ORDER BY number").all(taskId),
        );

      it("has the verify_runs table", () => {
        withRawDatabase(dbPath, (db) => {
          expect(tableNames(db)).toContain("verify_runs");
        });
      });

      it("upgrades a version-9 database", () => {
        const oldPath = join(dir, "old9.db");
        makeOldDatabase(oldPath, 9);
        withStoreFile(oldPath, () => {}, { now });
        withRawDatabase(oldPath, (check) => {
          expect(schemaVersion(check)).toBe(migrations.length);
          expect(tableNames(check)).toContain("verify_runs");
        });
      });

      it("numbers the runs of a task from 1", () => {
        const task = runningTask("verifying");
        expect(store.nextVerifyRun(task.id)).toBe(1);
        store.addVerifyRun(task.id, newVerifyRun(store, task.id, { number: 1 }), "awaiting_work_review");
        expect(store.nextVerifyRun(task.id)).toBe(2);
        store.startRun(task.id, "verifying");
        store.addVerifyRun(task.id, newVerifyRun(store, task.id, { number: 2 }), "awaiting_work_review");
        expect(readVerifyRows(task.id)).toHaveLength(2);
      });

      it("inserts the row and the events, sets the state and deletes the marker", () => {
        const task = runningTask("verifying");
        const before = store.listEvents(task.id).length;
        const moved = store.addVerifyRun(
          task.id,
          newVerifyRun(store, task.id, failedRun),
          "awaiting_work_review",
          () => ({
            type: "transition",
            data: { to: "awaiting_work_review" },
          }),
        );
        expect(moved.state).toBe("awaiting_work_review");
        expect(store.getTask(task.id)).toEqual(moved);
        expect(readRunMarker(dbPath, task.id)).toBeUndefined();
        expect(store.listEvents(task.id).slice(before)).toMatchObject([
          { type: "verify_run", data: { number: 1, result: "failed" } },
          { type: "transition", data: { to: "awaiting_work_review" } },
        ]);
        expect(readVerifyRows(task.id)).toMatchObject([
          {
            task_id: task.id,
            number: 1,
            result: "failed",
            commands: '["npm run lint","npm test"]',
            failing_command: 2,
          },
        ]);
      });

      it("writes nothing when check throws", () => {
        const task = runningTask("verifying");
        expectNothingChanged(
          task.id,
          () =>
            store.addVerifyRun(task.id, newVerifyRun(store, task.id), "awaiting_work_review", () => {
              throw new Error("check refused");
            }),
          "check refused",
        );
        expect(readVerifyRows(task.id)).toEqual([]);
      });

      it("writes nothing for a spawning state", () => {
        const task = runningTask("verifying");
        expectNothingChanged(
          task.id,
          () => store.addVerifyRun(task.id, newVerifyRun(store, task.id), "executing"),
          "executing is a spawning state",
        );
        expect(readVerifyRows(task.id)).toEqual([]);
      });

      it("writes nothing for a number that is not the next one", () => {
        const task = runningTask("verifying");
        expectNothingChanged(
          task.id,
          () => store.addVerifyRun(task.id, newVerifyRun(store, task.id, { number: 2 }), "awaiting_work_review"),
          `task ${task.id}: verify run 2 is not the next number (1)`,
        );
        expect(readVerifyRows(task.id)).toEqual([]);
      });

      it("writes nothing for a result outside the list", () => {
        const task = runningTask("verifying");
        const state = store.getTask(task.id)?.state;
        const events = eventCount();
        const error = thrownBy(() =>
          store.addVerifyRun(
            task.id,
            newVerifyRun(store, task.id, { result: "lost" as VerifyRunResult }),
            "awaiting_work_review",
          ),
        );
        expect((error as Error).message).toContain("CHECK constraint failed");
        expect(store.getTask(task.id)?.state).toBe(state);
        expect(eventCount()).toBe(events);
        expect(readVerifyRows(task.id)).toEqual([]);
      });

      it("gives the runs back", () => {
        const task = runningTask("verifying");
        expect(store.verifyRunCount(task.id)).toBe(0);
        expect(store.latestVerifyRun(task.id)).toBeUndefined();
        const first = newVerifyRun(store, task.id, failedRun);
        store.addVerifyRun(task.id, first, "awaiting_work_review");
        store.startRun(task.id, "verifying");
        const second = newVerifyRun(store, task.id);
        store.addVerifyRun(task.id, second, "awaiting_work_review");
        expect(store.verifyRunCount(task.id)).toBe(2);
        expect(store.getVerifyRun(task.id, 1)).toEqual({ taskId: task.id, ...first });
        expect(store.getVerifyRun(task.id, 9)).toBeUndefined();
        expect(store.latestVerifyRun(task.id)).toEqual({ taskId: task.id, ...second });
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
        const task = runningTask("executing", deadPid());
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
        const task = runningTask("executing", deadPid());
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
        writeRunMarker(dbPath, task.id, "executing", deadPid());
        const moved = store.endRun(task.id, "executed", transition);
        expect(moved).toMatchObject({ id: task.id, state: "executed" });
        expect(readRunMarker(dbPath, task.id)).toBeUndefined();
        expect(store.listEvents(task.id).at(-1)).toMatchObject({ type: "transition", data: { to: "executed" } });
      });

      it("refuses a spawning state as the target", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        store.startRun(task.id, "executing");
        expectNothingChanged(task.id, () => store.endRun(task.id, "planning"), "planning is a spawning state");
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

    describe("endDeadRun", () => {
      it("gives undefined and changes nothing for a task with no run", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        const events = eventCount();

        expect(endDeadRun(task.id, "interrupted")).toBeUndefined();

        expect(store.getTask(task.id)?.state).toBe("approved");
        expect(eventCount()).toBe(events);
      });

      it("gives undefined and changes nothing for a live run", () => {
        const task = runningTask("executing");
        const events = eventCount();

        expect(endDeadRun(task.id, "interrupted")).toBeUndefined();

        expect(store.getTask(task.id)?.state).toBe("executing");
        expect(readRunMarker(dbPath, task.id)).toMatchObject({ pid: process.pid });
        expect(eventCount()).toBe(events);
      });

      it("moves a spawning task with no marker, and appends the event of check", () => {
        const task = store.createTask({ ...newTask, state: "executing" });
        const checked: unknown[] = [];

        const result = endDeadRun(task.id, "interrupted", (current, childPid) => {
          checked.push([current.state, childPid]);
          return { type: "transition", data: { cause: "dead_run", childPid } };
        });

        expect(result).toEqual({ task: store.getTask(task.id), from: "executing", childPid: null });
        expect(result?.task.state).toBe("interrupted");
        expect(checked).toEqual([["executing", null]]);
        expect(readRunMarker(dbPath, task.id)).toBeUndefined();
        expect(store.listEvents(task.id).at(-1)).toMatchObject({
          type: "transition",
          data: { cause: "dead_run", childPid: null },
        });
      });

      it("moves a task with a dead marker, gives the child pid to check and deletes the marker", () => {
        const task = runningTask("executing", deadPid(), 4242);

        const result = endDeadRun(task.id, "interrupted", (_current, childPid) => ({
          type: "transition",
          data: { childPid },
        }));

        expect(result).toEqual({ task: store.getTask(task.id), from: "executing", childPid: 4242 });
        expect(readRunMarker(dbPath, task.id)).toBeUndefined();
        expect(store.listEvents(task.id).at(-1)?.data).toEqual({ childPid: 4242 });
      });

      it("writes nothing and keeps the marker when check throws", () => {
        const task = runningTask("executing", deadPid(), 4242);

        expectNothingChanged(
          task.id,
          () =>
            endDeadRun(task.id, "interrupted", () => {
              throw new Error("check refused");
            }),
          "check refused",
        );
        expect(readRunMarker(dbPath, task.id)).toMatchObject({ child_pid: 4242 });
      });

      it("moves the task once when a second store on the same file calls it after", () => {
        const task = runningTask("executing", deadPid());
        const second = openStore(dbPath, { now });

        try {
          expect(endDeadRun(task.id, "interrupted")).toBeDefined();
          const events = eventCount();

          expect(endDeadRun(task.id, "interrupted", undefined, second)).toBeUndefined();

          expect(eventCount()).toBe(events);
        } finally {
          second.close();
        }
      });
    });

    describe("runStatus", () => {
      it("gives none for a task that is not in a spawning state, also with a marker", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        expect(store.runStatus(task.id)).toEqual({ status: "none" });
        writeRunMarker(dbPath, task.id, "executing", deadPid());
        expect(store.runStatus(task.id)).toEqual({ status: "none" });
      });

      it("gives running when the process of the marker is alive", () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        store.startRun(task.id, "executing");
        expect(store.runStatus(task.id)).toEqual({ status: "running", pid: process.pid });
      });

      it("gives dead with no child pid when a spawning task has no marker", () => {
        const task = store.createTask({ ...newTask, state: "executing" });
        expect(store.runStatus(task.id)).toEqual({ status: "dead", childPid: null });
      });

      it("gives dead when the process of the marker is gone, also when the child is alive", () => {
        const task = runningTask("executing", deadPid(), process.pid);
        expect(store.runStatus(task.id)).toEqual({ status: "dead", childPid: process.pid });
      });

      it("sees a process of another tasker end", async () => {
        const task = store.createTask({ ...newTask, state: "approved" });
        const child = startFixture("run-starter.ts", [dbPath, String(task.id), "executing"]);
        expect(await child.firstLine).toBe("started");
        expect(store.runStatus(task.id)).toEqual({ status: "running", pid: child.pid });
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

  it("lets two processes write to one new database at once", async () => {
    const layout = createDataRoot(join(dir, "root"));
    const count = 300;
    const run = async (issueKey: string) => {
      const child = startFixture("store-writer.ts", [layout.database, issueKey, String(count)]);
      const { code } = await child.exited;
      return { code, stderr: child.stderr() };
    };

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
  }, 60_000);
});

describe("open of a new database", () => {
  it("waits for another process that holds the write lock of a new database", async () => {
    const path = join(useTempDir("tasker-open-"), "tasker.db");
    await startWriteLockHolder(path, 500);

    withStoreFile(path, () => {});

    withRawDatabase(path, (db) => {
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect(schemaVersion(db)).toBe(migrations.length);
    });
  }, 20_000);

  it("throws database is locked after the busy timeout when the write lock of a new database stays taken", async () => {
    const path = join(useTempDir("tasker-open-"), "tasker.db");
    await startWriteLockHolder(path, 8000);

    const start = Date.now();
    expect(() => openStore(path)).toThrow("database is locked");
    expect(Date.now() - start).toBeGreaterThanOrEqual(4500);
  }, 20_000);

  it("fails at once on an error that is not SQLITE_BUSY on the switch to WAL", () => {
    const path = useTempFile("tasker-open-", "tasker.db", "x".repeat(4096));

    const start = Date.now();
    expect(() => openStore(path)).toThrow("file is not a database");
    expect(Date.now() - start).toBeLessThan(1000);
  }, 20_000);
});
