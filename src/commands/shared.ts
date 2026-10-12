import { CommanderError } from "commander";
import type { Io } from "../cli.js";
import { loadConfig } from "../config/load.js";
import type { Config } from "../config/schema.js";

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
