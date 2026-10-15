import type { TaskStore } from "../store/store.js";

// The revision of the newest base event of the task, or undefined.
export function baseRevisionOf(store: TaskStore, taskId: number): string | undefined {
  const events = store.listEvents(taskId);
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type !== "base") continue;
    const revision = (events[i].data as { revision?: unknown } | null)?.revision;
    return typeof revision === "string" ? revision : undefined;
  }
  return undefined;
}
