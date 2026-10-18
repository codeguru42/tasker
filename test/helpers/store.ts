import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AssistantEvent } from "../../src/assistant/provider.js";
import { bootstrapLogPath } from "../../src/phases/bootstrap.js";
import {
  failTask,
  isSpawningState,
  isTaskState,
  lastTransitionError,
  transitionTask,
  transitionWithVerifyRun,
} from "../../src/state/machine.js";
import type { TaskState, TransitionDetail } from "../../src/state/machine.js";
import { createDataRoot, taskLogsDir, verifyCommandLogPath } from "../../src/store/layout.js";
import {
  type NewReview,
  type NewVerifyRun,
  openStore,
  type QuotaEventRecord,
  type Review,
  type StoreOptions,
  type Task,
  type TaskEvent,
  type TaskStore,
  type VerifyRun,
} from "../../src/store/store.js";
import { claudeRateLimitEvent } from "./fake-claude.js";
import { deadPid } from "./processes.js";
import { reviewFinding } from "./review.js";
import { useTempDir, writeFileWithParents } from "./temp.js";

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
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
    name: string;
  }[];
  return rows.map((row) => row.name);
}

// The number of all rows of table in db.
export function tableRowCount(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
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

// A raw row of the sessions table for a review session.
export interface ReviewSessionRow {
  task_id: number;
  role: string;
  session_id: string;
  provider: string;
  model: string;
  effort: string;
  created_at: string;
  plan_version: number | null;
  review_number: number;
}

// The raw rows of the review sessions of a task in the database of dataRoot, in the order of review_number.
export function reviewSessionRows(dataRoot: string, taskId: number): ReviewSessionRow[] {
  return withRawDatabase(
    databasePathOf(dataRoot),
    (db) =>
      db
        .prepare("SELECT * FROM sessions WHERE task_id = ? AND role = 'review' ORDER BY review_number")
        .all(taskId) as unknown as ReviewSessionRow[],
  );
}

// The raw run marker row of a task in the database file at path, or undefined.
export function readRunMarker(dbPath: string, taskId: number) {
  return withRawDatabase(
    dbPath,
    (db) =>
      db.prepare("SELECT * FROM run_markers WHERE task_id = ?").get(taskId) as
        { task_id: number; state: string; pid: number; child_pid: number | null; started_at: string } | undefined,
  );
}

// Writes a raw run marker row for a task in the database file at path. The marker holds no check of the state.
export function writeRunMarker(
  dbPath: string,
  taskId: number,
  state: string,
  pid: number,
  childPid: number | null = null,
): void {
  withRawDatabase(dbPath, (db) => {
    db.prepare("INSERT INTO run_markers (task_id, state, pid, child_pid, started_at) VALUES (?, ?, ?, ?, 't')").run(
      taskId,
      state,
      pid,
      childPid,
    );
  });
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

// The data of each event of the type of the latest task of issueKey in the repo codeguru42/tasker, in order.
export function eventDataOf(dataRoot: string, issueKey: string, type: string): unknown[] {
  return eventsOf(dataRoot, issueKey)
    .filter((event) => event.type === type)
    .map((event) => event.data);
}

// The error of the last transition event into the current state of the task, or undefined when that event has no error.
export function lastErrorOf(dataRoot: string, taskId: number): string | undefined {
  return withDataRootStore(dataRoot, (store) => {
    const state = store.getTask(taskId)?.state;
    return state !== undefined && isTaskState(state) ? lastTransitionError(store.listEvents(taskId), state) : undefined;
  });
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

// Creates each task in the store of dataRoot, in order. Its created_at and updated_at are its at. A task in a
// spawning state gets a run marker of the test process with no child, so its run status is running.
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
        if (isSpawningState(task.state)) writeRunMarker(databasePathOf(dataRoot), created.id, task.state, process.pid);
        return task.failWith === undefined ? created : failTask(store, created.id, task.failWith);
      }),
    { now: () => at },
  );
}

