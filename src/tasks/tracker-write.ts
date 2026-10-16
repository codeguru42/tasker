import type { RepoConfig } from "../config/schema.js";
import type { IssueTrackerId } from "../issues/provider.js";

type TargetKey = "inProgressLabel" | "inProgressStatus" | "doneLabel" | "doneStatus";

// The keys of the issue tracker that hold the in-progress and the done target, for each provider.
const TARGET_KEYS: Record<IssueTrackerId, { inProgress: TargetKey; done: TargetKey }> = {
  github: { inProgress: "inProgressLabel", done: "doneLabel" },
  jira: { inProgress: "inProgressStatus", done: "doneStatus" },
};

// The in-progress and the done target of a tracker. A target is undefined when its key is not set.
export function trackerTargets(issueTracker: RepoConfig["issueTracker"]): {
  inProgress: string | undefined;
  done: string | undefined;
} {
  const keys = TARGET_KEYS[issueTracker.provider];
  return { inProgress: issueTracker[keys.inProgress], done: issueTracker[keys.done] };
}
