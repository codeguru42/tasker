import { DatabaseSync } from "node:sqlite";
import { isSpawningState, TERMINAL_STATES } from "../state/machine.js";
import { type LockStore, tryLockIn, unlockIn } from "./locks.js";
import { migrate } from "./migrate.js";
import { migrations } from "./migrations.js";
import { pidIsLive } from "./pid.js";
import { immediateTransaction } from "./transaction.js";

// A task is active when its state is not terminal. The state names are fixed words with no quote.
const ACTIVE = `state NOT IN (${[...TERMINAL_STATES].map((s) => `'${s}'`).join(", ")})`;

export class ActiveTaskError extends Error {
  constructor(
    readonly taskId: number,
    issueKey: string,
    repoKey: string,
    state: string,
  ) {
    super(
      `the issue ${issueKey} already has an active task in the repo ${repoKey}: task ${taskId} is in ${state}`,
    );
    this.name = "ActiveTaskError";
  }
}

export type RunStatus =
  | { status: "none" }
  | { status: "running" }
  // childPid is null when the marker is missing or has no child pid.
  | { status: "dead"; childPid: number | null };

export class RunMarkerExistsError extends Error {
  constructor(
    readonly taskId: number,
    readonly state: string,
    readonly pid: number,
  ) {
    super(`task ${taskId} already has a run marker: state ${state}, process ${pid}`);
    this.name = "RunMarkerExistsError";
  }
}

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

export interface TaskFilter {
  repoKey?: string;
  issueKey?: string;
  states?: readonly string[];
}

export interface NewEvent {
  type: string;
  data?: unknown;
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

export interface TaskStore extends LockStore {
  createTask(task: NewTask): Task;
  getTask(id: number): Task | undefined;
  // With no `states`, only the active tasks. An empty `states` array matches no task.
  // The newest change comes first, and the higher id comes first on a tie.
  listTasks(filter?: TaskFilter): Task[];
  findActiveTask(repoKey: string, issueKey: string): Task | undefined;
  // The active task when one exists, else the task with the highest id.
  findLatestTask(repoKey: string, issueKey: string): Task | undefined;
  // The event that check returns is appended in the same transaction as the row write.
  updateTask(
    id: number,
    changes: TaskChanges,
    check?: (current: Task) => NewEvent | void,
  ): Task;
  // Moves the task into a spawning state and writes its run marker with the pid of this process,
  // in one transaction. The event that check returns is appended in the same transaction.
  startRun(
    id: number,
    state: string,
    check?: (current: Task) => NewEvent | void,
  ): Task;
  // Moves the task to a state that is not spawning and deletes its run marker, in one transaction.
  // The current state can be any state. The marker of any process goes, and a missing marker is not an error.
  endRun(
    id: number,
    state: string,
    check?: (current: Task) => NewEvent | void,
  ): Task;
  // Tells if the run of a task in a spawning state is alive. The process of tasker decides, never the child.
  runStatus(id: number): RunStatus;
  // Adds the pid of the child to the run marker of this process.
  setRunChildPid(id: number, childPid: number): void;
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

// The task of a row, or undefined when the query found no row.
function toTask(row: TaskRow | undefined): Task | undefined {
  return row === undefined ? undefined : rowToTask(row);
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

// The time that a process waits for a lock that another process holds.
const BUSY_TIMEOUT_MS = 5000;
const SQLITE_BUSY = 5;

// errcode can be an extended code, and its low byte is the primary code.
function isBusy(error: unknown): boolean {
  const code = (error as { errcode?: unknown }).errcode;
  return typeof code === "number" && (code & 0xff) === SQLITE_BUSY;
}

// On a new file, the switch to WAL upgrades a read lock to a write lock, and SQLite does not call
// the busy handler for that upgrade. So the switch tries again until the busy timeout ends.
function switchToWal(db: DatabaseSync): void {
  const end = Date.now() + BUSY_TIMEOUT_MS;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      db.exec("PRAGMA journal_mode = WAL");
      return;
    } catch (error) {
      if (!isBusy(error) || Date.now() >= end) throw error;
      Atomics.wait(pause, 0, 0, 10);
    }
  }
}

function setUp(db: DatabaseSync) {
  // The busy timeout comes first, because the commit of the switch to WAL and the migrations wait on it.
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  switchToWal(db);
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
    selectActiveTask: db.prepare(
      `SELECT * FROM tasks WHERE repo_key = ? AND issue_key = ? AND ${ACTIVE}`,
    ),
    selectLatestTask: db.prepare(
      `SELECT * FROM tasks WHERE repo_key = ? AND issue_key = ?
       ORDER BY (${ACTIVE}) DESC, id DESC LIMIT 1`,
    ),
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
    insertRunMarker: db.prepare(
      "INSERT INTO run_markers (task_id, state, pid, child_pid, started_at) VALUES (?, ?, ?, NULL, ?)",
    ),
    selectRunMarker: db.prepare("SELECT state, pid FROM run_markers WHERE task_id = ?"),
    setRunChildPid: db.prepare(
      "UPDATE run_markers SET child_pid = ? WHERE task_id = ? AND pid = ?",
    ),
    selectRunStatus: db.prepare(
      `SELECT tasks.state, run_markers.pid, run_markers.child_pid
       FROM tasks LEFT JOIN run_markers ON run_markers.task_id = tasks.id
       WHERE tasks.id = ?`,
    ),
    deleteRunMarker: db.prepare("DELETE FROM run_markers WHERE task_id = ?"),
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
    return toTask(statements.selectTask.get(id) as TaskRow | undefined);
  }

