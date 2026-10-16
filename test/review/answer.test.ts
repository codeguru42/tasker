import { describe, expect, it } from "vitest";
import { checkReviewAnswer, reviewAnswerJsonSchema } from "../../src/review/answer.js";
import { reviewFinding, reviewFindingWithout, validReviewAnswer } from "../helpers/review.js";

function check(output: unknown) {
  return checkReviewAnswer(output);
}

function problemsOf(output: unknown): string[] {
  const result = check(output);
  if (result.ok) throw new Error("expected problems");
  return result.problems;
}

function answerOf(...findings: unknown[]) {
  return { findings };
}

const PLACEHOLDER = "is a placeholder, not real text";
const EMPTY_FILE = 'is empty after a trim and the removal of a leading "./"';

describe("checkReviewAnswer: valid answers", () => {
  it("passes an empty list", () => {
    expect(check({ findings: [] })).toEqual({ ok: true, answer: { findings: [] } });
  });

  it("passes the valid answer and gives it back", () => {
    expect(check(validReviewAnswer())).toEqual({ ok: true, answer: validReviewAnswer() });
  });

  it("passes a finding without line and without category", () => {
    const output = answerOf(reviewFindingWithout("line", "category"));
    const result = check(output);
    expect(result).toEqual({ ok: true, answer: output });
    if (result.ok)
      expect(Object.keys(result.answer.findings[0] ?? {}).sort()).toEqual(["failure_scenario", "file", "summary"]);
  });

  it("passes a category of another word", () => {
    const output = validReviewAnswer({ findings: [reviewFinding({ category: "style" })] });
    expect(check(output)).toEqual({ ok: true, answer: output });
  });

  it("passes a text of exactly 3 characters after the trim", () => {
    const output = validReviewAnswer({ findings: [reviewFinding({ summary: " abc ", failure_scenario: "abc" })] });
    expect(check(output)).toEqual({ ok: true, answer: output });
  });
});

describe("checkReviewAnswer: the schema", () => {
  it.each([null, undefined])("gives one problem for %s", (output) => {
    expect(problemsOf(output)).toEqual(["(root): the assistant returned no review"]);
  });

  it("gives a problem for an extra key at the top", () => {
    expect(problemsOf({ ...validReviewAnswer(), extra: 1 })).toEqual(["extra: unrecognized key"]);
  });

  it("gives a problem for an extra key in a finding", () => {
    expect(problemsOf(answerOf({ ...reviewFinding(), extra: 1 }))).toEqual(["findings.0.extra: unrecognized key"]);
  });

  it("gives a problem for a missing summary", () => {
    expect(problemsOf(answerOf(reviewFindingWithout("summary")))).toEqual([
      "findings.0.summary: Invalid input: expected string, received undefined",
    ]);
  });

  it("gives a problem for missing findings", () => {
    expect(problemsOf({})).toEqual(["findings: Invalid input: expected array, received undefined"]);
  });

  it.each([0, -1])("gives a problem for a line of %i", (line) => {
    expect(problemsOf(answerOf(reviewFinding({ line })))).toEqual([
      "findings.0.line: Too small: expected number to be >=1",
    ]);
  });

  it("gives a problem for a line that is not a whole number", () => {
    expect(problemsOf(answerOf(reviewFinding({ line: 1.5 })))).toEqual([
      "findings.0.line: Invalid input: expected int, received number",
    ]);
  });

  it("gives a problem for an empty file", () => {
    expect(problemsOf(answerOf(reviewFinding({ file: "" })))).toEqual([
      "findings.0.file: Too small: expected string to have >=1 characters",
    ]);
  });

  it("reports two bad keys in one run", () => {
    expect(problemsOf(answerOf(reviewFinding({ file: "", line: 0 })))).toEqual([
      "findings.0.file: Too small: expected string to have >=1 characters",
      "findings.0.line: Too small: expected number to be >=1",
    ]);
  });
});

describe("checkReviewAnswer: the placeholder checks", () => {
  it("gives a problem for a placeholder summary", () => {
    expect(problemsOf(answerOf(reviewFinding({ summary: " ab " })))).toEqual([`findings.0.summary: ${PLACEHOLDER}`]);
  });

  it("gives a problem for a placeholder failure scenario", () => {
    expect(problemsOf(answerOf(reviewFinding({ failure_scenario: "x" })))).toEqual([
      `findings.0.failure_scenario: ${PLACEHOLDER}`,
    ]);
  });
});

describe("checkReviewAnswer: the clean step", () => {
  it("cleans the file", () => {
    const result = check(answerOf(reviewFinding({ file: "  ./src/a.ts " })));
    expect(result).toEqual({ ok: true, answer: validReviewAnswer() });
  });

  it.each(["./", "   "])("gives a problem for the file %j", (file) => {
    expect(problemsOf(answerOf(reviewFinding({ file })))).toEqual([`findings.0.file: ${EMPTY_FILE}`]);
  });

  it("reports all problems of one run", () => {
    const output = answerOf(reviewFinding({ file: "./", summary: "ab" }), reviewFinding({ failure_scenario: "x" }));
    expect(problemsOf(output)).toEqual([
      `findings.0.file: ${EMPTY_FILE}`,
      `findings.0.summary: ${PLACEHOLDER}`,
      `findings.1.failure_scenario: ${PLACEHOLDER}`,
    ]);
  });
});

describe("reviewAnswerJsonSchema", () => {
  it("has no $schema and closes the top object", () => {
    const schema = reviewAnswerJsonSchema();
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({ additionalProperties: false, required: ["findings"] });
  });
});
