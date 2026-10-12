import type { Check, CheckStatus } from "../../doctor/check.js";
import { timedCheck } from "../../doctor/timed-check.js";
import type { RepoConfig } from "../../config/schema.js";
import { authStatus } from "./auth.js";
import { GhError, GhNotInstalledError, readGhVersion, runGh } from "./run.js";

// Before this version, gh auth token has no --user flag.
const MINIMUM_GH = { major: 2, minor: 40, patch: 0 };
const MINIMUM_TEXT = `${MINIMUM_GH.major}.${MINIMUM_GH.minor}.${MINIMUM_GH.patch}`;

// A repo that the gh doctor checks: its repo key and its merged issueTracker.
export interface GithubDoctorRepo {
  key: string;
  issueTracker: RepoConfig["issueTracker"];
}

// The project is issueTracker.project, or the repo key when it is not set.
function projectOf(repo: GithubDoctorRepo): string {
  return repo.issueTracker.project ?? repo.key;
}

// The configuration schema requires the account for the github tracker.
function accountOf(repo: GithubDoctorRepo): string {
  const account = repo.issueTracker.account;
  if (account === undefined) {
    throw new Error(`${repo.key}: issueTracker.account is not set`);
  }
  return account;
}

export function ghVersionCheck(timeoutMs = 5000): Check {
  const remediation = `Install gh ${MINIMUM_TEXT} or newer.`;
  return timedCheck({ name: "gh version", required: true, timeoutMs }, async (env, { signal }) => {
    let output: string;
    try {
      output = await readGhVersion(env, { signal });
    } catch (error) {
      if (error instanceof GhNotInstalledError) {
        return {
          status: "error",
          detail: `gh is not installed. tasker needs gh ${MINIMUM_TEXT} or newer.`,
          remediation,
        };
      }
      throw error;
    }
    const firstLine = output.split("\n")[0].replace(/\r$/, "");
    const match = /^gh version (\d+)\.(\d+)\.(\d+)(\S*)/.exec(firstLine);
    if (match === null) {
      return { status: "error", detail: `cannot read the gh version from: ${firstLine}` };
    }
    const found = firstLine.slice("gh version ".length).split(" ")[0];
    const [major, minor, patch] = [match[1], match[2], match[3]].map(Number);
    const older =
      major !== MINIMUM_GH.major
        ? major < MINIMUM_GH.major
        : minor !== MINIMUM_GH.minor
          ? minor < MINIMUM_GH.minor
          : patch < MINIMUM_GH.patch;
    if (older) {
      return {
        status: "error",
        detail: `gh ${found} is older than the minimum ${MINIMUM_TEXT}. Before ${MINIMUM_TEXT}, gh auth token has no --user flag.`,
        remediation,
      };
    }
    return { status: "ok", detail: `gh ${found} (minimum ${MINIMUM_TEXT})` };
  });
}

export function ghAuthCheck(account: string, timeoutMs = 15000): Check {
  return timedCheck(
    { name: `gh auth: ${account}`, required: true, timeoutMs },
    async (env, { signal }) => {
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
    },
  );
}

export function ghProjectCheck(repo: GithubDoctorRepo, timeoutMs = 15000): Check {
  return timedCheck(
    { name: `gh project: ${repo.key}`, required: true, timeoutMs },
    async (env, { signal }) => {
      const account = accountOf(repo);
      const project = projectOf(repo);
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
    },
  );
}

// A label that tasker writes to an issue, and what happens when it is missing.
interface LabelToRead {
  configKey: string;
  name: string;
  missing: "error" | "warn";
  reason: string;
}

const SEVERITY: Record<CheckStatus, number> = { ok: 0, warn: 1, error: 2 };

// The labels that tasker writes with the configuration of the repo, in the order of use.
function labelsToRead(repo: GithubDoctorRepo): LabelToRead[] {
  const { updateOnStart, inProgressLabel, updateOnFinish, doneLabel } = repo.issueTracker;
  const labels: LabelToRead[] = [];
  if (updateOnStart && inProgressLabel !== undefined) {
    labels.push({
      configKey: "issueTracker.inProgressLabel",
      name: inProgressLabel,
      missing: "error",
      reason: "tasker start fails",
    });
  }
  if (updateOnFinish && doneLabel !== undefined) {
    labels.push({
      configKey: "issueTracker.doneLabel",
      name: doneLabel,
      missing: "warn",
      reason: "tasker finish only warns",
    });
  }
  return labels;
}

// GitHub answers a missing label with exit code 1 and (HTTP 404) in stderr.
function isNotFound(error: unknown): boolean {
  return error instanceof GhError && error.exitCode === 1 && error.stderr.includes("(HTTP 404)");
}

// The check only reads. Each label is one GET with no fields. It never creates a label.
export function ghLabelsCheck(repo: GithubDoctorRepo, timeoutMs = 15000): Check {
  return timedCheck(
    { name: `gh labels: ${repo.key}`, required: true, timeoutMs },
    async (env, { signal }) => {
      const labels = labelsToRead(repo);
      if (labels.length === 0) {
        return { status: "ok", detail: `${repo.key}: no label to check` };
      }
      const account = accountOf(repo);
      const project = projectOf(repo);
      let status: CheckStatus = "ok";
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
          if (SEVERITY[label.missing] > SEVERITY[status]) {
            status = label.missing;
          }
        }
      }
      const detail = [`${repo.key}:`, ...lines].join("\n");
      if (missingKeys.length === 0) {
        return { status, detail };
      }
      return {
        status,
        detail,
        remediation: `Create each missing label in ${project} on GitHub, or change ${missingKeys.join(" and ")}.`,
      };
    },
  );
}

// The doctor checks of the repos that use the github tracker, in this order:
// 1. The version check, once, and only when at least one repo uses the github tracker.
//    No github repo gives [].
// 2. One auth check for each distinct account, in the order of first use. The match is exact,
//    the same as the token cache of runGh().
// 3. For each github repo, in the order of the configuration, the project check and then the
//    labels check.
// The checks never change GitHub. They make only read-only gh calls.
export function githubDoctorChecks(repos: readonly GithubDoctorRepo[]): Check[] {
  const github = repos.filter((repo) => repo.issueTracker.provider === "github");
  if (github.length === 0) {
    return [];
  }
  const accounts = new Set(github.map(accountOf));
  return [
    ghVersionCheck(),
    ...[...accounts].map((account) => ghAuthCheck(account)),
    ...github.flatMap((repo) => [ghProjectCheck(repo), ghLabelsCheck(repo)]),
  ];
}
