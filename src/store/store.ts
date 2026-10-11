import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrate.js";
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

export interface StoreOptions {
  now?: () => Date;
}

export interface TaskStore {
  createTask(task: NewTask): Task;
  getTask(id: number): Task | undefined;
  updateTask(id: number, changes: TaskChanges): Task;
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

export function openStore(path: string, options: StoreOptions = {}): TaskStore {
  const now = options.now ?? (() => new Date());
  const db = new DatabaseSync(path);
  migrate(db, migrations);

  function write<T>(fn: () => T): T {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function readTask(id: number): Task | undefined {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | TaskRow
      | undefined;
    return row === undefined ? undefined : rowToTask(row);
  }

  return {
    createTask(task) {
      return write(() => {
        const at = now().toISOString();
        const result = db
          .prepare(
            `INSERT INTO tasks
               (issue_key, repo_key, state, branch, worktree_path, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            task.issueKey,
            task.repoKey,
            task.state,
            task.branch ?? null,
            task.worktreePath ?? null,
            at,
            at,
          );
        return readTask(Number(result.lastInsertRowid)) as Task;
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
        db.prepare(
          `UPDATE tasks
           SET state = ?, branch = ?, worktree_path = ?, updated_at = ?
           WHERE id = ?`,
        ).run(next.state, next.branch, next.worktreePath, now().toISOString(), id);
        return readTask(id) as Task;
      });
    },

    close() {
      db.close();
    },
  };
}
