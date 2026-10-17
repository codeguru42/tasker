import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { githubShortRef } from "../../src/issue-key/short-ref.js";
import { failTask, transitionTask, type TaskState } from "../../src/state/machine.js";
import { verifyCommandLogPath } from "../../src/store/layout.js";
import type { Task } from "../../src/store/store.js";
import { retryTask } from "../../src/tasks/retry.js";
import { configWithTrackers } from "../helpers/config.js";
import { seedApprovedTaskWithSessions, sessionsOf, seedExecuteTodoStates, seedReviewSession } from "../helpers/plan.js";
import { expectRefusedWithoutChange } from "../helpers/task-fixtures.js";
import {
  eventsOf,
  failTaskFrom,
  failTaskVia,
  failVerifyRun,
  latestTaskOf,
  seedReview,
  withDataRootStore,
} from "../helpers/store.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

// Calls retryTask for the task in the data root, in a store that closes after the call.
function retry(dataRoot: string, task: Task, resumeExecute = false) {
  const config = { ...configWithTrackers({ [REPO]: {} }), dataRoot };
  const ref = { key: KEY, repoKey: REPO, shortRef: githubShortRef("5") };
  return withDataRootStore(dataRoot, (store) => retryTask(store, { config, ref, taskId: task.id, resumeExecute }));
}

// Expects that retry refuses with message, and that the state, the events and the sessions stay the same.
async function expectRetryRefused(dataRoot: string, task: Task, message: string, resumeExecute = false) {
  const sessions = sessionsOf(dataRoot, task);
  await expectRefusedWithoutChange({ dataRoot, key: KEY }, () => retry(dataRoot, task, resumeExecute), message);
  expect(sessionsOf(dataRoot, task)).toEqual(sessions);
}

describe("retryTask checks", () => {
  it("refuses a task that is not in failed", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();

    await expectRetryRefused(dataRoot, task, `the task of ${KEY} is in approved; tasker retry needs failed`);
  });

  it.each(["approved", "pushing"] as const)("refuses a task that failed in %s", async (origin) => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => failTaskFrom(store, task.id, origin));

    await expectRetryRefused(dataRoot, task, `the task of ${KEY} failed in ${origin}; tasker retry has no step for it`);
  });

  it("refuses a task that failed in merging after a move from in_peer_review", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => failTaskVia(store, task.id, "in_peer_review", "merging"));

    await expectRetryRefused(dataRoot, task, `the task of ${KEY} failed in merging; tasker retry has no step for it`);
  });

  it("refuses --resume-execute for a task that failed in planning", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => failTaskFrom(store, task.id, "planning"));

    await expectRetryRefused(dataRoot, task, "--resume-execute applies only to a task that failed in verifying", true);
  });
});

describe("retryTask origins", () => {
  const kept = { plan: true, execute: true, review: [1] };
  const rows: {
    origin: TaskState;
    before?: TaskState;
    target: TaskState;
    next: string;
    state: string;
    sessions: { plan: boolean; execute: boolean; review: number[] };
  }[] = [
    { origin: "provisioning", target: "provisioning", next: "start", state: "failed", sessions: kept },
    {
      origin: "planning",
      target: "workspace_ready",
      next: "plan",
      state: "workspace_ready",
      sessions: { ...kept, plan: false },
    },
    {
      origin: "refining",
      before: "awaiting_plan_review",
      target: "awaiting_plan_review",
      next: "refine",
      state: "awaiting_plan_review",
      sessions: kept,
    },
    {
      origin: "refining",
      before: "failed",
      target: "awaiting_plan_review",
      next: "refine",
      state: "awaiting_plan_review",
      sessions: kept,
    },
    {
      origin: "refining",
      before: "reviewed",
      target: "reviewed",
      next: "refine-findings",
      state: "reviewed",
      sessions: kept,
    },
    {
      origin: "refining",
      before: "awaiting_work_review",
      target: "awaiting_work_review",
      next: "review-feedback",
      state: "awaiting_work_review",
      sessions: kept,
    },
    {
      origin: "reviewing",
      target: "awaiting_work_review",
      next: "review",
      state: "awaiting_work_review",
      sessions: { ...kept, review: [] },
    },
    {
      origin: "executing",
      target: "approved",
      next: "execute",
      state: "approved",
      sessions: { ...kept, execute: false },
    },
    { origin: "verifying", target: "executed", next: "verify", state: "executed", sessions: kept },
    { origin: "merging", before: "accepted", target: "accepted", next: "merge", state: "accepted", sessions: kept },
  ];

  const labeled = rows.map((row) => ({
    ...row,
    label: row.before === undefined ? row.origin : `${row.origin} after a move from ${row.before}`,
  }));

  it.each(labeled)("moves a task that failed in $label", async (row) => {
    const { origin, before: from, target, next, state, sessions } = row;
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) =>
      from === undefined ? failTaskFrom(store, task.id, origin) : failTaskVia(store, task.id, from, origin),
    );
    const before = eventsOf(dataRoot, KEY);

    const result = await retry(dataRoot, task);

    expect(result).toEqual({ origin, target, next });
    expect(latestTaskOf(dataRoot, KEY).state).toBe(state);
    expect(sessionsOf(dataRoot, task)).toEqual(sessions);
    const data =
      origin === "provisioning"
        ? { origin, target, resumeExecute: false }
        : { origin, target, resumeExecute: false, from: "failed", to: target };
    expect(eventsOf(dataRoot, KEY).slice(before.length)).toEqual([{ type: "retry", data }]);
  });
});

