import { describe, expect, it } from "vitest";
import { packagePath } from "../../../src/package-path.js";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { familyTemplateBody, fillFamilyTemplate } from "../../helpers/prompt-templates.js";

const path = packagePath("prompt-templates/start/orchestrator-milestone.md");

const OLD_EXAMPLE = "You are orchestrator-m31. Your scope is the milestone M31 — Orchestrator. Run git branch --show-current. If it does not print main, read nothing and tell me. If git status --porcelain --untracked-files=no prints nothing and you have the Read tool, run git pull --ff-only origin main. After a pull that worked, read docs/dev/doc-reads.md with the Read tool, in pieces to the end. Then read AGENTS.md and docs/orchestrator.md as its doc-read rule says. If status printed a line, the pull failed or was denied, or you have no Read tool, run git fetch origin. Then read docs/dev/doc-reads.md, AGENTS.md and docs/orchestrator.md with git show origin/main:<path>. Read each start doc in full before any other work. Then start.";

describe("prompt-templates/start/orchestrator-milestone.md", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(path)).toEqual([]);
  });

  it("has no final newline", () => {
    expect(familyTemplateBody("start", "orchestrator-milestone").endsWith("\n")).toBe(false);
  });

  it("has a description for a load", () => {
    expect(readPromptTemplate(path).description.startsWith("Load this template when")).toBe(true);
  });

  it("has the placeholders SLUG and MILESTONE", () => {
    expect(Object.keys(readPromptTemplate(path).placeholders)).toEqual(["SLUG", "MILESTONE"]);
  });

  it("gives the old example after a fill with m31", () => {
    const filled = fillFamilyTemplate("start", "orchestrator-milestone", { SLUG: "m31", MILESTONE: "M31 — Orchestrator" });
    expect(filled).toBe(OLD_EXAMPLE);
  });

  it("holds the own name, the start reads and no {{ after a fill", () => {
    const filled = fillFamilyTemplate("start", "orchestrator-milestone", { SLUG: "m31", MILESTONE: "M31 — Orchestrator" });
    expect(filled).toContain("You are orchestrator-m31.");
    expect(filled).toContain("AGENTS.md and docs/orchestrator.md");
    expect(filled).toContain("git show origin/main:<path>");
    expect(filled).not.toContain("{{");
  });

  it("names one scope", () => {
    const body = familyTemplateBody("start", "orchestrator-milestone");
    expect(body.split("Your scope is").length - 1).toBe(1);
  });
});
