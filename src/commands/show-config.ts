import { CommanderError } from "commander";
import type { Io, RegisterCommand } from "../cli.js";
import { loadConfig } from "../config/load.js";

function fail(io: Io, message: string): never {
  io.stderr(`${message}\n`);
  throw new CommanderError(1, "tasker.showConfig", message);
}

export const showConfig: RegisterCommand = (program, io) => {
  program
    .command("show-config")
    .description("Print the configuration as JSON, with the defaults filled in")
    .option("--repo <key>", "Print only the repo with this key")
    .action((options: { repo?: string }) => {
      const config = loadConfig();
      const key = options.repo;
      if (key === undefined) {
        io.stdout(`${JSON.stringify(config, null, 2)}\n`);
        return;
      }
      if (!Object.hasOwn(config.repos, key)) {
        fail(io, `repo key not found: ${key}`);
      }
      io.stdout(`${JSON.stringify(config.repos[key], null, 2)}\n`);
    });
};
