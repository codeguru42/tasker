import { CommanderError } from "commander";
import type { Io } from "../cli.js";
import { loadConfig } from "../config/load.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import { IssueKeyError, type IssueRef } from "../issue-key/ref.js";
import { resolveIssueKey, type ResolveOptions } from "../issue-key/resolve.js";
import { createDataRoot } from "../store/layout.js";
import { openStore, type Task, type TaskStore } from "../store/store.js";

// Another command can hold the clone for a long first fetch.
export const REPO_LOCK_WAIT_MS = 300_000;

// Prints message to stderr and stops the command with exit code 1.
export function fail(io: Io, message: string): never {
  io.stderr(`${message}\n`);
  throw new CommanderError(1, "tasker.fail", message);
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
export function resolveIssueKeyOrFail(
  io: Io,
  rawKey: string,
  config: Config,
  options: ResolveOptions,
): IssueRef {
  return issueKeyOrFail(io, () => resolveIssueKey(rawKey, config, options));
}

// The text of a field value on one line: each line end is written as the two characters \n.
// A field with no value is -.
function fieldValue(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "-" : String(value).replace(/\r\n|\r|\n/g, "\\n");
}

// The lines `field: value`, each ending in a line end.
export function formatFields(fields: [string, string | number | null | undefined][]): string {
  return fields.map(([field, value]) => `${field}: ${fieldValue(value)}\n`).join("");
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
export async function withStoreAsync<T>(
  config: Config,
  fn: (store: TaskStore) => Promise<T>,
): Promise<T> {
  const store = openDataRootStore(config);
  try {
    return await fn(store);
  } finally {
    store.close();
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
