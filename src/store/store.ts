import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrate.js";
import { migrations } from "./migrations.js";
import { immediateTransaction } from "./transaction.js";

export interface Task {
  id: number;
  issueKey: string;
  repoKey: string;
  state: string;
  branch: string | null;
  worktreePath: string | null;
  title: string | null;
  shortRef: string | null;
  base: string | null;
  attempt: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewTask {
  issueKey: string;
  repoKey: string;
  state: string;
  branch?: string;
  worktreePath?: string;
  title?: string;
  shortRef?: string;
  base?: string;
}

export interface TaskChanges {
  state?: string;
  branch?: string | null;
  worktreePath?: string | null;
  title?: string | null;
  shortRef?: string | null;
  base?: string | null;
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
  updateTask(id: number, changes: TaskChanges, check?: (current: Task) => void): Task;
  appendEvent(taskId: number, type: string, data?: unknown): TaskEvent;
  listEvents(taskId: number): TaskEvent[];
  getDefaultBaseBranch(repoKey: string): string | undefined;
  setDefaultBaseBranch(repoKey: string, branch: string): void;
  // Deletes the row only when it holds this branch. A value that another process saved stays.
  forgetDefaultBaseBranch(repoKey: string, branch: string): void;
  close(): void;
}

interface TaskRow {
  id: number;
  issue_key: string;
  repo_key: string;
  state: string;
  branch: string | null;
  worktree_path: string | null;
  title: string | null;
  short_ref: string | null;
  base: string | null;
  attempt: number;
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
    title: row.title,
    shortRef: row.short_ref,
    base: row.base,
    attempt: row.attempt,
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
         (issue_key, repo_key, state, branch, worktree_path, title, short_ref, base,
          attempt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    ),
    selectTask: db.prepare("SELECT * FROM tasks WHERE id = ?"),
    // The count covers all repos, because the issue key is the same in each of them.
    selectNextAttempt: db.prepare(
      "SELECT COALESCE(MAX(attempt), 0) + 1 AS next FROM tasks WHERE issue_key = ?",
    ),
    updateTask: db.prepare(
      `UPDATE tasks
       SET state = ?, branch = ?, worktree_path = ?, title = ?, short_ref = ?, base = ?,
           updated_at = ?
       WHERE id = ?
       RETURNING *`,
    ),
    insertEvent: db.prepare(
      "INSERT INTO events (task_id, at, type, data) VALUES (?, ?, ?, ?) RETURNING *",
    ),
    selectEvents: db.prepare(
      "SELECT * FROM events WHERE task_id = ? ORDER BY id",
    ),
    selectDefaultBaseBranch: db.prepare(
      "SELECT branch FROM default_base_branches WHERE repo_key = ?",
    ),
    upsertDefaultBaseBranch: db.prepare(
      `INSERT INTO default_base_branches (repo_key, branch, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(repo_key) DO UPDATE SET
         branch = excluded.branch, updated_at = excluded.updated_at`,
    ),
    deleteDefaultBaseBranch: db.prepare(
      "DELETE FROM default_base_branches WHERE repo_key = ? AND branch = ?",
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

  function readTask(id: number): Task | undefined {
    const row = statements.selectTask.get(id) as TaskRow | undefined;
    return row === undefined ? undefined : rowToTask(row);
  }

  return {
    createTask(task) {
      return immediateTransaction(db, () => {
        const at = now().toISOString();
        const { next } = statements.selectNextAttempt.get(task.issueKey) as {
          next: number;
        };
        const row = statements.insertTask.get(
          task.issueKey,
          task.repoKey,
          task.state,
          task.branch ?? null,
          task.worktreePath ?? null,
          task.title ?? null,
          task.shortRef ?? null,
          task.base ?? null,
          next,
          at,
          at,
        ) as unknown as TaskRow;
        return rowToTask(row);
      });
    },

    getTask: readTask,

    updateTask(id, changes, check) {
      return immediateTransaction(db, () => {
        const current = readTask(id);
        if (current === undefined) {
          throw new Error(`task not found: ${id}`);
        }
        check?.(current);
        const next = { ...current };
        if (changes.state !== undefined) next.state = changes.state;
        if (changes.branch !== undefined) next.branch = changes.branch;
        if (changes.worktreePath !== undefined) {
          next.worktreePath = changes.worktreePath;
        }
        if (changes.title !== undefined) next.title = changes.title;
        if (changes.shortRef !== undefined) next.shortRef = changes.shortRef;
        if (changes.base !== undefined) next.base = changes.base;
        const row = statements.updateTask.get(
          next.state,
          next.branch,
          next.worktreePath,
          next.title,
          next.shortRef,
          next.base,
          now().toISOString(),
          id,
        ) as unknown as TaskRow;
        return rowToTask(row);
      });
    },

    appendEvent(taskId, type, data) {
      return immediateTransaction(db, () => {
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

    getDefaultBaseBranch(repoKey) {
      const row = statements.selectDefaultBaseBranch.get(repoKey) as
        | { branch: string }
        | undefined;
      return row?.branch;
    },

    setDefaultBaseBranch(repoKey, branch) {
      immediateTransaction(db, () => {
        statements.upsertDefaultBaseBranch.run(repoKey, branch, now().toISOString());
      });
    },

    forgetDefaultBaseBranch(repoKey, branch) {
      immediateTransaction(db, () => {
        statements.deleteDefaultBaseBranch.run(repoKey, branch);
      });
    },

    close() {
      db.close();
    },
  };
}
