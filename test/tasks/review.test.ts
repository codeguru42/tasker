import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReviewAnswer } from "../../src/review/answer.js";
import type { Config } from "../../src/config/schema.js";
import { reviewTranscriptPath } from "../../src/store/layout.js";
import { taskLockName } from "../../src/store/locks.js";
import { reviewTask } from "../../src/tasks/review.js";
import { captureIo } from "../helpers/cli.js";
import { captureAssistantStartInputs } from "../helpers/assistant-run.js";
import { withTrustedExtensions } from "../helpers/config.js";
import { answerStream } from "../helpers/plan.js";
import { startLockHolder } from "../helpers/processes.js";
import { validReviewAnswer } from "../helpers/review.js";
import { databasePathOf, latestTaskOf, lockNames, withDataRootStore, reviewSessionRows } from "../helpers/store.js";
import {
  expectRefusedWithoutChange,
  taskRefOf,
  useReviewFixture,
  useSeededTask as useSharedSeededTask,
} from "../helpers/task-fixtures.js";
import type { FakeClaude } from "../helpers/fake-claude.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

interface ReviewTarget {
  dataRoot: string;
  config: Config;
  claude: FakeClaude;
}

// Runs reviewTask for the latest task of KEY.
function callReview(target: ReviewTarget, key = KEY) {
  const io = captureIo();
  return withDataRootStore(target.dataRoot, (store) => {
    const task = store.findLatestTask(REPO, key)!;
    return reviewTask(store, {
      config: target.config,
      ref: taskRefOf({ key, repoKey: REPO }),
      taskId: task.id,
      env: process.env,
      io,
    });
  });
}

// Expects that reviewTask refuses with message, and that it wrote nothing: the state and the events as before (see
// expectRefusedWithoutChange), no review session row, no transcript and no claude call.
async function expectRefused(target: ReviewTarget, message: string) {
  await expectRefusedWithoutChange({ dataRoot: target.dataRoot, key: KEY }, () => callReview(target), message);
  const task = latestTaskOf(target.dataRoot, KEY);
  expect(reviewSessionRows(target.dataRoot, task.id)).toEqual([]);
  expect(existsSync(reviewTranscriptPath(target.dataRoot, task, 1))).toBe(false);
  expect(target.claude.calls()).toEqual([]);
}

const CONTROL = { stream: answerStream(validReviewAnswer()) };

// A started fixture with a fake claude, and the task of KEY seeded in state with the given worktree and branch.
const useSeededTask = (change: { state: string; worktreePath?: string; branch?: string }) =>
  useSharedSeededTask(CONTROL, change);

describe("reviewTask checks", () => {
  it("passes the review answer check to the provider", async () => {
    const inputs = captureAssistantStartInputs("prepareTaskPlanModeRun");
    const target = await useReviewFixture(CONTROL);

    await callReview(target);

    expect(inputs).toHaveLength(1);
    expect(inputs[0].checkAnswer).toBe(checkReviewAnswer);
  });

  it("records the trusted extension list for a new review session", async () => {
    const target = await useReviewFixture(CONTROL);
    const trustedExtensions = ["configured-review-key"];
    target.config = withTrustedExtensions(target.config, REPO, trustedExtensions);
    await callReview(target);
    const task = latestTaskOf(target.dataRoot, KEY);
    expect(reviewSessionRows(target.dataRoot, task.id)[0]).toMatchObject({
      trusted_extensions: '["configured-review-key"]',
    });
  });

  it("refuses a task that is not in awaiting_work_review", async () => {
    const target = await useSeededTask({ state: "executed" });

    await expectRefused(target, `the task of ${KEY} is in executed; tasker review needs awaiting_work_review`);
  });

  it("refuses a task with no worktree", async () => {
    const target = await useSeededTask({ state: "awaiting_work_review" });

    await expectRefused(target, `the task of ${KEY} has no worktree`);
  });

  it("refuses a task with no branch", async () => {
    const target = await useSeededTask({ state: "awaiting_work_review", worktreePath: "/work/tree" });

    await expectRefused(target, `the task of ${KEY} has no branch`);
  });

  it("refuses a task with no base revision", async () => {
    const target = await useSeededTask({
      state: "awaiting_work_review",
      worktreePath: "/work/tree",
      branch: "tasker/five",
    });

    await expectRefused(target, `the task of ${KEY} has no base revision`);
  });

  it("refuses a task branch that the clone does not have", async () => {
    const work = await useReviewFixture(CONTROL);
    withDataRootStore(work.dataRoot, (store) => store.updateTask(work.task.id, { branch: "issue-99-missing" }));

    await expectRefused(work, "cannot resolve the task branch: issue-99-missing");
  });

  it("fails at once when another process holds the task lock", async () => {
    const work = await useReviewFixture(CONTROL);
    const name = taskLockName(REPO, KEY);
    const holder = startLockHolder(databasePathOf(work.dataRoot), name);
    await holder.attempt;

    await expectRefused(work, `the lock ${name} is busy`);
    expect(lockNames(work.dataRoot)).toEqual([name]);
  });
});
