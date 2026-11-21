import { describe, expect, it } from "vitest";
import { promptFileProblems } from "../../helpers/prompt-templates.js";

describe("execute-fix", () => {
  it("is a valid prompt file that fills with no problem", () => {
    expect(
      promptFileProblems("execute-fix", {
        VERIFY_FAILURE: "sample",
        VERIFY_LOG: "sample",
        RESULT_LEAD: "sample",
        BLOCKED: "sample",
      }),
    ).toEqual([]);
  });
});
