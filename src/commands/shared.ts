import { CommanderError } from "commander";
import type { Io } from "../cli.js";
import { loadConfig } from "../config/load.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import { readTextFile } from "../read-text-file.js";
import { IssueKeyError, type IssueRef } from "../issue-key/ref.js";
import { resolveIssueKey, type ResolveOptions } from "../issue-key/resolve.js";
import { createDataRoot } from "../store/layout.js";
import { findOverlaps, overlapWarning } from "../tasks/overlap.js";
import { taskById } from "../tasks/task-state.js";
import { openStore, type Task, type TaskStore } from "../store/store.js";

// Another command can hold the clone for a long first fetch.
export const REPO_LOCK_WAIT_MS = 300_000;

// The help texts of the --repo option and the <issue> argument of the commands that act on one task.
export const REPO_OPTION_DESCRIPTION = "Use the repo with this key when two repos share the project of the issue";
export const ISSUE_ARGUMENT_DESCRIPTION = "The issue key of the task";

// Prints message to stderr and stops the command with exit code 1.
export function fail(io: Io, message: string): never {
  io.stderr(`${message}\n`);
  throw new CommanderError(1, "tasker.fail", message);
}

// True when the text is a whole number of 1 or more, with no sign and no leading zero.
export function isWholeNumberText(text: string): boolean {
  return /^[1-9][0-9]*$/.test(text);
}

// Stops the command with exit code 1 when an option has a value that is not a whole number of 1 or more, with no sign
// and no leading zero. It reports each bad option, one line each, in the order of options. An absent option is good.
// The caller keeps the raw strings, so that a very large number prints as the user typed it.
export function wholeNumberOptionsOrFail(io: Io, options: Record<string, string | undefined>): void {
  const problems = Object.entries(options)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && !isWholeNumberText(entry[1]))
    .map(([name, raw]) => `${name} must be a whole number of 1 or more: ${raw}`);
  if (problems.length > 0) fail(io, problems.join("\n"));
}

// The row that a show command prints: the newest row, or the row with the number. number is the raw value of the
// option, already checked by wholeNumberOptionsOrFail, or undefined for the newest row. total is the count of rows.
export function numberedRowOrFail<T>(
  io: Io,
  issueKey: string,
  o: {
    name: string; // for example "verify run"
    command: string; // the command that makes a row, for example "verify"
    total: number;
    number: string | undefined;
    newest: () => T | undefined;
    get: (number: number) => T | undefined;
  },
): T {
  if (o.total === 0) fail(io, `the task of ${issueKey} has no ${o.name}; run tasker ${o.command} first`);
  if (o.number !== undefined && Number(o.number) > o.total) {
    fail(io, `the task of ${issueKey} has no ${o.name} ${o.number}; it has ${o.total}`);
  }
  return (o.number === undefined ? o.newest() : o.get(Number(o.number)))!;
}

// The text with a final line end: text that already ends with a line end stays as it is.
export function withFinalLineEnd(text: string): string {
  return /[\r\n]$/.test(text) ? text : `${text}\n`;
}

// The text of the file at path, read as utf8. A missing file stops the command with exit code 1 and the message missing.
// Any other read error stops it with the message `<unreadable>: <error>`, where <error> is the text of readErrorText:
// the error code, for example EISDIR, else the error message.
export function readFileOrFail(io: Io, path: string, messages: { missing: string; unreadable: string }): string {
  const file = readTextFile(path);
  if (file.text !== undefined) return file.text;
  fail(io, file.missing ? messages.missing : `${messages.unreadable}: ${file.error}`);
}

// The value of fn. An error stops the command with exit code 1 and its message on stderr.
// A CommanderError passes through, because fail() has already written its message.
export function orFail<T>(io: Io, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof CommanderError) throw error;
    fail(io, errorMessage(error));
  }
}

// The value of fn, as orFail() gives it, for an async fn. message gives the text of an error.
export async function orFailAsync<T>(
  io: Io,
  fn: () => Promise<T>,
  message: (error: unknown) => string = errorMessage,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof CommanderError) throw error;
    fail(io, message(error));
  }
}

// Stops the command with exit code 1 when key is not the key of a repo in config.
export function repoKeyOrFail(io: Io, config: Config, key: string): void {
  if (!Object.hasOwn(config.repos, key)) {
    fail(io, `repo key not found: ${key}`);
  }
}

// The value of fn. An IssueKeyError stops the command with exit code 1. Any other error passes through.
export function issueKeyOrFail<T>(io: Io, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof IssueKeyError)) throw error;
    fail(io, error.message);
  }
}

