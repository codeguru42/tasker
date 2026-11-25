import { describe, expect, it } from "vitest";
import { packagePath } from "../../../src/package-path.js";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { familyTemplateBody, fillFamilyTemplate } from "../../helpers/prompt-templates.js";

const path = packagePath("prompt-templates/start/planner-initial.md");

const OLD_TEXT = "You are the planner of M31 — Orchestrator. Run git branch --show-current. If it does not print main, read nothing and tell me. If git status --porcelain --untracked-files=no prints nothing and you have the Read tool, run git pull --ff-only origin main. After a pull that worked, read docs/dev/doc-reads.md with the Read tool, in pieces to the end. Then read AGENTS.md and docs/planner.md as its doc-read rule says. If status printed a line, the pull failed or was denied, or you have no Read tool, run git fetch origin. Then read docs/dev/doc-reads.md, AGENTS.md and docs/planner.md with git show origin/main:<path>. This is the initial planning: the user works with you in this tab. After the start reads, read the title and the description of the milestone. Then start the drafts of its issues.";

describe("prompt-templates/start/planner-initial.md", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(path)).toEqual([]);
  });

  it("has no final newline", () => {
    expect(familyTemplateBody("start", "planner-initial").endsWith("\n")).toBe(false);
  });

  it("has a description for a load", () => {
    expect(readPromptTemplate(path).description.startsWith("Load this template when")).toBe(true);
  });

  it("has the placeholder MILESTONE", () => {
    expect(Object.keys(readPromptTemplate(path).placeholders)).toEqual(["MILESTONE"]);
  });

  it("gives the old text after a fill with the milestone title", () => {
    expect(fillFamilyTemplate("start", "planner-initial", { MILESTONE: "M31 — Orchestrator" })).toBe(OLD_TEXT);
  });

  it("holds the planner line, the start reads and no {{ after a fill", () => {
    const filled = fillFamilyTemplate("start", "planner-initial", { MILESTONE: "M31 — Orchestrator" });
    expect(filled).toContain("You are the planner of M31 — Orchestrator.");
    expect(filled).toContain("AGENTS.md and docs/planner.md");
    expect(filled).not.toContain("{{");
  });
});
