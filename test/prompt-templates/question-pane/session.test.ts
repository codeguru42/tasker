import { describe, expect, it } from "vitest";
import { packagePath } from "../../../src/package-path.js";
import { readPromptTemplate } from "../../../src/prompts/template-file.js";
import { questionPaneTemplateProblems } from "../../helpers/prompt-templates.js";

const path = packagePath("prompt-templates/question-pane/session.md");

function problems(values: Record<string, string>): string[] {
  return questionPaneTemplateProblems(path, values);
}

function body(): string {
  return readPromptTemplate(path).body;
}

const sample = {
  NAME: "question-x",
  OWNER_NAME: "orchestrator",
  OWNER_PANE_ID: "p_1",
  QUESTION_ID: "q1",
  LOCAL_CLONE: "/tmp/clone",
  FIRST_REPLY: "Issue: x LINE-BREAK Second line",
};

describe("prompt-templates/question-pane/session.md", () => {
  it("has no problem after a fill", () => {
    expect(problems(sample)).toEqual([]);
  });

  it("holds no single quote", () => {
    expect(body().includes("'")).toBe(false);
  });

  it("stays within 300 words and 2000 characters", () => {
    expect(body().split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(300);
    expect(Array.from(body()).length).toBeLessThanOrEqual(2000);
  });
});
