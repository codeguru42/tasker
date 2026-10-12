import type { Check } from "../../doctor/check.js";
import { timedCheck } from "../../doctor/timed-check.js";
import type { RepoConfig } from "../../config/schema.js";
import { authStatus } from "./auth.js";
import { runGh, readGhVersion, GhNotInstalledError } from "./run.js";

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
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }
        return {
          status: "error",
          detail: `${repo.key}: the account ${account} cannot see the project ${project}: ${error instanceof Error ? error.message : String(error)}`,
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
