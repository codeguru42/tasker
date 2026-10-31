import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { review } from "../../src/commands/review.js";
import { planRevisionPath, planTranscriptPath, reviewTranscriptPath } from "../../src/store/layout.js";
import { archivePrompt } from "../../src/prompts/archive.js";
import { REVIEW_PROMPT, REVIEW_PROMPT_NAME } from "../../src/prompts/review.js";
import { formatFindings } from "../../src/review/findings-text.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { splitRoleModelsRepo } from "../helpers/config.js";
import {
  TEST_SESSION_ID,
  argAfter,
  claudeApprovalWarningEvent,
  claudeOverageEvent,
  claudeSample,
  withEventBeforeResult,
  withEventFirst,
} from "../helpers/fake-claude.js";
import { overlapWarningText } from "../helpers/overlap.js";
import { quotaPauseLineExpected } from "../helpers/quota.js";
import {
  answerStream,
  planRevisionOf,
  seedPlanRevision,
  seedTaskWithPlanFiles,
  transcriptLines,
  validPlanAnswer,
} from "../helpers/plan.js";
import { reviewFeedbackContextExpected, reviewFinding, validReviewAnswer } from "../helpers/review.js";
import {
  databasePathOf,
  eventDataOf,
  dayAt,
  eventsOf,
  latestTaskOf,
  readRunMarker,
  seedCreditsApprovalIn,
  seedReview,
  withDataRootStore,
  reviewSessionRows,
} from "../helpers/store.js";
import {
  useLocalBase,
  expectCommandRefused,
  expectNoAssistantRun,
  taskBranchTipOf,
  useRefineFixture,
  useReviewedRefineFixture,
  useReviewFixture,
  useSeededTask,
} from "../helpers/task-fixtures.js";
import { wrongStateError } from "../helpers/state-commands.js";
import { refinedLine } from "../helpers/command-output.js";

const KEY = "codeguru42/tasker#5";

const runReview = (key = KEY, ...extra: string[]) => runCommand(review, "review", key, ...extra);

const FEEDBACK = "Keep the loop and add a test for the empty list.";

const runReviewFeedback = (feedback: string, key = KEY, ...extra: string[]) =>
  runCommand(review, "review", key, feedback, ...extra);

const reviewsOf = (dataRoot: string, taskId: number) =>
  withDataRootStore(dataRoot, (store) => store.listReviews(taskId));

// The text that the command prints for a review with findings.
const outputOf = (dataRoot: string, number: number, count: string, findings: Parameters<typeof formatFindings>[0]) => {
  const task = latestTaskOf(dataRoot, KEY);
  return [
    `reviewed ${KEY}: review ${number}, ${count}`,
    `${formatFindings(findings)}prompt: ${archivePrompt(dataRoot, REVIEW_PROMPT_NAME, REVIEW_PROMPT).path}`,
    `transcript: ${reviewTranscriptPath(dataRoot, task, number)}`,
    "",
  ].join("\n");
};

