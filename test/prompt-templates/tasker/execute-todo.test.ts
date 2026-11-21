import { describe, expect, it } from "vitest";
import { promptFileProblems } from "../../helpers/prompt-templates.js";

describe("execute-todo", () => {
  it("is a valid prompt file that fills with no problem", () => {
    expect(
      promptFileProblems("execute-todo", {
        CURRENT_TODO: "sample",
        RESULT_LEAD: "sample",
        BLOCKED: "sample",
      }),
    ).toEqual([]);
  });
});
