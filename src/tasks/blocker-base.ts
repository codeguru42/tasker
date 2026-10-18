import type { IssueRef } from "../issue-key/ref.js";
import type { Blocker } from "../issues/issue.js";
import type { TaskState } from "../state/machine.js";
import type { TaskStore } from "../store/store.js";
import { LOCAL_PREFIX } from "../vcs/local-branch.js";
import type { BlockerBase } from "../vcs/provider.js";

// A blocker in one of these states is done, also when its issue is still open.
const DONE_STATES: ReadonlySet<string> = new Set<TaskState>(["landed", "finishing", "cleanup_failed", "finished"]);

// The task of an open blocker in one of these states holds reviewed work that a new task can build on.
const READY_STATES: ReadonlySet<string> = new Set<TaskState>([
  "awaiting_work_review",
  "reviewing",
  "reviewed",
  "accepted",
  "pushing",
  "pushed",
  "opening_pr",
  "in_peer_review",
]);

// Sorts the blockers of an issue into done, ready and open, and gives the branch of the one ready blocker.
// It gives undefined when no blocker is ready. It throws when a blocker is open, or when more than one is ready.
export function blockerBase(store: TaskStore, ref: IssueRef, blockers: readonly Blocker[]): BlockerBase | undefined {
  const open: string[] = [];
  const ready: { key: string; branch: string | null }[] = [];
  for (const blocker of blockers) {
    if (blocker.state === "closed") continue;
    const task = store.findLatestTask(ref.repoKey, blocker.key);
    if (task === undefined) {
      open.push(blocker.key);
    } else if (DONE_STATES.has(task.state)) {
      continue;
    } else if (READY_STATES.has(task.state)) {
      ready.push({ key: blocker.key, branch: task.branch });
    } else {
      open.push(blocker.key);
    }
  }
  if (open.length > 0) {
    throw new Error(open.map((key) => `${key}: blocking issue is still open`).join("\n"));
  }
  if (ready.length > 1) {
    const keys = ready.map((blocker) => blocker.key).join(", ");
    throw new Error(
      `${ref.key} has more than one blocker ready to stack: ${keys}; pass --base refs/heads/<branch> to pick one`,
    );
  }
  if (ready.length === 0) return undefined;
  const [{ key, branch }] = ready;
  if (branch === null) throw new Error(`the task of the blocker ${key} has no branch`);
  return { key, base: LOCAL_PREFIX + branch };
}
