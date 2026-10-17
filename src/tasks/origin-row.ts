import { transitionFromEvents, type TaskState } from "../state/machine.js";
import type { TaskEvent } from "../store/store.js";

// The tables of a command that moves a task back by its origin. rows holds the row of each origin. For an origin in
// byOriginOf, the origin of that origin picks the row instead. The origin of an origin is the from of the last move
// into it. fallback is the row of an origin of an origin with no row, or undefined when the command has none.
export interface OriginTables<R> {
  rows: Partial<Record<TaskState, R>>;
  byOriginOf: Partial<Record<TaskState, { rows: Partial<Record<TaskState, R>>; fallback?: R }>>;
}

// The row of the origin, or undefined when the command has no step for it.
export function originRow<R>(events: readonly TaskEvent[], origin: TaskState, tables: OriginTables<R>): R | undefined {
  const byOrigin = tables.byOriginOf[origin];
  if (byOrigin === undefined) return tables.rows[origin];
  const inner = transitionFromEvents(events, origin);
  return (inner === undefined ? undefined : byOrigin.rows[inner]) ?? byOrigin.fallback;
}
