import { Option } from "commander";
import type { Io, RegisterCommand } from "../cli.js";
import type { AssistantRole } from "../assistant/provider.js";
import { loadConfigFile } from "../config/load.js";
import { ASSISTANT_ROLES, EFFORTS, type Config } from "../config/schema.js";
import { IssueKeyError } from "../issue-key/ref.js";
import { issueKeyMatches } from "../issue-key/resolve.js";
import { fail, orFail, resolveIssueKeyOrFail, withStore } from "./shared.js";

interface ModelOptions {
  role?: AssistantRole;
  repo?: string;
  effort?: (typeof EFFORTS)[number];
}

// The key of the repo of the issue. When the key matches more than one repo and repo is not given, the repo
// with the active task of the issue wins. In every other case, the normal resolve picks the repo or fails.
function pickRepo(io: Io, issue: string, config: Config, repo: string | undefined): string {
  if (repo === undefined) {
    let matches;
    try {
      matches = issueKeyMatches(issue, config);
    } catch (error) {
      if (!(error instanceof IssueKeyError)) throw error;
      fail(io, error.message);
    }
    if (matches.length > 1) {
      const active = withStore(config, (store) =>
        matches.filter((ref) => store.findActiveTask(ref.repoKey, ref.key) !== undefined),
      );
      if (active.length === 1) return active[0].repoKey;
    }
  }
  return resolveIssueKeyOrFail(io, issue, config, { repo }).repoKey;
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
      const repoKey = pickRepo(io, issue, config, options.repo);
      const { models } = config.repos[repoKey].assistant;
      for (const role of options.role === undefined ? ASSISTANT_ROLES : [options.role]) {
        io.stdout(`${role}: ${models[role].model} (effort ${models[role].effort})\n`);
      }
    });
};
