import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TaskState } from "../../src/state/machine.js";
import { originRow, type OriginTables } from "../../src/tasks/origin-row.js";
import { pauseRefineFrom, pauseTaskVia, seedTask, withDataRootStore } from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";

const TABLES: OriginTables<string> = {
  rows: { planning: "planning row" },
  byOriginOf: {
    refining: { rows: { reviewed: "reviewed refine row" } },
    merging: { rows: { accepted: "accepted merge row" } },
  },
};
const WITH_FALLBACK: OriginTables<string> = {
  ...TABLES,
  byOriginOf: {
    ...TABLES.byOriginOf,
    refining: { rows: { reviewed: "reviewed refine row" }, fallback: "fallback row" },
  },
};

// Calls originRow on the events of a task that is in refining, or that has no move into refining. refineOrigin is the
// state that the last refine left.
function rowFor(origin: TaskState, tables: OriginTables<string>, refineOrigin?: TaskState): string | undefined {
  const dataRoot = join(useTempDir("tasker-origin-row-"), "data");
  return withDataRootStore(dataRoot, (store) => {
    const task = seedTask(store);
    if (refineOrigin !== undefined) pauseRefineFrom(store, task.id, refineOrigin, "interrupted");
    return originRow(store.listEvents(task.id), origin, tables);
  });
}

// Calls originRow with the origin merging, on the events of a task that moved from before into merging and stopped.
function mergeRowFor(before: TaskState): string | undefined {
  const dataRoot = join(useTempDir("tasker-origin-row-"), "data");
  return withDataRootStore(dataRoot, (store) => {
    const task = seedTask(store);
    pauseTaskVia(store, task.id, before, "merging", "interrupted");
    return originRow(store.listEvents(task.id), "merging", TABLES);
  });
}

describe("originRow", () => {
  it("gives the row of an origin other than refining", () => {
    expect(rowFor("planning", TABLES)).toBe("planning row");
  });

  it("gives undefined for an origin other than refining with no row, also with a fallback", () => {
    expect(rowFor("executing", TABLES)).toBeUndefined();
    expect(rowFor("executing", WITH_FALLBACK)).toBeUndefined();
  });

  it("gives the row of the origin of the refine", () => {
    expect(rowFor("refining", WITH_FALLBACK, "reviewed")).toBe("reviewed refine row");
  });

  it("gives the fallback, or undefined, for a refine origin with no row", () => {
    expect(rowFor("refining", WITH_FALLBACK, "accepted")).toBe("fallback row");
    expect(rowFor("refining", TABLES, "accepted")).toBeUndefined();
  });

  it("gives the fallback, or undefined, when the events hold no move into refining", () => {
    expect(rowFor("refining", WITH_FALLBACK)).toBe("fallback row");
    expect(rowFor("refining", TABLES)).toBeUndefined();
  });

  it("gives the row of the merge origin", () => {
    expect(mergeRowFor("accepted")).toBe("accepted merge row");
  });

  it("gives undefined for a merge origin with no row", () => {
    expect(mergeRowFor("in_peer_review")).toBeUndefined();
  });
});
