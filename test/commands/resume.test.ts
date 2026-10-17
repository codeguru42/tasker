import { describe, expect, it } from "vitest";
import { resume } from "../../src/commands/resume.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { executedLine, plannedLine, refinedLine, reviewedLinePrefix, verifiedLine } from "../helpers/command-output.js";
import { argAfter, TEST_EXECUTE_SESSION_ID, TEST_REVIEW_SESSION_ID, TEST_SESSION_ID } from "../helpers/fake-claude.js";
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
import { deadRunNote, wrongStateError } from "../helpers/state-commands.js";
import {
  eventDataOf,
  latestTaskOf,
  pauseRefineFrom,
  pauseTaskFrom,
  reviewSessionRows,
  seedDeadRun,
  withDataRootStore,
} from "../helpers/store.js";
import {
  expectCommandRefused,
  useExecuteFixture,
  usePlanFixture,
  useRefineFixture,
  useReviewedRefineFixture,
  useReviewFixture,
  useVerifyFixture,
} from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const FEEDBACK = "Keep the loop.";
const TODOS = [planTodo("a"), planTodo("b", ["a"])];
const PAUSES = ["quota_blocked", "interrupted"] as const;

const runResume = (key = KEY, ...extra: string[]) => runCommand(resume, "resume", key, ...extra);

// The first line of the output of tasker resume.
const firstLine = (origin: string, target: string) => `resumed ${KEY}: paused in ${origin}, back in ${target}\n`;

const V2_ANSWER = validPlanAnswer({
  plan_markdown: "## Summary\n\nAdd the b module and its test, test first.\n",
  todos: [{ id: "only-todo", title: "Do the work", description: "Do all of it.", depends_on: [] }],
  questions: [],
});

