import { describe, expect, it } from "vitest";
import { retry } from "../../src/commands/retry.js";
import type { TaskState } from "../../src/state/machine.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { argAfter, TEST_EXECUTE_SESSION_ID, TEST_REVIEW_SESSION_ID } from "../helpers/fake-claude.js";
import {
  answerStream,
  planTodo,
  seedExecuteSession,
  seedExecuteTodoStates,
  seedPlanSession,
  seedReviewSession,
  turnResultStream,
  validPlanAnswer,
} from "../helpers/plan.js";
import { validReviewAnswer } from "../helpers/review.js";
import {
  eventDataOf,
  eventsOf,
  failRefineFrom,
  failTaskFrom,
  failTaskVia,
  failVerifyRun,
  latestTaskOf,
  reviewSessionRows,
  withDataRootStore,
} from "../helpers/store.js";
import {
  expectCommandRefused,
  landAcceptedTask,
  useAcceptedTask,
  useExecuteFixture,
  usePlanFixture,
  useRefineFixture,
  useReviewFixture,
  useStartedTask,
  useVerifyFixture,
} from "../helpers/task-fixtures.js";
import { wrongStateError } from "../helpers/state-commands.js";
import { executedLine, plannedLine, reviewedLinePrefix, verifiedLine } from "../helpers/command-output.js";

const KEY = "codeguru42/tasker#5";
const TODOS = [planTodo("a"), planTodo("b", ["a"])];

const runRetry = (key = KEY, ...extra: string[]) => runCommand(retry, "retry", key, ...extra);

// The first line of the output of tasker retry.
const firstLine = (origin: string, target: string) => `retried ${KEY}: failed in ${origin}, back in ${target}\n`;

