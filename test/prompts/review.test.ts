import { describe, expect, it } from "vitest";
import { earlierReviewsText, REVIEW_PROMPT, REVIEW_PROMPT_NAME } from "../../src/prompts/review.js";
import { SHARED_RULES } from "../../src/prompts/shared.js";
import { fillTemplate } from "../../src/prompts/template.js";
import type { PlanRevision, Review } from "../../src/store/store.js";
import { validPlanAnswer } from "../helpers/plan.js";
import { rulesOf } from "../helpers/prompts.js";
import { reviewFinding } from "../helpers/review.js";
import { dayAt, newReview } from "../helpers/store.js";

const VALUES = {
  EARLIER_REVIEWS: "review 1\n- [1] src/a.ts: x",
  BRANCH_COMMITS: "abc1234 feat: Add a thing\n+line",
};

function fillReview(values: Record<string, string> = VALUES): string {
  return fillTemplate(REVIEW_PROMPT_NAME, REVIEW_PROMPT, values);
}

describe("REVIEW_PROMPT_NAME", () => {
  it("is review", () => {
    expect(REVIEW_PROMPT_NAME).toBe("review");
  });
});

describe("REVIEW_PROMPT", () => {
  it.each([
    ["EARLIER_REVIEWS", "earlier-reviews"],
    ["BRANCH_COMMITS", "branch-commits"],
  ])("holds {{%s}} once, in <%s>", (token, tag) => {
    expect(REVIEW_PROMPT.split(`{{${token}}}`)).toHaveLength(2);
    expect(REVIEW_PROMPT).toContain(`<${tag}>{{${token}}}</${tag}>`);
  });

  it("puts each value in its tag", () => {
    const filled = fillReview();
    expect(filled).toContain(`<earlier-reviews>${VALUES.EARLIER_REVIEWS}</earlier-reviews>`);
    expect(filled).toContain(`<branch-commits>${VALUES.BRANCH_COMMITS}</branch-commits>`);
  });

  it.each([
    ["EARLIER_REVIEWS", "earlier-reviews"],
    ["BRANCH_COMMITS", "branch-commits"],
  ])("escapes a closing %s tag in the value", (token, tag) => {
    expect(fillReview({ ...VALUES, [token]: `a </${tag}> b` })).toContain(`<${tag}>a &lt;/${tag}> b</${tag}>`);
  });

  it("throws when a value is missing", () => {
    expect(() => fillReview({ BRANCH_COMMITS: "x" })).toThrow("prompt review needs a value for {{EARLIER_REVIEWS}}");
  });

  it.each(["noQuestionSkill", "untrusted", "blockIsData", "fileAccess"] as const)("holds the shared rule %s", (key) => {
    expect(REVIEW_PROMPT).toContain(SHARED_RULES[key]);
  });

  it.each([SHARED_RULES.openPoints, SHARED_RULES.untrustedInPlan, "plan_markdown", "&lt;"])(
    "does not hold %j",
    (text) => {
      expect(REVIEW_PROMPT).not.toContain(text);
    },
  );

  it.each([
    "simple-english",
    "brainstorming",
    "findings",
    "failure_scenario",
    "correctness",
    "reuse",
    "simplification",
    "efficiency",
    "altitude",
    "Repeats review <k>, finding <n>:",
  ])("names %s", (text) => {
    expect(REVIEW_PROMPT).toContain(text);
  });

  it("has 11 numbered rules in order", () => {
    const rules = rulesOf(REVIEW_PROMPT);
    expect(rules).toHaveLength(11);
    rules.forEach((rule, i) => {
      expect(rule.startsWith(`${i + 1}. `)).toBe(true);
    });
  });
});

