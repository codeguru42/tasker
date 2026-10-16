import type { Finding, ReviewAnswer } from "../../src/review/answer.js";
import type { FindingEntry } from "../../src/review/findings-text.js";

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

// reviewFinding() without the named keys.
export function reviewFindingWithout<K extends keyof Finding>(...keys: K[]): Omit<Finding, K> {
  const finding: Partial<Finding> = reviewFinding();
  return Object.fromEntries(Object.entries(finding).filter(([name]) => !keys.includes(name as K))) as Omit<Finding, K>;
}

export function validReviewAnswer(change: Partial<ReviewAnswer> = {}): ReviewAnswer {
  return { findings: [reviewFinding()], ...change };
}

const FINDING_TEXTS = {
  first: {
    head: "src/a.ts:3 (correctness): The loop skips the last item.",
    scenario: "A list of two items gives only the first one.",
  },
  second: {
    head: "src/b.ts:9 (correctness): The count is off by one.",
    scenario: "A list of three items gives the count 2.",
  },
};

// The expected text form of a default finding at position, as literal text, so that a test does not call the code
// under test. "first" is reviewFinding(), "second" is the second finding of newReview. status is "open" or
// "dismissed: <reason>".
export function findingText(which: "first" | "second", position: number, status = "open"): string {
  const { head, scenario } = FINDING_TEXTS[which];
  return `- [${position}] ${head}\n  failure scenario: ${scenario}\n  status: ${status}\n`;
}

// The findings as open entries, with positions from 1.
export function findingEntries(findings: readonly Finding[]): FindingEntry[] {
  return findings.map((finding, i) => ({ position: i + 1, finding, dismissed: null }));
}
