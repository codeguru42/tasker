import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { refine } from "../../src/commands/refine.js";
import { archivePrompt, promptVersion } from "../../src/prompts/archive.js";
import { openQuestionsText, REFINE_PROMPT, REFINE_PROMPT_NAME } from "../../src/prompts/refine.js";
import { transitionTask } from "../../src/state/machine.js";
import type { Task } from "../../src/store/store.js";
import { planRevisionPath, planTranscriptPath } from "../../src/store/layout.js";
import { taskLockName } from "../../src/store/locks.js";
import { NO_OWN_COMMITS } from "../../src/vcs/git/changes.js";
import { runCommand } from "../helpers/cli.js";
import { TEST_SESSION_ID, claudeSample } from "../helpers/fake-claude.js";
import { commitInWorktree } from "../helpers/git.js";
import { planAnswerStream, planRevisionOf, seedPlanSession, seedTaskWithPlanFiles, transcriptLines, validPlanAnswer } from "../helpers/plan.js";
import { overlapWarningText } from "../helpers/overlap.js";
import { startLockHolder } from "../helpers/processes.js";
import { databasePathOf, dayAt, eventsOf, latestTaskOf, lockNames, readRunMarker, withDataRootStore } from "../helpers/store.js";
import { expectNoAssistantRun, type PlanFixture, useRefineFixture, usePlanFixture } from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";
const FEEDBACK = "Use main as the base branch.";

const runRefine = (feedback = FEEDBACK, key = KEY, ...extra: string[]) =>
  runCommand(refine, "refine", key, feedback, ...extra);

// The questions of v1: base-branch is answered by the feedback, test-runner stays open.
const V1_ANSWER = validPlanAnswer({
  questions: [
    { id: "base-branch", question: "Which branch is the base?", context: "The issue names no base branch." },
    { id: "test-runner", question: "Which test runner?", context: "The repo has two." },
  ],
});
const V2_ANSWER = validPlanAnswer({
  plan_markdown: "## Summary\n\nAdd the b module and its test, test first.\n",
  todos: [
    { id: "only-todo", title: "Do the work", description: "Do all of it.", depends_on: [] },
  ],
  questions: [V1_ANSWER.questions[1]!],
});

const refinePromptPath = (dataRoot: string) =>
  join(dataRoot, "prompts", `${promptVersion(REFINE_PROMPT_NAME, REFINE_PROMPT)}.md`);

// What a run that did not start must leave: the state and the events as before, no claude call, no lock,
// no second revision, no transcript of v2 and no archive of the refine prompt.
const expectNoWrite = (
  fixture: PlanFixture,
  task: Task,
  eventsBefore: { type: string; data: unknown }[],
  state: string,
) => {
  const { dataRoot } = fixture.started;
  expect(latestTaskOf(dataRoot, KEY).state).toBe(state);
  expectNoAssistantRun(fixture);
  expect(eventsOf(dataRoot, KEY)).toEqual(eventsBefore);
  expect(planRevisionOf(dataRoot, task.id, 2)).toBeUndefined();
  expect(existsSync(planTranscriptPath(dataRoot, task, 2))).toBe(false);
  expect(existsSync(refinePromptPath(dataRoot))).toBe(false);
};

