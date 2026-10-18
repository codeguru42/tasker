import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { IssueRef } from "../../src/issue-key/ref.js";
import type { Blocker } from "../../src/issues/issue.js";
import { blockerBase } from "../../src/tasks/blocker-base.js";
import { dayAt, seedTasks, withDataRootStore, type SeedTask } from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";

const REPO = "codeguru42/tasker";
const ref: IssueRef = { key: `${REPO}#5`, repoKey: REPO, shortRef: "codeguru42-tasker-5" };
const open = (number: number, project = REPO): Blocker => ({ key: `${project}#${number}`, state: "open" });
const closed = (number: number, project = REPO): Blocker => ({ key: `${project}#${number}`, state: "closed" });

const READY_STATES = [
  "awaiting_work_review",
  "reviewing",
  "reviewed",
  "accepted",
  "pushing",
  "pushed",
  "opening_pr",
  "in_peer_review",
];
const DONE_STATES = ["landed", "finishing", "cleanup_failed", "finished"];

// Seeds the tasks into a new data root, then runs blockerBase for issue 5 with the blockers.
function call(tasks: readonly Omit<SeedTask, "repoKey" | "at">[], blockers: readonly Blocker[]) {
  const dataRoot = join(useTempDir("tasker-blocker-base-"), "data");
  seedTasks(
    dataRoot,
    tasks.map((task, index) => ({ repoKey: REPO, at: dayAt(index + 1), ...task })),
  );
  return withDataRootStore(dataRoot, (store) => blockerBase(store, ref, blockers));
}

const task = (number: number, state: string, branch = `b${number}`) => ({
  issueKey: `${REPO}#${number}`,
  state,
  branch,
});

describe("blockerBase", () => {
  it("gives undefined for no blockers", () => {
    expect(call([], [])).toBeUndefined();
  });

  it.each(READY_STATES)("gives the branch of an open blocker whose task is in %s", (state) => {
    expect(call([task(3, state)], [open(3)])).toEqual({ key: `${REPO}#3`, base: "refs/heads/b3" });
  });

  it.each(DONE_STATES)("counts an open blocker whose task is in %s as done", (state) => {
    expect(call([task(3, state)], [open(3)])).toBeUndefined();
  });

  it("counts a closed blocker with no task as done", () => {
    expect(call([], [closed(3)])).toBeUndefined();
  });

  it("counts a closed blocker whose task is in planning as done", () => {
    expect(call([task(3, "planning")], [closed(3)])).toBeUndefined();
  });

  it("refuses an open blocker whose task is in planning", () => {
    expect(() => call([task(3, "planning")], [open(3)])).toThrow(`${REPO}#3: blocking issue is still open`);
  });

  it("refuses an open blocker with no task", () => {
    expect(() => call([], [open(3)])).toThrow(`${REPO}#3: blocking issue is still open`);
  });

  it("refuses an open blocker of another repo", () => {
    const other = { issueKey: "other/repo#3", repoKey: "other/repo", state: "reviewed", branch: "b3" };
    expect(() => call([other], [open(3, "other/repo")])).toThrow("other/repo#3: blocking issue is still open");
  });

  it("gives one line for each open blocker, in order", () => {
    expect(() => call([], [open(4), closed(2), open(3)])).toThrow(
      new Error(`${REPO}#4: blocking issue is still open\n${REPO}#3: blocking issue is still open`),
    );
  });

  it("uses the newest task of the blocker when none is active", () => {
    const older = task(3, "reviewed");
    const newer = task(3, "cancelled", "b3-new");
    expect(() => call([older, newer], [open(3)])).toThrow(`${REPO}#3: blocking issue is still open`);
  });

  it("gives the open error before the ready blocker", () => {
    expect(() => call([task(3, "reviewed")], [open(3), open(4)])).toThrow(
      new Error(`${REPO}#4: blocking issue is still open`),
    );
  });

  it("refuses more than one ready blocker", () => {
    expect(() => call([task(3, "reviewed"), task(4, "pushed")], [open(3), open(4)])).toThrow(
      `${REPO}#5 has more than one blocker ready to stack: ${REPO}#3, ${REPO}#4; pass --base refs/heads/<branch> to pick one`,
    );
  });
});
