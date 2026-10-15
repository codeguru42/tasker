import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { AssistantProviderId, Effort, RecordedSession } from "../assistant/provider.js";
import type { PlanAnswer } from "../plan/answer.js";
import type { Finding } from "../review/answer.js";
import type { FindingEntry } from "../review/findings-text.js";
import { isSpawningState, isTerminalState, TERMINAL_STATES } from "../state/machine.js";
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

type PlanQuestion = PlanAnswer["questions"][number];

// A question is resolved when the next revision has no question with the same id.
export type PlanQuestionState =
  | { question: PlanQuestion; state: "open" }
  | { question: PlanQuestion; state: "resolved"; version: number; answer: string | null };

type ResolvedPlanQuestion = Extract<PlanQuestionState, { state: "resolved" }>;

// Later tickets add more sources, for example a review promotion. The table has no check on the values.
export type PlanRevisionSource = "plan" | "refine";

export interface NewPlanRevision {
  version: number;
  source: PlanRevisionSource;
  // None for the first revision.
  feedback?: string;
  answer: PlanAnswer;
  // The prompt version of the run, for example plan@3f9a1c04b2e7.
  prompt: string;
}

export interface PlanRevision {
  taskId: number;
  version: number;
  source: string;
  feedback: string | null;
  answer: PlanAnswer;
  prompt: string;
  approvedAt: string | null;
  createdAt: string;
}

// The result of a verify run. tasker verify decides it, and the store only keeps it. The table refuses another value.
export type VerifyRunResult = "passed" | "failed" | "timed_out" | "dirty_before" | "dirty_after";

export interface NewVerifyRun {
  number: number;
  result: VerifyRunResult;
  // The commands that the run started, in order. A command that the deadline kept from its start is not in the list.
  commands: string[];
  // The position (from 1) of the failing command, or null for a run that passed. It can be one more than the number
  // of started commands, when the deadline came before the failing command started. That command has no log.
  failingCommand: number | null;
  // The caller gives both times. The store does not take them from its clock.
  startedAt: string;
  endedAt: string;
}

export interface VerifyRun extends NewVerifyRun {
  taskId: number;
}

export interface NewReview {
  number: number;
  // The revision of the worktree that the review read. The findings describe this one tree.
  revision: string;
  // The prompt version of the run, for example review@3f9a1c04b2e7.
  prompt: string;
  // The caller gives both times. The store does not take them from its clock.
  startedAt: string;
  endedAt: string;
  findings: Finding[];
}

export interface Review extends Omit<NewReview, "findings"> {
  taskId: number;
  // In the order of their positions.
  findings: FindingEntry[];
}

// A session that the store holds: what it recorded when it started, and its id.
export interface StoredSession extends RecordedSession {
  sessionId: string;
}

// The repo comes from the task, so the caller does not give it.
export type NewSession = Omit<StoredSession, "repoKey">;

// A todo with no row is not started, so the table stores only the two other states.
export type ExecuteTodoState = "in_progress" | "done";

type PlanTodo = PlanAnswer["todos"][number];

// A fix turn is one more turn of the execute session. It gives the assistant the error of a failed verify run.
export interface NewExecuteFixTurn {
  verifyFailure: string;
  verifyLogTail: string | null;
}

// The writes of a retry beside the move. They share the transaction of the move.
export interface RetryWrites {
  clearPlanSession?: boolean;
  // The version of the pinned revision whose execute session goes.
  clearExecuteSession?: number;
  // Marks every todo of the version done and queues the fix turn of the version.
  resumeExecute?: { version: number; fixTurn: NewExecuteFixTurn };
}

export interface ExecuteFixTurn extends NewExecuteFixTurn {
  queuedAt: string;
}

