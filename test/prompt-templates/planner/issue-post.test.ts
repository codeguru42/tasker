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
  standsAfterStartBlock,
} from "../../helpers/planner-prompts.js";

const path = packagePath("prompt-templates/planner/issue-post.md");

const RULE_DOCS = "docs/dev/issue-subagents.md\ndocs/dev/issue-post.md";

const sample: Record<string, string> = {
  RULE_DOCS,
  DRAFT_FILE: "/tmp/drafts/planner-1-draft.md",
  SUBAGENT_NAME: "issue-post-1",
  REPO_KEY: "codeguru42/tasker",
  POST_KIND: "a new issue",
  MILESTONE: "M31 — Orchestrator",
  LABELS: "docs\nenhancement",
  ISSUE_KEY: "none",
  START_HASH: "none",
  LINKS: "none",
};

describe("prompt-templates/planner/issue-post.md", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(path)).toEqual([]);
  });

  it("has exactly the placeholders of the issue", () => {
    expect(Object.keys(readPromptTemplate(path).placeholders)).toEqual([
      "RULE_DOCS",
      "DRAFT_FILE",
      "SUBAGENT_NAME",
      "REPO_KEY",
      "POST_KIND",
      "MILESTONE",
      "LABELS",
      "ISSUE_KEY",
      "START_HASH",
      "LINKS",
    ]);
  });

  it("leaves no {{ after a fill and holds the result ask and the rule documents", () => {
    const filled = fillPlannerTemplate("issue-post", sample);
    expect(filled).not.toContain("{{");
    expect(filled).toContain(ISSUE_RESULT_ASK);
    for (const line of RULE_DOCS.split("\n")) expect(filled).toContain(line);
  });

  it("has no docs/ path in the body and names only the two rule documents after a fill", () => {
    expect(docPaths(plannerTemplateBody("issue-post"))).toEqual([]);
    expect(docPaths(fillPlannerTemplate("issue-post", sample))).toEqual(["docs/dev/issue-subagents.md", "docs/dev/issue-post.md"]);
  });

  it("shares no 8-word run with docs/dev/planner-subagent.md", () => {
    expect(plannerDocWordRuns(plannerTemplateBody("issue-post"))).toEqual([]);
  });

  it("says what to do when the rule documents are none", () => {
    const filled = fillPlannerTemplate("issue-post", { ...sample, RULE_DOCS: "none" });
    expect(filled).toContain(RULE_DOCS_NONE);
    expect(filled).not.toContain("the prompt names no rule document.");
  });

  it("gives the rule documents sentence after the start steps", () => {
    const filled = fillPlannerTemplate("issue-post", { ...sample, RULE_DOCS: "none" });
    expect(standsAfterStartBlock(filled, RULE_DOCS_NONE)).toBe(true);
  });

  it("says what to do when the labels are none", () => {
    const filled = fillPlannerTemplate("issue-post", { ...sample, LABELS: "none" });
    expect(filled).toContain("Labels: none");
    expect(filled).toContain("If the labels are none, the draft gives no label.");
  });

  it("says what to do when the blocked-by links are none", () => {
    const filled = fillPlannerTemplate("issue-post", { ...sample, LINKS: "none" });
    expect(filled).toContain("If the blocked-by links are none, the draft gives no blocked-by link.");
  });

  it("says what to do when the start hash is none", () => {
    const filled = fillPlannerTemplate("issue-post", { ...sample, START_HASH: "none" });
    expect(filled).toContain("Start hash: none");
    expect(filled).toContain("If the start hash is none, the prompt gives no start hash.");
  });

  it("holds the issue key for the end of the post of an existing issue", () => {
    const filled = fillPlannerTemplate("issue-post", { ...sample, POST_KIND: "the end of the post of an existing issue", ISSUE_KEY: "codeguru42/tasker#123" });
    expect(filled).toContain("Issue key: codeguru42/tasker#123");
    expect(filled).not.toContain("{{");
  });

  it("holds the milestone, each label and each link with its reason for a new issue", () => {
    const links = [
      "codeguru42/tasker#2 is blocked by codeguru42/tasker#1. Reason: it needs the new file.",
      "codeguru42/tasker#3 is blocked by codeguru42/tasker#2. Reason: it reads the new test.",
    ];
    const filled = fillPlannerTemplate("issue-post", { ...sample, MILESTONE: "M31 — Orchestrator", LABELS: "docs\nenhancement", LINKS: links.join("\n") });
    expect(filled).toContain("Milestone: M31 — Orchestrator");
    expect(filled).toContain("docs\nenhancement");
    for (const link of links) expect(filled).toContain(link);
    expect(filled).not.toContain("{{");
  });

  it("gives the wait command with its quotes", () => {
    const filled = fillPlannerTemplate("issue-post", sample);
    expect(filled).toContain(PLANNER_WAIT);
    expect(filled).not.toContain("bash -c sleep 5");
  });
});
