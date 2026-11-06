import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { githubShortRef } from "../../src/issue-key/short-ref.js";
import { failedFrom, failTask, transitionTask, type TaskState } from "../../src/state/machine.js";
import { verifyCommandLogPath } from "../../src/store/layout.js";
import type { Task } from "../../src/store/store.js";
import { retryTask } from "../../src/tasks/retry.js";
import { LockBusyError, repoLockName } from "../../src/store/locks.js";
import { configWithTrackers } from "../helpers/config.js";
import { failureOf } from "../helpers/errors.js";
import { readArgLog } from "../helpers/fake-commands.js";
import { commitInWorktree, gitBeforeCommandEnv, gitOutput, gitRecorderEnv } from "../helpers/git.js";
import {
  answerStream,
  seedApprovedTaskWithSessions,
  seedExecuteSession,
  sessionsOf,
  seedExecuteTodoStates,
  seedReviewSession,
  validPlanAnswer,
} from "../helpers/plan.js";
import { expectRefusedWithoutChange, useReopenFixture, useRefineFixture } from "../helpers/task-fixtures.js";
import { startConflictedReopenResync } from "../helpers/reopen-resync.js";
import { startLockHolder } from "../helpers/processes.js";
import { useTempDir } from "../helpers/temp.js";
import {
  databasePathOf,
  eventsOf,
  failRefineFrom,
  failTaskFrom,
  failTaskVia,
  failVerifyRun,
  latestTaskOf,
  seedReview,
  rejectRetryEvent,
  withDataRootStore,
} from "../helpers/store.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

// Calls retryTask for the task in the data root, in a store that closes after the call.
function retry(
  dataRoot: string,
  task: Task,
  resumeExecute = false,
  options: { config?: ReturnType<typeof configWithTrackers>; env?: NodeJS.ProcessEnv; repoLockWaitMs?: number } = {},
) {
  const config = { ...(options.config ?? configWithTrackers({ [REPO]: {} })), dataRoot };
  const ref = { key: KEY, repoKey: REPO, shortRef: githubShortRef("5") };
  return withDataRootStore(dataRoot, (store) =>
    retryTask(store, {
      config,
      ref,
      taskId: task.id,
      resumeExecute,
      env: options.env ?? process.env,
      repoLockWaitMs: options.repoLockWaitMs ?? 300_000,
    }),
  );
}

