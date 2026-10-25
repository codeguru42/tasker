import { Option } from "commander";
import type { Io, RegisterCommand } from "../cli.js";
import type { AssistantRole } from "../assistant/provider.js";
import { setRoleModel, setSessionRoleModel } from "../config/edit.js";
import { loadConfigFile, parseConfigText } from "../config/load.js";
import {
  ASSISTANT_ROLES,
  SESSION_EFFORTS,
  SESSION_ROLES,
  type Config,
  type RepoConfig,
  type SessionRole,
} from "../config/schema.js";
import { replaceFile } from "../replace-file.js";
import { issueKeyMatches } from "../issue-key/resolve.js";
import { fail, issueKeyOrFail, orFail, REPO_OPTION_DESCRIPTION, resolveIssueKeyOrFail, withStore } from "./shared.js";

type Role = AssistantRole | SessionRole;

// The roles in the order of the report: the assistant roles, then the session roles.
const ROLES: readonly Role[] = [...ASSISTANT_ROLES, ...SESSION_ROLES];

interface ModelOptions {
  role?: Role;
  repo?: string;
  effort?: (typeof SESSION_EFFORTS)[number];
}

const NEW_SESSIONS_NOTE =
  "note: the new model and effort apply only to new sessions. A continued session keeps the model and the effort that it started with.\n";

// The report line of a role.
function roleLine(role: string, choice: { model: string; effort: string }): string {
  return `${role}: ${choice.model} (effort ${choice.effort})\n`;
}

function isSessionRole(role: Role): role is SessionRole {
  return (SESSION_ROLES as readonly string[]).includes(role);
}

// The report line of a role of the repo. A session role with no entry prints none.
function lineOf(repo: RepoConfig, role: Role): string {
  if (!isSessionRole(role)) return roleLine(role, repo.assistant.models[role]);
  const entry = repo.sessions.models[role];
  return entry === undefined ? `${role}: none\n` : roleLine(role, entry);
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
    .description(
      "Print or set the model and the effort of each assistant role and each session role for the repo of an issue",
    )
    .argument("<issue>", "The issue key: the command uses the repo of the issue")
    .argument("[model]", "The new model of the role. It must pass the model check of the provider")
    .addOption(
      new Option(
        "--role <role>",
        "The role to print or to set: an assistant role (plan, execute, review) or a session role (operator, planner, orchestrator)",
      ).choices(ROLES),
    )
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .addOption(
      new Option("--effort <effort>", "The new effort of the role. xhigh and max are for a session role only").choices(
        SESSION_EFFORTS,
      ),
    )
    .action((issue: string, newModel: string | undefined, options: ModelOptions) => {
      const { role, effort } = options;
      const set = newModel !== undefined || effort !== undefined;
      if (set && role === undefined) fail(io, "name the role with --role");
      const { path, text, config } = orFail(io, () => loadConfigFile());
      const repoKey = pickRepo(io, issue, config, options.repo);
      if (role === undefined || !set) {
        for (const each of role === undefined ? ROLES : [role]) {
          io.stdout(lineOf(config.repos[repoKey], each));
        }
        return;
      }
      if (isSessionRole(role) && config.repos[repoKey].sessions.models[role] === undefined) {
        if (newModel === undefined || effort === undefined) {
          fail(io, `the role ${role} has no entry: give the model and --effort`);
        }
      }
      const change = { model: newModel, effort };
      const next = isSessionRole(role)
        ? setSessionRoleModel(text, repoKey, role, change)
        : setRoleModel(text, repoKey, role, change);
      const updated = orFail(io, () => parseConfigText(next, path));
      orFail(io, () => replaceFile(path, next));
      io.stdout(lineOf(updated.repos[repoKey], role));
      io.stderr(NEW_SESSIONS_NOTE);
    });
};