describe("refine", () => {
  it("records revision v2 with the feedback and moves the task back to awaiting_plan_review", async () => {
    const stream = planAnswerStream(V2_ANSWER);
    const fixture = await useRefineFixture({ stream }, { answer: V1_ANSWER });
    const { dataRoot } = fixture.started;
    const before = eventsOf(dataRoot, KEY);

    const result = await runRefine();

    const task = latestTaskOf(dataRoot, KEY);
    const revision = planRevisionOf(dataRoot, task.id, 2);
    const promptPath = archivePrompt(dataRoot, REFINE_PROMPT_NAME, REFINE_PROMPT).path;
    expect(result).toEqual({
      code: 0,
      out: [
        `refined ${KEY} as revision v2`,
        `plan: ${planRevisionPath(dataRoot, task, 2)}`,
        `prompt: ${promptPath}`,
        "todos:",
        "- only-todo: Do the work",
        "questions: 1",
        "",
      ].join("\n"),
      err: "",
    });
    expect(task.state).toBe("awaiting_plan_review");
    expect(readRunMarker(databasePathOf(dataRoot), task.id)).toBeUndefined();
    expect(revision).toMatchObject({ version: 2, source: "refine", feedback: FEEDBACK, answer: V2_ANSWER });
    expect(revision?.prompt).toMatch(/^refine@[0-9a-f]{12}$/);
    expect(readFileSync(planRevisionPath(dataRoot, task, 2), "utf8")).toBe(V2_ANSWER.plan_markdown);
    expect(readFileSync(planRevisionPath(dataRoot, task, 1), "utf8")).toBe(V1_ANSWER.plan_markdown);
    expect(eventsOf(dataRoot, KEY).slice(before.length)).toEqual([
      { type: "transition", data: { from: "awaiting_plan_review", to: "refining" } },
      { type: "usage", data: expect.anything() },
      { type: "plan_revision", data: { version: 2, prompt: revision!.prompt } },
      { type: "transition", data: { from: "refining", to: "awaiting_plan_review" } },
    ]);
    expect(transcriptLines(planTranscriptPath(dataRoot, task, 2))).toHaveLength(stream.length);
  });

  it("continues the recorded session with its recorded model, not the configured one", async () => {
    const repo = {
      assistant: {
        provider: "claude-code",
        models: {
          plan: { model: "sonnet", effort: "low" },
          execute: { model: "sonnet", effort: "medium" },
          review: { model: "opus", effort: "high" },
        },
      },
    };
    const fixture = await useRefineFixture({ stream: planAnswerStream(V2_ANSWER) }, { repo });

    const result = await runRefine();

    expect(result.code).toBe(0);
    const argv = fixture.claude.calls()[0]!.argv;
    expect(argv[argv.indexOf("--resume") + 1]).toBe(TEST_SESSION_ID);
    expect(argv).not.toContain("--session-id");
    expect(argv[argv.indexOf("--model") + 1]).toBe("opus");
  });

  it("gives the plan, the feedback, the open questions and the branch commits on the stdin", async () => {
    const fixture = await useRefineFixture({ stream: planAnswerStream(V2_ANSWER) }, { answer: V1_ANSWER });

    await runRefine();

    const stdin = fixture.claude.calls()[0]!.stdin;
    expect(stdin).toContain(`<current-plan>${V1_ANSWER.plan_markdown}</current-plan>`);
    expect(stdin).toContain(`<feedback>${FEEDBACK}</feedback>`);
    expect(stdin).toContain(`<open-questions>${openQuestionsText(V1_ANSWER.questions)}</open-questions>`);
    expect(stdin).toContain(`<branch-commits>${NO_OWN_COMMITS}</branch-commits>`);
  });

  it("gives the commits of the branch on the stdin", async () => {
    const fixture = await useRefineFixture({ stream: planAnswerStream(V2_ANSWER) });
    await commitInWorktree(fixture.started.worktree, fixture.started.env, { file: "src/b.ts" });

    await runRefine();

    const stdin = fixture.claude.calls()[0]!.stdin;
    const block = /<branch-commits>([\s\S]*)<\/branch-commits>/.exec(stdin)?.[1];
    expect(block).toContain("src/b.ts");
    expect(block).not.toContain(NO_OWN_COMMITS);
  });

  it("counts a question that the new revision leaves out as answered by the feedback", async () => {
    const fixture = await useRefineFixture({ stream: planAnswerStream(V2_ANSWER) }, { answer: V1_ANSWER });

    await runRefine();

    withDataRootStore(fixture.started.dataRoot, (store) => {
      expect(store.resolvedQuestionsThrough(fixture.task.id, 2)).toEqual([
        { question: V1_ANSWER.questions[0], state: "resolved", version: 2, answer: FEEDBACK },
      ]);
      expect(store.planQuestions(fixture.task.id, 2)).toEqual([{ question: V1_ANSWER.questions[1], state: "open" }]);
    });
  });

  it("fails the task when the assistant fails", async () => {
    const fixture = await useRefineFixture({ stream: planAnswerStream(V2_ANSWER), exitCode: 1, stderr: "boom" });
    const { dataRoot } = fixture.started;

    const result = await runRefine();

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^refining failed: .+\n$/);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("failed");
    expect(planRevisionOf(dataRoot, fixture.task.id, 2)).toBeUndefined();
    expect(eventsOf(dataRoot, KEY).at(-1)).toEqual({
      type: "transition",
      data: { from: "refining", to: "failed", error: result.err.trimEnd() },
    });
  });

  it("fails the task when the assistant runs longer than the plan limit", { timeout: 15_000 }, async () => {
    const fixture = await useRefineFixture(
      { stream: claudeSample("plain").slice(0, 2), untilStopped: true },
      { limits: { planTimeoutMin: 0.05 } },
    );

    const result = await runRefine();

    expect(result.code).toBe(1);
    expect(result.err).toBe("refining timed out after 0.05 min\n");
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("failed");
  });

  it("blocks the task on a quota stop", async () => {
    const fixture = await useRefineFixture({ stream: claudeSample("quota-stop"), exitCode: 1 });

    const result = await runRefine();

    expect(result.code).toBe(1);
    expect(result.out).toMatch(/^refining stopped by a quota limit; /);
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("quota_blocked");
    expect(readRunMarker(databasePathOf(fixture.started.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("fails the task for an answer that tasker refuses, and writes no v2", async () => {
    const fixture = await useRefineFixture({ stream: planAnswerStream(validPlanAnswer({ todos: [] })) });

    const result = await runRefine();

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^the assistant returned a plan that tasker refuses:/);
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("failed");
    expect(planRevisionOf(fixture.started.dataRoot, fixture.task.id, 2)).toBeUndefined();
  });

  it("warns of a shared file with the last line of tasker plan", async () => {
    const fixture = await useRefineFixture({
      stream: planAnswerStream(validPlanAnswer({ files_changed: ["src/a.ts"] })),
    });
    seedTaskWithPlanFiles(
      fixture.started.dataRoot,
      { issueKey: "codeguru42/tasker#6", repoKey: REPO, state: "awaiting_plan_review", at: dayAt(3) },
      ["src/a.ts"],
    );

    const result = await runRefine();

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^refined /);
    expect(result.err).toBe(
      overlapWarningText(
        [{ issueKey: "codeguru42/tasker#6", state: "awaiting_plan_review", files: ["src/a.ts"] }],
        ["tasker does not refuse. Decide before you approve."],
      ),
    );
  });

  describe("a failure before the run", () => {
    it("fails at once when another process holds the task lock", async () => {
      const fixture = await useRefineFixture({ stream: planAnswerStream(V2_ANSWER) });
      const { dataRoot } = fixture.started;
      const before = eventsOf(dataRoot, KEY);
      const name = taskLockName(REPO, KEY);
      const holder = startLockHolder(databasePathOf(dataRoot), name);
      await holder.attempt;

      const result = await runRefine();

      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toMatch(new RegExp(`^the lock ${name} is busy`));
      expect(lockNames(dataRoot)).toEqual([name]);
      expect(fixture.claude.calls()).toEqual([]);
      expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_plan_review");
      expect(eventsOf(dataRoot, KEY)).toEqual(before);
      expect(existsSync(refinePromptPath(dataRoot))).toBe(false);
    });

    it("fails when the plan file of the newest revision is missing", async () => {
      const fixture = await useRefineFixture({ stream: planAnswerStream(V2_ANSWER) });
      const { dataRoot } = fixture.started;
      const before = eventsOf(dataRoot, KEY);
      rmSync(planRevisionPath(dataRoot, fixture.task, 1));

      const result = await runRefine();

      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toMatch(/^cannot read the plan file of revision v1: .+\n$/);
      expectNoWrite(fixture, fixture.task, before, "awaiting_plan_review");
    });

    it("fails when the prompt cannot be archived", async () => {
      const fixture = await useRefineFixture({ stream: planAnswerStream(V2_ANSWER) });
      const { dataRoot } = fixture.started;
      const before = eventsOf(dataRoot, KEY);
      const prompts = join(dataRoot, "prompts");
      chmodSync(prompts, 0o555);
      onTestFinished(() => chmodSync(prompts, 0o755));

      const result = await runRefine();

      expect(result.code).toBe(1);
      expect(result.err).not.toBe("");
      expectNoWrite(fixture, fixture.task, before, "awaiting_plan_review");
    });
  });
});

describe("a check before any write", () => {
  const stream = planAnswerStream(V2_ANSWER);

  const expectRefused = async (
    fixture: PlanFixture,
    task: Task,
    state: string,
    error: string,
    feedback = FEEDBACK,
  ) => {
    const before = eventsOf(fixture.started.dataRoot, KEY);

    const result = await runRefine(feedback);

    expect(result).toEqual({ code: 1, out: "", err: `${error}\n` });
    expectNoWrite(fixture, task, before, state);
  };

  it("refuses a task that is not in awaiting_plan_review", async () => {
    const fixture = await useRefineFixture({ stream });
    withDataRootStore(fixture.started.dataRoot, (store) => transitionTask(store, fixture.task.id, "approved"));

    await expectRefused(
      fixture,
      fixture.task,
      "approved",
      `the task of ${KEY} is in approved; tasker refine needs awaiting_plan_review`,
    );
  });

  it("refuses feedback of only spaces", async () => {
    const fixture = await useRefineFixture({ stream });

    await expectRefused(fixture, fixture.task, "awaiting_plan_review", "the feedback is empty", "   ");
  });

  it("refuses a task with no plan revision", async () => {
    const fixture = await usePlanFixture({ stream });
    const task = latestTaskOf(fixture.started.dataRoot, KEY);
    withDataRootStore(fixture.started.dataRoot, (store) => {
      transitionTask(store, task.id, "planning");
      transitionTask(store, task.id, "awaiting_plan_review");
      seedPlanSession(store, task.id);
    });

    await expectRefused(fixture, task, "awaiting_plan_review", `the task of ${KEY} has no plan revision`);
  });

  it("refuses a task with no plan session", async () => {
    const fixture = await useRefineFixture({ stream });
    withDataRootStore(fixture.started.dataRoot, (store) => store.clearPlanSession(fixture.task.id));

    await expectRefused(fixture, fixture.task, "awaiting_plan_review", `the task of ${KEY} has no plan session`);
  });

  it("refuses a recorded model that the provider refuses", async () => {
    const fixture = await useRefineFixture({ stream }, { session: { model: "gpt-5" } });

    await expectRefused(
      fixture,
      fixture.task,
      "awaiting_plan_review",
      "the plan session of codeguru42/tasker#5 runs on gpt-5, and claude-code refuses it: is not a claude-code model: gpt-5",
    );
  });
});