async function failedPendingReopen(origin: "accepted" | "pushed" = "accepted") {
  const fixture = await useRefineFixture({ stream: answerStream(validPlanAnswer()) });
  const startHead = await startConflictedReopenResync(fixture);
  withDataRootStore(fixture.started.dataRoot, (store) => {
    store.updateTask(fixture.task.id, { state: origin, reopenStartHead: startHead, prNumber: 73 });
    failRefineFrom(store, fixture.task.id, origin);
  });
  return { ...fixture, startHead, task: latestTaskOf(fixture.started.dataRoot, KEY) };
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

  it("refuses a task that failed in approved", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => failTaskFrom(store, task.id, "approved"));

    await expectRetryRefused(dataRoot, task, `the task of ${KEY} failed in approved; tasker retry has no step for it`);
  });

  it("refuses a task that failed in merging after a move from in_peer_review", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => failTaskVia(store, task.id, "in_peer_review", "merging"));

    await expectRetryRefused(dataRoot, task, `the task of ${KEY} failed in merging; tasker retry has no step for it`);
  });

  it("refuses a task that failed in interrupted after a move from pushing", async () => {
    const { dataRoot, task } = seedApprovedTaskWithSessions();
    withDataRootStore(dataRoot, (store) => failTaskVia(store, task.id, "pushing", "interrupted"));
    withDataRootStore(dataRoot, (store) => expect(failedFrom(store, task.id)).toBe("interrupted"));

    await expectRetryRefused(
      dataRoot,
      task,
      `the task of ${KEY} failed in interrupted; tasker retry has no step for it`,
    );
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
    {
      origin: "quota_blocked",
      before: "executing",
      target: "approved",
      next: "execute",
      state: "approved",
      sessions: { ...kept, execute: false },
    },
    {
      origin: "awaiting_quota_approval",
      before: "executing",
      target: "approved",
      next: "execute",
      state: "approved",
      sessions: { ...kept, execute: false },
    },
    {
      origin: "interrupted",
      before: "executing",
      target: "approved",
      next: "execute",
      state: "approved",
      sessions: { ...kept, execute: false },
    },
    { origin: "verifying", target: "executed", next: "verify", state: "executed", sessions: kept },
    { origin: "accepted", target: "accepted", next: "push", state: "accepted", sessions: kept },
    { origin: "merging", before: "accepted", target: "accepted", next: "merge", state: "accepted", sessions: kept },
    { origin: "pushing", before: "accepted", target: "accepted", next: "push", state: "accepted", sessions: kept },
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
    withDataRootStore(dataRoot, (store) => expect(failedFrom(store, task.id)).toBe(origin));
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

  it.each(["accepted", "pushed"] as const)("prints a reopen hint for a failed reopen from %s", async (origin) => {
    const fixture = await useReopenFixture({ stream: answerStream(validPlanAnswer()) }, origin);
    const { dataRoot } = fixture.started;
    const { task } = fixture;
    withDataRootStore(dataRoot, (store) => {
      seedExecuteSession(store, task.id, 1);
      seedReviewSession(store, task.id, 1);
      failTaskVia(store, task.id, origin, "refining");
    });
    withDataRootStore(dataRoot, (store) =>
      store.updateTask(task.id, { acceptedRevision: "accepted-revision", publishedRevision: "published-revision" }),
    );
    const beforeTask = latestTaskOf(dataRoot, KEY);
    const beforeSessions = sessionsOf(dataRoot, task);
    const beforeRevisions = withDataRootStore(dataRoot, (store) => store.listPlanRevisions(task.id));
    const beforeEvents = eventsOf(dataRoot, KEY);

    const result = await retry(dataRoot, task);

    expect(result).toEqual({ origin: "refining", target: origin, next: "reopen-hint" });
    expect(latestTaskOf(dataRoot, KEY).state).toBe(origin);
    expect(sessionsOf(dataRoot, task)).toEqual(beforeSessions);
    expect(withDataRootStore(dataRoot, (store) => store.listPlanRevisions(task.id))).toEqual(beforeRevisions);
    expect(latestTaskOf(dataRoot, KEY)).toMatchObject({
      acceptedRevision: "accepted-revision",
      publishedRevision: "published-revision",
    });
    expect(beforeTask.acceptedRevision).toBe("accepted-revision");
    expect(beforeTask.publishedRevision).toBe("published-revision");
    expect(eventsOf(dataRoot, KEY).slice(beforeEvents.length)).toEqual([
      { type: "retry", data: { origin: "refining", target: origin, resumeExecute: false, from: "failed", to: origin } },
    ]);
  });
});

