import type { RegisterCommand } from "../cli.js";
import { loadConfig } from "../config/load.js";

export const showConfig: RegisterCommand = (program, io) => {
  program
    .command("show-config")
    .description("Print the configuration as JSON, with the defaults filled in")
    .action(() => {
      const config = loadConfig();
      io.stdout(`${JSON.stringify(config, null, 2)}\n`);
    });
};