describe("review", () => {
  it("records a review with findings and moves the task to reviewed", async () => {
    const stream = answerStream(
      validReviewAnswer({ findings: [reviewFinding(), reviewFinding({ file: "src/b.ts" })] }),
    );
    const work = await useReviewFixture({ stream }, { repo: splitRoleModelsRepo() });
    const { dataRoot } = work;
    const revision = await taskBranchTipOf(work);
    const before = eventsOf(dataRoot, KEY);

    const result = await runReview();

    const task = latestTaskOf(dataRoot, KEY);
    const stored = withDataRootStore(dataRoot, (store) => store.getReview(task.id, 1));
    expect(result).toEqual({ code: 0, out: outputOf(dataRoot, 1, "2 findings", stored!.findings), err: "" });
    expect(task.state).toBe("reviewed");
    expect(readRunMarker(databasePathOf(dataRoot), task.id)).toBeUndefined();
    expect(stored).toMatchObject({ number: 1, revision });
    expect(stored?.prompt).toMatch(/^review@[0-9a-f]{12}$/);
    expect(stored?.findings.map((entry) => entry.finding)).toEqual([
      reviewFinding(),
      reviewFinding({ file: "src/b.ts" }),
    ]);
    expect(eventsOf(dataRoot, KEY).slice(before.length)).toEqual([
      { type: "transition", data: { from: "awaiting_work_review", to: "reviewing" } },
      { type: "sandbox_cleanup", data: { removed: [] } },
      { type: "usage", data: expect.anything() },
      { type: "review", data: { number: 1, revision, findings: 2 } },
      { type: "transition", data: { from: "reviewing", to: "reviewed" } },
    ]);
    expect(transcriptLines(reviewTranscriptPath(dataRoot, task, 1))).toHaveLength(stream.length);
  });

  it("writes a sandbox_cleanup event with the sandboxCleanup of the outcome", async () => {
    const work = await useReviewFixture({ stream: answerStream(validReviewAnswer()), placeholders: [".bashrc"] });

    await runReview();

    expect(eventDataOf(work.dataRoot, KEY, "sandbox_cleanup")).toEqual([{ removed: [".bashrc"] }]);
  });

  it("runs a new session with the review model and gives the earlier reviews and the commits on stdin", async () => {
    const work = await useReviewFixture({ stream: answerStream(validReviewAnswer()) }, { repo: splitRoleModelsRepo() });

    const result = await runReview();

    expect(result.code).toBe(0);
    const call = work.claude.calls()[0];
    const rows = reviewSessionRows(work.dataRoot, latestTaskOf(work.dataRoot, KEY).id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ review_number: 1, model: "opus", session_id: argAfter(call.argv, "--session-id") });
    expect(call.argv).not.toContain("--resume");
    expect(argAfter(call.argv, "--model")).toBe("opus");
    const commits = /<branch-commits>([\s\S]*)<\/branch-commits>/.exec(call.stdin)?.[1];
    expect(commits).toContain("work.txt");
    expect(call.stdin).toContain("<earlier-reviews>No earlier review.</earlier-reviews>");
  });

  it("gives the commits of a task with a local base", async () => {
    const work = await useReviewFixture({ stream: answerStream(validReviewAnswer()) });
    await useLocalBase(work, "refs/remotes/origin/main");

    await runReview();

    const commits = /<branch-commits>([\s\S]*)<\/branch-commits>/.exec(work.claude.calls()[0].stdin)?.[1];
    expect(commits).toContain("work.txt");
  });

  it("moves the task back to awaiting_work_review when the review has no findings", async () => {
    const work = await useReviewFixture({ stream: answerStream(validReviewAnswer({ findings: [] })) });

    const result = await runReview();

    const task = latestTaskOf(work.dataRoot, KEY);
    expect(result.code).toBe(0);
    expect(result.out.split("\n")[0]).toBe(`reviewed ${KEY}: review 1, no findings`);
    expect(result.out.split("\n")[1]).toBe("no findings");
    expect(task.state).toBe("awaiting_work_review");
    expect(reviewsOf(work.dataRoot, task.id)).toMatchObject([{ number: 1, findings: [] }]);
  });

  it("says 1 finding for one finding", async () => {
    const work = await useReviewFixture({ stream: answerStream(validReviewAnswer()) });

    const result = await runReview();

    expect(result.out.split("\n")[0]).toBe(`reviewed ${KEY}: review 1, 1 finding`);
    expect(latestTaskOf(work.dataRoot, KEY).state).toBe("reviewed");
  });

  it("gives the earlier reviews with their findings and the revisions that followed", async () => {
    const work = await useReviewFixture({ stream: answerStream(validReviewAnswer()) });
    const { dataRoot } = work;
    const id = work.task.id;
    const at = (day: number) => ({ now: () => new Date(dayAt(day)) });
    withDataRootStore(dataRoot, (store) => seedPlanRevision(store, id, {}, "awaiting_work_review"), at(1));
    withDataRootStore(
      dataRoot,
      (store) => seedReview(store, id, { startedAt: dayAt(2), endedAt: dayAt(2) }, "awaiting_work_review"),
      at(2),
    );
    withDataRootStore(
      dataRoot,
      (store) => store.dismissReviewFindings(id, 1, [1], "Not a bug.", "awaiting_work_review"),
      at(2),
    );
    withDataRootStore(
      dataRoot,
      (store) => seedPlanRevision(store, id, { source: "refine", feedback: "Keep the loop." }, "awaiting_work_review"),
      at(3),
    );

    const result = await runReview();

    expect(result.code).toBe(0);
    const stdin = work.claude.calls()[0].stdin;
    expect(stdin).toContain("Review 1, at 4b825dc642cb:");
    expect(stdin).toContain("status: dismissed: Not a bug.");
    expect(stdin).toContain("Plan revision v2 (refine) followed this review with this user feedback: Keep the loop.");
    expect(stdin).not.toContain("Plan revision v1");
    expect(reviewsOf(dataRoot, id).map((item) => item.number)).toEqual([1, 2]);
    expect(existsSync(reviewTranscriptPath(dataRoot, latestTaskOf(dataRoot, KEY), 2))).toBe(true);
  });
});

