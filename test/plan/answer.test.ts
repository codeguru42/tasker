import { describe, expect, it } from "vitest";
import { checkPlanAnswer, type PlanAnswer, planAnswerJsonSchema } from "../../src/plan/answer.js";
import { validPlanAnswer } from "../helpers.js";

function problemsOf(output: unknown): string[] {
  const result = checkPlanAnswer(output);
  if (result.ok) throw new Error("expected problems");
  return result.problems;
}

describe("checkPlanAnswer: the schema", () => {
  it("passes the valid answer and gives it back", () => {
    expect(checkPlanAnswer(validPlanAnswer())).toEqual({ ok: true, answer: validPlanAnswer() });
  });

  it("refuses an empty summary list", () => {
    expect(problemsOf(validPlanAnswer({ summary: [] }))).toEqual([
      "summary: Too small: expected array to have >=1 items",
    ]);
  });

  it("refuses an empty summary string", () => {
    expect(problemsOf(validPlanAnswer({ summary: [""] }))).toEqual([
      "summary.0: Too small: expected string to have >=1 characters",
    ]);
  });

  it("refuses a plan with no heading", () => {
    expect(problemsOf(validPlanAnswer({ plan_markdown: "No heading here." }))).toEqual([
      'plan_markdown: must start with "## Summary"',
    ]);
  });

  it("refuses a heading that continues in the same word", () => {
    expect(problemsOf(validPlanAnswer({ plan_markdown: "## Summaryx\n\nA long plan text here." }))).toEqual([
      'plan_markdown: must start with "## Summary"',
    ]);
  });

  it("accepts a heading that ends with a carriage return and a newline", () => {
    const answer = validPlanAnswer({ plan_markdown: "## Summary\r\n\r\nA long plan text, test first.\r\n" });

    expect(checkPlanAnswer(answer)).toEqual({ ok: true, answer });
  });

  it("refuses an empty path in files_changed", () => {
    expect(problemsOf(validPlanAnswer({ files_changed: [""] }))).toEqual([
      "files_changed.0: Too small: expected string to have >=1 characters",
    ]);
  });

  it("refuses a todo id that is not kebab-case", () => {
    const answer = validPlanAnswer({
      todos: [{ ...validPlanAnswer().todos[0]!, id: "Write_Test" }, validPlanAnswer().todos[1]!],
    });

    expect(problemsOf(answer)).toEqual(["todos.0.id: must be kebab-case"]);
  });

  it("refuses an empty todo title", () => {
    const answer = validPlanAnswer({
      todos: [{ ...validPlanAnswer().todos[0]!, title: "" }, validPlanAnswer().todos[1]!],
    });

    expect(problemsOf(answer)).toEqual([
      "todos.0.title: Too small: expected string to have >=1 characters",
    ]);
  });

  it("refuses a missing top-level field", () => {
    const answer: Partial<PlanAnswer> = validPlanAnswer();
    delete answer.questions;

    expect(problemsOf(answer)).toEqual(["questions: Invalid input: expected array, received undefined"]);
  });

  it("refuses an extra key at the top", () => {
    expect(problemsOf({ ...validPlanAnswer(), extra: 1 })).toEqual(["extra: unrecognized key"]);
  });

  it("refuses an extra key in a todo", () => {
    const answer = validPlanAnswer({
      todos: [{ ...validPlanAnswer().todos[0]!, extra: 1 } as never, validPlanAnswer().todos[1]!],
    });

    expect(problemsOf(answer)).toEqual(["todos.0.extra: unrecognized key"]);
  });

  it("refuses an extra key in a question", () => {
    const answer = validPlanAnswer({
      questions: [{ ...validPlanAnswer().questions[0]!, extra: 1 } as never],
    });

    expect(problemsOf(answer)).toEqual(["questions.0.extra: unrecognized key"]);
  });

  it("gives the root problem for undefined", () => {
    expect(problemsOf(undefined)).toEqual(["(root): the assistant returned no plan"]);
  });

  it("gives the root problem for null", () => {
    expect(problemsOf(null)).toEqual(["(root): the assistant returned no plan"]);
  });

  it("gives one root line for a string", () => {
    const problems = problemsOf("text");

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^\(root\): /);
  });

  it("gives every schema problem in one run", () => {
    const answer = {
      ...validPlanAnswer({
        todos: [
          { ...validPlanAnswer().todos[0]!, id: "Bad_Id", title: "" },
          validPlanAnswer().todos[1]!,
        ],
      }),
      extra: 1,
    };

    expect(problemsOf(answer)).toEqual([
      "extra: unrecognized key",
      "todos.0.id: must be kebab-case",
      "todos.0.title: Too small: expected string to have >=1 characters",
    ]);
  });
});

describe("planAnswerJsonSchema", () => {
  it("has no $schema key, closes each object and requires the five fields", () => {
    const schema = planAnswerJsonSchema();

    expect(schema).not.toHaveProperty("$schema");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["summary", "plan_markdown", "files_changed", "todos", "questions"]);
  });
});