export interface ExecuteTodoProgress {
  todo: PlanTodo;
  state: ExecuteTodoState | "not_started";
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
  // A low-level write with no run marker rule. A state move goes through transitionTask.
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
  // The version that the next revision of the task must have. The caller holds the task lock,
  // so the value stays valid until the insert.
  nextPlanVersion(taskId: number): number;
  // Inserts the plan revision, appends the plan_revision event { version, prompt }, moves the task to a state
  // that is not spawning and deletes its run marker, in one transaction. The event that check returns is
  // appended in the same transaction. A throw writes nothing.
  addPlanRevision(
    taskId: number,
    revision: NewPlanRevision,
    state: string,
    check?: (current: Task) => NewEvent | void,
  ): Task;
  getPlanRevision(taskId: number, version: number): PlanRevision | undefined;
  // The number that the next verify run of the task must have. The caller holds the task lock,
  // so the value stays valid until the insert.
  nextVerifyRun(taskId: number): number;
  // Inserts the verify run, appends the verify_run event { number, result }, moves the task to a state
  // that is not spawning and deletes its run marker, in one transaction. The event that check returns is
  // appended in the same transaction. A throw writes nothing.
  addVerifyRun(taskId: number, run: NewVerifyRun, state: string, check?: (current: Task) => NewEvent | void): Task;
  // The number of verify runs of the task.
  verifyRunCount(taskId: number): number;
  getVerifyRun(taskId: number, number: number): VerifyRun | undefined;
  // The run with the highest number.
  latestVerifyRun(taskId: number): VerifyRun | undefined;
  // The number that the next review of the task must have. The caller holds the task lock,
  // so the value stays valid until the insert.
  nextReview(taskId: number): number;
  // Inserts the review and its findings, appends the review event { number, revision, findings },
  // moves the task to a state that is not spawning and deletes its run marker, in one transaction.
  // The findings get the positions 1, 2, and so on. The event that check returns is appended in the
  // same transaction. A throw writes nothing.
  addReview(taskId: number, review: NewReview, state: string, check?: (current: Task) => NewEvent | void): Task;
  // The number of reviews of the task.
  reviewCount(taskId: number): number;
  getReview(taskId: number, number: number): Review | undefined;
  // The review with the highest number.
  latestReview(taskId: number): Review | undefined;
  // The reviews of the task, oldest first.
  listReviews(taskId: number): Review[];
  // The revision with the highest version.
  latestPlanRevision(taskId: number): PlanRevision | undefined;
  // The approved revision with the highest version.
  pinnedPlanRevision(taskId: number): PlanRevision | undefined;
  // Moves the task to a state that is not spawning, deletes its run marker and sets the approval time
  // of the revision, in one transaction. Only the newest revision can be approved.
  // The event that check returns is appended in the same transaction.
  approvePlanRevision(
    taskId: number,
    version: number,
    state: string,
    check?: (current: Task) => NewEvent | void,
  ): Task;
  // Moves the task to a state that is not spawning, deletes its run marker and clears the approval
  // of revision version, in one transaction. Only the pinned revision can be cleared: another version throws and
  // writes nothing. The event that check returns is appended in the same transaction.
  clearPlanApproval(
    taskId: number,
    version: number,
    state: string,
    check?: (current: Task) => NewEvent | void,
  ): Task;
  // The questions of a revision with their state. The newest revision has only open questions.
  // A resolved question names the next version, and its answer is the feedback of that version.
  planQuestions(taskId: number, version: number): PlanQuestionState[];
  // The questions of the revisions before `version` that a later revision up to `version` resolves.
  // The order is by the resolving version, then by the order of the questions in the revision.
  // The revision must exist.
  resolvedQuestionsThrough(taskId: number, version: number): ResolvedPlanQuestion[];
  // Records the plan session of a task once, before the run. The same id again writes nothing and
  // gives the stored session. Another id is an error that names both ids.
  recordPlanSession(taskId: number, session: NewSession): StoredSession;
  // The plan session of a task, or undefined when the task has none.
  planSession(taskId: number): StoredSession | undefined;
  // Records the execute session of a plan revision once, before the run. The same id again writes
  // nothing and gives the stored session. Another id is an error that names both ids.
  // A task that does not exist is an error. A version with no plan revision is an error.
  recordExecuteSession(taskId: number, version: number, session: NewSession): StoredSession;
  // The execute session of a plan revision, or undefined when the revision has none.
  executeSession(taskId: number, version: number): StoredSession | undefined;
  // Sets the state of one todo of a plan revision and the time of the change. The todo must be a todo
  // of the plan revision, and the revision must exist.
  setExecuteTodoState(taskId: number, version: number, todoId: string, state: ExecuteTodoState): void;
  // The todos of a plan revision in the order of the plan, each with its state. A todo with no row is not started.
  executeTodoProgress(taskId: number, version: number): ExecuteTodoProgress[];
  // Sets every todo of a plan revision to done, with one time, in one transaction. The revision must exist. This is a
  // method of the store interface, and no code in src calls it: tasker retry runs the same step inside the transaction
  // of the move, through retryTask. Code in src that changes a task must use retryTask, so that the move and the write
  // stay one step.
  markExecuteTodosDone(taskId: number, version: number): void;
  // Queues the fix turn of a plan revision. A new fix turn replaces the old one, also when the old one is done.
  // The revision must exist. This is a method of the store interface, and no code in src calls it: tasker retry runs
  // the same step inside the transaction of the move, through retryTask. Code in src that changes a task must use
  // retryTask, so that the move and the write stay one step.
  queueExecuteFixTurn(taskId: number, version: number, turn: NewExecuteFixTurn): void;
  // The queued fix turn of a plan revision, or undefined when it has none or the turn is done.
  queuedExecuteFixTurn(taskId: number, version: number): ExecuteFixTurn | undefined;
  // The state of the fix turn of a plan revision: queued, done, or undefined when the revision has none.
  executeFixTurnState(taskId: number, version: number): "queued" | "done" | undefined;
  // Marks the queued fix turn of a plan revision done. A revision with no queued fix turn is an error, also when its
  // fix turn is already done. The time of an earlier done mark does not change.
  markExecuteFixTurnDone(taskId: number, version: number): void;
  // Deletes the plan session of a task. A missing row is not an error. A run that failed before its first turn recorded
  // an id that no conversation holds, so the next run must not continue that id. This is a method of the store
  // interface, and no code in src calls it: tasker retry runs the same step inside the transaction of the move, through
  // retryTask. Code in src that changes a task must use retryTask, so that the move and the write stay one step.
  clearPlanSession(taskId: number): void;
  // Deletes the execute session of a plan revision. A missing row is not an error. The reason is the same as for
  // clearPlanSession. This is a method of the store interface, and no code in src calls it: tasker retry runs the same
  // step inside the transaction of the move, through retryTask. Code in src that changes a task must use retryTask, so
  // that the move and the write stay one step.
  clearExecuteSession(taskId: number, version: number): void;
  // The writes of a retry beside the move: the move to state, the run marker delete, the writes and the event of
  // check, in one transaction. A throw of any step writes nothing.
  retryTask(
    taskId: number,
    state: string,
    writes: RetryWrites,
    check?: (current: Task) => NewEvent | void,
  ): Task;
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

interface PlanRevisionRow {
  task_id: number;
  version: number;
  source: string;
  feedback: string | null;
  answer: string;
  prompt: string;
  approved_at: string | null;
  created_at: string;
}

function rowToPlanRevision(row: PlanRevisionRow): PlanRevision {
  return {
    taskId: row.task_id,
    version: row.version,
    source: row.source,
    feedback: row.feedback,
    answer: JSON.parse(row.answer) as PlanAnswer,
    prompt: row.prompt,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

// The plan revision of a row, or undefined when the query found no row.
function toPlanRevision(row: PlanRevisionRow | undefined): PlanRevision | undefined {
  return row === undefined ? undefined : rowToPlanRevision(row);
}

interface VerifyRunRow {
  task_id: number;
  number: number;
  result: VerifyRunResult;
  commands: string;
  failing_command: number | null;
  started_at: string;
  ended_at: string;
}

function toVerifyRun(row: VerifyRunRow | undefined): VerifyRun | undefined {
  if (row === undefined) return undefined;
  return {
    taskId: row.task_id,
    number: row.number,
    result: row.result,
    commands: JSON.parse(row.commands) as string[],
    failingCommand: row.failing_command,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

interface ReviewRow {
  task_id: number;
  number: number;
  revision: string;
  prompt: string;
  started_at: string;
  ended_at: string;
}

interface ReviewFindingRow {
  position: number;
  file: string;
  line: number | null;
  category: string | null;
  summary: string;
  failure_scenario: string;
  dismissed_at: string | null;
  dismiss_reason: string | null;
}

function toFindingEntry(row: ReviewFindingRow): FindingEntry {
  const finding: Finding = { file: row.file, summary: row.summary, failure_scenario: row.failure_scenario };
  if (row.line !== null) finding.line = row.line;
  if (row.category !== null) finding.category = row.category;
  const dismissed =
    row.dismissed_at === null ? null : { at: row.dismissed_at, reason: row.dismiss_reason as string };
  return { position: row.position, finding, dismissed };
}

interface PlanSessionRow {
  session_id: string;
  provider: string;
  model: string;
  effort: string;
  repo_key: string;
}

// The stored session of a row, or undefined when the query found no row.
function toStoredSession(row: PlanSessionRow | undefined): StoredSession | undefined {
  return row === undefined
    ? undefined
    : {
        sessionId: row.session_id,
        repoKey: row.repo_key,
        provider: row.provider as AssistantProviderId,
        model: row.model,
        effort: row.effort as Effort,
      };
}

// The time that a process waits for a lock that another process holds.
const BUSY_TIMEOUT_MS = 5000;
const SQLITE_BUSY = 5;

// The error of a task id that the store does not hold.
export function taskNotFound(id: number): Error {
  return new Error(`task not found: ${id}`);
}

function noPlanRevision(taskId: number, version: number): Error {
  return new Error(`task ${taskId} has no plan revision ${version}`);
}

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
    insertPlanRevision: db.prepare(
      `INSERT INTO plan_revisions
         (task_id, version, source, feedback, answer, prompt, approved_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
       RETURNING *`,
    ),
    selectPlanRevision: db.prepare(
      "SELECT * FROM plan_revisions WHERE task_id = ? AND version = ?",
    ),
    selectLatestPlanRevision: db.prepare(
      "SELECT * FROM plan_revisions WHERE task_id = ? ORDER BY version DESC LIMIT 1",
    ),
    insertPlanSession: db.prepare(
      `INSERT INTO sessions (task_id, role, session_id, provider, model, effort, created_at)
       VALUES (?, 'plan', ?, ?, ?, ?, ?)`,
    ),
    selectPlanSession: db.prepare(
      `SELECT sessions.session_id, sessions.provider, sessions.model, sessions.effort, tasks.repo_key
       FROM sessions JOIN tasks ON tasks.id = sessions.task_id
       WHERE sessions.task_id = ? AND sessions.role = 'plan'`,
    ),
    insertExecuteSession: db.prepare(
      `INSERT INTO sessions (task_id, role, session_id, provider, model, effort, created_at, plan_version)
       VALUES (?, 'execute', ?, ?, ?, ?, ?, ?)`,
    ),
    selectExecuteSession: db.prepare(
      `SELECT sessions.session_id, sessions.provider, sessions.model, sessions.effort, tasks.repo_key
       FROM sessions JOIN tasks ON tasks.id = sessions.task_id
       WHERE sessions.task_id = ? AND sessions.role = 'execute' AND sessions.plan_version = ?`,
    ),
    deletePlanSession: db.prepare("DELETE FROM sessions WHERE task_id = ? AND role = 'plan'"),
    deleteExecuteSession: db.prepare(
      "DELETE FROM sessions WHERE task_id = ? AND role = 'execute' AND plan_version = ?",
    ),
    upsertExecuteTodo: db.prepare(
      `INSERT INTO execute_todos (task_id, plan_version, todo_id, state, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(task_id, plan_version, todo_id)
       DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
    ),
    selectExecuteTodos: db.prepare(
      "SELECT todo_id, state FROM execute_todos WHERE task_id = ? AND plan_version = ?",
    ),
    upsertExecuteFixTurn: db.prepare(
      `INSERT INTO execute_fix_turns (task_id, plan_version, verify_failure, verify_log_tail, queued_at, done_at)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(task_id, plan_version)
       DO UPDATE SET verify_failure = excluded.verify_failure, verify_log_tail = excluded.verify_log_tail,
         queued_at = excluded.queued_at, done_at = NULL`,
    ),
    selectQueuedExecuteFixTurn: db.prepare(
      `SELECT verify_failure, verify_log_tail, queued_at FROM execute_fix_turns
       WHERE task_id = ? AND plan_version = ? AND done_at IS NULL`,
    ),
    selectExecuteFixTurnDoneAt: db.prepare(
      "SELECT done_at FROM execute_fix_turns WHERE task_id = ? AND plan_version = ?",
    ),
    updateExecuteFixTurnDone: db.prepare(
      "UPDATE execute_fix_turns SET done_at = ? WHERE task_id = ? AND plan_version = ? AND done_at IS NULL",
    ),
    selectNextPlanVersion: db.prepare(
      "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM plan_revisions WHERE task_id = ?",
    ),
    selectNextVerifyRun: db.prepare(
      "SELECT COALESCE(MAX(number), 0) + 1 AS next FROM verify_runs WHERE task_id = ?",
    ),
    insertVerifyRun: db.prepare(
      `INSERT INTO verify_runs (task_id, number, result, commands, failing_command, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    selectVerifyRun: db.prepare("SELECT * FROM verify_runs WHERE task_id = ? AND number = ?"),
    selectLatestVerifyRun: db.prepare(
      "SELECT * FROM verify_runs WHERE task_id = ? ORDER BY number DESC LIMIT 1",
    ),
    selectVerifyRunCount: db.prepare("SELECT COUNT(*) AS n FROM verify_runs WHERE task_id = ?"),
    selectNextReview: db.prepare(
      "SELECT COALESCE(MAX(number), 0) + 1 AS next FROM reviews WHERE task_id = ?",
    ),
    insertReview: db.prepare(
      `INSERT INTO reviews (task_id, number, revision, prompt, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    insertReviewFinding: db.prepare(
      `INSERT INTO review_findings (task_id, number, position, file, line, category, summary, failure_scenario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    selectReview: db.prepare("SELECT * FROM reviews WHERE task_id = ? AND number = ?"),
    selectLatestReview: db.prepare("SELECT * FROM reviews WHERE task_id = ? ORDER BY number DESC LIMIT 1"),
    selectReviews: db.prepare("SELECT * FROM reviews WHERE task_id = ? ORDER BY number"),
    selectReviewCount: db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE task_id = ?"),
    selectReviewFindings: db.prepare(
      "SELECT * FROM review_findings WHERE task_id = ? AND number = ? ORDER BY position",
    ),
    selectPinnedPlanRevision: db.prepare(
      `SELECT * FROM plan_revisions WHERE task_id = ? AND approved_at IS NOT NULL
       ORDER BY version DESC LIMIT 1`,
    ),
    setPlanApproval: db.prepare(
      "UPDATE plan_revisions SET approved_at = ? WHERE task_id = ? AND version = ?",
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

  function readPlanRevision(taskId: number, version: number): PlanRevision | undefined {
    return toPlanRevision(
      statements.selectPlanRevision.get(taskId, version) as PlanRevisionRow | undefined,
    );
  }

  function readPlanSession(taskId: number): StoredSession | undefined {
    return toStoredSession(statements.selectPlanSession.get(taskId) as PlanSessionRow | undefined);
  }

  // The one home of the open/resolved rule of a question.
  function readPlanQuestions(taskId: number, version: number): PlanQuestionState[] {
    const revision = readPlanRevision(taskId, version);
    if (revision === undefined) throw noPlanRevision(taskId, version);
    const next = readPlanRevision(taskId, version + 1);
    return revision.answer.questions.map((question): PlanQuestionState => {
      if (next === undefined || next.answer.questions.some((q) => q.id === question.id)) {
        return { question, state: "open" };
      }
      return { question, state: "resolved", version: next.version, answer: next.feedback };
    });
  }

  function readExecuteSession(taskId: number, version: number): StoredSession | undefined {
    return toStoredSession(
      statements.selectExecuteSession.get(taskId, version) as PlanSessionRow | undefined,
    );
  }

  // The record-once rule of a session: the same id gives the stored session, another id is an error, else insert.
  function recordSessionOnce(
    stored: StoredSession | undefined,
    session: NewSession,
    repoKey: string,
    conflict: (storedId: string) => string,
    insert: () => void,
  ): StoredSession {
    if (stored !== undefined) {
      if (stored.sessionId === session.sessionId) return stored;
      throw new Error(conflict(stored.sessionId));
    }
    insert();
    return { ...session, repoKey };
  }

  function readLatestPlanRevision(taskId: number): PlanRevision | undefined {
    return toPlanRevision(
      statements.selectLatestPlanRevision.get(taskId) as PlanRevisionRow | undefined,
    );
  }

  function readPinnedPlanRevision(taskId: number): PlanRevision | undefined {
    return toPlanRevision(
      statements.selectPinnedPlanRevision.get(taskId) as PlanRevisionRow | undefined,
    );
  }

  // Runs a next-number statement of a task. The caller holds the task lock or a transaction.
  function readNext(statement: StatementSync, taskId: number): number {
    const { next } = statement.get(taskId) as { next: number };
    return next;
  }

  function readNextPlanVersion(taskId: number): number {
    return readNext(statements.selectNextPlanVersion, taskId);
  }

  function readNextVerifyRun(taskId: number): number {
    return readNext(statements.selectNextVerifyRun, taskId);
  }

  function readNextReview(taskId: number): number {
    return readNext(statements.selectNextReview, taskId);
  }

  // Throws when the given number of a new row is not the next one.
  function requireNext(taskId: number, what: string, given: number, next: number, unit: string): void {
    if (given !== next) {
      throw new Error(`task ${taskId}: ${what} ${given} is not the next ${unit} (${next})`);
    }
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

  // The one transaction frame of a task write: read the task, run check, take the clock once, run
  // the marker step, write the row and append the event of check. A throw from check or from the
  // marker step refuses the move, and then nothing is written.
  function writeTask(
    id: number,
    changes: TaskChanges,
    check: ((current: Task) => NewEvent | void) | undefined,
    markerStep?: (at: string) => void,
  ): Task {
    return immediateTransaction(db, () => {
      const current = readTask(id);
      if (current === undefined) {
        throw taskNotFound(id);
      }
      const event = check?.(current);
      const at = now().toISOString();
      markerStep?.(at);
      const task = writeChanges(current, changes, at);
      if (event !== undefined) writeEvent(id, at, event.type, event.data);
      return task;
    });
  }

  // The frame of a new row at the end of a run: the insert, its event, the move to a state that is
  // not spawning and the marker delete, in one transaction.
  function addRowAtRunEnd(
    taskId: number,
    state: string,
    check: ((current: Task) => NewEvent | void) | undefined,
    insert: () => NewEvent,
  ): Task {
    return writeTask(taskId, { state }, check, (at) => {
      endRunStep(taskId, state);
      const event = insert();
      writeEvent(taskId, at, event.type, event.data);
    });
  }

  // The marker step of a move to a state that is not spawning: it deletes the run marker.
  function endRunStep(id: number, state: string): void {
    if (isSpawningState(state)) {
      throw new Error(`${state} is a spawning state`);
    }
    statements.deleteRunMarker.run(id);
  }

  // The steps of the todo marks, the fix turn and the session clears. They open no transaction, so the caller must
  // have one open. The public methods and retryTask share them.
  function markExecuteTodosDoneStep(taskId: number, version: number, at: string): void {
    const revision = readPlanRevision(taskId, version);
    if (revision === undefined) throw noPlanRevision(taskId, version);
    for (const todo of revision.answer.todos) {
      statements.upsertExecuteTodo.run(taskId, version, todo.id, "done", at);
    }
  }

  function queueExecuteFixTurnStep(taskId: number, version: number, turn: NewExecuteFixTurn, at: string): void {
    if (readPlanRevision(taskId, version) === undefined) throw noPlanRevision(taskId, version);
    statements.upsertExecuteFixTurn.run(taskId, version, turn.verifyFailure, turn.verifyLogTail, at);
  }

  function clearPlanSessionStep(taskId: number): void {
    statements.deletePlanSession.run(taskId);
  }

  function clearExecuteSessionStep(taskId: number, version: number): void {
    statements.deleteExecuteSession.run(taskId, version);
  }

  // The row insert of a plan revision. It checks the version and opens no transaction, so the
  // caller must have one open.
  function writePlanRevision(taskId: number, revision: NewPlanRevision): PlanRevision {
    const next = readNextPlanVersion(taskId);
    requireNext(taskId, "plan revision", revision.version, next, "version");
    const row = statements.insertPlanRevision.get(
      taskId,
      revision.version,
      revision.source,
      revision.feedback ?? null,
      JSON.stringify(revision.answer),
      revision.prompt,
      now().toISOString(),
    ) as unknown as PlanRevisionRow;
    return rowToPlanRevision(row);
  }

  // The row insert of a verify run. It checks the number and opens no transaction, so the
  // caller must have one open.
  function writeVerifyRun(taskId: number, run: NewVerifyRun): void {
    const next = readNextVerifyRun(taskId);
    requireNext(taskId, "verify run", run.number, next, "number");
    statements.insertVerifyRun.run(
      taskId,
      run.number,
      run.result,
      JSON.stringify(run.commands),
      run.failingCommand,
      run.startedAt,
      run.endedAt,
    );
  }

  // The row insert of a review and its findings. It checks the number and opens no transaction, so
  // the caller must have one open.
  function writeReview(taskId: number, review: NewReview): void {
    requireNext(taskId, "review", review.number, readNextReview(taskId), "number");
    statements.insertReview.run(
      taskId,
      review.number,
      review.revision,
      review.prompt,
      review.startedAt,
      review.endedAt,
    );
    review.findings.forEach((finding, index) => {
      statements.insertReviewFinding.run(
        taskId,
        review.number,
        index + 1,
        finding.file,
        finding.line ?? null,
        finding.category ?? null,
        finding.summary,
        finding.failure_scenario,
      );
    });
  }

  function toReview(row: ReviewRow | undefined): Review | undefined {
    if (row === undefined) return undefined;
    const findings = statements.selectReviewFindings.all(row.task_id, row.number) as unknown as ReviewFindingRow[];
    return {
      taskId: row.task_id,
      number: row.number,
      revision: row.revision,
      prompt: row.prompt,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      findings: findings.map(toFindingEntry),
    };
  }

  return {
    createTask(task) {
      return immediateTransaction(db, () => {
        // A task that starts in a terminal state is not active, so it cannot clash.
        const active = isTerminalState(task.state)
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
      return writeTask(id, changes, check);
    },

    startRun(id, state, check) {
      return writeTask(id, { state }, check, (at) => {
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
        statements.insertRunMarker.run(id, state, process.pid, at);
      });
    },

    endRun(id, state, check) {
      return writeTask(id, { state }, check, () => endRunStep(id, state));
    },

    runStatus(id) {
      // The read and the pid check share the write lock, so an endRun of another process cannot
      // commit in between and make an ended run look dead.
      return immediateTransaction(db, (): RunStatus => {
        const row = statements.selectRunStatus.get(id) as
          | { state: string; pid: number | null; child_pid: number | null }
          | undefined;
        if (row === undefined) {
          throw taskNotFound(id);
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

    nextPlanVersion: readNextPlanVersion,

    addPlanRevision(taskId, revision, state, check) {
      return addRowAtRunEnd(taskId, state, check, () => {
        writePlanRevision(taskId, revision);
        return { type: "plan_revision", data: { version: revision.version, prompt: revision.prompt } };
      });
    },

    getPlanRevision: readPlanRevision,

    nextVerifyRun: readNextVerifyRun,

    addVerifyRun(taskId, run, state, check) {
      return addRowAtRunEnd(taskId, state, check, () => {
        writeVerifyRun(taskId, run);
        return { type: "verify_run", data: { number: run.number, result: run.result } };
      });
    },

    verifyRunCount(taskId) {
      return (statements.selectVerifyRunCount.get(taskId) as { n: number }).n;
    },

    getVerifyRun(taskId, number) {
      return toVerifyRun(statements.selectVerifyRun.get(taskId, number) as VerifyRunRow | undefined);
    },

    latestVerifyRun(taskId) {
      return toVerifyRun(statements.selectLatestVerifyRun.get(taskId) as VerifyRunRow | undefined);
    },

    nextReview: readNextReview,

    addReview(taskId, review, state, check) {
      return addRowAtRunEnd(taskId, state, check, () => {
        writeReview(taskId, review);
        return {
          type: "review",
          data: { number: review.number, revision: review.revision, findings: review.findings.length },
        };
      });
    },

    reviewCount(taskId) {
      return (statements.selectReviewCount.get(taskId) as { n: number }).n;
    },

    getReview(taskId, number) {
      return toReview(statements.selectReview.get(taskId, number) as ReviewRow | undefined);
    },

    latestReview(taskId) {
      return toReview(statements.selectLatestReview.get(taskId) as ReviewRow | undefined);
    },

    listReviews(taskId) {
      const rows = statements.selectReviews.all(taskId) as unknown as ReviewRow[];
      return rows.map((row) => toReview(row) as Review);
    },

    pinnedPlanRevision: readPinnedPlanRevision,

    planQuestions: readPlanQuestions,

    resolvedQuestionsThrough(taskId, version) {
      if (readPlanRevision(taskId, version) === undefined) throw noPlanRevision(taskId, version);
      const resolved: ResolvedPlanQuestion[] = [];
      for (let v = 1; v < version; v++) {
        for (const entry of readPlanQuestions(taskId, v)) {
          if (entry.state === "resolved") resolved.push(entry);
        }
      }
      return resolved;
    },

    recordPlanSession(taskId, session) {
      return immediateTransaction(db, () => {
        const task = readTask(taskId);
        if (task === undefined) throw taskNotFound(taskId);
        return recordSessionOnce(
          readPlanSession(taskId),
          session,
          task.repoKey,
          (id) => `task ${taskId} already has the plan session ${id}, not ${session.sessionId}`,
          () =>
            statements.insertPlanSession.run(
              taskId,
              session.sessionId,
              session.provider,
              session.model,
              session.effort,
              now().toISOString(),
            ),
        );
      });
    },

    planSession: readPlanSession,

    recordExecuteSession(taskId, version, session) {
      return immediateTransaction(db, () => {
        const task = readTask(taskId);
        if (task === undefined) throw taskNotFound(taskId);
        if (readPlanRevision(taskId, version) === undefined) throw noPlanRevision(taskId, version);
        return recordSessionOnce(
          readExecuteSession(taskId, version),
          session,
          task.repoKey,
          (id) =>
            `task ${taskId} already has the execute session ${id} of plan revision ${version}, not ${session.sessionId}`,
          () =>
            statements.insertExecuteSession.run(
              taskId,
              session.sessionId,
              session.provider,
              session.model,
              session.effort,
              now().toISOString(),
              version,
            ),
        );
      });
    },

    executeSession: readExecuteSession,

    setExecuteTodoState(taskId, version, todoId, state) {
      immediateTransaction(db, () => {
        const revision = readPlanRevision(taskId, version);
        if (revision === undefined) throw noPlanRevision(taskId, version);
        if (!revision.answer.todos.some((todo) => todo.id === todoId)) {
          throw new Error(`plan revision ${version} of task ${taskId} has no todo ${todoId}`);
        }
        statements.upsertExecuteTodo.run(taskId, version, todoId, state, now().toISOString());
      });
    },

    executeTodoProgress(taskId, version) {
      const revision = readPlanRevision(taskId, version);
      if (revision === undefined) throw noPlanRevision(taskId, version);
      const rows = statements.selectExecuteTodos.all(taskId, version) as {
        todo_id: string;
        state: ExecuteTodoState;
      }[];
      const states = new Map(rows.map((row) => [row.todo_id, row.state]));
      return revision.answer.todos.map((todo) => ({
        todo,
        state: states.get(todo.id) ?? "not_started",
      }));
    },

    markExecuteTodosDone(taskId, version) {
      immediateTransaction(db, () => {
        markExecuteTodosDoneStep(taskId, version, now().toISOString());
      });
    },

    queueExecuteFixTurn(taskId, version, turn) {
      immediateTransaction(db, () => {
        queueExecuteFixTurnStep(taskId, version, turn, now().toISOString());
      });
    },

    queuedExecuteFixTurn(taskId, version) {
      const row = statements.selectQueuedExecuteFixTurn.get(taskId, version) as
        | { verify_failure: string; verify_log_tail: string | null; queued_at: string }
        | undefined;
      if (row === undefined) return undefined;
      return {
        verifyFailure: row.verify_failure,
        verifyLogTail: row.verify_log_tail,
        queuedAt: row.queued_at,
      };
    },

    executeFixTurnState(taskId, version) {
      const row = statements.selectExecuteFixTurnDoneAt.get(taskId, version) as
        | { done_at: string | null }
        | undefined;
      if (row === undefined) return undefined;
      return row.done_at === null ? "queued" : "done";
    },

    markExecuteFixTurnDone(taskId, version) {
      immediateTransaction(db, () => {
        const result = statements.updateExecuteFixTurnDone.run(now().toISOString(), taskId, version);
        if (result.changes === 0) {
          throw new Error(`task ${taskId} has no queued fix turn of plan revision ${version}`);
        }
      });
    },

    clearPlanSession(taskId) {
      immediateTransaction(db, () => {
        clearPlanSessionStep(taskId);
      });
    },

    clearExecuteSession(taskId, version) {
      immediateTransaction(db, () => {
        clearExecuteSessionStep(taskId, version);
      });
    },

    retryTask(taskId, state, writes, check) {
      return writeTask(taskId, { state }, check, (at) => {
        endRunStep(taskId, state);
        if (writes.clearPlanSession === true) clearPlanSessionStep(taskId);
        if (writes.clearExecuteSession !== undefined) clearExecuteSessionStep(taskId, writes.clearExecuteSession);
        if (writes.resumeExecute !== undefined) {
          const { version, fixTurn } = writes.resumeExecute;
          markExecuteTodosDoneStep(taskId, version, at);
          queueExecuteFixTurnStep(taskId, version, fixTurn, at);
        }
      });
    },

    approvePlanRevision(taskId, version, state, check) {
      return writeTask(taskId, { state }, check, (at) => {
        endRunStep(taskId, state);
        const latest = readLatestPlanRevision(taskId);
        if (latest === undefined || readPlanRevision(taskId, version) === undefined) {
          throw noPlanRevision(taskId, version);
        }
        if (version !== latest.version) {
          throw new Error(
            `task ${taskId}: plan revision ${version} is not the newest revision (${latest.version})`,
          );
        }
        statements.setPlanApproval.run(at, taskId, version);
      });
    },

    clearPlanApproval(taskId, version, state, check) {
      return writeTask(taskId, { state }, check, () => {
        endRunStep(taskId, state);
        const pinned = readPinnedPlanRevision(taskId);
        if (pinned === undefined) {
          throw new Error(`task ${taskId} has no approved plan revision`);
        }
        if (version !== pinned.version) {
          throw new Error(`task ${taskId}: plan revision ${version} is not the pinned revision (${pinned.version})`);
        }
        statements.setPlanApproval.run(null, taskId, version);
      });
    },

    latestPlanRevision: readLatestPlanRevision,

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
