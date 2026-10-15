import type { Finding, ReviewAnswer } from "../../src/review/answer.js";

export function reviewFinding(change: Partial<Finding> = {}): Finding {
  return {
    file: "src/a.ts",
    line: 3,
    category: "correctness",
    summary: "The loop skips the last item.",
    failure_scenario: "A list of two items gives only the first one.",
    ...change,
  };
}

export function validReviewAnswer(change: Partial<ReviewAnswer> = {}): ReviewAnswer {
  return { findings: [reviewFinding()], ...change };
}