describe("retryTask pending reopen recovery", () => {
  it("does not restore an unfinished reopen resync for a plain refine retry", async () => {
    const fixture = await useRefineFixture({ stream: answerStream(validPlanAnswer()) });
    const startHead = await startConflictedReopenResync(fixture);
    withDataRootStore(fixture.started.dataRoot, (store) => {
      store.updateTask(fixture.task.id, { reopenStartHead: startHead });
      failRefineFrom(store, fixture.task.id, "awaiting_plan_review");
    });
    const task = latestTaskOf(fixture.started.dataRoot, KEY);
    const path = String(task.worktreePath);
    const beforeHead = await gitOutput({ cwd: path }, fixture.started.env, "rev-parse", "HEAD");
    const beforeStatus = await gitOutput({ cwd: path }, fixture.started.env, "status", "--porcelain");
    const recorder = gitRecorderEnv(useTempDir("tasker-retry-plain-refine-git-log-"), fixture.started.env);

    const result = await retry(fixture.started.dataRoot, task, false, {
      config: fixture.started.config,
      env: recorder.env,
    });

    expect(result).toEqual({ origin: "refining", target: "awaiting_plan_review", next: "refine" });
    expect(eventsOf(fixture.started.dataRoot, KEY).at(-1)).toEqual({
      type: "retry",
      data: {
        origin: "refining",
        target: "awaiting_plan_review",
        resumeExecute: false,
        from: "failed",
        to: "awaiting_plan_review",
      },
    });
    expect(latestTaskOf(fixture.started.dataRoot, KEY)).toMatchObject({
      state: "awaiting_plan_review",
      reopenStartHead: startHead,
    });
    expect(await gitOutput({ cwd: path }, fixture.started.env, "rev-parse", "HEAD")).toBe(beforeHead);
    expect(await gitOutput({ cwd: path }, fixture.started.env, "status", "--porcelain")).toBe(beforeStatus);
    expect(existsSync(recorder.log)).toBe(false);
  });

  it.each(["accepted", "pushed"] as const)("restores a pending reopen from %s", async (origin) => {
    const fixture = await failedPendingReopen(origin);
    const path = String(fixture.task.worktreePath);
    writeFileSync(join(path, "after-failure.txt"), "discard me\n");

    const result = await retry(fixture.started.dataRoot, fixture.task, false, {
      config: fixture.started.config,
      env: fixture.started.env,
    });

    expect(result).toEqual({ origin: "refining", target: origin, next: "reopen-hint" });
    expect(latestTaskOf(fixture.started.dataRoot, KEY)).toMatchObject({
      state: origin,
      reopenStartHead: null,
      prNumber: 73,
    });
    expect(await gitOutput({ cwd: path }, fixture.started.env, "rev-parse", "HEAD")).toBe(fixture.startHead);
    expect(await gitOutput({ cwd: path }, fixture.started.env, "status", "--porcelain")).toBe("");
  });

  it("keeps completed branch movement and makes no Git call when the recovery head is null", async () => {
    const fixture = await useRefineFixture({ stream: answerStream(validPlanAnswer()) });
    const path = String(fixture.task.worktreePath);
    const movedHead = await commitInWorktree(path, fixture.started.env, { file: "completed-resync.txt" });
    withDataRootStore(fixture.started.dataRoot, (store) => {
      store.updateTask(fixture.task.id, { state: "accepted", reopenStartHead: null });
      failRefineFrom(store, fixture.task.id, "accepted");
    });
    const recorder = gitRecorderEnv(useTempDir("tasker-retry-null-reopen-git-log-"), fixture.started.env);

    const result = await retry(fixture.started.dataRoot, fixture.task, false, {
      config: fixture.started.config,
      env: recorder.env,
    });

    expect(result).toEqual({ origin: "refining", target: "accepted", next: "reopen-hint" });
    expect(await gitOutput({ cwd: path }, fixture.started.env, "rev-parse", "HEAD")).toBe(movedHead);
    expect(existsSync(recorder.log)).toBe(false);
  });

  it("refuses --resume-execute before it restores a pending reopen", async () => {
    const fixture = await failedPendingReopen();
    const events = eventsOf(fixture.started.dataRoot, KEY);

    const error = await failureOf(
      retry(fixture.started.dataRoot, fixture.task, true, {
        config: fixture.started.config,
        env: fixture.started.env,
      }),
      Error,
    );

    expect(error.message).toBe("--resume-execute applies only to a task that failed in verifying");
    expect(latestTaskOf(fixture.started.dataRoot, KEY)).toMatchObject({
      state: "failed",
      reopenStartHead: fixture.startHead,
    });
    expect(eventsOf(fixture.started.dataRoot, KEY)).toEqual(events);
    expect(
      await gitOutput({ cwd: String(fixture.task.worktreePath) }, fixture.started.env, "status", "--porcelain"),
    ).toContain("reopen-conflict.txt");
  });

  it("reports a busy repo lock without restoring the pending worktree", async () => {
    const fixture = await failedPendingReopen();
    const beforeEvents = eventsOf(fixture.started.dataRoot, KEY);
    const name = repoLockName(REPO);
    const holder = startLockHolder(databasePathOf(fixture.started.dataRoot), name);
    await holder.attempt;

    const error = await failureOf(
      retry(fixture.started.dataRoot, fixture.task, false, {
        config: fixture.started.config,
        env: fixture.started.env,
        repoLockWaitMs: 0,
      }),
      LockBusyError,
    );

    expect(error.message).toContain(`the lock ${name} is busy`);
    expect(latestTaskOf(fixture.started.dataRoot, KEY)).toMatchObject({
      state: "failed",
      reopenStartHead: fixture.startHead,
    });
    expect(
      await gitOutput({ cwd: String(fixture.task.worktreePath) }, fixture.started.env, "status", "--porcelain"),
    ).toContain("reopen-conflict.txt");
    expect(eventsOf(fixture.started.dataRoot, KEY)).toEqual(beforeEvents);
  });

  it("keeps the task failed and the recovery head when restore fails", async () => {
    const fixture = await failedPendingReopen();
    const beforeEvents = eventsOf(fixture.started.dataRoot, KEY);
    const path = String(fixture.task.worktreePath);
    writeFileSync(join(path, "untracked-after-failure.txt"), "keep until restore works\n");
    const env = gitBeforeCommandEnv(useTempDir("tasker-retry-restore-failure-"), fixture.started.env, "clean", [
      "sh",
      "-c",
      "printf 'clean refused by test\\n' >&2; exit 1",
    ]);

    const error = await failureOf(
      retry(fixture.started.dataRoot, fixture.task, false, { config: fixture.started.config, env }),
      Error,
    );

    expect(error.message).toContain("clean refused by test");
    expect(error.message).toContain("git clean -fd");
    expect(latestTaskOf(fixture.started.dataRoot, KEY)).toMatchObject({
      state: "failed",
      reopenStartHead: fixture.startHead,
    });
    expect(eventsOf(fixture.started.dataRoot, KEY)).toEqual(beforeEvents);
  });

  it("repeats restore after the retry event fails, then commits the retry on a later call", async () => {
    const fixture = await failedPendingReopen();
    const beforeEvents = eventsOf(fixture.started.dataRoot, KEY);
    const recorder = gitRecorderEnv(useTempDir("tasker-retry-event-failure-git-log-"), fixture.started.env);
    const release = rejectRetryEvent(databasePathOf(fixture.started.dataRoot));
    try {
      const error = await failureOf(
        retry(fixture.started.dataRoot, fixture.task, false, {
          config: fixture.started.config,
          env: recorder.env,
        }),
        Error,
      );

      expect(error.message).toContain("event rejected");
      expect(error.message).toContain(fixture.startHead);
      expect(
        await gitOutput({ cwd: String(fixture.task.worktreePath) }, fixture.started.env, "rev-parse", "HEAD"),
      ).toBe(fixture.startHead);
      expect(latestTaskOf(fixture.started.dataRoot, KEY)).toMatchObject({
        state: "failed",
        reopenStartHead: fixture.startHead,
      });
      expect(eventsOf(fixture.started.dataRoot, KEY)).toEqual(beforeEvents);
      expect(
        readArgLog(recorder.log).filter((args) => args.includes("checkout") && args.includes("--force")),
      ).toHaveLength(1);
    } finally {
      release();
    }

    const result = await retry(fixture.started.dataRoot, fixture.task, false, {
      config: fixture.started.config,
      env: recorder.env,
    });

    expect(result).toEqual({ origin: "refining", target: "accepted", next: "reopen-hint" });
    expect(latestTaskOf(fixture.started.dataRoot, KEY)).toMatchObject({ state: "accepted", reopenStartHead: null });
    expect(eventsOf(fixture.started.dataRoot, KEY)).toEqual([
      ...beforeEvents,
      {
        type: "retry",
        data: { origin: "refining", target: "accepted", resumeExecute: false, from: "failed", to: "accepted" },
      },
    ]);
    expect(
      readArgLog(recorder.log).filter((args) => args.includes("checkout") && args.includes("--force")),
    ).toHaveLength(2);
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
