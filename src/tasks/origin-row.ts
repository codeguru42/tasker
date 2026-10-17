import { transitionFromEvents, type TaskState } from "../state/machine.js";
import type { TaskEvent } from "../store/store.js";

// The tables of a command that moves a task back by its origin. rows holds the row of each origin except refining.
// For refining, the origin of the refine picks the row of refineRows. refineFallback is the row of a refine origin
// that has no row, or undefined when the command has none.
export interface OriginTables<R> {
  rows: Partial<Record<TaskState, R>>;
  refineRows: Partial<Record<TaskState, R>>;
  refineFallback?: R;
}

// The row of the origin, or undefined when the command has no step for it.
export function originRow<R>(events: readonly TaskEvent[], origin: TaskState, tables: OriginTables<R>): R | undefined {
  if (origin !== "refining") return tables.rows[origin];
  const refineOrigin = transitionFromEvents(events, "refining");
  return (refineOrigin === undefined ? undefined : tables.refineRows[refineOrigin]) ?? tables.refineFallback;
}
