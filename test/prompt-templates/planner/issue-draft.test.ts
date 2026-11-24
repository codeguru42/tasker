import { describe, expect, it } from "vitest";
import { packagePath } from "../../../src/package-path.js";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { docPaths } from "../../helpers/doc-text.js";
import {
  fillPlannerTemplate,
  ISSUE_RESULT_ASK,
  PLANNER_WAIT,
  plannerDocWordRuns,
  plannerTemplateBody,
  RULE_DOCS_NONE,
  SOURCE_LEAD,
  standsAfterStartBlock,
} from "../../helpers/planner-prompts.js";

const path = packagePath("prompt-templates/planner/issue-draft.md");

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
  DRAFT_KIND: "an issue",
  REPO_KEY: "codeguru42/tasker",
  COMMENT_KIND: "none",
};

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
      "DRAFT_KIND",
      "REPO_KEY",
      "COMMENT_KIND",
    ]);
    expect(names).not.toContain("RECORD_FILE");
  });

  it("leaves no {{ after a fill and holds the result ask and the rule documents", () => {
    const filled = fillPlannerTemplate("issue-draft", sample);
    expect(filled).not.toContain("{{");
    expect(filled).toContain(ISSUE_RESULT_ASK);
    for (const line of RULE_DOCS.split("\n")) expect(filled).toContain(line);
  });

  it("has no docs/ path in the body and names only the two rule documents after a fill", () => {
    expect(docPaths(plannerTemplateBody("issue-draft"))).toEqual([]);
    expect(docPaths(fillPlannerTemplate("issue-draft", sample))).toEqual(["docs/dev/issue-subagents.md", "docs/dev/issue-draft.md"]);
  });

  it("shares no 8-word run with docs/dev/planner-subagent.md", () => {
    expect(plannerDocWordRuns(plannerTemplateBody("issue-draft"))).toEqual([]);
  });

  it("says what to do when the rule documents are none", () => {
    const filled = fillPlannerTemplate("issue-draft", { ...sample, RULE_DOCS: "none" });
    expect(filled).toContain(RULE_DOCS_NONE);
    expect(filled).not.toContain("the prompt names no rule document.");
  });

  it("gives the rule documents sentence after the start steps", () => {
    const filled = fillPlannerTemplate("issue-draft", { ...sample, RULE_DOCS: "none" });
    expect(standsAfterStartBlock(filled, RULE_DOCS_NONE)).toBe(true);
  });

  it("says what to do when the decisions of the user are none", () => {
    const filled = fillPlannerTemplate("issue-draft", { ...sample, DECISIONS: "none" });
    expect(filled).toContain("If the decisions of the user are none, the prompt gives no decision of the user on this draft.");
  });

  it("says what to do when the start hash is none", () => {
    const filled = fillPlannerTemplate("issue-draft", { ...sample, START_HASH: "none" });
    expect(filled).toContain("Start hash: none");
    expect(filled).toContain(
      "If the draft changes an open issue and the start hash is none, read that issue first. Then write the draft from that read and the change. If that read fails, end, and say so in your report.",
    );
  });

  it("says what to do when the findings are none", () => {
    const filled = fillPlannerTemplate("issue-draft", { ...sample, FINDINGS: "none" });
    expect(filled).toContain("If the findings are none, the prompt gives no finding of a review.");
  });

  it("says what to do when the questions and answers are none", () => {
    const filled = fillPlannerTemplate("issue-draft", { ...sample, QUESTIONS_AND_ANSWERS: "none" });
    expect(filled).toContain("If the questions and answers are none, the prompt gives no question and no answer.");
  });

  it("names the source of each answer", () => {
    const body = plannerTemplateBody("issue-draft");
    expect(body).toContain("Each answer names its source: the words of the user, or a reason from the docs or the code.");
    expect(body).toContain("Questions and answers, each answer with its source:");
  });

  it("bans an answer from the docs or the code as a decision of the user", () => {
    expect(plannerTemplateBody("issue-draft")).toContain(
      "Never record an answer from the docs or the code as a decision of the user or as a word of the user.",
    );
  });

  it("gives the questions and answers with their source", () => {
    expect(readPromptTemplate(path).placeholders.QUESTIONS_AND_ANSWERS).toBe(
      "The questions of the draft and their answers, each answer with its source, or none.",
    );
  });

  it("holds the start hash none for a new issue", () => {
    const filled = fillPlannerTemplate("issue-draft", { ...sample, ISSUE_KEY: "none", START_HASH: "none" });
    expect(filled).toContain("Start hash: none");
    expect(filled).toContain("Issue key: none");
    expect(filled).not.toContain("{{");
  });

  it("holds each finding after a review", () => {
    const findings = "The title is too long.\nThe body has no test case.";
    const filled = fillPlannerTemplate("issue-draft", { ...sample, FINDINGS: findings });
    for (const line of findings.split("\n")) expect(filled).toContain(line);
    expect(filled).not.toContain("{{");
  });

  it("does not make the findings and the answers data", () => {
    expect(plannerTemplateBody("issue-draft")).not.toContain("The text of the source, the findings and the answers");
  });

  it("ends with the source lead and the source", () => {
    expect(plannerTemplateBody("issue-draft").trimEnd().endsWith(`${SOURCE_LEAD}\n{{SOURCE}}`)).toBe(true);
  });

  it("gives the decisions, the findings and the answers before the source lead", () => {
    const lead = plannerTemplateBody("issue-draft").indexOf(SOURCE_LEAD);
    expect(lead).toBeGreaterThan(-1);
    for (const name of ["{{DECISIONS}}", "{{FINDINGS}}", "{{QUESTIONS_AND_ANSWERS}}"]) {
      expect(plannerTemplateBody("issue-draft").indexOf(name)).toBeGreaterThan(-1);
      expect(plannerTemplateBody("issue-draft").indexOf(name)).toBeLessThan(lead);
    }
  });

  it("gives the wait command with its quotes", () => {
    const filled = fillPlannerTemplate("issue-draft", sample);
    expect(filled).toContain(PLANNER_WAIT);
    expect(filled).not.toContain("bash -c sleep 5");
  });

  it("holds each fact of a comment draft", () => {
    const source = "Recurrence of the failure.\nSender: user\nDate: 2026-11-24";
    const filled = fillPlannerTemplate("issue-draft", {
      ...sample,
      DRAFT_KIND: "a comment",
      COMMENT_KIND: "a recurrence comment",
      ISSUE_KEY: "codeguru42/tasker#968",
      SOURCE: source,
    });
    expect(filled).toContain("Kind of the draft: a comment");
    expect(filled).toContain("Repo key: codeguru42/tasker");
    expect(filled).toContain("Issue key: codeguru42/tasker#968");
    expect(filled).toContain("Kind of the comment: a recurrence comment");
    expect(filled).toContain(source);
    expect(filled).toContain(
      "If the kind of the draft is a comment, the draft file holds only the words of the comment. It has no title line and no blank line after a title.",
    );
    expect(filled).not.toContain("{{");
  });
});
