import { describe, expect, it } from "vitest";
import { promptFileProblems } from "../../helpers/prompt-templates.js";

describe("execute", () => {
  it("is a valid prompt file that fills with no problem", () => {
    expect(
      promptFileProblems("execute", {
        COMMIT_RULES: "sample",
        PLAN_MARKDOWN: "sample",
        TODOS: "sample",
        RESOLVED_QUESTIONS: "sample",
      }),
    ).toEqual([]);
  });
});
