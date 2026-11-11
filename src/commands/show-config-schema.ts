import type { RegisterCommand } from "../cli.js";
import { configSchemaEntries } from "../config/show-schema.js";
import { fail, printJson } from "./shared.js";

export const showConfigSchema: RegisterCommand = (program, io) => {
  program
    .command("show-config-schema")
    .description("Print the configuration schema as JSON")
    .argument("[key-path]", "Print one key and its descendants")
    .action((keyPath?: string) => {
      const entries = configSchemaEntries(keyPath);
      if (keyPath !== undefined && entries.length === 0) {
        fail(io, `configuration key path not found: ${keyPath}`);
      }
      printJson(io, entries);
    });
};
