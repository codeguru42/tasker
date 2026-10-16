import { describe, expect, it } from "vitest";
import { retry } from "../../src/commands/retry.js";
import { runCommand } from "../helpers/cli.js";
import { argAfter, TEST_EXECUTE_SESSION_ID } from "../helpers/fake-claude.js";
import {
  answerStream,
  planTodo,
  seedExecuteSession,
  seedExecuteTodoStates,
  seedPlanSession,
  turnResultStream,
  validPlanAnswer,
} from "../helpers/plan.js";
import { eventsOf, failTaskFrom, failVerifyRun, latestTaskOf, withDataRootStore } from "../helpers/store.js";
import {
  useExecuteFixture,
  usePlanFixture,
  useRefineFixture,
  useStartedTask,
  useVerifyFixture,
} from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const TODOS = [planTodo("a"), planTodo("b", ["a"])];

const runRetry = (key = KEY, ...extra: string[]) => runCommand(retry, "retry", key, ...extra);

// The first line of the output of tasker retry.
const firstLine = (origin: string, target: string) => `retried ${KEY}: failed in ${origin}, back in ${target}\n`;

// The data of each retry event of the task, in order.
const retryEvents = (dataRoot: string) =>
  eventsOf(dataRoot, KEY)
    .filter((event) => event.type === "retry")
    .map((event) => event.data);

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
    expect(retryEvents(started.dataRoot)).toEqual([
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
    expect(result.out).toContain(`planned ${KEY} as revision v1`);
    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(argAfter(calls[0].argv, "--session-id")).toBeDefined();
    expect(calls[0].argv).not.toContain("--resume");
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_plan_review");
    expect(retryEvents(dataRoot)).toEqual([
      { origin: "planning", target: "workspace_ready", resumeExecute: false, from: "failed", to: "workspace_ready" },
    ]);
  });

  it("prints a hint and runs nothing for a task that failed in refining", async () => {
    const fixture = await useRefineFixture({ stream: answerStream(validPlanAnswer()) });
    const { dataRoot } = fixture.started;
    withDataRootStore(dataRoot, (store) => failTaskFrom(store, fixture.task.id, "refining"));

    const result = await runRetry();

    expect(result).toEqual({
      code: 0,
      out: `${firstLine("refining", "awaiting_plan_review")}run tasker refine ${KEY} "<feedback>" again\n`,
      err: "",
    });
    expect(fixture.claude.calls()).toEqual([]);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_plan_review");
    expect(retryEvents(dataRoot)).toEqual([
      {
        origin: "refining",
        target: "awaiting_plan_review",
        resumeExecute: false,
        from: "failed",
        to: "awaiting_plan_review",
      },
    ]);
  });

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
    expect(result.out).toContain(`executed ${KEY} at revision v1`);
    expect(result.out).toContain("todos: 2 of 2 done");
    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(argAfter(calls[0].argv, "--session-id")).toBeDefined();
    expect(calls[0].argv).not.toContain("--resume");
    expect(latestTaskOf(dataRoot, KEY).state).toBe("executed");
    expect(retryEvents(dataRoot)).toEqual([
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
    expect(result.out).toContain(`verified ${KEY}: run 1`);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_work_review");
    expect(retryEvents(dataRoot)).toEqual([
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
    expect(retryEvents(dataRoot)).toEqual([
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
    const events = eventsOf(dataRoot, KEY);

    const result = await runRetry();

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `the task of ${KEY} is in executed; tasker retry needs failed\n`,
    });
    expect(latestTaskOf(dataRoot, KEY).state).toBe("executed");
    expect(eventsOf(dataRoot, KEY)).toEqual(events);
  });

  it("prints the description of the command and of its options for --help", async () => {
    const { code, out } = await runCommand(retry, "retry", "--help");

    expect(code).toBe(0);
    // Commander wraps the long lines of the help, so compare with single spaces.
    const help = out.replace(/\s+/g, " ");
    expect(help).toContain(
      "Move a task in failed back to the state before the step that failed, and run that step again",
    );
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
    expect(help).toContain("--resume-execute");
    expect(help).toContain("For a task that failed in verifying");
  });
});