describe("a review that does not finish", () => {
  const expectNoReview = (dataRoot: string) => {
    const task = latestTaskOf(dataRoot, KEY);
    expect(reviewsOf(dataRoot, task.id)).toEqual([]);
    return task;
  };

  it("fails the task when the assistant fails", async () => {
    const work = await useReviewFixture({ stream: answerStream(validReviewAnswer()), exitCode: 1, stderr: "boom" });

    const result = await runReview();

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^reviewing failed: .+\n$/);
    expect(expectNoReview(work.dataRoot).state).toBe("failed");
    expect(eventsOf(work.dataRoot, KEY).map((event) => event.type)).toContain("usage");
  });

  it("fails the task when the assistant runs longer than the plan limit", { timeout: 15_000 }, async () => {
    const work = await useReviewFixture(
      { stream: claudeSample("plain").slice(0, 2), untilStopped: true },
      { limits: { planTimeoutMin: 0.05 } },
    );

    const result = await runReview();

    expect(result.code).toBe(1);
    expect(result.err).toBe("reviewing timed out after 0.05 min\n");
    expect(expectNoReview(work.dataRoot).state).toBe("failed");
    expect(eventsOf(work.dataRoot, KEY).map((event) => event.type)).toContain("usage");
  });

  it("blocks the task on a quota stop", async () => {
    const work = await useReviewFixture({ stream: claudeSample("quota-stop"), exitCode: 1 });

    const result = await runReview();

    expect(result.code).toBe(1);
    expect(result.out).toMatch(/^reviewing stopped by a quota limit; /);
    const task = expectNoReview(work.dataRoot);
    expect(task.state).toBe("quota_blocked");
    expect(readRunMarker(databasePathOf(work.dataRoot), task.id)).toBeUndefined();
    expect(eventsOf(work.dataRoot, KEY).map((event) => event.type)).toContain("usage");
  });

  it("fails the task for an answer that tasker refuses", async () => {
    const work = await useReviewFixture({
      stream: answerStream({ findings: [reviewFinding({ file: "./" })] }),
    });

    const result = await runReview();

    expect(result.code).toBe(1);
    expect(result.err.startsWith("the assistant returned findings that tasker refuses:\n  - findings.0.file:")).toBe(
      true,
    );
    expect(expectNoReview(work.dataRoot).state).toBe("failed");
  });
});

describe("a refused review", () => {
  it("prints the error and changes nothing", async () => {
    const fixture = await useSeededTask({ stream: answerStream(validReviewAnswer()) }, { state: "workspace_ready" });

    await expectCommandRefused(
      { dataRoot: fixture.dataRoot, key: KEY },
      () => runReview(),
      `${wrongStateError("workspace_ready", KEY, "review", "awaiting_work_review")}\n`,
    );
  });
});

// A task in awaiting_work_review with v1 approved, a passed verify run and review 1.
const startFeedback = (
  control: Parameters<typeof useReviewedRefineFixture>[0],
  options: Parameters<typeof useReviewedRefineFixture>[1] = {},
) => useReviewedRefineFixture(control, { ...options, state: "awaiting_work_review" });