describe("tasker retry", () => {
  it("runs tasker start for a task that failed in provisioning", async () => {
    const started = await useStartedTask();
    withDataRootStore(started.dataRoot, (store) => {
      const task = store.findLatestTask(started.repoKey, KEY)!;
      failTaskFrom(store, task.id, "provisioning");
    });

    const result = await runRetry();

    expect(result.code).toBe(0);
    expect(result.out.startsWith(firstLine("provisioning", "provisioning"))).toBe(true);
    expect(result.out).toContain("state: workspace_ready");
    expect(latestTaskOf(started.dataRoot, KEY).state).toBe("workspace_ready");
    expect(eventDataOf(started.dataRoot, KEY, "retry")).toEqual([
      { origin: "provisioning", target: "provisioning", resumeExecute: false },
    ]);
  });

  it("runs tasker plan in a new session for a task that failed in planning", async () => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
    const { dataRoot, repoKey } = fixture.started;
    withDataRootStore(dataRoot, (store) => {
      const task = store.findLatestTask(repoKey, KEY)!;
      seedPlanSession(store, task.id);
      failTaskFrom(store, task.id, "planning");
    });

    const result = await runRetry();

    expect(result.code).toBe(0);
    expect(result.out.startsWith(firstLine("planning", "workspace_ready"))).toBe(true);
    expect(result.out).toContain(plannedLine(KEY, 1));
    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(argAfter(calls[0].argv, "--session-id")).toBeDefined();
    expect(calls[0].argv).not.toContain("--resume");
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_plan_review");
    expect(eventDataOf(dataRoot, KEY, "retry")).toEqual([
      { origin: "planning", target: "workspace_ready", resumeExecute: false, from: "failed", to: "workspace_ready" },
    ]);
  });

  it("runs tasker review in a new session for a task that failed in reviewing", async () => {
    const work = await useReviewFixture({ stream: answerStream(validReviewAnswer()) });
    const { dataRoot } = work;
    withDataRootStore(dataRoot, (store) => {
      seedReviewSession(store, work.task.id, 1);
      failTaskFrom(store, work.task.id, "reviewing");
    });

    const result = await runRetry(work.key);

    expect(result.code).toBe(0);
    expect(result.out.startsWith(firstLine("reviewing", "awaiting_work_review"))).toBe(true);
    expect(result.out).toContain(reviewedLinePrefix(KEY, 1));
    const calls = work.claude.calls();
    expect(calls).toHaveLength(1);
    const sessionId = argAfter(calls[0].argv, "--session-id");
    expect(sessionId).not.toBe(TEST_REVIEW_SESSION_ID);
    expect(calls[0].argv).not.toContain("--resume");
    expect(reviewSessionRows(dataRoot, work.task.id)).toMatchObject([{ review_number: 1, session_id: sessionId }]);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("reviewed");
    expect(eventDataOf(dataRoot, KEY, "retry")).toEqual([
      {
        origin: "reviewing",
        target: "awaiting_work_review",
        resumeExecute: false,
        from: "failed",
        to: "awaiting_work_review",
      },
    ]);
  });

  it("runs tasker merge for a task that failed in merging", async () => {
    const accepted = await useAcceptedTask();
    withDataRootStore(accepted.dataRoot, (store) => failTaskVia(store, accepted.task.id, "accepted", "merging"));

    const result = await runRetry();

    expect(result.code).toBe(0);
    expect(result.out).toBe(
      firstLine("merging", "accepted") + `merged ${KEY}\nlanded: ${accepted.revision} on origin/main\n`,
    );
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("landed");
    expect(await accepted.origin.branchHead("main")).toBe(accepted.revision);
    expect(eventDataOf(accepted.dataRoot, KEY, "retry")).toEqual([
      { origin: "merging", target: "accepted", resumeExecute: false, from: "failed", to: "accepted" },
    ]);
  });

  it("pushes nothing on a retry after a push that was recorded as failed", async () => {
    const accepted = await useAcceptedTask();
    await landAcceptedTask(accepted);
    const message = `merging failed: pushed ${accepted.revision} to origin/main, but tasker cannot record the result: test`;
    withDataRootStore(accepted.dataRoot, (store) =>
      failTaskVia(store, accepted.task.id, "accepted", "merging", message),
    );

    const result = await runRetry();

    expect(result.code).toBe(0);
    expect(result.out.endsWith(`already on origin/main: ${accepted.revision}. Nothing pushed.\n`)).toBe(true);
    expect(eventsOf(accepted.dataRoot, KEY).at(-1)).toMatchObject({ type: "landed", data: { pushed: false } });
    expect(await accepted.origin.branchHead("main")).toBe(accepted.revision);
  });

  const hints: { refineOrigin: TaskState; target: TaskState; hint: string }[] = [
    {
      refineOrigin: "awaiting_plan_review",
      target: "awaiting_plan_review",
      hint: `run tasker refine ${KEY} "<feedback>" again\n`,
    },
    {
      refineOrigin: "failed",
      target: "awaiting_plan_review",
      hint: `run tasker refine ${KEY} "<feedback>" again\n`,
    },
    {
      refineOrigin: "reviewed",
      target: "reviewed",
      hint: `run tasker refine ${KEY} again to act on the findings, or tasker dismiss-review ${KEY} "<reason>"\n`,
    },
    {
      refineOrigin: "awaiting_work_review",
      target: "awaiting_work_review",
      hint: `run tasker review ${KEY} "<feedback>" again\n`,
    },
  ];

  it.each(hints)(
    "prints a hint and runs nothing for a task that failed in refining after a refine from $refineOrigin",
    async ({ refineOrigin, target, hint }) => {
      const fixture = await useRefineFixture({ stream: answerStream(validPlanAnswer()) });
      const { dataRoot } = fixture.started;
      withDataRootStore(dataRoot, (store) => failRefineFrom(store, fixture.task.id, refineOrigin));

      const result = await runRetry();

      expect(result).toEqual({ code: 0, out: `${firstLine("refining", target)}${hint}`, err: "" });
      expect(fixture.claude.calls()).toEqual([]);
      expect(latestTaskOf(dataRoot, KEY).state).toBe(target);
      expect(eventDataOf(dataRoot, KEY, "retry")).toEqual([
        { origin: "refining", target, resumeExecute: false, from: "failed", to: target },
      ]);
    },
  );

  it("runs tasker execute in a new session for the todos that are not done", async () => {
    const fixture = await useExecuteFixture({ stream: turnResultStream("done") }, { answer: { todos: TODOS } });
    const { dataRoot } = fixture.started;
    withDataRootStore(dataRoot, (store) => {
      seedExecuteSession(store, fixture.task.id, 1);
      seedExecuteTodoStates(store, fixture.task.id, 1, { a: "done" });
      failTaskFrom(store, fixture.task.id, "executing");
    });

    const result = await runRetry();

    expect(result.code).toBe(0);
    expect(result.out.startsWith(firstLine("executing", "approved"))).toBe(true);
    expect(result.out).toContain(executedLine(KEY, 1));
    expect(result.out).toContain("todos: 2 of 2 done");
    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(argAfter(calls[0].argv, "--session-id")).toBeDefined();
    expect(calls[0].argv).not.toContain("--resume");
    expect(latestTaskOf(dataRoot, KEY).state).toBe("executed");
    expect(eventDataOf(dataRoot, KEY, "retry")).toEqual([
      { origin: "executing", target: "approved", resumeExecute: false, from: "failed", to: "approved" },
    ]);
  });

  it("runs tasker verify for a task that failed in verifying", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    const { dataRoot } = fixture.started;
    withDataRootStore(dataRoot, (store) => failTaskFrom(store, fixture.task.id, "verifying"));

    const result = await runRetry();

    expect(result.code).toBe(0);
    expect(result.out.startsWith(firstLine("verifying", "executed"))).toBe(true);
    expect(result.out).toContain(verifiedLine(KEY, 1));
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_work_review");
    expect(eventDataOf(dataRoot, KEY, "retry")).toEqual([
      { origin: "verifying", target: "executed", resumeExecute: false, from: "failed", to: "executed" },
    ]);
  });

  it("continues the execute session with one fix turn for --resume-execute", async () => {
    const fixture = await useExecuteFixture({ stream: turnResultStream("done") }, { answer: { todos: TODOS } });
    const { dataRoot } = fixture.started;
    withDataRootStore(dataRoot, (store) => {
      seedExecuteSession(store, fixture.task.id, 1);
      failVerifyRun(
        store,
        dataRoot,
        fixture.task,
        { result: "failed", commands: ["npm test"], failingCommand: 1 },
        ["$ npm test\nboom in test\n--- exit code 1\n"],
        "verify command 1 failed: npm test: exit code 1.",
      );
    });

    const result = await runRetry(KEY, "--resume-execute");

    expect(result.code).toBe(0);
    expect(result.out.startsWith(firstLine("verifying", "approved"))).toBe(true);
    expect(result.out).toContain("fix turn: done");
    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(argAfter(calls[0].argv, "--resume")).toBe(TEST_EXECUTE_SESSION_ID);
    expect(calls[0].stdin).toContain("verify command 1 failed: npm test: exit code 1.");
    expect(calls[0].stdin).toContain("boom in test");
    withDataRootStore(dataRoot, (store) => {
      expect(store.executeTodoProgress(fixture.task.id, 1).map((entry) => entry.state)).toEqual(["done", "done"]);
      expect(store.executeFixTurnState(fixture.task.id, 1)).toBe("done");
    });
    expect(eventDataOf(dataRoot, KEY, "retry")).toEqual([
      { origin: "verifying", target: "approved", resumeExecute: true, from: "failed", to: "approved" },
    ]);
  });

  it("keeps the error and the exit code of a next command that fails", async () => {
    const fixture = await useVerifyFixture({ commands: ["false"] });
    const { dataRoot } = fixture.started;
    withDataRootStore(dataRoot, (store) => failTaskFrom(store, fixture.task.id, "verifying"));

    const result = await runRetry();

    expect(result.code).toBe(1);
    expect(result.out).toBe(firstLine("verifying", "executed"));
    expect(result.err).toContain("verify command 1 failed: false: exit code 1.");
    expect(latestTaskOf(dataRoot, KEY).state).toBe("failed");
    withDataRootStore(dataRoot, (store) => expect(store.latestVerifyRun(fixture.task.id)?.number).toBe(1));
  });

  it("refuses a task that is not in failed and changes nothing", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    const { dataRoot } = fixture.started;

    await expectCommandRefused(
      { dataRoot, key: KEY },
      () => runRetry(),
      `${wrongStateError("executed", KEY, "retry", "failed")}\n`,
    );
  });

  it("prints the description of the command and of its options for --help", async () => {
    const { code, help } = await runHelp(retry, "retry");

    expect(code).toBe(0);
    expect(help).toContain(
      "Move a task in failed back to the state before the step that failed, and run that step again",
    );
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
    expect(help).toContain("--resume-execute");
    expect(help).toContain("For a task that failed in verifying");
  });
});