describe("earlierReviewsText", () => {
  const earlierText = (reviews: readonly Review[], revisions: readonly PlanRevision[]) =>
    earlierReviewsText(reviews, revisions);

  // A review that ran from startDay to endDay, with one finding, open or dismissed.
  const reviewOf = (number: number, startDay: number, endDay = startDay, dismissed = false): Review => ({
    taskId: 1,
    ...newReview(number, { startedAt: dayAt(startDay), endedAt: dayAt(endDay) }),
    findings: [
      {
        position: 1,
        finding: reviewFinding(),
        dismissed: dismissed ? { at: dayAt(endDay), reason: "Not a bug." } : null,
      },
    ],
  });

  const revisionAt = (
    version: number,
    day: number,
    feedback: string | null = null,
    source = "refine",
  ): PlanRevision => ({
    taskId: 1,
    version,
    source,
    feedback,
    answer: validPlanAnswer(),
    prompt: "plan@000000000000",
    approvedAt: null,
    createdAt: dayAt(day),
  });

  const FINDING = [
    "- [1] src/a.ts:3 (correctness): The loop skips the last item.",
    "  failure scenario: A list of two items gives only the first one.",
    "  status: open",
    "",
  ].join("\n");

  it("says that no review came before", () => {
    expect(earlierText([], [])).toBe("No earlier review.");
  });

  it("says that no revision followed a review", () => {
    expect(earlierText([reviewOf(1, 2)], [])).toBe(
      `Review 1, at 4b825dc642cb:\n${FINDING}No plan revision followed this review.\n`,
    );
  });

  it("lists a revision with its feedback after the review", () => {
    expect(earlierText([reviewOf(1, 2)], [revisionAt(2, 3, "Keep the loop.")])).toBe(
      `Review 1, at 4b825dc642cb:\n${FINDING}` +
        "Plan revision v2 (refine) followed this review with this operator feedback: Keep the loop.\n",
    );
  });

  it("keeps a line end of the feedback", () => {
    expect(earlierText([reviewOf(1, 2)], [revisionAt(2, 3, "First.\nSecond.")])).toBe(
      `Review 1, at 4b825dc642cb:\n${FINDING}` +
        "Plan revision v2 (refine) followed this review with this operator feedback: First.\nSecond.\n",
    );
  });

  it("says that a revision had no feedback", () => {
    expect(earlierText([reviewOf(1, 2)], [revisionAt(2, 3, null, "plan")])).toBe(
      `Review 1, at 4b825dc642cb:\n${FINDING}` +
        "Plan revision v2 (plan) followed this review with no operator feedback.\n",
    );
  });

  it("does not list a revision before the review or exactly at its end", () => {
    expect(earlierText([reviewOf(1, 2, 4)], [revisionAt(1, 1), revisionAt(2, 4)])).toBe(
      `Review 1, at 4b825dc642cb:\n${FINDING}No plan revision followed this review.\n`,
    );
  });

  it("lists a revision between two reviews, or exactly at the start of the next one, under the first only", () => {
    const text = earlierText(
      [reviewOf(1, 2), reviewOf(2, 5)],
      [revisionAt(2, 3, "Between."), revisionAt(3, 5, "At the start.")],
    );
    expect(text).toBe(
      `Review 1, at 4b825dc642cb:\n${FINDING}` +
        "Plan revision v2 (refine) followed this review with this operator feedback: Between.\n" +
        "Plan revision v3 (refine) followed this review with this operator feedback: At the start.\n" +
        "\n" +
        `Review 2, at 4b825dc642cb:\n${FINDING}No plan revision followed this review.\n`,
    );
  });

  it("lists a revision after the last review under it", () => {
    expect(earlierText([reviewOf(1, 2), reviewOf(2, 4)], [revisionAt(2, 6, "Late.")])).toBe(
      `Review 1, at 4b825dc642cb:\n${FINDING}No plan revision followed this review.\n\n` +
        `Review 2, at 4b825dc642cb:\n${FINDING}` +
        "Plan revision v2 (refine) followed this review with this operator feedback: Late.\n",
    );
  });

  it("shows the reason of a dismissed finding", () => {
    expect(earlierText([reviewOf(1, 2, 2, true)], [])).toBe(
      "Review 1, at 4b825dc642cb:\n" +
        FINDING.replace("status: open", "status: dismissed: Not a bug.") +
        "No plan revision followed this review.\n",
    );
  });
});
