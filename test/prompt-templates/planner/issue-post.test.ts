import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packagePath } from "../../../src/package-path.js";
import { fillTemplate } from "../../../src/prompts/template.js";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { docPaths, sharedWordRuns } from "../../helpers/doc-text.js";

const path = packagePath("prompt-templates/planner/issue-post.md");

const RESULT_ASK = "Return your result to the session that started you with the tool SubagentHandback.";
const RULE_DOCS = "docs/dev/issue-subagents.md\ndocs/dev/issue-post.md";
const WAIT = "timeout 20 bash -c 'sleep 5'";

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

function body(): string {
  return readPromptTemplate(path).body;
}

function fill(values: Record<string, string>): string {
  return fillTemplate("planner/issue-post", body(), { ...sample, ...values });
}

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
    const filled = fill({});
    expect(filled).not.toContain("{{");
    expect(filled).toContain(RESULT_ASK);
    for (const line of RULE_DOCS.split("\n")) expect(filled).toContain(line);
  });

  it("has no docs/ path in the body and names only the two rule documents after a fill", () => {
    expect(docPaths(body())).toEqual([]);
    expect(docPaths(fill({}))).toEqual(["docs/dev/issue-subagents.md", "docs/dev/issue-post.md"]);
  });

  it("shares no 8-word run with docs/dev/planner-subagent.md", () => {
    const doc = readFileSync(packagePath("docs/dev/planner-subagent.md"), "utf8");
    expect(sharedWordRuns(body(), doc)).toEqual([]);
  });

  it("says what to do when the rule documents are none", () => {
    const filled = fill({ RULE_DOCS: "none" });
    expect(filled).toContain("If the rule documents are none, the prompt names no rule document.");
  });

  it("says what to do when the labels are none", () => {
    const filled = fill({ LABELS: "none" });
    expect(filled).toContain("Labels: none");
    expect(filled).toContain("If the labels are none, the draft gives no label.");
  });

  it("says what to do when the blocked-by links are none", () => {
    const filled = fill({ LINKS: "none" });
    expect(filled).toContain("If the blocked-by links are none, the draft gives no blocked-by link.");
  });

  it("says what to do when the start hash is none", () => {
    const filled = fill({ START_HASH: "none" });
    expect(filled).toContain("Start hash: none");
    expect(filled).toContain("If the start hash is none, the prompt gives no start hash.");
  });

  it("holds the issue key for the end of the post of an existing issue", () => {
    const filled = fill({ POST_KIND: "the end of the post of an existing issue", ISSUE_KEY: "codeguru42/tasker#123" });
    expect(filled).toContain("Issue key: codeguru42/tasker#123");
    expect(filled).not.toContain("{{");
  });

  it("holds the milestone, each label and each link with its reason for a new issue", () => {
    const links = [
      "codeguru42/tasker#2 is blocked by codeguru42/tasker#1. Reason: it needs the new file.",
      "codeguru42/tasker#3 is blocked by codeguru42/tasker#2. Reason: it reads the new test.",
    ];
    const filled = fill({ MILESTONE: "M31 — Orchestrator", LABELS: "docs\nenhancement", LINKS: links.join("\n") });
    expect(filled).toContain("Milestone: M31 — Orchestrator");
    expect(filled).toContain("docs\nenhancement");
    for (const link of links) expect(filled).toContain(link);
    expect(filled).not.toContain("{{");
  });

  it("gives the wait command with its quotes", () => {
    const filled = fill({});
    expect(filled).toContain(WAIT);
    expect(filled).not.toContain("bash -c sleep 5");
  });
});
