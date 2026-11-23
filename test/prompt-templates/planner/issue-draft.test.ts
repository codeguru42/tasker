import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packagePath } from "../../../src/package-path.js";
import { fillTemplate } from "../../../src/prompts/template.js";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { docPaths, sharedWordRuns } from "../../helpers/doc-text.js";

const path = packagePath("prompt-templates/planner/issue-draft.md");

const RESULT_ASK = "Return your result to the session that started you with the tool SubagentHandback.";
const RULE_DOCS = "docs/dev/issue-subagents.md\ndocs/dev/issue-draft.md";

const sample: Record<string, string> = {
  RULE_DOCS,
  DRAFT_FILE: "/tmp/drafts/planner-1-draft.md",
  SUBAGENT_NAME: "issue-draft-1",
  SOURCE: "Add a retry to the sync.\nSender: user\nDate: 2026-11-23",
  MILESTONE: "M31 — Orchestrator",
  DECISIONS: "Use the title of the user.",
  ISSUE_KEY: "none",
  START_HASH: "none",
  FINDINGS: "none",
  QUESTIONS_AND_ANSWERS: "none",
};

function body(): string {
  return readPromptTemplate(path).body;
}

function fill(values: Record<string, string>): string {
  return fillTemplate("planner/issue-draft", body(), { ...sample, ...values });
}

describe("prompt-templates/planner/issue-draft.md", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(path)).toEqual([]);
  });

  it("has exactly the placeholders of the issue and no RECORD_FILE", () => {
    const names = Object.keys(readPromptTemplate(path).placeholders);
    expect(names).toEqual([
      "RULE_DOCS",
      "DRAFT_FILE",
      "SUBAGENT_NAME",
      "SOURCE",
      "MILESTONE",
      "DECISIONS",
      "ISSUE_KEY",
      "START_HASH",
      "FINDINGS",
      "QUESTIONS_AND_ANSWERS",
    ]);
    expect(names).not.toContain("RECORD_FILE");
  });

  it("leaves no {{ after a fill and holds the result ask and the rule documents", () => {
    const filled = fill({});
    expect(filled).not.toContain("{{");
    expect(filled).toContain(RESULT_ASK);
    for (const line of RULE_DOCS.split("\n")) expect(filled).toContain(line);
  });

  it("has no docs/ path in the body and names only the two rule documents after a fill", () => {
    expect(docPaths(body())).toEqual([]);
    expect(docPaths(fill({}))).toEqual(["docs/dev/issue-subagents.md", "docs/dev/issue-draft.md"]);
  });

  it("shares no 8-word run with docs/dev/planner-subagent.md", () => {
    const doc = readFileSync(packagePath("docs/dev/planner-subagent.md"), "utf8");
    expect(sharedWordRuns(body(), doc)).toEqual([]);
  });

  it("says what to do when the rule documents are none", () => {
    const filled = fill({ RULE_DOCS: "none" });
    expect(filled).toContain("If the rule documents are none, the prompt names no rule document.");
  });

  it("says what to do when the decisions of the user are none", () => {
    const filled = fill({ DECISIONS: "none" });
    expect(filled).toContain("If the decisions of the user are none, the prompt gives no decision of the user on this draft.");
  });

  it("says what to do when the start hash is none", () => {
    const filled = fill({ START_HASH: "none" });
    expect(filled).toContain("Start hash: none");
    expect(filled).toContain(
      "If the draft changes an open issue and the start hash is none, read that issue first. Then write the draft from that read and the change. If that read fails, end, and say so in your report.",
    );
  });

  it("says what to do when the findings are none", () => {
    const filled = fill({ FINDINGS: "none" });
    expect(filled).toContain("If the findings are none, the prompt gives no finding of a review.");
  });

  it("says what to do when the questions and answers are none", () => {
    const filled = fill({ QUESTIONS_AND_ANSWERS: "none" });
    expect(filled).toContain("If the questions and answers are none, the prompt gives no question and no answer of the user.");
  });

  it("holds the start hash none for a new issue", () => {
    const filled = fill({ ISSUE_KEY: "none", START_HASH: "none" });
    expect(filled).toContain("Start hash: none");
    expect(filled).toContain("Issue key: none");
    expect(filled).not.toContain("{{");
  });

  it("holds each finding after a review", () => {
    const findings = "The title is too long.\nThe body has no test case.";
    const filled = fill({ FINDINGS: findings });
    for (const line of findings.split("\n")) expect(filled).toContain(line);
    expect(filled).not.toContain("{{");
  });
});
