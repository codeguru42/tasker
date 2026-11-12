import type { Check } from "../../doctor/check.js";
import { firstLine } from "../../doctor/first-line.js";
import { timedCheck } from "../../doctor/timed-check.js";
import { isOlderVersion } from "../../doctor/version-compare.js";
import { isSet } from "../../config/path.js";
import { projectOf } from "../../issue-key/resolve.js";
import type { IssueDoctorRepo } from "../provider.js";
import { authStatus } from "./auth.js";
import { GhError, GhNotInstalledError, readGhVersion, runGh } from "./run.js";

// Before this version, gh auth token has no --user flag.
const MINIMUM_GH = { major: 2, minor: 40, patch: 0 };
const MINIMUM_TEXT = `${MINIMUM_GH.major}.${MINIMUM_GH.minor}.${MINIMUM_GH.patch}`;

// The configuration schema requires the account for the github tracker.
export function accountOf(repo: IssueDoctorRepo): string {
  const account = repo.issueTracker.account;
  if (account === undefined) {
    throw new Error(`${repo.key}: issueTracker.account is not set`);
  }
  return account;
}

export function ghVersionCheck(timeoutMs = 5000): Check {
  const remediation = `Install gh ${MINIMUM_TEXT} or newer.`;
  const selectedRemediation = `Set PATH to the directories for child programs. Make sure that TASKER_GH_BIN selects gh ${MINIMUM_TEXT} or newer.`;
  return timedCheck({ name: "gh version", required: true, timeoutMs }, async (env, { signal }) => {
    let output: string;
    try {
      output = await readGhVersion(env, { signal });
    } catch (error) {
      if (error instanceof GhNotInstalledError) {
        if (isSet(env.TASKER_GH_BIN)) {
          return {
            status: "error",
            detail: error.message,
            remediation: selectedRemediation,
          };
        }
        return {
          status: "error",
          detail: `gh is not installed. tasker needs gh ${MINIMUM_TEXT} or newer.`,
          remediation,
        };
      }
      throw error;
    }
    const line = firstLine(output);
    const match = /^gh version (\d+)\.(\d+)\.(\d+)(\S*)/.exec(line);
    if (match === null) {
      return { status: "error", detail: `cannot read the gh version from: ${line}` };
    }
    const found = line.slice("gh version ".length).split(" ")[0];
    const [major, minor, patch] = [match[1], match[2], match[3]].map(Number);
    if (isOlderVersion([major, minor, patch], [MINIMUM_GH.major, MINIMUM_GH.minor, MINIMUM_GH.patch])) {
      return {
        status: "error",
        detail: `gh ${found} is older than the minimum ${MINIMUM_TEXT}. Before ${MINIMUM_TEXT}, gh auth token has no --user flag.`,
        remediation: isSet(env.TASKER_GH_BIN) ? selectedRemediation : remediation,
      };
    }
    return { status: "ok", detail: `gh ${found} (minimum ${MINIMUM_TEXT})` };
  });
}

export function ghAuthCheck(account: string, timeoutMs = 15000): Check {
  return timedCheck({ name: `gh auth: ${account}`, required: true, timeoutMs }, async (env, { signal }) => {
    const status = await authStatus(account, env, { signal });
    if (status.ok) {
      return { status: "ok", detail: status.detail };
    }
    if (!status.needsLogin) {
      return { status: "error", detail: status.detail };
    }
    return {
      status: "error",
      detail: status.detail,
      remediation: `Run \`gh auth login --hostname github.com\` and log in as ${account}.`,
    };
  });
}

export function ghProjectCheck(repo: IssueDoctorRepo, timeoutMs = 15000): Check {
  return timedCheck({ name: `gh project: ${repo.key}`, required: true, timeoutMs }, async (env, { signal }) => {
    const account = accountOf(repo);
    const project = projectOf(repo.key, repo.issueTracker);
    try {
      await runGh(["repo", "view", project, "--json", "nameWithOwner"], {
        account,
        env,
        signal,
      });
    } catch (error) {
      // Only a failure of the repo view call itself is a project problem. Every other error (the
      // token call, gh not installed, a signal, an abort) passes to the shared wrapper, which gives
      // error with its message and no remediation, or the timeout result.
      if (!(error instanceof GhError && error.subcommand === "repo view" && error.exitCode !== null)) {
        throw error;
      }
      return {
        status: "error",
        detail: `${repo.key}: the account ${account} cannot see the project ${project}: ${error.message}`,
        remediation: `Make sure that issueTracker.project of ${repo.key} names the repo on GitHub, and that the account ${account} can see it.`,
      };
    }
    return {
      status: "ok",
      detail: `${repo.key}: the account ${account} can see the project ${project}`,
    };
  });
}

