import { Option } from "commander";
import type { Io, RegisterCommand } from "../cli.js";
import type { AssistantRole, ModelChoice } from "../assistant/provider.js";
import { setRoleModel } from "../config/edit.js";
import { loadConfigFile, parseConfigText } from "../config/load.js";
import { ASSISTANT_ROLES, EFFORTS, type Config } from "../config/schema.js";
import { replaceFile } from "../replace-file.js";
import { issueKeyMatches } from "../issue-key/resolve.js";
import {
  fail,
  issueKeyOrFail,
  orFail,
  REPO_OPTION_DESCRIPTION,
  resolveIssueKeyOrFail,
  withStore,
} from "./shared.js";

interface ModelOptions {
  role?: AssistantRole;
  repo?: string;
  effort?: (typeof EFFORTS)[number];
}

const NEW_SESSIONS_NOTE =
  "note: the new model and effort apply only to new sessions. A continued session keeps the model and the effort that it started with.\n";

// The report line of a role.
function roleLine(role: AssistantRole, choice: ModelChoice): string {
  return `${role}: ${choice.model} (effort ${choice.effort})\n`;
}

// The key of the repo of the issue. When the key matches more than one repo and repo is not given, the repo
// with the active task of the issue wins. In every other case, the normal resolve picks the repo or fails.
function pickRepo(io: Io, issue: string, config: Config, repo: string | undefined): string {
  if (repo === undefined) {
    const matches = issueKeyOrFail(io, () => issueKeyMatches(issue, config));
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
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .addOption(new Option("--effort <effort>", "The new effort of the role").choices(EFFORTS))
    .action((issue: string, newModel: string | undefined, options: ModelOptions) => {
      const { role, effort } = options;
      const set = newModel !== undefined || effort !== undefined;
      if (set && role === undefined) fail(io, "name the role with --role");
      const { path, text, config } = orFail(io, () => loadConfigFile());
      const repoKey = pickRepo(io, issue, config, options.repo);
      if (role === undefined || !set) {
        const { models } = config.repos[repoKey].assistant;
        for (const each of role === undefined ? ASSISTANT_ROLES : [role]) {
          io.stdout(roleLine(each, models[each]));
        }
        return;
      }
      const next = setRoleModel(text, repoKey, role, { model: newModel, effort });
      const updated = orFail(io, () => parseConfigText(next, path));
      orFail(io, () => replaceFile(path, next));
      io.stdout(roleLine(role, updated.repos[repoKey].assistant.models[role]));
      io.stderr(NEW_SESSIONS_NOTE);
    });
};