describe("retryTask review session", () => {
  it("deletes only the review session of the next review number", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => {
      seedReview(store, task.id);
      seedReviewSession(store, task.id, 2, { sessionId: "r-2" });
      failTaskFrom(store, task.id, "reviewing");
    });

    await retry(dataRoot, task);

    expect(sessionsOf(dataRoot, task).review).toEqual([1]);
  });
});

describe("retryTask --resume-execute", () => {
  const failedVerify = (
    dataRoot: string,
    task: Task,
    change: Parameters<typeof failVerifyRun>[3],
    logs: readonly string[] | undefined,
    error = "command 2 failed",
  ) => withDataRootStore(dataRoot, (store) => failVerifyRun(store, dataRoot, task, change, logs, error));

  const failedRun: Parameters<typeof failVerifyRun>[3] = { result: "failed", commands: ["a", "b"], failingCommand: 2 };

  it("marks every todo done and queues the fix turn with the error and the log tail", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    failedVerify(dataRoot, task, failedRun, ["log a\n", "log b\n"]);

    const result = await retry(dataRoot, task, true);

    expect(result).toEqual({ origin: "verifying", target: "approved", next: "execute" });
    expect(latestTaskOf(dataRoot, KEY).state).toBe("approved");
    withDataRootStore(dataRoot, (store) => {
      expect(store.executeTodoProgress(task.id, 1).map((entry) => entry.state)).toEqual(["done", "done"]);
    });
    expect(withDataRootStore(dataRoot, (store) => store.queuedExecuteFixTurn(task.id, 1))).toMatchObject({
      verifyFailure: "command 2 failed",
      verifyLogTail: "log b\n",
    });
    const last = eventsOf(dataRoot, KEY).at(-1);
    expect(last).toEqual({
      type: "retry",
      data: { origin: "verifying", target: "approved", resumeExecute: true, from: "failed", to: "approved" },
    });
  });

  it("marks a todo that was in progress done", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => seedExecuteTodoStates(store, task.id, 1, { "write-test": "in_progress" }));
    failedVerify(dataRoot, task, failedRun, ["log a\n", "log b\n"]);

    await retry(dataRoot, task, true);

    withDataRootStore(dataRoot, (store) => {
      expect(store.executeTodoProgress(task.id, 1).map((entry) => entry.state)).toEqual(["done", "done"]);
    });
  });

  describe("gives a null tail", () => {
    it.each([
      "cannot read the uncommitted changes of the worktree before the run: EACCES",
      "the verify commands passed, but the run could not be recorded: disk full",
      "verifying failed: boom",
    ])("after the failure %s, which records no run", async (message) => {
      const { dataRoot, task } = seedApprovedTaskWithSessions();
      failedVerify(dataRoot, task, failedRun, ["log a\n", "log b\n"], "old failure");
      withDataRootStore(dataRoot, (store) => {
        transitionTask(store, task.id, "executed");
        transitionTask(store, task.id, "verifying");
        failTask(store, task.id, message);
      });

      await retry(dataRoot, task, true);

      expect(withDataRootStore(dataRoot, (store) => store.queuedExecuteFixTurn(task.id, 1))).toMatchObject({
        verifyFailure: message,
        verifyLogTail: null,
      });
    });

    it("for a run with no failing command", async () => {
      const { dataRoot, task } = seedApprovedTaskWithSessions();
      failedVerify(dataRoot, task, { result: "failed", failingCommand: null }, ["log\n"]);

      await retry(dataRoot, task, true);

      expect(withDataRootStore(dataRoot, (store) => store.queuedExecuteFixTurn(task.id, 1))?.verifyLogTail).toBeNull();
    });

    it("for a failing command that never started and has no log", async () => {
      const { dataRoot, task } = seedApprovedTaskWithSessions();
      failedVerify(dataRoot, task, { result: "failed", commands: ["a", "b"], failingCommand: 3 }, [
        "log a\n",
        "log b\n",
      ]);

      await retry(dataRoot, task, true);

      expect(withDataRootStore(dataRoot, (store) => store.queuedExecuteFixTurn(task.id, 1))?.verifyLogTail).toBeNull();
    });

    it("for a log file that was removed", async () => {
      const { dataRoot, task } = seedApprovedTaskWithSessions();
      failedVerify(dataRoot, task, failedRun, ["log a\n", "log b\n"]);
      rmSync(verifyCommandLogPath(dataRoot, task, 1, 2));

      await retry(dataRoot, task, true);

      expect(withDataRootStore(dataRoot, (store) => store.queuedExecuteFixTurn(task.id, 1))).toMatchObject({
        verifyFailure: "command 2 failed",
        verifyLogTail: null,
      });
    });
  });
});
