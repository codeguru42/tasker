import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasLanded, isLocalBase, parentOf } from "../../src/tasks/parent.js";
import type { Task } from "../../src/store/store.js";
import { dayAt, seedTasks, withDataRootStore, type SeedTask } from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";

const REPO = "codeguru42/tasker";

// Seeds the tasks into a new data root. When linkTo is the index of a seeded task, it sets parentTaskId of the last
// task to the id of that task. Then it runs parentOf for the last seeded task.
function parentOfLast(tasks: readonly Omit<SeedTask, "repoKey" | "at">[], linkTo?: number): Task | undefined {
  const dataRoot = join(useTempDir("tasker-parent-"), "data");
  const seeded = seedTasks(
    dataRoot,
    tasks.map((task, index) => ({ repoKey: REPO, at: dayAt(index + 1), ...task })),
  );
  return withDataRootStore(dataRoot, (store) => {
    const last = seeded[seeded.length - 1];
    const stacked = linkTo === undefined ? last : store.updateTask(last.id, { parentTaskId: seeded[linkTo].id });
    return parentOf(store, stacked);
  });
}

const task = (number: number, state: string, extra: Partial<SeedTask> = {}) => ({
  issueKey: `${REPO}#${number}`,
  state,
  ...extra,
});

describe("isLocalBase", () => {
  it("is true for refs/heads/<x> and false for any other base", () => {
    expect(isLocalBase("refs/heads/x")).toBe(true);
    expect(isLocalBase("main")).toBe(false);
  });
});

describe("parentOf", () => {
  it("gives undefined for a task with no link and no base", () => {
    expect(parentOfLast([task(5, "awaiting_work_review", { branch: "b5" }), task(6, "executed")])).toBeUndefined();
  });

  it("gives undefined for a task with no link, also when a local base matches a branch", () => {
    const stacked = task(6, "executed", { base: "refs/heads/b5" });
    expect(parentOfLast([task(5, "awaiting_work_review", { branch: "b5" }), stacked])).toBeUndefined();
  });

  it("gives the task of the link", () => {
    const stacked = task(6, "executed", { base: "refs/heads/b5" });
    const parent = parentOfLast(
      [task(4, "finished", { branch: "b4" }), task(5, "awaiting_work_review", { branch: "b5" }), stacked],
      1,
    );
    expect(parent?.issueKey).toBe(`${REPO}#5`);
  });

  it("gives a parent in a state that has no worktree", () => {
    const stacked = task(6, "executed", { base: "refs/heads/b5" });
    expect(parentOfLast([task(5, "finished", { branch: "b5" }), stacked], 0)?.state).toBe("finished");
  });

  it("lets the link win over a newer task with the same branch", () => {
    const stacked = task(6, "executed", { base: "refs/heads/shared" });
    const parent = parentOfLast(
      [task(3, "landed", { branch: "shared" }), task(4, "executed", { branch: "shared" }), stacked],
      0,
    );
    expect(parent?.issueKey).toBe(`${REPO}#3`);
  });
});

describe("hasLanded", () => {
  it.each(["landed", "finishing", "cleanup_failed", "finished"])("is true for a task in %s", (state) => {
    expect(hasLanded({ state } as Task)).toBe(true);
  });

  it("is false for a task in accepted", () => {
    expect(hasLanded({ state: "accepted" } as Task)).toBe(false);
  });
});
