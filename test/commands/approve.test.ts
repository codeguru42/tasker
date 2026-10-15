import { describe, expect, it } from "vitest";
import { approve } from "../../src/commands/approve.js";
import { taskLockName } from "../../src/store/locks.js";
import { runCommand } from "../helpers/cli.js";
import {
  planRevisionOf,
  seedPlanReviewTask,
  seedPlanRevision,
  seedPlanningTask,
  seedTaskWithPlanFiles,
  validPlanAnswer,
} from "../helpers/plan.js";
import { overlapWarningText } from "../helpers/overlap.js";
import { startLockHolder } from "../helpers/processes.js";
import { databasePathOf, dayAt, eventsOf, latestTaskOf, lockNames, withDataRootStore } from "../helpers/store.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

const runApprove = (key = KEY, ...extra: string[]) => runCommand(approve, "approve", key, "--repo", REPO, ...extra);

const seedOverlappingTask = (dataRoot: string) =>
  seedTaskWithPlanFiles(
    dataRoot,
    { issueKey: "codeguru42/tasker#6", repoKey: REPO, state: "awaiting_plan_review", at: dayAt(3) },
    ["src/a.ts"],
  );

const approvedEvent = (version: number, openQuestions: number) => ({
  type: "approved",
  data: { version, openQuestions, from: "awaiting_plan_review", to: "approved" },
});

// The state, the events and the approved_at of each version of the task, as the store holds them now.
const snapshot = (dataRoot: string, taskId: number, versions: number[]) => ({
  state: latestTaskOf(dataRoot, KEY).state,
  events: eventsOf(dataRoot, KEY),
  approvedAt: versions.map((version) => planRevisionOf(dataRoot, taskId, version)?.approvedAt),
});

// What a refused approve must leave: the state, the events and each approved_at as before.
const expectNoWrite = (dataRoot: string, taskId: number, before: ReturnType<typeof snapshot>) => {
  expect(snapshot(dataRoot, taskId, before.approvedAt.map((_, i) => i + 1))).toEqual(before);
};

const question = (id: string, text: string) => ({ id, question: text, context: "No context." });