// The time 00:00 UTC of a day in January 2026, for example dayAt(2) is 2026-01-02T00:00:00.000Z.
export function dayAt(day: number): string {
  return `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;
}

// Creates a new data root in a temp folder and one task in it in state, at dayAt(1), with seedTasks. It gives back
// the data root and the task.
export function seedOneTask(state: string, issueKey: string, repoKey: string): { dataRoot: string; task: Task } {
  const dataRoot = join(useTempDir("tasker-seed-one-"), "data");
  const [task] = seedTasks(dataRoot, [{ issueKey, repoKey, state, at: dayAt(1) }]);
  return { dataRoot, task };
}

// Writes text as the bootstrap log of the attempt of task under dataRoot.
export function writeBootstrapLog(dataRoot: string, task: Pick<Task, "issueKey" | "attempt">, text: string): void {
  const path = bootstrapLogPath(taskLogsDir(dataRoot, task));
  writeFileWithParents(path, text);
}

// A new verify run of task with the defaults of a passed run of one command. The number defaults to the next number
// of the store. change replaces the defaults that it names, the number too.
export function newVerifyRun(store: TaskStore, taskId: number, change: Partial<NewVerifyRun> = {}): NewVerifyRun {
  return {
    number: store.nextVerifyRun(taskId),
    result: "passed",
    commands: ["npm run check"],
    failingCommand: null,
    startedAt: dayAt(1),
    endedAt: dayAt(1),
    ...change,
  };
}

// Writes a log for each command of run at its position. The logs default to one passing log for each command.
function writeVerifyLogs(
  dataRoot: string,
  task: Pick<Task, "issueKey" | "attempt">,
  run: NewVerifyRun,
  logs?: readonly string[],
): void {
  const texts = logs ?? run.commands.map((command) => `$ ${command}\n--- exit code 0\n`);
  texts.forEach((text, i) => {
    const path = verifyCommandLogPath(dataRoot, task, run.number, i + 1);
    writeFileWithParents(path, text);
  });
}

// Seeds the next verify run of task: the row, and a log for each command at its position. The task ends in state.
// The logs default to one passing log for each command. It gives back the stored run.
export function seedVerifyRun(
  store: TaskStore,
  dataRoot: string,
  task: Pick<Task, "id" | "issueKey" | "attempt">,
  change: Partial<Omit<NewVerifyRun, "number">> = {},
  logs?: readonly string[],
  state = "awaiting_work_review",
): VerifyRun {
  const run = newVerifyRun(store, task.id, change);
  writeVerifyLogs(dataRoot, task, run, logs);
  store.addVerifyRun(task.id, run, state);
  return store.getVerifyRun(task.id, run.number)!;
}

// A new review with the number and the defaults: a revision, a prompt version, the times dayAt(1) and two open
// findings. change replaces the defaults that it names.
export function newReview(number: number, change: Partial<Omit<NewReview, "number">> = {}): NewReview {
  return {
    number,
    revision: "4b825dc642cb",
    prompt: "review@3f9a1c04b2e7",
    startedAt: dayAt(1),
    endedAt: dayAt(1),
    findings: [
      reviewFinding(),
      reviewFinding({
        file: "src/b.ts",
        line: 9,
        summary: "The count is off by one.",
        failure_scenario: "A list of three items gives the count 2.",
      }),
    ],
    ...change,
  };
}

// Seeds the next review of task: the row and its findings. The task ends in state. The findings default to two
// open findings. It gives back the stored review.
export function seedReview(
  store: TaskStore,
  taskId: number,
  change: Partial<Omit<NewReview, "number">> = {},
  state = "reviewed",
): Review {
  const review = newReview(store.nextReview(taskId), change);
  store.addReview(taskId, review, state);
  return store.getReview(taskId, review.number)!;
}

// Creates task with seedTasks, then seeds one review for each change with seedReview. Each review moves the task to
// state. With no change, the task keeps the state of its seed. It gives back the task as the store holds it at the end.
export function seedTaskWithReviews(
  dataRoot: string,
  task: SeedTask,
  reviews: readonly Partial<Omit<NewReview, "number">>[] = [],
  state = "reviewed",
): Task {
  const [created] = seedTasks(dataRoot, [task]);
  return withDataRootStore(dataRoot, (store) => {
    reviews.forEach((change) => seedReview(store, created.id, change, state));
    return store.getTask(created.id)!;
  });
}

// Does a real recorded verify failure: it writes the logs, moves the task to verifying, then records the run and
// moves the task to failed with error in one transaction. The events end with verify_run, then the transition.
export function failVerifyRun(
  store: TaskStore,
  dataRoot: string,
  task: Pick<Task, "id" | "issueKey" | "attempt">,
  change: Partial<Omit<NewVerifyRun, "number">> = {},
  logs?: readonly string[],
  error = "verify failed: test",
): VerifyRun {
  const run = newVerifyRun(store, task.id, change);
  writeVerifyLogs(dataRoot, task, run, logs);
  store.startRun(task.id, "verifying");
  transitionWithVerifyRun(store, task.id, "failed", run, { error });
  return store.getVerifyRun(task.id, run.number)!;
}

// Moves the task to state with no edge check. A spawning state starts a run, so the run marker exists as in a real run.
export function placeTask(store: TaskStore, taskId: number, state: TaskState): Task {
  return isSpawningState(state) ? store.startRun(taskId, state) : store.endRun(taskId, state);
}

// Moves the task to origin with no edge check, then fails it with message. A spawning origin starts a run, so the
// run marker exists as in a real failure. failedFrom then gives origin.
export function failTaskFrom(
  store: TaskStore,
  taskId: number,
  origin: TaskState,
  message = `${origin} failed: test`,
): Task {
  placeTask(store, taskId, origin);
  return failTask(store, taskId, message);
}

// Moves the task to before with no edge check, then into origin with a real move. It records the move, so
// transitionFromEvents(events, origin) gives before. detail is the detail of the move.
function enterVia(
  store: TaskStore,
  taskId: number,
  before: TaskState,
  origin: TaskState,
  detail?: TransitionDetail,
): Task {
  placeTask(store, taskId, before);
  return transitionTask(store, taskId, origin, detail);
}

// Moves the task to before with no edge check, then into origin with a real move, then fails it with message. After it,
// transitionFromEvents(events, origin) gives before, and failedFrom gives origin.
export function failTaskVia(
  store: TaskStore,
  taskId: number,
  before: TaskState,
  origin: TaskState,
  message = `${origin} failed: test`,
): Task {
  enterVia(store, taskId, before, origin);
  return failTask(store, taskId, message);
}

// Moves the task to refineOrigin with no edge check, then into refining, then fails it with message. It records a real
// move into refining, so transitionFromEvents(events, "refining") gives refineOrigin. failedFrom gives refining.
export function failRefineFrom(
  store: TaskStore,
  taskId: number,
  refineOrigin: TaskState,
  message = "refining failed: test",
): Task {
  return failTaskVia(store, taskId, refineOrigin, "refining", message);
}

// The detail of the move into each pause, as src writes it: run-outcome.ts writes a rate limit stop with no reset time
// known, a quota warning writes the use of the window with no reset time known, and interruptDeadRun writes the dead
// run with no child process.
const PAUSE_DATA: Record<"quota_blocked" | "awaiting_quota_approval" | "interrupted", TransitionDetail> = {
  quota_blocked: { cause: "rate_limit" },
  awaiting_quota_approval: { utilization: 0.95 },
  interrupted: { cause: "dead_run", childPid: null },
};

// Moves the task to origin with no edge check, then pauses it. A spawning origin starts a run, so the run marker exists
// as in a real pause. transitionFromEvents(events, pause) gives origin. data replaces the default detail of the pause,
// for example { cause: "rate_limit", resetsAt } for a quota stop with a known reset time.
export function pauseTaskFrom(
  store: TaskStore,
  taskId: number,
  origin: TaskState,
  pause: "quota_blocked" | "awaiting_quota_approval" | "interrupted",
  data?: TransitionDetail,
): Task {
  placeTask(store, taskId, origin);
  return transitionTask(store, taskId, pause, data ?? PAUSE_DATA[pause]);
}

// Moves the task to before with no edge check, then into origin with a real move, then into interrupted. After it,
// transitionFromEvents(events, origin) gives before, and transitionFromEvents(events, "interrupted") gives origin.
// detail is the detail of the move into origin, for example { head } for the move into updating_branch.
export function pauseTaskVia(
  store: TaskStore,
  taskId: number,
  before: TaskState,
  origin: TaskState,
  detail?: TransitionDetail,
): Task {
  enterVia(store, taskId, before, origin, detail);
  return transitionTask(store, taskId, "interrupted", PAUSE_DATA.interrupted);
}

// Moves the task to refineOrigin with no edge check, then into refining, then pauses it. feedback is the feedback that
// the move into refining records, when one is given. transitionFromEvents(events, "refining") gives refineOrigin. data
// replaces the default detail of the pause, as in pauseTaskFrom.
export function pauseRefineFrom(
  store: TaskStore,
  taskId: number,
  refineOrigin: TaskState,
  pause: "quota_blocked" | "awaiting_quota_approval" | "interrupted",
  feedback?: string,
  data?: TransitionDetail,
): Task {
  enterVia(store, taskId, refineOrigin, "refining", feedback === undefined ? undefined : { feedback });
  return transitionTask(store, taskId, pause, data ?? PAUSE_DATA[pause]);
}

// Creates the task a/b#1 in the planning state, the task that the store tests of the helpers use.
export function seedTask(store: TaskStore): Task {
  return store.createTask({ issueKey: "a/b#1", repoKey: "a/b", state: "planning" });
}

// Records the approval of the quota window that resets at resetsAt, as tasker approve-credits does. It gives back the
// event as the store holds it.
export function seedCreditsApproval(store: TaskStore, taskId: number, resetsAt: number): TaskEvent {
  return store.appendEvent(taskId, "credits_approved", { resetsAt });
}

// Records the approval of the window that resets at resetsAt for the task, in the store of dataRoot. It gives back the
// event.
export function seedCreditsApprovalIn(dataRoot: string, taskId: number, resetsAt: number): TaskEvent {
  return withDataRootStore(dataRoot, (store) => seedCreditsApproval(store, taskId, resetsAt));
}

// Records event as the last quota event of repoKey, with the provider claude-code, in the store of dataRoot. It gives
// back the record as the store holds it.
export function seedQuotaEvent(
  dataRoot: string,
  repoKey: string,
  event: AssistantEvent = claudeRateLimitEvent(),
): QuotaEventRecord {
  return withDataRootStore(dataRoot, (store) => {
    store.recordQuotaEvent(repoKey, "claude-code", event);
    return store.listQuotaEvents(repoKey)[0];
  });
}

// The quota event records of the store of dataRoot, sorted by repo key.
export function quotaEventsOf(dataRoot: string): QuotaEventRecord[] {
  return withDataRootStore(dataRoot, (store) => store.listQuotaEvents());
}

// Moves the task to the spawning state, then writes a run marker of a pid that is gone, so the run status is dead
// with childPid. It gives back the task.
export function seedDeadRun(dataRoot: string, taskId: number, state: string, childPid: number | null = null): Task {
  const task = withDataRootStore(dataRoot, (store) => store.updateTask(taskId, { state }));
  writeRunMarker(databasePathOf(dataRoot), taskId, state, deadPid(), childPid);
  return task;
}