// A label that tasker writes to an issue, and what happens when it is missing.
interface LabelToRead {
  configKey: string;
  name: string;
  reason: string;
}

// The labels that tasker writes with the configuration of the repo, in the order of use.
function labelsToRead(repo: IssueDoctorRepo): LabelToRead[] {
  const { updateOnStart, inProgressLabel, updateOnFinish, doneLabel, reviewLabel } = repo.issueTracker;
  const labels: LabelToRead[] = [];
  if (updateOnStart && inProgressLabel !== undefined) {
    labels.push({
      configKey: "issueTracker.inProgressLabel",
      name: inProgressLabel,
      reason: "the in-progress write of each tasker start fails and only warns",
    });
  }
  if (updateOnFinish && doneLabel !== undefined) {
    labels.push({
      configKey: "issueTracker.doneLabel",
      name: doneLabel,
      reason: "the done write of each tasker finish fails and only warns",
    });
  }
  if (reviewLabel !== undefined) {
    labels.push({
      configKey: "issueTracker.reviewLabel",
      name: reviewLabel,
      reason: "the review write of each tasker open-pr fails and only warns",
    });
  }
  return labels;
}

// GitHub answers a missing label with exit code 1 and (HTTP 404) in stderr.
function isNotFound(error: unknown): boolean {
  return error instanceof GhError && error.exitCode === 1 && error.stderr.includes("(HTTP 404)");
}

// The check only reads. Each label is one GET with no fields. It never creates a label.
export function ghLabelsCheck(repo: IssueDoctorRepo, timeoutMs = 15000): Check {
  return timedCheck({ name: `gh labels: ${repo.key}`, required: true, timeoutMs }, async (env, { signal }) => {
    const labels = labelsToRead(repo);
    if (labels.length === 0) {
      return { status: "ok", detail: `${repo.key}: no label to check` };
    }
    const account = accountOf(repo);
    const project = projectOf(repo.key, repo.issueTracker);
    const lines: string[] = [];
    const missingKeys: string[] = [];
    for (const label of labels) {
      const text = `the label ${JSON.stringify(label.name)} of ${label.configKey}`;
      try {
        await runGh(["api", `repos/${project}/labels/${encodeURIComponent(label.name)}`], {
          account,
          env,
          signal,
        });
        lines.push(`${text} exists`);
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
        lines.push(`${text} does not exist in ${project}: ${label.reason}`);
        missingKeys.push(label.configKey);
      }
    }
    const detail = [`${repo.key}:`, ...lines].join("\n");
    if (missingKeys.length === 0) {
      return { status: "ok", detail };
    }
    // A missing label only makes a write warn, so the status is never an error.
    return {
      status: "warn",
      detail,
      remediation: `Create each missing label in ${project} on GitHub, or change ${missingKeys.join(" and ")}.`,
    };
  });
}

interface BoardField {
  name: string;
  type: string;
  options?: { name: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoardFields(output: string): BoardField[] {
  const parsed: unknown = JSON.parse(output);
  if (!isRecord(parsed) || !Array.isArray(parsed.fields) || !Number.isInteger(parsed.totalCount)) {
    throw new Error("gh project field-list returned invalid JSON data");
  }
  return parsed.fields.map((value): BoardField => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.name !== "string" ||
      typeof value.type !== "string"
    ) {
      throw new Error("gh project field-list returned invalid JSON data");
    }
    if (value.type !== "ProjectV2SingleSelectField") {
      return { name: value.name, type: value.type };
    }
    if (!Array.isArray(value.options)) {
      throw new Error("gh project field-list returned invalid JSON data");
    }
    const options = value.options.map((option): { name: string } => {
      if (!isRecord(option) || typeof option.id !== "string" || typeof option.name !== "string") {
        throw new Error("gh project field-list returned invalid JSON data");
      }
      return { name: option.name };
    });
    return { name: value.name, type: value.type, options };
  });
}

interface BoardOptionToRead {
  configKey: string;
  name: string;
}

