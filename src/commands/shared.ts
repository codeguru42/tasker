import { CommanderError } from "commander";
import type { Io } from "../cli.js";
import { loadConfig } from "../config/load.js";
import type { Config } from "../config/schema.js";
import { IssueKeyError, type IssueRef } from "../issue-key/ref.js";
import { resolveIssueKey, type ResolveOptions } from "../issue-key/resolve.js";
import { createDataRoot } from "../store/layout.js";
import { openStore, type Task, type TaskStore } from "../store/store.js";

// Prints message to stderr and stops the command with exit code 1.
export function fail(io: Io, message: string): never {
  io.stderr(`${message}\n`);
  throw new CommanderError(1, "tasker.fail", message);
}

// The configuration. A loader error stops the command with exit code 1.
export function loadConfigOrFail(io: Io): Config {
  try {
    return loadConfig();
  } catch (error) {
    fail(io, (error as Error).message);
  }
}

// The issue ref of rawKey. An IssueKeyError stops the command with exit code 1.
export function resolveIssueKeyOrFail(
  io: Io,
  rawKey: string,
  config: Config,
  options: ResolveOptions,
): IssueRef {
  try {
    return resolveIssueKey(rawKey, config, options);
  } catch (error) {
    if (!(error instanceof IssueKeyError)) throw error;
    fail(io, error.message);
  }
}

// Opens the store of dataRoot, runs fn and closes the store, also after an error.
export function withStore<T>(config: Config, fn: (store: TaskStore) => T): T {
  const store = openStore(createDataRoot(config.dataRoot).database);
  try {
    return fn(store);
  } finally {
    store.close();
  }
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
  return withStore(config, (store) => {
    const task = store.findLatestTask(ref.repoKey, ref.key);
    if (task === undefined) {
      fail(io, `no task for the issue ${ref.key} in the repo ${ref.repoKey}`);
    }
    return fn(store, task);
  });
}
