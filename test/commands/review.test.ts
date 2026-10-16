import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { review } from "../../src/commands/review.js";
import { archivePrompt } from "../../src/prompts/archive.js";
import { REVIEW_PROMPT, REVIEW_PROMPT_NAME } from "../../src/prompts/review.js";
import { formatFindings } from "../../src/review/findings-text.js";
import { reviewTranscriptPath } from "../../src/store/layout.js";
import { runGit } from "../../src/vcs/git/run.js";
import { runCommand } from "../helpers/cli.js";
import { splitRoleModelsRepo } from "../helpers/config.js";
import { argAfter, claudeSample } from "../helpers/fake-claude.js";
import { answerStream, seedPlanRevision, transcriptLines } from "../helpers/plan.js";
import { reviewFinding, validReviewAnswer } from "../helpers/review.js";
import {
  databasePathOf,
  dayAt,
  eventsOf,
  latestTaskOf,
  readRunMarker,
  seedReview,
  withDataRootStore,
  reviewSessionRows,
} from "../helpers/store.js";
import { expectCommandRefused, useReviewFixture, useSeededTask, type ReviewFixture } from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";

const runReview = (key = KEY, ...extra: string[]) => runCommand(review, "review", key, ...extra);

// The tip of the task branch in the clone, read with git show-ref and not from HEAD of the worktree.
const branchTipOf = (work: ReviewFixture) =>
  runGit(["show-ref", "--verify", "--hash", `refs/heads/${String(work.task.branch)}`], {
    gitDir: work.clone,
    env: work.env,
  }).then((out) => out.trim());

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
    const revision = await branchTipOf(work);
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
      { type: "usage", data: expect.anything() },
      { type: "review", data: { number: 1, revision, findings: 2 } },
      { type: "transition", data: { from: "reviewing", to: "reviewed" } },
    ]);
    expect(transcriptLines(reviewTranscriptPath(dataRoot, task, 1))).toHaveLength(stream.length);
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
    expect(stdin).toContain(
      "Plan revision v2 (refine) followed this review with this operator feedback: Keep the loop.",
    );
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
      `the task of ${KEY} is in workspace_ready; tasker review needs awaiting_work_review\n`,
    );
  });
});
