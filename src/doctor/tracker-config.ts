import type { Config } from "../config/schema.js";
import type { Check } from "./check.js";
import { hasGitHubBoardStartTarget, trackerTargetKeys, trackerTargets } from "../tasks/tracker-write.js";

const CHECK_TIMEOUT_MS = 1000;

function missingTargetCheck(repoKey: string, detail: string): Check {
  return {
    name: `tracker config: ${repoKey}`,
    required: false,
    timeoutMs: CHECK_TIMEOUT_MS,
    async run() {
      return { status: "warn", detail };
    },
  };
}

// Warn when an enabled tracker update has no target in the repo configuration.
export function trackerConfigChecks(config: Config): Check[] {
  return Object.entries(config.repos).flatMap(([repoKey, repo]) => {
    const issueTracker = repo.issueTracker;
    const keys = trackerTargetKeys(issueTracker);
    const targets = trackerTargets(issueTracker);
    const checks: Check[] = [];
    const inProgressConfigKey = `repos.${repoKey}.issueTracker.${keys.inProgress}`;
    const doneConfigKey = `repos.${repoKey}.issueTracker.${keys.done}`;

    if (issueTracker.updateOnStart && targets.inProgress === undefined && !hasGitHubBoardStartTarget(issueTracker)) {
      checks.push(
        missingTargetCheck(
          repoKey,
          `repo ${repoKey}: start skips the in-progress write because ${inProgressConfigKey} is not set`,
        ),
      );
    }

    if (issueTracker.updateOnFinish && targets.done === undefined) {
      const detail =
        issueTracker.provider === "github"
          ? `repo ${repoKey}: finish closes the issue as completed because ${doneConfigKey} is not set`
          : `repo ${repoKey}: finish cannot move the issue to a done status, and its tracker write will warn, because ${doneConfigKey} is not set`;
      checks.push(missingTargetCheck(repoKey, detail));
    }

    return checks;
  });
}
