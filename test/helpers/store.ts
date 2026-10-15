import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bootstrapLogPath } from "../../src/phases/bootstrap.js";
import { failTask } from "../../src/state/machine.js";
import { createDataRoot, taskLogsDir } from "../../src/store/layout.js";
import { openStore, type StoreOptions, type Task, type TaskStore } from "../../src/store/store.js";

// Runs fn with resource, then closes resource. When fn gives a promise, resource closes after the
// promise settles. When fn throws, resource closes and the error goes on.
function closeAfter<R extends { close(): void }, T>(resource: R, fn: (resource: R) => T): T {
  let result: T;
  try {
    result = fn(resource);
  } catch (error) {
    resource.close();
    throw error;
  }
  if (result instanceof Promise) return result.finally(() => resource.close()) as T;
  resource.close();
  return result;
}

// Runs fn with the open store of the database file at path, then closes the store, as closeAfter does.
export function withStoreFile<T>(path: string, fn: (store: TaskStore) => T, options?: StoreOptions): T {
  return closeAfter(openStore(path, options), fn);
}

// Runs fn with a raw connection to the SQLite file at path, then closes it, as withStoreFile does.
export function withRawDatabase<T>(path: string, fn: (db: DatabaseSync) => T): T {
  return closeAfter(new DatabaseSync(path), fn);
}

// The path of the database file of dataRoot.
export function databasePathOf(dataRoot: string): string {
  return createDataRoot(dataRoot).database;
}

// Runs fn with the open store of dataRoot. It keeps each promise of withStoreFile.
export function withDataRootStore<T>(dataRoot: string, fn: (store: TaskStore) => T, options?: StoreOptions): T {
  return withStoreFile(databasePathOf(dataRoot), fn, options);
}

// The names of the tables in db, in alphabetical order.
export function tableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

// The names in the locks table of a data root, sorted.
export function lockNames(dataRoot: string): string[] {
  return withRawDatabase(databasePathOf(dataRoot), (db) =>
    db
      .prepare("SELECT name FROM locks ORDER BY name")
      .all()
      .map((row) => String(row.name)),
  );
}

// The raw run marker row of a task in the database file at path, or undefined.
export function readRunMarker(dbPath: string, taskId: number) {
  return withRawDatabase(
    dbPath,
    (db) =>
      db.prepare("SELECT * FROM run_markers WHERE task_id = ?").get(taskId) as
        | { task_id: number; state: string; pid: number; child_pid: number | null; started_at: string }
        | undefined,
  );
}

// The latest task of issueKey in the repo codeguru42/tasker. It throws when there is none.
export function latestTaskOf(dataRoot: string, issueKey: string): Task {
  return withDataRootStore(dataRoot, (store) => {
    const task = store.findLatestTask("codeguru42/tasker", issueKey);
    if (task === undefined) throw new Error(`no task of ${issueKey}`);
    return task;
  });
}

// The events of the latest task of issueKey in the repo codeguru42/tasker, as { type, data }.
export function eventsOf(dataRoot: string, issueKey: string): { type: string; data: unknown }[] {
  const task = latestTaskOf(dataRoot, issueKey);
  return withDataRootStore(dataRoot, (store) => store.listEvents(task.id).map(({ type, data }) => ({ type, data })));
}

export interface SeedTask {
  issueKey: string;
  repoKey: string;
  state: string;
  at: string;
  title?: string;
  base?: string;
  branch?: string;
  worktreePath?: string;
  // Fails the task at its at, with this message.
  failWith?: string;
}

// Creates each task in the store of dataRoot, in order. Its created_at and updated_at are its at.
export function seedTasks(dataRoot: string, tasks: readonly SeedTask[]): Task[] {
  let at = new Date(0);
  return withDataRootStore(
    dataRoot,
    (store) =>
      tasks.map((task) => {
        at = new Date(task.at);
        const created = store.createTask({
          issueKey: task.issueKey,
          repoKey: task.repoKey,
          state: task.state,
          title: task.title,
          base: task.base,
          branch: task.branch,
          worktreePath: task.worktreePath,
        });
        return task.failWith === undefined ? created : failTask(store, created.id, task.failWith);
      }),
    { now: () => at },
  );
}

// The time 00:00 UTC of a day in January 2026, for example dayAt(2) is 2026-01-02T00:00:00.000Z.
export function dayAt(day: number): string {
  return `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;
}

// Writes text as the bootstrap log of the attempt of task under dataRoot.
export function writeBootstrapLog(dataRoot: string, task: Pick<Task, "issueKey" | "attempt">, text: string): void {
  const path = bootstrapLogPath(taskLogsDir(dataRoot, task));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// Creates the task a/b#1 in the planning state, the task that the store tests of the helpers use.
export function seedTask(store: TaskStore): Task {
  return store.createTask({ issueKey: "a/b#1", repoKey: "a/b", state: "planning" });
}
