import { CommanderError } from "commander";
import type { Io } from "../cli.js";
import { loadConfig } from "../config/load.js";
import type { Config } from "../config/schema.js";
import { createDataRoot } from "../store/layout.js";
import { openStore, type TaskStore } from "../store/store.js";

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

// Opens the store of dataRoot, runs fn and closes the store, also after an error.
export function withStore<T>(config: Config, fn: (store: TaskStore) => T): T {
  const store = openStore(createDataRoot(config.dataRoot).database);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}