// The configuration. A loader error stops the command with exit code 1.
export function loadConfigOrFail(io: Io): Config {
  return orFail(io, () => loadConfig());
}

// The issue ref of rawKey. An IssueKeyError stops the command with exit code 1.
export function resolveIssueKeyOrFail(io: Io, rawKey: string, config: Config, options: ResolveOptions): IssueRef {
  return issueKeyOrFail(io, () => resolveIssueKey(rawKey, config, options));
}

// The text on one line: each line end is written as the two characters \n.
export function oneLine(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "\\n");
}

// The text of a field value. A field with no value is -. Line ends follow oneLine.
function fieldValue(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "-" : oneLine(String(value));
}

// The lines `field: value`, each ending in a line end.
export function formatFields(fields: [string, string | number | null | undefined][]): string {
  return fields.map(([field, value]) => `${field}: ${fieldValue(value)}\n`).join("");
}

// Left-aligned columns: each column is as wide as its widest cell, and two spaces separate the columns.
// Each line has no trailing spaces and no line end. A row can have fewer cells than another row.
export function formatColumns(rows: readonly (readonly string[])[]): string[] {
  const count = Math.max(0, ...rows.map((row) => row.length));
  const widths = Array.from({ length: count }, (_, i) => Math.max(...rows.map((row) => (row[i] ?? "").length)));
  return rows.map((row) =>
    row
      .map((cell, i) => cell.padEnd(widths[i]))
      .join("  ")
      .trimEnd(),
  );
}

function openDataRootStore(config: Config): TaskStore {
  return openStore(createDataRoot(config.dataRoot).database);
}

// Opens the store of dataRoot, runs fn and closes the store, also after an error.
export function withStore<T>(config: Config, fn: (store: TaskStore) => T): T {
  const store = openDataRootStore(config);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

// Like withStore, for an async fn: the store closes after the promise settles.
export async function withStoreAsync<T>(config: Config, fn: (store: TaskStore) => Promise<T>): Promise<T> {
  const store = openDataRootStore(config);
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

// Prints the notes and the overlap warning for the files of the task on stderr, with the lines of lastLines at the end of
// the warning. It never stops the command: a failure prints one note line. docs/dev/tasks.md gives the reasons.
export async function warnOverlaps(
  io: Io,
  config: Config,
  o: { taskId: number; files: readonly string[]; env: NodeJS.ProcessEnv; lastLines: readonly string[] },
): Promise<void> {
  try {
    const report = await withStoreAsync(config, async (store) => {
      const task = taskById(store, o.taskId);
      return findOverlaps({ config, store, task, files: o.files, env: o.env });
    });
    for (const note of report.notes) io.stderr(`${note}\n`);
    const warning = overlapWarning(report.overlaps, o.lastLines);
    if (warning !== "") io.stderr(warning);
  } catch (error) {
    io.stderr(`note: cannot compare the plan with the other tasks in flight: ${errorMessage(error)}\n`);
  }
}

// The task of the issue: the active task, else the newest one.
// An issue with no task stops the command with exit code 1.
function issueTaskOrFail(io: Io, store: TaskStore, ref: IssueRef): Task {
  const task = store.findLatestTask(ref.repoKey, ref.key);
  if (task === undefined) {
    fail(io, `no task for the issue ${ref.key} in the repo ${ref.repoKey}`);
  }
  return task;
}

// Runs fn with the store and the task of the issue: the active task, else the newest one.
// A key that does not resolve stops the command before the store opens.
// An issue with no task stops the command with exit code 1.
export function withIssueTask<T>(
  io: Io,
  config: Config,
  rawKey: string,
  options: ResolveOptions,
  fn: (store: TaskStore, task: Task) => T,
): T {
  const ref = resolveIssueKeyOrFail(io, rawKey, config, options);
  return withStore(config, (store) => fn(store, issueTaskOrFail(io, store, ref)));
}

// Like withIssueTask, for an async fn: the store closes after the promise settles.
// The fn also gets the ref that the key resolved to.
export function withIssueTaskAsync<T>(
  io: Io,
  config: Config,
  rawKey: string,
  options: ResolveOptions,
  fn: (store: TaskStore, task: Task, ref: IssueRef) => Promise<T>,
): Promise<T> {
  const ref = resolveIssueKeyOrFail(io, rawKey, config, options);
  return withStoreAsync(config, (store) => fn(store, issueTaskOrFail(io, store, ref), ref));
}