describe("tasker resume", () => {
  it.each(PAUSES)("continues the plan session for a task paused in %s from planning", async (pause) => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
    const { dataRoot, repoKey } = fixture.started;
    withDataRootStore(dataRoot, (store) => {
      const task = store.findLatestTask(repoKey, KEY)!;
      seedPlanSession(store, task.id);
      pauseTaskFrom(store, task.id, "planning", pause);
    });

    const result = await runResume();

    expect(result.code).toBe(0);
    expect(result.out.startsWith(firstLine("planning", "workspace_ready"))).toBe(true);
    expect(result.out).toContain(plannedLine(KEY, 1));
    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(argAfter(calls[0].argv, "--resume")).toBe(TEST_SESSION_ID);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_plan_review");
    expect(eventDataOf(dataRoot, KEY, "resume")).toEqual([{ origin: "planning", target: "workspace_ready" }]);
  });

  describe("a task paused in refining", () => {
    const plainOrigins = ["awaiting_plan_review", "failed"] as const;
    const plainCases = PAUSES.flatMap((pause) => plainOrigins.map((refineOrigin) => ({ pause, refineOrigin })));

    it.each(plainCases)(
      "runs the same refine with the recorded feedback for $refineOrigin in $pause",
      async ({ pause, refineOrigin }) => {
        const fixture = await useRefineFixture({ stream: answerStream(V2_ANSWER) });
        withDataRootStore(fixture.started.dataRoot, (store) =>
          pauseRefineFrom(store, fixture.task.id, refineOrigin, pause, FEEDBACK),
        );

        const result = await runResume();

        expect(result.code).toBe(0);
        expect(result.out.startsWith(firstLine("refining", "awaiting_plan_review"))).toBe(true);
        expect(result.out).toContain(refinedLine(KEY, 2));
        const calls = fixture.claude.calls();
        expect(calls).toHaveLength(1);
        expect(calls[0].stdin).toContain(`<feedback>${FEEDBACK}</feedback>`);
        expect(argAfter(calls[0].argv, "--resume")).toBe(TEST_SESSION_ID);
        expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("awaiting_plan_review");
      },
    );

    it.each(PAUSES)("runs the refine of findings with the recorded feedback in %s", async (pause) => {
      const fixture = await useReviewedRefineFixture({ stream: answerStream(V2_ANSWER) });
      withDataRootStore(fixture.started.dataRoot, (store) =>
        pauseRefineFrom(store, fixture.task.id, "reviewed", pause, FEEDBACK),
      );

      const result = await runResume();

      expect(result.code).toBe(0);
      expect(result.out.startsWith(firstLine("refining", "reviewed"))).toBe(true);
      expect(result.out).toContain(refinedLine(KEY, 2));
      expect(fixture.claude.calls()[0].stdin).toContain(`<feedback>${FEEDBACK}</feedback>`);
    });

    it.each(PAUSES)("runs the refine of findings with no feedback in %s", async (pause) => {
      const fixture = await useReviewedRefineFixture({ stream: answerStream(V2_ANSWER) });
      withDataRootStore(fixture.started.dataRoot, (store) =>
        pauseRefineFrom(store, fixture.task.id, "reviewed", pause),
      );

      const result = await runResume();

      expect(result.code).toBe(0);
      expect(result.out).toContain(refinedLine(KEY, 2));
      expect(fixture.claude.calls()[0].stdin).toContain("<feedback>None.</feedback>");
    });

    it.each(PAUSES)("runs the feedback form of review with the recorded feedback in %s", async (pause) => {
      const fixture = await useReviewedRefineFixture(
        { stream: answerStream(V2_ANSWER) },
        { state: "awaiting_work_review", review: null },
      );
      withDataRootStore(fixture.started.dataRoot, (store) =>
        pauseRefineFrom(store, fixture.task.id, "awaiting_work_review", pause, FEEDBACK),
      );

      const result = await runResume();

      expect(result.code).toBe(0);
      expect(result.out.startsWith(firstLine("refining", "awaiting_work_review"))).toBe(true);
      expect(result.out).toContain(refinedLine(KEY, 2));
      expect(fixture.claude.calls()[0].stdin).toContain(`<feedback>${FEEDBACK}</feedback>`);
    });
  });

  it.each(PAUSES)("continues the execute session and gives no turn to a done todo in %s", async (pause) => {
    const fixture = await useExecuteFixture({ stream: turnResultStream("done") }, { answer: { todos: TODOS } });
    const { dataRoot } = fixture.started;
    withDataRootStore(dataRoot, (store) => {
      seedExecuteSession(store, fixture.task.id, 1);
      seedExecuteTodoStates(store, fixture.task.id, 1, { a: "done" });
      pauseTaskFrom(store, fixture.task.id, "executing", pause);
    });

    const result = await runResume();

    expect(result.code).toBe(0);
    expect(result.out.startsWith(firstLine("executing", "approved"))).toBe(true);
    expect(result.out).toContain(executedLine(KEY, 1));
    expect(result.out).toContain("todos: 2 of 2 done");
    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(argAfter(calls[0].argv, "--resume")).toBe(TEST_EXECUTE_SESSION_ID);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("executed");
  });

  it("runs the verify again for a task paused in interrupted from verifying", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    const { dataRoot } = fixture.started;
    withDataRootStore(dataRoot, (store) => pauseTaskFrom(store, fixture.task.id, "verifying", "interrupted"));

    const result = await runResume();

    expect(result.code).toBe(0);
    expect(result.out.startsWith(firstLine("verifying", "executed"))).toBe(true);
    expect(result.out).toContain(verifiedLine(KEY, 1));
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_work_review");
  });

  it.each(PAUSES)("runs the review in a new session for a task paused in %s from reviewing", async (pause) => {
    const work = await useReviewFixture({ stream: answerStream(validReviewAnswer()) });
    const { dataRoot } = work;
    withDataRootStore(dataRoot, (store) => {
      seedReviewSession(store, work.task.id, 1);
      pauseTaskFrom(store, work.task.id, "reviewing", pause);
    });

    const result = await runResume(work.key);

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
  });

  it("moves a task with a dead run to interrupted, then resumes it", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    const { dataRoot } = fixture.started;
    seedDeadRun(dataRoot, fixture.task.id, "verifying");

    const result = await runResume();

    expect(result.code).toBe(0);
    expect(result.err).toContain(deadRunNote(KEY, "verifying"));
    expect(result.out.startsWith(firstLine("verifying", "executed"))).toBe(true);
    withDataRootStore(dataRoot, (store) => expect(store.latestVerifyRun(fixture.task.id)?.number).toBe(1));
  });

  it("keeps the error and the exit code of a next command that fails", async () => {
    const fixture = await useVerifyFixture({ commands: ["false"] });
    const { dataRoot } = fixture.started;
    withDataRootStore(dataRoot, (store) => pauseTaskFrom(store, fixture.task.id, "verifying", "interrupted"));

    const result = await runResume();

    expect(result.code).toBe(1);
    expect(result.out).toBe(firstLine("verifying", "executed"));
    expect(result.err).toContain("verify command 1 failed: false: exit code 1.");
    expect(latestTaskOf(dataRoot, KEY).state).toBe("failed");
    withDataRootStore(dataRoot, (store) => expect(store.latestVerifyRun(fixture.task.id)?.number).toBe(1));
  });

  it("refuses a task that is not paused and changes nothing", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    const { dataRoot } = fixture.started;

    await expectCommandRefused(
      { dataRoot, key: KEY },
      () => runResume(),
      `${wrongStateError("executed", KEY, "resume", "quota_blocked or interrupted")}\n`,
    );
  });

  it("prints the description of the command and of its repo option for --help", async () => {
    const { code, help } = await runHelp(resume, "resume");

    expect(code).toBe(0);
    expect(help).toContain(
      "Move a task in quota_blocked or interrupted back to the state before the run that stopped, and run the same command again",
    );
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
  });
});
