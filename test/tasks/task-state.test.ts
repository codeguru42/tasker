import { describe, expect, it } from "vitest";
import { assertTaskState, taskById, taskInState } from "../../src/tasks/task-state.js";
import { dayAt, seedTasks, withDataRootStore } from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";

function seeded(state: string): { dataRoot: string; id: number } {
  const dataRoot = useTempDir("tasker-task-state-");
  const [task] = seedTasks(dataRoot, [
    { issueKey: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", state, at: dayAt(1) },
  ]);
  return { dataRoot, id: task!.id };
}

describe("taskById", () => {
  it("gives the task", () => {
    const { dataRoot, id } = seeded("approved");
    withDataRootStore(dataRoot, (store) => expect(taskById(store, id).issueKey).toBe("codeguru42/tasker#5"));
  });

  it("throws for an unknown id", () => {
    const { dataRoot } = seeded("approved");
    withDataRootStore(dataRoot, (store) => expect(() => taskById(store, 999)).toThrow("task not found: 999"));
  });
});

describe("assertTaskState", () => {
  it("passes in the state", () => {
    const { dataRoot, id } = seeded("approved");
    withDataRootStore(dataRoot, (store) => expect(() => assertTaskState(taskById(store, id), "approved", "execute")).not.toThrow());
  });

  it("throws in another state", () => {
    const { dataRoot, id } = seeded("failed");
    withDataRootStore(dataRoot, (store) =>
      expect(() => assertTaskState(taskById(store, id), "approved", "execute")).toThrow(
        "the task of codeguru42/tasker#5 is in failed; tasker execute needs approved",
      ),
    );
  });
});

describe("taskInState", () => {
  it("gives the task in the state", () => {
    const { dataRoot, id } = seeded("approved");
    withDataRootStore(dataRoot, (store) => expect(taskInState(store, id, "approved", "execute").id).toBe(id));
  });

  it("throws for an unknown id and for another state", () => {
    const { dataRoot, id } = seeded("failed");
    withDataRootStore(dataRoot, (store) => {
      expect(() => taskInState(store, 999, "approved", "execute")).toThrow("task not found: 999");
      expect(() => taskInState(store, id, "approved", "execute")).toThrow(
        "the task of codeguru42/tasker#5 is in failed; tasker execute needs approved",
      );
    });
  });
});
