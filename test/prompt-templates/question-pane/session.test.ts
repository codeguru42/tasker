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

  it("reads all of docs/dev/doc-reads.md after a pull that worked", () => {
    expect(body()).toContain("read docs/dev/doc-reads.md with the Read tool, in pieces to the end.");
  });

  it("names no section of docs/dev/doc-reads.md as the start read", () => {
    expect(body()).not.toContain("The doc-read rule of docs/dev/doc-reads.md");
  });

  it("keeps the old read of the five files", () => {
    expect(body()).toContain("run git fetch origin. Then read the five files with git show origin/main: and the path.");
  });

  it("shows the start line again on a status request before the first reply", () => {
    expect(body()).toContain(
      "Each time Claude Code asks for a status before that reply, show it again, alone, and continue.",
    );
  });

  it("holds no single quote", () => {
    expect(body().includes("'")).toBe(false);
  });

  it("stays within 300 words and 2000 characters", () => {
    expect(body().split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(300);
    expect(Array.from(body()).length).toBeLessThanOrEqual(2000);
  });
});
