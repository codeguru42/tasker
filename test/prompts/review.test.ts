import { describe, expect, it } from "vitest";
import { REVIEW_PROMPT, REVIEW_PROMPT_NAME } from "../../src/prompts/review.js";
import { SHARED_RULES } from "../../src/prompts/shared.js";
import { fillTemplate } from "../../src/prompts/template.js";
import { rulesOf } from "../helpers/prompts.js";

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
