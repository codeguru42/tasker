import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasLanded, parentOf } from "../../src/tasks/parent.js";
import type { Task } from "../../src/store/store.js";
import { dayAt, seedTasks, withDataRootStore, type SeedTask } from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";

const REPO = "codeguru42/tasker";

// Seeds the tasks into a new data root, then runs parentOf for the last seeded task.
function parentOfLast(tasks: readonly Omit<SeedTask, "repoKey" | "at">[]): Task | undefined {
  const dataRoot = join(useTempDir("tasker-parent-"), "data");
  const seeded = seedTasks(
    dataRoot,
    tasks.map((task, index) => ({ repoKey: REPO, at: dayAt(index + 1), ...task })),
  );
  return withDataRootStore(dataRoot, (store) => parentOf(store, seeded[seeded.length - 1]));
}

const task = (number: number, state: string, extra: Partial<SeedTask> = {}) => ({
  issueKey: `${REPO}#${number}`,
  state,
  ...extra,
});

describe("parentOf", () => {
  it("gives undefined for a task with no base", () => {
    expect(parentOfLast([task(5, "awaiting_work_review", { branch: "b5" }), task(6, "executed")])).toBeUndefined();
  });

  it("gives undefined for a base on origin", () => {
    const stacked = task(6, "executed", { base: "main" });
    expect(parentOfLast([task(5, "awaiting_work_review", { branch: "main" }), stacked])).toBeUndefined();
  });

  it("gives undefined for a local base that no task has as its branch", () => {
    const stacked = task(6, "executed", { base: "refs/heads/b5" });
    expect(parentOfLast([task(5, "awaiting_work_review", { branch: "other" }), stacked])).toBeUndefined();
  });

  it("gives the task whose branch is the local base", () => {
    const stacked = task(6, "executed", { base: "refs/heads/b5" });
    const parent = parentOfLast([
      task(4, "finished", { branch: "b4" }),
      task(5, "awaiting_work_review", { branch: "b5" }),
      stacked,
    ]);
    expect(parent?.issueKey).toBe(`${REPO}#5`);
  });

  it("gives the task with the highest id when tasks share the branch", () => {
    const stacked = task(6, "executed", { base: "refs/heads/shared" });
    const parent = parentOfLast([
      task(3, "finished", { branch: "shared" }),
      task(4, "landed", { branch: "shared" }),
      task(5, "executed", { branch: "other" }),
      stacked,
    ]);
    expect(parent?.issueKey).toBe(`${REPO}#4`);
  });

  it("reads a parent in a state that has no worktree", () => {
    const stacked = task(6, "executed", { base: "refs/heads/b5" });
    expect(parentOfLast([task(5, "finished", { branch: "b5" }), stacked])?.state).toBe("finished");
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