export function ghBoardCheck(repo: IssueDoctorRepo, timeoutMs = 15000): Check {
  return timedCheck({ name: `gh board: ${repo.key}`, required: true, timeoutMs }, async (env, { signal }) => {
    const issueTracker = repo.issueTracker;
    const board = issueTracker.board;
    if (board === undefined) {
      return { status: "ok", detail: `${repo.key}: no board to check` };
    }
    const options: BoardOptionToRead[] = [];
    if (issueTracker.updateOnStart) {
      if (board.inProgress !== undefined) {
        options.push({ configKey: "issueTracker.board.inProgress", name: board.inProgress });
      }
      if (board.abort !== undefined) {
        options.push({ configKey: "issueTracker.board.abort", name: board.abort });
      }
    }
    if (issueTracker.updateOnFinish && board.done !== undefined) {
      options.push({ configKey: "issueTracker.board.done", name: board.done });
    }
    if (options.length === 0) {
      return { status: "ok", detail: `${repo.key}: no board option to check` };
    }

    const account = accountOf(repo);
    let output: string;
    try {
      output = await runGh(
        ["project", "field-list", String(board.number), "--owner", board.owner, "--format", "json", "--limit", "100"],
        { account, env, signal },
      );
    } catch (error) {
      if (!(error instanceof GhError && error.subcommand === "project field-list" && error.exitCode !== null)) {
        throw error;
      }
      return {
        status: "warn",
        detail: `${repo.key}: cannot read board ${board.number}: ${error.message}`,
        remediation: `Make sure that issueTracker.board of ${repo.key} names a board that the account ${account} can read. The token of the account needs the scopes project and read:project. A fine-grained token cannot open a board of a user.`,
      };
    }

    const fields = readBoardFields(output);
    const matchingFields = fields.filter((field) => field.name.toLowerCase() === board.field.toLowerCase());
    if (matchingFields.length !== 1) {
      const state = matchingFields.length === 0 ? "is missing" : "is ambiguous";
      return {
        status: "warn",
        detail: `${repo.key}: field ${JSON.stringify(board.field)} ${state} on board ${board.number}`,
        remediation: `Change issueTracker.board.field of ${repo.key} to one single-select field of the configured board.`,
      };
    }
    const field = matchingFields[0];
    if (field.type !== "ProjectV2SingleSelectField") {
      return {
        status: "warn",
        detail: `${repo.key}: field ${JSON.stringify(field.name)} on board ${board.number} is not a single-select field`,
        remediation: `Change issueTracker.board.field of ${repo.key} to one single-select field of the configured board.`,
      };
    }

    const fieldOptions = field.options ?? [];
    const missingOptions = options.filter(
      (option) =>
        fieldOptions.filter((fieldOption) => fieldOption.name.toLowerCase() === option.name.toLowerCase()).length !== 1,
    );
    const availableOptions = fieldOptions.map((option) => JSON.stringify(option.name)).join(", ");
    const fieldSummary = `${repo.key}: board ${board.number}, field ${JSON.stringify(field.name)}, options ${availableOptions}`;
    if (missingOptions.length > 0) {
      const invalidOptions = missingOptions
        .map((option) => `${JSON.stringify(option.name)} (${option.configKey})`)
        .join(", ");
      return {
        status: "warn",
        detail: `${fieldSummary}; configured options ${invalidOptions} are missing or ambiguous`,
        remediation: `Add each missing option to the field on GitHub, or change ${missingOptions.map((option) => option.configKey).join(" and ")}.`,
      };
    }
    return { status: "ok", detail: fieldSummary };
  });
}

// The doctor checks of the repos that use the github tracker, in this order:
// 1. The version check, once, and only when at least one repo uses the github tracker.
//    No github repo gives [].
// 2. One auth check for each distinct account, in the order of first use. The match is exact,
//    the same as the token cache of runGh().
// 3. For each github repo, in the order of the configuration, the project check, labels check,
//    and board check when issueTracker.board is set.
// The checks never change GitHub. They make only read-only gh calls.
export function githubDoctorChecks(repos: readonly IssueDoctorRepo[]): Check[] {
  const github = repos.filter((repo) => repo.issueTracker.provider === "github");
  if (github.length === 0) {
    return [];
  }
  const accounts = new Set(github.map(accountOf));
  return [
    ghVersionCheck(),
    ...[...accounts].map((account) => ghAuthCheck(account)),
    ...github.flatMap((repo) => [
      ghProjectCheck(repo),
      ghLabelsCheck(repo),
      ...(repo.issueTracker.board === undefined ? [] : [ghBoardCheck(repo)]),
    ]),
  ];
}
