import { describe, expect, it } from "vitest";
import type { TaskStore } from "../../src/store/store.js";
import {
  assertTaskState,
  requireBase,
  requireBaseRevision,
  requireBranch,
  requireWorktree,
  taskById,
  taskInState,
} from "../../src/tasks/task-state.js";
import { dayAt, seedTasks, withDataRootStore } from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";

function seeded(
  state: string,
  extra: { base?: string; branch?: string; worktreePath?: string } = {},
): { dataRoot: string; id: number } {
  const dataRoot = useTempDir("tasker-task-state-");
  const [task] = seedTasks(dataRoot, [
    { issueKey: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", state, at: dayAt(1), ...extra },
  ]);
  return { dataRoot, id: task.id };
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
    withDataRootStore(dataRoot, (store) =>
      expect(() => assertTaskState(taskById(store, id), "approved", "execute")).not.toThrow(),
    );
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

const worktreeOf = (store: TaskStore, id: number) => requireWorktree(taskById(store, id));
const baseOf = (store: TaskStore, id: number) => requireBase(taskById(store, id));
const branchOf = (store: TaskStore, id: number) => requireBranch(taskById(store, id));
const requiredBaseRevisionOf = (store: TaskStore, id: number) => requireBaseRevision(store, taskById(store, id));

describe("requireWorktree", () => {
  it("gives the worktree path", () => {
    const { dataRoot, id } = seeded("awaiting_work_review", { worktreePath: "/work/tree" });
    withDataRootStore(dataRoot, (store) => expect(worktreeOf(store, id)).toBe("/work/tree"));
  });

  it("throws for a task without a worktree", () => {
    const { dataRoot, id } = seeded("awaiting_work_review");
    withDataRootStore(dataRoot, (store) =>
      expect(() => worktreeOf(store, id)).toThrow("the task of codeguru42/tasker#5 has no worktree"),
    );
  });
});

describe("requireBranch", () => {
  it("gives the branch", () => {
    const { dataRoot, id } = seeded("awaiting_work_review", { branch: "tasker/five" });
    withDataRootStore(dataRoot, (store) => expect(branchOf(store, id)).toBe("tasker/five"));
  });

  it("throws for a task without a branch", () => {
    const { dataRoot, id } = seeded("awaiting_work_review");
    withDataRootStore(dataRoot, (store) =>
      expect(() => branchOf(store, id)).toThrow("the task of codeguru42/tasker#5 has no branch"),
    );
  });
});

describe("requireBase", () => {
  it("gives the base", () => {
    const { dataRoot, id } = seeded("accepted", { base: "main" });
    withDataRootStore(dataRoot, (store) => expect(baseOf(store, id)).toBe("main"));
  });

  it("throws for a task without a base", () => {
    const { dataRoot, id } = seeded("accepted");
    withDataRootStore(dataRoot, (store) =>
      expect(() => baseOf(store, id)).toThrow("the task of codeguru42/tasker#5 has no base"),
    );
  });
});

describe("requireBaseRevision", () => {
  it("gives the revision of the newest base event", () => {
    const { dataRoot, id } = seeded("awaiting_work_review");
    withDataRootStore(dataRoot, (store) => {
      store.appendEvent(id, "base", { base: "main", revision: "refs/remotes/origin/main", source: "default" });
      store.appendEvent(id, "base", { base: "dev", revision: "refs/remotes/origin/dev", source: "explicit" });
      expect(requiredBaseRevisionOf(store, id)).toBe("refs/remotes/origin/dev");
    });
  });

  it("throws for a task without a base event", () => {
    const { dataRoot, id } = seeded("awaiting_work_review");
    withDataRootStore(dataRoot, (store) =>
      expect(() => requiredBaseRevisionOf(store, id)).toThrow("the task of codeguru42/tasker#5 has no base revision"),
    );
  });
});
