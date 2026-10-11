import { DatabaseSync } from "node:sqlite";
import { migrate, rollbackQuietly } from "./migrate.js";
import { migrations } from "./migrations.js";

export interface Task {
  id: number;
  issueKey: string;
  repoKey: string;
  state: string;
  branch: string | null;
  worktreePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewTask {
  issueKey: string;
  repoKey: string;
  state: string;
  branch?: string;
  worktreePath?: string;
}

export interface TaskChanges {
  state?: string;
  branch?: string | null;
  worktreePath?: string | null;
}

export interface TaskEvent {
  id: number;
  taskId: number;
  at: string;
  type: string;
  // null when the event has no data
  data: unknown;
}

export interface StoreOptions {
  now?: () => Date;
}

export interface TaskStore {
  createTask(task: NewTask): Task;
  getTask(id: number): Task | undefined;
  updateTask(id: number, changes: TaskChanges): Task;
  appendEvent(taskId: number, type: string, data?: unknown): TaskEvent;
  listEvents(taskId: number): TaskEvent[];
  close(): void;
}

interface TaskRow {
  id: number;
  issue_key: string;
  repo_key: string;
  state: string;
  branch: string | null;
  worktree_path: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: number;
  task_id: number;
  at: string;
  type: string;
  data: string | null;
}

function rowToEvent(row: EventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    at: row.at,
    type: row.type,
    data: row.data === null ? null : JSON.parse(row.data),
  };
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    issueKey: row.issue_key,
    repoKey: row.repo_key,
    state: row.state,
    branch: row.branch,
    worktreePath: row.worktree_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function setUp(db: DatabaseSync) {
  // The busy timeout comes first because the switch to WAL takes a lock.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, migrations);
  // The tables exist now, so the statements can be prepared.
  return {
    insertTask: db.prepare(
      `INSERT INTO tasks
         (issue_key, repo_key, state, branch, worktree_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    ),
    selectTask: db.prepare("SELECT * FROM tasks WHERE id = ?"),
    updateTask: db.prepare(
      `UPDATE tasks
       SET state = ?, branch = ?, worktree_path = ?, updated_at = ?
       WHERE id = ?
       RETURNING *`,
    ),
    insertEvent: db.prepare(
      "INSERT INTO events (task_id, at, type, data) VALUES (?, ?, ?, ?) RETURNING *",
    ),
    selectEvents: db.prepare(
      "SELECT * FROM events WHERE task_id = ? ORDER BY id",
    ),
  };
}

export function openStore(path: string, options: StoreOptions = {}): TaskStore {
  const now = options.now ?? (() => new Date());
  const db = new DatabaseSync(path);
  let statements: ReturnType<typeof setUp>;
  try {
    statements = setUp(db);
  } catch (error) {
    db.close();
    throw error;
  }

  function write<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      rollbackQuietly(db);
      throw error;
    }
  }

  function readTask(id: number): Task | undefined {
    const row = statements.selectTask.get(id) as TaskRow | undefined;
    return row === undefined ? undefined : rowToTask(row);
  }

  return {
    createTask(task) {
      return write(() => {
        const at = now().toISOString();
        const row = statements.insertTask.get(
          task.issueKey,
          task.repoKey,
          task.state,
          task.branch ?? null,
          task.worktreePath ?? null,
          at,
          at,
        ) as unknown as TaskRow;
        return rowToTask(row);
      });
    },

    getTask: readTask,

    updateTask(id, changes) {
      return write(() => {
        const current = readTask(id);
        if (current === undefined) {
          throw new Error(`task not found: ${id}`);
        }
        const next = { ...current };
        if (changes.state !== undefined) next.state = changes.state;
        if (changes.branch !== undefined) next.branch = changes.branch;
        if (changes.worktreePath !== undefined) {
          next.worktreePath = changes.worktreePath;
        }
        const row = statements.updateTask.get(
          next.state,
          next.branch,
          next.worktreePath,
          now().toISOString(),
          id,
        ) as unknown as TaskRow;
        return rowToTask(row);
      });
    },

    appendEvent(taskId, type, data) {
      return write(() => {
        const at = now().toISOString();
        const row = statements.insertEvent.get(
          taskId,
          at,
          type,
          data === undefined ? null : JSON.stringify(data),
        ) as unknown as EventRow;
        return rowToEvent(row);
      });
    },

    listEvents(taskId) {
      const rows = statements.selectEvents.all(taskId) as unknown as EventRow[];
      return rows.map(rowToEvent);
    },

    close() {
      db.close();
    },
  };
}