const V2_ANSWER = validPlanAnswer({
  plan_markdown: "## Summary\n\nAdd the empty list test.\n",
  todos: [{ id: "only-todo", title: "Do the work", description: "Do all of it.", depends_on: [] }],
  questions: [],
});

describe("review with feedback", () => {
  it("refuses a task with no worktree and changes nothing", async () => {
    const fixture = await useSeededTask({ stream: answerStream(V2_ANSWER) }, { state: "awaiting_work_review" });

    await expectCommandRefused(
      { dataRoot: fixture.dataRoot, key: KEY },
      () => runReviewFeedback(FEEDBACK),
      `the task of ${KEY} has no worktree\n`,
    );

    expectNoAssistantRun({ claude: fixture.claude, started: { dataRoot: fixture.dataRoot } });
  });

  it("records revision v2 with the source review-feedback and the feedback", async () => {
    const stream = answerStream(V2_ANSWER);
    const fixture = await startFeedback({ stream });
    const { dataRoot } = fixture.started;
    const before = eventsOf(dataRoot, KEY);

    const result = await runReviewFeedback(FEEDBACK);

    const task = latestTaskOf(dataRoot, KEY);
    const revision = planRevisionOf(dataRoot, task.id, 2);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out.split("\n")).toEqual([
      refinedLine(KEY, 2),
      `plan: ${planRevisionPath(dataRoot, task, 2)}`,
      expect.stringMatching(/^prompt: /),
      "todos:",
      "- only-todo: Do the work",
      "questions: 0",
      "",
    ]);
    expect(task.state).toBe("awaiting_plan_review");
    expect(readRunMarker(databasePathOf(dataRoot), task.id)).toBeUndefined();
    expect(revision).toMatchObject({ version: 2, source: "review-feedback", feedback: FEEDBACK, answer: V2_ANSWER });
    expect(eventsOf(dataRoot, KEY).slice(before.length)).toEqual([
      { type: "transition", data: { feedback: FEEDBACK, from: "awaiting_work_review", to: "refining" } },
      { type: "sandbox_cleanup", data: { removed: [] } },
      { type: "usage", data: expect.anything() },
      { type: "plan_revision", data: { version: 2, prompt: revision!.prompt } },
      { type: "transition", data: { from: "refining", to: "awaiting_plan_review" } },
    ]);
    expect(transcriptLines(planTranscriptPath(dataRoot, task, 2))).toHaveLength(stream.length);
    expect(reviewsOf(dataRoot, task.id).map((item) => item.number)).toEqual([1]);
  });

  it("continues the recorded plan session", async () => {
    const fixture = await startFeedback({ stream: answerStream(V2_ANSWER) });

    const result = await runReviewFeedback(FEEDBACK);

    expect(result.code).toBe(0);
    const argv = fixture.claude.calls()[0].argv;
    expect(argv[argv.indexOf("--resume") + 1]).toBe(TEST_SESSION_ID);
    expect(argv).not.toContain("--session-id");
  });

  it("gives the revision of the work, the verify run and the feedback on the stdin", async () => {
    const fixture = await startFeedback({ stream: answerStream(V2_ANSWER) });
    const tip = await taskBranchTipOf({ clone: fixture.started.clone, env: fixture.started.env, task: fixture.task });

    await runReviewFeedback(FEEDBACK);

    const stdin = fixture.claude.calls()[0].stdin;
    expect(stdin).toContain(`<context>${reviewFeedbackContextExpected(tip, 1)}</context>`);
    expect(stdin).toContain(`<feedback>${FEEDBACK}</feedback>`);
  });

  it("says that no verify run is recorded for a task with no verify run", async () => {
    const fixture = await startFeedback({ stream: answerStream(V2_ANSWER) }, { verifyRun: false });
    const tip = await taskBranchTipOf({ clone: fixture.started.clone, env: fixture.started.env, task: fixture.task });

    await runReviewFeedback(FEEDBACK);

    expect(fixture.claude.calls()[0].stdin).toContain(`<context>${reviewFeedbackContextExpected(tip, null)}</context>`);
  });

  it("names no review in the context, also for a task with a seeded review", async () => {
    const fixture = await startFeedback({ stream: answerStream(V2_ANSWER) });
    const tip = await taskBranchTipOf({ clone: fixture.started.clone, env: fixture.started.env, task: fixture.task });

    await runReviewFeedback(FEEDBACK);

    const stdin = fixture.claude.calls()[0].stdin;
    const context = /<context>([\s\S]*)<\/context>/.exec(stdin)?.[1];
    expect(context).toBe(reviewFeedbackContextExpected(tip, 1));
    expect(stdin).not.toContain("The loop skips the last item.");
    expect(stdin).not.toContain("The count is off by one.");
  });

  it.each(["", "   "])("refuses the feedback %j as empty and changes nothing", async (feedback) => {
    const fixture = await startFeedback({ stream: answerStream(V2_ANSWER) });
    const { dataRoot } = fixture.started;

    await expectCommandRefused(fixture.started, () => runReviewFeedback(feedback), "the feedback is empty\n");

    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_work_review");
    expectNoAssistantRun(fixture);
    expect(planRevisionOf(dataRoot, fixture.task.id, 2)).toBeUndefined();
  });

  it("refuses a task in awaiting_plan_review and changes nothing", async () => {
    const fixture = await useRefineFixture({ stream: answerStream(V2_ANSWER) });

    await expectCommandRefused(
      fixture.started,
      () => runReviewFeedback(FEEDBACK),
      `${wrongStateError("awaiting_plan_review", KEY, "review", "awaiting_work_review")}\n`,
    );

    expectNoAssistantRun(fixture);
    expect(planRevisionOf(fixture.started.dataRoot, fixture.task.id, 2)).toBeUndefined();
  });

  it("fails the task when the assistant fails", async () => {
    const fixture = await startFeedback({ stream: answerStream(V2_ANSWER), exitCode: 1, stderr: "boom" });
    const { dataRoot } = fixture.started;

    const result = await runReviewFeedback(FEEDBACK);

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^refining failed: .+\n$/);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("failed");
    expect(planRevisionOf(dataRoot, fixture.task.id, 2)).toBeUndefined();
  });

  it("fails the task when the assistant runs longer than the plan limit", { timeout: 15_000 }, async () => {
    const fixture = await startFeedback(
      { stream: claudeSample("plain").slice(0, 2), untilStopped: true },
      { limits: { planTimeoutMin: 0.05 } },
    );

    const result = await runReviewFeedback(FEEDBACK);

    expect(result.code).toBe(1);
    expect(result.err).toBe("refining timed out after 0.05 min\n");
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("failed");
  });

  it("blocks the task on a quota stop", async () => {
    const fixture = await startFeedback({ stream: claudeSample("quota-stop"), exitCode: 1 });

    const result = await runReviewFeedback(FEEDBACK);

    expect(result.code).toBe(1);
    expect(result.out).toMatch(/^refining stopped by a quota limit; /);
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("quota_blocked");
  });

  it("fails the task for an answer that tasker refuses, and writes no v2", async () => {
    const fixture = await startFeedback({ stream: answerStream(validPlanAnswer({ todos: [] })) });

    const result = await runReviewFeedback(FEEDBACK);

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^the assistant returned a plan that tasker refuses:/);
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("failed");
    expect(planRevisionOf(fixture.started.dataRoot, fixture.task.id, 2)).toBeUndefined();
  });

  it("refuses a task with no plan session and changes nothing", async () => {
    const fixture = await startFeedback({ stream: answerStream(V2_ANSWER) });
    withDataRootStore(fixture.started.dataRoot, (store) => store.clearPlanSession(fixture.task.id));

    await expectCommandRefused(
      fixture.started,
      () => runReviewFeedback(FEEDBACK),
      `the task of ${KEY} has no plan session\n`,
    );

    expectNoAssistantRun(fixture);
  });

  it("warns of a shared file with the last line of tasker plan", async () => {
    const fixture = await startFeedback({
      stream: answerStream(validPlanAnswer({ files_changed: ["src/a.ts"] })),
    });
    seedTaskWithPlanFiles(
      fixture.started.dataRoot,
      { issueKey: "codeguru42/tasker#6", repoKey: "codeguru42/tasker", state: "awaiting_plan_review", at: dayAt(3) },
      ["src/a.ts"],
    );

    const result = await runReviewFeedback(FEEDBACK);

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^refined /);
    expect(result.err).toBe(
      overlapWarningText(
        [{ issueKey: "codeguru42/tasker#6", state: "awaiting_plan_review", files: ["src/a.ts"] }],
        ["tasker does not refuse. Decide before you approve."],
      ),
    );
  });

  it("still runs the automated review without feedback", async () => {
    const fixture = await startFeedback({ stream: answerStream(validReviewAnswer()) });

    const result = await runReview();

    expect(result.code).toBe(0);
    expect(result.out).toMatch(new RegExp(`^reviewed ${KEY}: review 2, 1 finding\n`));
    expect(planRevisionOf(fixture.started.dataRoot, fixture.task.id, 2)).toBeUndefined();
  });

  it("shows the feedback argument in the help", async () => {
    const result = await runHelp(review, "review");

    expect(result.code).toBe(0);
    expect(result.help).toContain("<issue> [feedback]");
    expect(result.help).toContain("Your feedback on the committed work, quoted as one argument.");
  });
});

