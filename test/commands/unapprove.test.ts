import { describe, expect, it } from "vitest";
import { unapprove } from "../../src/commands/unapprove.js";
import { taskLockName } from "../../src/store/locks.js";
import { runCommand } from "../helpers/cli.js";
import {
  planRevisionOf,
  planStateSnapshot,
  runApprove,
  seedApprovedTask,
  seedPlanReviewTask,
  seedPlanRevision,
  seedPlanningTask,
} from "../helpers/plan.js";
import { startLockHolder } from "../helpers/processes.js";
import { databasePathOf, eventsOf, latestTaskOf, lockNames, withDataRootStore } from "../helpers/store.js";
import { wrongStateError } from "../helpers/state-commands.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

const runUnapprove = (key = KEY) => runCommand(unapprove, "unapprove", key, "--repo", REPO);

const unapprovedEvent = (version: number) => ({
  type: "unapproved",
  data: { version, from: "approved", to: "awaiting_plan_review" },
});

describe("unapprove", () => {
  it("unapproves the pinned revision", async () => {
    const { dataRoot, task } = seedApprovedTask();
    const before = eventsOf(dataRoot, KEY);

    const result = await runUnapprove();

    expect(result.code).toBe(0);
    expect(result.out).toBe("unapproved codeguru42/tasker#5: revision v1 is no longer pinned\n");
    expect(result.err).toBe("");
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_plan_review");
    expect(planRevisionOf(dataRoot, task.id, 1)?.approvedAt).toBeNull();
    expect(eventsOf(dataRoot, KEY)).toEqual([...before, unapprovedEvent(1)]);
  });

  it("approves, unapproves and approves the same revision again", async () => {
    const { dataRoot, task } = seedPlanReviewTask();

    const first = await runApprove();
    const second = await runUnapprove();
    const third = await runApprove();

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(third.code).toBe(0);
    expect(third.out.startsWith("approved codeguru42/tasker#5 at revision v1")).toBe(true);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("approved");
    expect(withDataRootStore(dataRoot, (store) => store.pinnedPlanRevision(task.id))?.version).toBe(1);
    expect(
      eventsOf(dataRoot, KEY)
        .slice(-3)
        .map((e) => e.type),
    ).toEqual(["approved", "unapproved", "approved"]);
  });

  it("clears the pinned v3 and keeps the older approval of v1", async () => {
    const { dataRoot, task } = seedApprovedTask({ revisions: [{}, {}, {}], approved: 1 });

    const result = await runUnapprove();

    expect(result.code).toBe(0);
    expect(result.out).toBe("unapproved codeguru42/tasker#5: revision v3 is no longer pinned\n");
    expect(planRevisionOf(dataRoot, task.id, 3)?.approvedAt).toBeNull();
    expect(planRevisionOf(dataRoot, task.id, 1)?.approvedAt).not.toBeNull();
    expect(planRevisionOf(dataRoot, task.id, 2)?.approvedAt).toBeNull();
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_plan_review");
    expect(eventsOf(dataRoot, KEY).at(-1)).toEqual(unapprovedEvent(3));
  });

  it("fails at once when another process holds the task lock", async () => {
    const { dataRoot, task } = seedApprovedTask();
    const before = planStateSnapshot(dataRoot, KEY, task.id, [1]);
    const name = taskLockName(REPO, KEY);
    const holder = startLockHolder(databasePathOf(dataRoot), name);
    await holder.attempt;

    const result = await runUnapprove();

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toMatch(new RegExp(`^the lock ${name} is busy`));
    expect(lockNames(dataRoot)).toEqual([name]);
    expect(planStateSnapshot(dataRoot, KEY, task.id, [1])).toEqual(before);
  });
});

describe("a refused unapprove", () => {
  it("refuses a task in another state", async () => {
    const { dataRoot, task } = seedPlanReviewTask();
    const before = planStateSnapshot(dataRoot, KEY, task.id, [1]);

    const result = await runUnapprove();

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toBe(
      `${wrongStateError("awaiting_plan_review", "codeguru42/tasker#5", "unapprove", "approved")}\n`,
    );
    expect(planStateSnapshot(dataRoot, KEY, task.id, [1])).toEqual(before);
  });

  it("refuses a second unapprove", async () => {
    const { dataRoot, task } = seedApprovedTask();
    expect((await runUnapprove()).code).toBe(0);
    const before = planStateSnapshot(dataRoot, KEY, task.id, [1]);

    const result = await runUnapprove();

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toBe(
      `${wrongStateError("awaiting_plan_review", "codeguru42/tasker#5", "unapprove", "approved")}\n`,
    );
    expect(planStateSnapshot(dataRoot, KEY, task.id, [1])).toEqual(before);
  });

  it("refuses an approved task with no pinned revision", async () => {
    const { dataRoot, task } = seedPlanningTask();
    withDataRootStore(dataRoot, (store) => seedPlanRevision(store, task.id, {}, "approved"));
    const before = planStateSnapshot(dataRoot, KEY, task.id, [1]);

    const result = await runUnapprove();

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toBe("the task of codeguru42/tasker#5 is approved, but no revision is pinned\n");
    expect(planStateSnapshot(dataRoot, KEY, task.id, [1])).toEqual(before);
  });
});
