import type { Io } from "../cli.js";
import type { RepoConfig } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueTrackerId } from "../issues/provider.js";
import type { TaskStore } from "../store/store.js";

type TargetKey = "inProgressLabel" | "inProgressStatus" | "doneLabel" | "doneStatus" | "reviewLabel" | "reviewStatus";

// The keys of the issue tracker that hold the in-progress and the done target, for each provider.
const TARGET_KEYS: Record<IssueTrackerId, { inProgress: TargetKey; done: TargetKey; review: TargetKey }> = {
  github: { inProgress: "inProgressLabel", done: "doneLabel", review: "reviewLabel" },
  jira: { inProgress: "inProgressStatus", done: "doneStatus", review: "reviewStatus" },
};

// The configuration keys that hold the targets for a tracker provider.
export function trackerTargetKeys(issueTracker: Pick<RepoConfig["issueTracker"], "provider">) {
  return TARGET_KEYS[issueTracker.provider];
}

// The in-progress and the done target of a tracker. A target is undefined when its key is not set.
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

export type TrackerAction = "assign" | "in_progress" | "clear_in_progress" | "done" | "abort";

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
): Promise<void> {
  try {
    await write.run();
  } catch (error) {
    const message = errorMessage(error);
    store.appendEvent(taskId, "tracker_update", { action: write.action, result: "failed", error: message });
    io.stderr(`warning: cannot ${write.text} on the tracker: ${message}\n`);
    return;
  }
  // A passed in_progress write sets the column trackerMarked. Code reads that column, never the event.
  if (write.action === "in_progress") store.recordTrackerMark(taskId);
  else store.appendEvent(taskId, "tracker_update", { action: write.action, result: "ok" });
  io.stdout(`${write.success}\n`);
}
