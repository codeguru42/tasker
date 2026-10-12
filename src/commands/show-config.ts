import type { RegisterCommand } from "../cli.js";
import { fail, loadConfigOrFail } from "./shared.js";

export const showConfig: RegisterCommand = (program, io) => {
  program
    .command("show-config")
    .description("Print the configuration as JSON, with the defaults filled in")
    .option("--repo <key>", "Print only the repo with this key")
    .action((options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
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
