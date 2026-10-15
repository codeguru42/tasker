import type { Config } from "../config/schema.js";
import { compareText } from "../compare-text.js";
import { errorMessage } from "../error-message.js";
import { compareIssueKeys } from "../issue-key/order.js";
import { cleanPlanPaths } from "../plan/answer.js";
import type { Task, TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";

// The files of the task that another task in flight also changes.
export interface TaskOverlap {
  issueKey: string;
  state: string;
  // Sorted as plain text.
  files: string[];
}

export interface OverlapReport {
  overlaps: TaskOverlap[];
  // One line for each task whose branch paths cannot be read.
  notes: string[];
}

// The revision of the newest base event of the task, or undefined.
function baseRevisionOf(store: TaskStore, taskId: number): string | undefined {
  const events = store.listEvents(taskId);
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type !== "base") continue;
    const revision = (events[i].data as { revision?: unknown } | null)?.revision;
    return typeof revision === "string" ? revision : undefined;
  }
  return undefined;
}

// Compares files with the files of each other active task of the repo of task. docs/dev/tasks.md gives the reasons.
export async function findOverlaps(o: {
  config: Config;
  store: TaskStore;
  task: Task;
  files: readonly string[];
  env: NodeJS.ProcessEnv;
}): Promise<OverlapReport> {
  const { config, store, task, env } = o;
  const mine = new Set(cleanPlanPaths(o.files));
  const others = store
    .listTasks({ repoKey: task.repoKey })
    .filter((other) => other.id !== task.id)
    .sort((a, b) => compareIssueKeys(a.issueKey, b.issueKey));
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const report: OverlapReport = { overlaps: [], notes: [] };
  for (const other of others) {
    const theirs = [...(store.latestPlanRevision(other.id)?.answer.files_changed ?? [])];
    const baseRevision = baseRevisionOf(store, other.id);
    if (other.branch !== null && baseRevision !== undefined) {
      try {
        theirs.push(...(await vcs.changedPaths(ctx, { taskRef: other.branch, baseRevision })));
      } catch (error) {
        report.notes.push(
          `note: cannot read the files of the task branch of ${other.issueKey}: ${errorMessage(error)}`,
        );
      }
    }
    const shared = cleanPlanPaths(theirs)
      .filter((file) => mine.has(file))
      .sort(compareText);
    if (shared.length > 0) report.overlaps.push({ issueKey: other.issueKey, state: other.state, files: shared });
  }
  return report;
}

// The warning for the overlaps, with lastLine as its last line. An empty text for no overlap.
export function overlapWarning(overlaps: readonly TaskOverlap[], lastLine: string): string {
  if (overlaps.length === 0) return "";
  const lines = [
    "WARNING: this plan changes files that other tasks in flight also change.",
    "The task that lands second can get merge conflicts and redo its work.",
    ...overlaps.flatMap((overlap) => [`  ${overlap.issueKey} (${overlap.state}):`, ...overlap.files.map((f) => `    ${f}`)]),
    lastLine,
  ];
  return `${lines.join("\n")}\n`;
}