  // Inserts one event. It starts no transaction, because immediateTransaction() is not reentrant.
  // The caller runs it inside its own transaction.
  function writeEvent(
    taskId: number,
    at: string,
    type: string,
    data: unknown,
  ): TaskEvent {
    const row = statements.insertEvent.get(
      taskId,
      at,
      type,
      data === undefined ? null : JSON.stringify(data),
    ) as unknown as EventRow;
    return rowToEvent(row);
  }

  // Writes the changes of one task row. It starts no transaction. The caller runs it inside its own.
  function writeChanges(current: Task, changes: TaskChanges, at: string): Task {
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
      at,
      current.id,
    ) as unknown as TaskRow;
    return rowToTask(row);
  }

  return {
    createTask(task) {
      return immediateTransaction(db, () => {
        // A task that starts in a terminal state is not active, so it cannot clash.
        const active = (TERMINAL_STATES as ReadonlySet<string>).has(task.state)
          ? undefined
          : (statements.selectActiveTask.get(task.repoKey, task.issueKey) as
              | TaskRow
              | undefined);
        if (active !== undefined) {
          throw new ActiveTaskError(
            active.id,
            task.issueKey,
            task.repoKey,
            active.state,
          );
        }
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
        // The transaction helper is not reentrant, so this uses writeEvent() and not appendEvent().
        writeEvent(row.id, at, "created", { state: task.state });
        return rowToTask(row);
      });
    },

    getTask: readTask,

    listTasks(filter = {}) {
      const conditions: string[] = [];
      const params: string[] = [];
      if (filter.repoKey !== undefined) {
        conditions.push("repo_key = ?");
        params.push(filter.repoKey);
      }
      if (filter.issueKey !== undefined) {
        conditions.push("issue_key = ?");
        params.push(filter.issueKey);
      }
      if (filter.states === undefined) {
        conditions.push(ACTIVE);
      } else {
        // SQLite reads `IN ()` as false, so an empty list matches no row.
        conditions.push(`state IN (${filter.states.map(() => "?").join(", ")})`);
        params.push(...filter.states);
      }
      const rows = db
        .prepare(
          `SELECT * FROM tasks WHERE ${conditions.join(" AND ")}
           ORDER BY updated_at DESC, id DESC`,
        )
        .all(...params) as unknown as TaskRow[];
      return rows.map(rowToTask);
    },

    findActiveTask(repoKey, issueKey) {
      return toTask(
        statements.selectActiveTask.get(repoKey, issueKey) as
          | TaskRow
          | undefined,
      );
    },

    findLatestTask(repoKey, issueKey) {
      return toTask(
        statements.selectLatestTask.get(repoKey, issueKey) as
          | TaskRow
          | undefined,
      );
    },

    updateTask(id, changes, check) {
      return immediateTransaction(db, () => {
        const current = readTask(id);
        if (current === undefined) {
          throw new Error(`task not found: ${id}`);
        }
        const event = check?.(current);
        const at = now().toISOString();
        const task = writeChanges(current, changes, at);
        if (event !== undefined) writeEvent(id, at, event.type, event.data);
        return task;
      });
    },

    startRun(id, state, check) {
      return immediateTransaction(db, () => {
        const current = readTask(id);
        if (current === undefined) {
          throw new Error(`task not found: ${id}`);
        }
        const event = check?.(current);
        if (!isSpawningState(state)) {
          throw new Error(`${state} is not a spawning state`);
        }
        // A dead process also keeps its marker. A later recovery clears it.
        const marker = statements.selectRunMarker.get(id) as
          | { state: string; pid: number }
          | undefined;
        if (marker !== undefined) {
          throw new RunMarkerExistsError(id, marker.state, marker.pid);
        }
        const at = now().toISOString();
        const task = writeChanges(current, { state }, at);
        statements.insertRunMarker.run(id, state, process.pid, at);
        if (event !== undefined) writeEvent(id, at, event.type, event.data);
        return task;
      });
    },

    endRun(id, state, check) {
      return immediateTransaction(db, () => {
        const current = readTask(id);
        if (current === undefined) {
          throw new Error(`task not found: ${id}`);
        }
        const event = check?.(current);
        if (isSpawningState(state)) {
          throw new Error(`${state} is a spawning state`);
        }
        const at = now().toISOString();
        const task = writeChanges(current, { state }, at);
        statements.deleteRunMarker.run(id);
        if (event !== undefined) writeEvent(id, at, event.type, event.data);
        return task;
      });
    },

    runStatus(id) {
      // The read and the pid check share the write lock, so an endRun of another process cannot
      // commit in between and make an ended run look dead.
      return immediateTransaction(db, (): RunStatus => {
        const row = statements.selectRunStatus.get(id) as
          | { state: string; pid: number | null; child_pid: number | null }
          | undefined;
        if (row === undefined) {
          throw new Error(`task not found: ${id}`);
        }
        if (!isSpawningState(row.state)) return { status: "none" };
        if (row.pid === null) return { status: "dead", childPid: null };
        if (pidIsLive(row.pid)) return { status: "running" };
        return { status: "dead", childPid: row.child_pid };
      });
    },

    setRunChildPid(id, childPid) {
      immediateTransaction(db, () => {
        const { changes } = statements.setRunChildPid.run(childPid, id, process.pid);
        if (changes === 0) {
          throw new Error(`task ${id} has no run marker of this process`);
        }
      });
    },

    appendEvent(taskId, type, data) {
      return immediateTransaction(db, () =>
        writeEvent(taskId, now().toISOString(), type, data),
      );
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

    tryLock(name) {
      return tryLockIn(db, name, now().toISOString());
    },
    unlock(name) {
      unlockIn(db, name);
    },

    close() {
      db.close();
    },
  };
}
