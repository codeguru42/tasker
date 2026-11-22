import { describe, expect, it } from "vitest";
import { packagePath } from "../../../src/package-path.js";
import { questionPaneTemplateProblems, sessionReadProblems } from "../../helpers/prompt-templates.js";

const path = packagePath("prompt-templates/question-pane/opener.md");

function problems(values: Record<string, string>): string[] {
  return questionPaneTemplateProblems(path, values);
}

const sample = {
  NAME: "value-NAME",
  OWNER_NAME: "value-OWNER_NAME",
  OWNER_PANE_ID: "value-OWNER_PANE_ID",
  LOCAL_CLONE: "value-LOCAL_CLONE",
  REPO_KEY: "value-REPO_KEY",
  QUESTION_ID: "value-QUESTION_ID",
  FIRST_REPLY: "Issue: x\nSecond line",
};

describe("prompt-templates/question-pane/opener.md", () => {
  it("has no problem after a fill", () => {
    expect(problems(sample)).toEqual([]);
  });

  it("keeps a brace name in the first reply word for word", () => {
    expect(problems({ ...sample, FIRST_REPLY: "Issue: x\nThe text {{NAME}} stays." })).toEqual([]);
  });

  it("reads the body of the session file", () => {
    expect(sessionReadProblems(path)).toEqual([]);
  });
});