describe("review with a quota warning", () => {
  const RESETS_AT = 1792206000;
  const ask = { repo: { overagePolicy: "ask" } };

  it("pauses the task under ask and records no review", async () => {
    const work = await useReviewFixture(
      { stream: withEventBeforeResult(claudeApprovalWarningEvent(), answerStream(validReviewAnswer())) },
      ask,
    );

    const result = await runReview();

    expect(result).toEqual({ code: 1, out: quotaPauseLineExpected("reviewing", 95, RESETS_AT), err: "" });
    const task = latestTaskOf(work.dataRoot, KEY);
    expect(task.state).toBe("awaiting_quota_approval");
    expect(eventsOf(work.dataRoot, KEY).at(-1)).toEqual({
      type: "transition",
      data: { from: "reviewing", to: "awaiting_quota_approval", utilization: 0.95, resetsAt: RESETS_AT },
    });
    expect(reviewsOf(work.dataRoot, task.id)).toEqual([]);
    expect(readRunMarker(databasePathOf(work.dataRoot), task.id)).toBeUndefined();
  });

  it("does not pause under decline", async () => {
    const work = await useReviewFixture({
      stream: withEventBeforeResult(claudeApprovalWarningEvent(), answerStream(validReviewAnswer())),
    });

    const result = await runReview();

    expect(result.code).toBe(0);
    expect(latestTaskOf(work.dataRoot, KEY).state).toBe("reviewed");
  });

  it("gives the approved window to the overage stop under decline", async () => {
    const work = await useReviewFixture({
      stream: withEventFirst(claudeOverageEvent(), answerStream(validReviewAnswer())),
    });
    seedCreditsApprovalIn(work.dataRoot, latestTaskOf(work.dataRoot, KEY).id, RESETS_AT);

    const result = await runReview();

    expect(result.code).toBe(0);
    expect(latestTaskOf(work.dataRoot, KEY).state).toBe("reviewed");
  });
});

describe("review with feedback and a quota warning", () => {
  const RESETS_AT = 1792206000;

  it("pauses the task as refining under ask and writes no v2", async () => {
    const fixture = await startFeedback(
      { stream: withEventBeforeResult(claudeApprovalWarningEvent(), answerStream(V2_ANSWER)) },
      { repo: { overagePolicy: "ask" } },
    );
    const { dataRoot } = fixture.started;

    const result = await runReviewFeedback(FEEDBACK);

    expect(result).toEqual({ code: 1, out: quotaPauseLineExpected("refining", 95, RESETS_AT), err: "" });
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_quota_approval");
    expect(eventsOf(dataRoot, KEY).at(-1)).toEqual({
      type: "transition",
      data: { from: "refining", to: "awaiting_quota_approval", utilization: 0.95, resetsAt: RESETS_AT },
    });
    expect(planRevisionOf(dataRoot, fixture.task.id, 2)).toBeUndefined();
  });
});
