import { Option } from "commander";
import type { RegisterCommand } from "../cli.js";
import type { AssistantRole } from "../assistant/provider.js";
import { loadConfigFile } from "../config/load.js";
import { ASSISTANT_ROLES, EFFORTS } from "../config/schema.js";
import { orFail, resolveIssueKeyOrFail } from "./shared.js";

interface ModelOptions {
  role?: AssistantRole;
  repo?: string;
  effort?: (typeof EFFORTS)[number];
}

export const model: RegisterCommand = (program, io) => {
  program
    .command("model")
    .description("Print or set the model and the effort of each assistant role for the repo of an issue")
    .argument("<issue>", "The issue key: the command uses the repo of the issue")
    .argument("[model]", "The new model of the role. It must pass the model check of the provider")
    .addOption(new Option("--role <role>", "The role to print or to set").choices(ASSISTANT_ROLES))
    .option("--repo <key>", "Use the repo with this key when two repos share the project of the issue")
    .addOption(new Option("--effort <effort>", "The new effort of the role").choices(EFFORTS))
    .action((issue: string, _model: string | undefined, options: ModelOptions) => {
      const { config } = orFail(io, () => loadConfigFile());
      const { repoKey } = resolveIssueKeyOrFail(io, issue, config, { repo: options.repo });
      const { models } = config.repos[repoKey].assistant;
      for (const role of options.role === undefined ? ASSISTANT_ROLES : [options.role]) {
        io.stdout(`${role}: ${models[role].model} (effort ${models[role].effort})\n`);
      }
    });
};
