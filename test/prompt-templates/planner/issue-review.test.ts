import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packagePath } from "../../../src/package-path.js";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { docPaths, markdownSection } from "../../helpers/doc-text.js";
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

const path = packagePath("prompt-templates/planner/issue-review.md");

const RULE_DOCS = "docs/dev/issue-subagents.md\ndocs/dev/issue-review.md";
const BANS_FIXTURE = "The issue-review subagent keeps these bans:\n\n- Ban one.\n- Ban two.";

const sample = {
  RULE_DOCS,
  DRAFT_FILE: "/tmp/drafts/planner-1-draft.md",
  SUBAGENT_NAME: "issue-review-1",
  SOURCE: "Add a retry to the sync.\nSender: user\nDate: 2026-11-23",
  REVIEW_BANS: BANS_FIXTURE,
};

describe("prompt-templates/planner/issue-review.md", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(path)).toEqual([]);
  });

  it("has exactly the placeholders of the issue", () => {
    expect(Object.keys(readPromptTemplate(path).placeholders)).toEqual([
      "RULE_DOCS",
      "DRAFT_FILE",
      "SUBAGENT_NAME",
      "SOURCE",
      "REVIEW_BANS",
    ]);
  });

  it("leaves no {{ after a fill and holds the result ask and the rule documents", () => {
    const filled = fillPlannerTemplate("issue-review", sample);
    expect(filled).not.toContain("{{");
    expect(filled).toContain(ISSUE_RESULT_ASK);
    for (const line of RULE_DOCS.split("\n")) expect(filled).toContain(line);
  });

  it("has no docs/ path in the body", () => {
    expect(docPaths(plannerTemplateBody("issue-review"))).toEqual([]);
  });

  it("names only the two rule documents in a filled prompt, apart from the bans", () => {
    const filled = fillPlannerTemplate("issue-review", { ...sample, REVIEW_BANS: "none" });
    expect(docPaths(filled)).toEqual(["docs/dev/issue-subagents.md", "docs/dev/issue-review.md"]);
  });

  it("shares no 8-word run with docs/dev/planner-subagent.md", () => {
    expect(plannerDocWordRuns(plannerTemplateBody("issue-review"))).toEqual([]);
  });

  it("says what to do when the rule documents are none", () => {
    const filled = fillPlannerTemplate("issue-review", { ...sample, RULE_DOCS: "none" });
    expect(filled).toContain(RULE_DOCS_NONE);
    expect(filled).not.toContain("the prompt names no rule document.");
  });

  it("gives the rule documents sentence after the start steps", () => {
    const filled = fillPlannerTemplate("issue-review", { ...sample, RULE_DOCS: "none" });
    expect(standsAfterStartBlock(filled, RULE_DOCS_NONE)).toBe(true);
  });

  it("fills the bans with a fixture word for word", () => {
    const filled = fillPlannerTemplate("issue-review", sample);
    expect(filled).toContain(BANS_FIXTURE);
    expect(filled).not.toContain("{{");
  });

  it("fills the bans with the real section of docs/dev/issue-review.md", () => {
    const doc = readFileSync(packagePath("docs/dev/issue-review.md"), "utf8");
    const section = markdownSection(doc, "The bans of an issue-review subagent");
    expect(section).toBeDefined();
    expect(section?.trim()).not.toBe("");
    const filled = fillPlannerTemplate("issue-review", { ...sample, REVIEW_BANS: section ?? "" });
    expect(filled).toContain(section);
    expect(filled).not.toContain("{{");
  });

  it("does not make the bans data", () => {
    expect(plannerTemplateBody("issue-review")).not.toContain("the text of the bans");
  });

  it("ends with the source lead and the source", () => {
    expect(plannerTemplateBody("issue-review").trimEnd().endsWith(`${SOURCE_LEAD}\n{{SOURCE}}`)).toBe(true);
  });

  it("gives the bans before the source lead", () => {
    expect(plannerTemplateBody("issue-review").indexOf("Keep each ban of this list:")).toBeGreaterThan(-1);
    expect(plannerTemplateBody("issue-review").indexOf("Keep each ban of this list:")).toBeLessThan(plannerTemplateBody("issue-review").indexOf(SOURCE_LEAD));
  });

  it("gives the wait command with its quotes", () => {
    const filled = fillPlannerTemplate("issue-review", sample);
    expect(filled).toContain(PLANNER_WAIT);
    expect(filled).not.toContain("bash -c sleep 5");
  });
});
