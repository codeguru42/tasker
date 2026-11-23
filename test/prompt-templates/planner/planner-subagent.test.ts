import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packagePath } from "../../../src/package-path.js";
import { fillTemplate } from "../../../src/prompts/template.js";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { docPaths, sharedWordRuns } from "../../helpers/doc-text.js";

const path = packagePath("prompt-templates/planner/planner-subagent.md");

const RESULT_ASK = "Return your result to the orchestrator with the tool SubagentHandback.";
const DOCS_TO_READ = "docs/dev/planner-subagent.md\ndocs/dev/planner.md\ndocs/dev/issues.md";
const ENTRY = '{ "model": "claude-opus-5-5", "effort": "high" }';
const ENTRY_SENTENCE =
  "If an entry is none, the key has no entry. Then pass no model and no effort when you start a subagent of that kind.";

const sample: Record<string, string> = {
  REQUEST: "Plan the retry of the sync.\nSecond line of the request.",
  SENDER: "user",
  DATE: "2026-11-23",
  SOURCES: "The retry comes from the issue text.",
  OWN_NAME: "orchestrator-1",
  SCOPE: "milestone M31",
  DRAFT_FOLDER: "/tmp/drafts",
  SUBAGENT_NAME: "planner-1",
  DOCS_TO_READ,
  MODEL_ISSUE_DRAFT: ENTRY,
  MODEL_ISSUE_REVIEW: "none",
  MODEL_ISSUE_POST: "none",
};

function body(): string {
  return readPromptTemplate(path).body;
}

function fill(values: Record<string, string>): string {
  return fillTemplate("planner/planner-subagent", body(), { ...sample, ...values });
}

describe("prompt-templates/planner/planner-subagent.md", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(path)).toEqual([]);
  });

  it("has exactly the placeholders of the issue", () => {
    expect(Object.keys(readPromptTemplate(path).placeholders)).toEqual([
      "REQUEST",
      "SENDER",
      "DATE",
      "SOURCES",
      "OWN_NAME",
      "SCOPE",
      "DRAFT_FOLDER",
      "SUBAGENT_NAME",
      "DOCS_TO_READ",
      "MODEL_ISSUE_DRAFT",
      "MODEL_ISSUE_REVIEW",
      "MODEL_ISSUE_POST",
    ]);
  });

  it("leaves no {{ after a fill and holds the result ask and the docs to read", () => {
    const filled = fill({});
    expect(filled).not.toContain("{{");
    expect(filled).toContain(RESULT_ASK);
    for (const line of DOCS_TO_READ.split("\n")) expect(filled).toContain(line);
  });

  it("has no docs/ path in the body and names only the docs to read after a fill", () => {
    expect(docPaths(body())).toEqual([]);
    expect(docPaths(fill({}))).toEqual(DOCS_TO_READ.split("\n"));
  });

  it("shares no 8-word run with docs/dev/planner-subagent.md", () => {
    const doc = readFileSync(packagePath("docs/dev/planner-subagent.md"), "utf8");
    expect(sharedWordRuns(body(), doc)).toEqual([]);
  });

  it("says what to do when the docs to read are none", () => {
    const filled = fill({ DOCS_TO_READ: "none" });
    expect(filled).toContain("If the docs to read are none, the prompt names no doc to read.");
  });

  it("holds one entry as the read gave it and none for the two other keys", () => {
    const filled = fill({});
    expect(filled).toContain(`Entry of sessions.models.issue-draft: ${ENTRY}`);
    expect(filled).toContain("Entry of sessions.models.issue-review: none");
    expect(filled).toContain("Entry of sessions.models.issue-post: none");
    expect(filled).not.toContain("{{");
  });

  it.each([
    ["issue-draft", "MODEL_ISSUE_DRAFT"],
    ["issue-review", "MODEL_ISSUE_REVIEW"],
    ["issue-post", "MODEL_ISSUE_POST"],
  ])("says what to do when the entry of %s is none", (kind, placeholder) => {
    const filled = fill({ [placeholder]: "none" });
    expect(filled).toContain(`Entry of sessions.models.${kind}: none`);
    expect(filled).toContain(ENTRY_SENTENCE);
  });

  it("holds the request with its sender, its date and its sources", () => {
    const filled = fill({});
    expect(filled).toContain(sample.REQUEST);
    expect(filled).toContain(sample.SENDER);
    expect(filled).toContain(sample.DATE);
    expect(filled).toContain(sample.SOURCES);
  });
});
