import type { Io } from "../cli.js";
import type { Config, RepoConfig } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import { issueProviderFor, type IssueTrackerId } from "../issues/provider.js";
import type { Task, TaskStore } from "../store/store.js";

type TargetKey = "inProgressLabel" | "inProgressStatus" | "doneLabel" | "doneStatus" | "reviewLabel" | "reviewStatus";

// The keys of the issue tracker that hold each write target for each provider.
const TARGET_KEYS: Record<IssueTrackerId, { inProgress: TargetKey; done: TargetKey; review: TargetKey }> = {
  github: { inProgress: "inProgressLabel", done: "doneLabel", review: "reviewLabel" },
  jira: { inProgress: "inProgressStatus", done: "doneStatus", review: "reviewStatus" },
};

// The configuration keys that hold the targets for a tracker provider.
export function trackerTargetKeys(issueTracker: Pick<RepoConfig["issueTracker"], "provider">) {
  return TARGET_KEYS[issueTracker.provider];
}

// The in-progress, review, and done targets of a tracker. A target is undefined when its key is not set.
export function trackerTargets(issueTracker: RepoConfig["issueTracker"]): {
  inProgress: string | undefined;
  done: string | undefined;
  review: string | undefined;
} {
  const keys = trackerTargetKeys(issueTracker);
  return {
    inProgress: issueTracker[keys.inProgress],
    done: issueTracker[keys.done],
    review: issueTracker[keys.review],
  };
}

export type TrackerAction = "assign" | "in_progress" | "clear_in_progress" | "done" | "abort" | "review";

// One write to the issue tracker. text finishes "warning: cannot ... on the tracker: <error>".
// success is the line that stdout gets when the write works.
export interface TrackerWrite {
  action: TrackerAction;
  text: string;
  success: string;
  run: () => Promise<void>;
}

// Runs one tracker write and records the result as a tracker_update event. A failed write prints a warning on
// stderr with the raw error text. It never throws the error of the write: the task and the clone are correct.
export async function runTrackerWrite(
  store: TaskStore,
  taskId: number,
  write: TrackerWrite,
  io: Pick<Io, "stdout" | "stderr">,
): Promise<boolean> {
  try {
    await write.run();
  } catch (error) {
    const message = errorMessage(error);
    store.appendEvent(taskId, "tracker_update", { action: write.action, result: "failed", error: message });
    io.stderr(`warning: cannot ${write.text} on the tracker: ${message}\n`);
    return false;
  }
  // Passed marker writes set or clear trackerMarked with the successful tracker_update event. Code reads the column,
  // never the event.
  if (write.action === "in_progress") store.recordTrackerMark(taskId);
  else if (write.action === "clear_in_progress") store.clearTrackerMark(taskId);
  else store.appendEvent(taskId, "tracker_update", { action: write.action, result: "ok" });
  io.stdout(`${write.success}\n`);
  return true;
}

// Removes the GitHub in-progress marker. The marker protects an issue against two machines, so a task removes only
// the marker that it added. Abort clears it after the work stops. Open-pr clears it after a review label write passes.
export function clearMarkerWrite(
  config: Config,
  ref: IssueRef,
  task: Task,
  env: NodeJS.ProcessEnv,
): TrackerWrite | undefined {
  const { issueTracker } = config.repos[ref.repoKey];
  const marker = trackerTargets(issueTracker).inProgress;
  if (!issueTracker.updateOnStart || marker === undefined || !task.trackerMarked) return undefined;
  return {
    action: "clear_in_progress",
    text: `clear the in-progress marker of ${ref.key}`,
    success: `cleared the in-progress marker of ${ref.key} on the tracker`,
    run: () => issueProviderFor(config, ref.repoKey).clearInProgress(ref, marker, env),
  };
}
