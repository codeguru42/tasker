import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertBaseMoved, assertParentLanded, isLocalBase, parentOf } from "../../src/tasks/parent.js";
import type { Task, TaskStore } from "../../src/store/store.js";
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

type Guard = (store: TaskStore, task: Task) => void;

// Seeds the tasks into a new data root and links them. Each link is [child, parent] with indexes into the tasks, and a
// parent index that is out of range gives an id with no row. With no links, each task links to the one before it. Then
// it runs the guard for the last task and gives the message of its error, or undefined when the guard passes.
function guardError(
  guard: Guard,
  tasks: readonly Omit<SeedTask, "repoKey" | "at">[],
  links?: readonly (readonly [number, number])[],
): string | undefined {
  const dataRoot = join(useTempDir("tasker-parent-"), "data");
  const seeded = seedTasks(
    dataRoot,
    tasks.map((task, index) => ({ repoKey: REPO, at: dayAt(index + 1), ...task })),
  );
  const pairs = links ?? seeded.slice(1).map((_, index): readonly [number, number] => [index + 1, index]);
  return withDataRootStore(dataRoot, (store) => {
    for (const [child, parent] of pairs) {
      store.updateTask(seeded[child].id, { parentTaskId: seeded[parent]?.id ?? 9999 });
    }
    try {
      guard(store, store.getTask(seeded[seeded.length - 1].id)!);
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
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

const GUARDS: readonly (readonly [string, Guard])[] = [
  ["assertBaseMoved", assertBaseMoved],
  ["assertParentLanded", assertParentLanded],
];

const movedError = (parent: number, child: number, base: string) =>
  `the parent ${REPO}#${parent} of ${REPO}#${child} has landed; run tasker update-branch ${REPO}#${child} to move the task onto ${base} first`;

const loopError = (child: number, at: number) =>
  `the chain of parents of ${REPO}#${child} has a loop at ${REPO}#${at}; nothing moved`;

describe.each(GUARDS)("the walk of landed parents in %s", (_name, guard) => {
  const chain = (nextState: string, nextBase = "main") => [
    task(5, nextState, { branch: "b5", base: nextBase }),
    task(6, "landed", { branch: "b6", base: "refs/heads/b5" }),
    task(7, "executed", { base: "refs/heads/b6" }),
  ];

  it.each(["landed", "finishing", "cleanup_failed", "finished"])(
    "names the base of the next parent when it is in %s",
    (state) => {
      expect(guardError(guard, chain(state))).toBe(movedError(6, 7, "main"));
    },
  );

  it("throws the local-base error when the end task has a local base and no parent", () => {
    expect(guardError(guard, chain("landed", "refs/heads/x"))).toBe(
      `the base refs/heads/x of ${REPO}#5 is a local branch with no parent task; nothing moved`,
    );
  });

  it("throws the loop error when the chain goes back to the task", () => {
    const tasks = chain("landed").slice(1);
    expect(
      guardError(guard, tasks, [
        [0, 1],
        [1, 0],
      ]),
    ).toBe(loopError(7, 7));
  });

  it("throws the loop error at the task that the chain repeats above the task", () => {
    const tasks = [task(4, "landed", { branch: "b4", base: "refs/heads/b5" }), ...chain("landed", "refs/heads/b4")];
    expect(
      guardError(guard, tasks, [
        [0, 1],
        [1, 0],
        [2, 1],
        [3, 2],
      ]),
    ).toBe(loopError(7, 5));
  });

  it("throws the loop error when a landed parent links to itself", () => {
    const tasks = chain("landed").slice(1);
    expect(
      guardError(guard, tasks, [
        [0, 0],
        [1, 0],
      ]),
    ).toBe(loopError(7, 6));
  });

  it("throws the loop error when the chain returns to a task that has not landed", () => {
    expect(
      guardError(guard, chain("landed"), [
        [0, 2],
        [1, 0],
        [2, 1],
      ]),
    ).toBe(loopError(7, 7));
  });

  it("ends the walk at a landed parent whose link has no row", () => {
    const tasks = [task(6, "landed", { branch: "b6", base: "main" }), task(7, "executed", { base: "refs/heads/b6" })];
    expect(
      guardError(guard, tasks, [
        [0, 9],
        [1, 0],
      ]),
    ).toBe(movedError(6, 7, "main"));
  });

  it("names the base of the direct parent when the next parent has not landed", () => {
    expect(guardError(guard, chain("accepted"))).toBe(movedError(6, 7, "refs/heads/b5"));
  });
});

describe("assertParentLanded", () => {
  it("keeps the cancelled error", () => {
    const tasks = [task(5, "cancelled", { branch: "b5" }), task(6, "executed", { base: "refs/heads/b5" })];
    expect(guardError(assertParentLanded, tasks)).toBe(
      `the parent ${REPO}#5 of ${REPO}#6 is cancelled; ${REPO}#6 cannot land on it`,
    );
  });

  it("keeps the not-landed error", () => {
    const tasks = [task(5, "accepted", { branch: "b5" }), task(6, "executed", { base: "refs/heads/b5" })];
    expect(guardError(assertParentLanded, tasks)).toBe(
      `the parent ${REPO}#5 of ${REPO}#6 has not landed; land the parent first, then run tasker update-branch ${REPO}#6`,
    );
  });
});