describe("approve", () => {
  it("approves a plan with no question", async () => {
    const { dataRoot, task } = seedPlanReviewTask({
      revisions: [{ answer: validPlanAnswer({ questions: [] }) }],
    });
    const before = eventsOf(dataRoot, KEY);

    const result = await runApprove();

    expect(result.code).toBe(0);
    expect(result.out).toBe("approved codeguru42/tasker#5 at revision v1\nno open questions\n");
    expect(result.err).toBe("");
    expect(latestTaskOf(dataRoot, KEY).state).toBe("approved");
    expect(planRevisionOf(dataRoot, task.id, 1)?.approvedAt).not.toBeNull();
    expect(eventsOf(dataRoot, KEY)).toEqual([...before, approvedEvent(1, 0)]);
  });

  it("lists the one open question and approves anyway", async () => {
    const { dataRoot } = seedPlanReviewTask();

    const result = await runApprove();

    expect(result.code).toBe(0);
    expect(result.out).toBe(
      "approved codeguru42/tasker#5 at revision v1\n1 open question:\n  base-branch: Which branch is the base?\n",
    );
    expect(eventsOf(dataRoot, KEY).at(-1)).toEqual(approvedEvent(1, 1));
  });

  it("lists two open questions in order", async () => {
    const answer = validPlanAnswer({
      questions: [question("base-branch", "Which branch is the base?"), question("test-runner", "Which test runner?")],
    });
    const { dataRoot } = seedPlanReviewTask({ revisions: [{ answer }] });

    const result = await runApprove();

    expect(result.code).toBe(0);
    expect(result.out).toBe(
      "approved codeguru42/tasker#5 at revision v1\n2 open questions:\n" +
        "  base-branch: Which branch is the base?\n  test-runner: Which test runner?\n",
    );
    expect(eventsOf(dataRoot, KEY).at(-1)).toEqual(approvedEvent(1, 2));
  });

  it("approves the newest revision and keeps an older approval", async () => {
    const { dataRoot, task } = seedPlanReviewTask({ revisions: [{}, {}, {}], approved: 1 });

    const result = await runApprove();

    expect(result.code).toBe(0);
    expect(result.out.startsWith("approved codeguru42/tasker#5 at revision v3")).toBe(true);
    expect(planRevisionOf(dataRoot, task.id, 3)?.approvedAt).not.toBeNull();
    expect(planRevisionOf(dataRoot, task.id, 1)?.approvedAt).not.toBeNull();
    expect(planRevisionOf(dataRoot, task.id, 2)?.approvedAt).toBeNull();
    expect(withDataRootStore(dataRoot, (store) => store.pinnedPlanRevision(task.id))?.version).toBe(3);
    expect(eventsOf(dataRoot, KEY).at(-1)).toEqual(approvedEvent(3, 1));
  });

  it("warns about another task that changes the same files, and approves anyway", async () => {
    const { dataRoot } = seedPlanReviewTask();
    seedOverlappingTask(dataRoot);

    const result = await runApprove();

    expect(result.code).toBe(0);
    expect(result.err).toBe(
      overlapWarningText(
        [{ issueKey: "codeguru42/tasker#6", state: "awaiting_plan_review", files: ["src/a.ts"] }],
        "tasker approves the plan anyway.",
      ),
    );
    expect(latestTaskOf(dataRoot, KEY).state).toBe("approved");
  });

  it("fails at once when another process holds the task lock", async () => {
    const { dataRoot, task } = seedPlanReviewTask();
    const before = snapshot(dataRoot, task.id, [1]);
    const name = taskLockName(REPO, KEY);
    const holder = startLockHolder(databasePathOf(dataRoot), name);
    await holder.attempt;

    const result = await runApprove();

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toMatch(new RegExp(`^the lock ${name} is busy`));
    expect(lockNames(dataRoot)).toEqual([name]);
    expectNoWrite(dataRoot, task.id, before);
  });
});

describe("a refused approve", () => {
  // A task that the store holds in workspace_ready with a plan revision v1. The store refuses a revision in a
  // spawning state, so this is the nearest state that tasker can write before awaiting_plan_review.
  const seedOtherStateTask = () => {
    const { dataRoot, task } = seedPlanningTask();
    withDataRootStore(dataRoot, (store) => seedPlanRevision(store, task.id, {}, "workspace_ready"));
    return { dataRoot, task };
  };
  const STATE_ERROR =
    "the task of codeguru42/tasker#5 is in workspace_ready; tasker approve needs awaiting_plan_review\n";

  it("refuses a second approve", async () => {
    const { dataRoot, task } = seedPlanReviewTask();
    expect((await runApprove()).code).toBe(0);
    const before = snapshot(dataRoot, task.id, [1]);

    const result = await runApprove();

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toBe("codeguru42/tasker#5 is already approved at revision v1\n");
    expectNoWrite(dataRoot, task.id, before);
  });

  it("refuses a task in another state", async () => {
    const { dataRoot, task } = seedOtherStateTask();
    const before = snapshot(dataRoot, task.id, [1]);

    const result = await runApprove();

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toBe(STATE_ERROR);
    expectNoWrite(dataRoot, task.id, before);
  });

  it("refuses a task with no plan revision", async () => {
    const { dataRoot, task } = seedPlanReviewTask({ revisions: [] });
    const before = snapshot(dataRoot, task.id, [1]);

    const result = await runApprove();

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toBe("the task of codeguru42/tasker#5 has no plan revision\n");
    expectNoWrite(dataRoot, task.id, before);
  });

  it("prints no overlap warning", async () => {
    const { dataRoot, task } = seedOtherStateTask();
    seedOverlappingTask(dataRoot);
    const before = snapshot(dataRoot, task.id, [1]);

    const result = await runApprove();

    expect(result.err).toBe(STATE_ERROR);
    expectNoWrite(dataRoot, task.id, before);
  });
});
