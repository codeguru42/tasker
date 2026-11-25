import { describe, expect, it } from "vitest";
import { packagePath } from "../../../src/package-path.js";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { familyTemplateBody, fillFamilyTemplate } from "../../helpers/prompt-templates.js";

const path = packagePath("prompt-templates/start/orchestrator-set.md");

const KEYS = "codeguru42/tasker#756, codeguru42/tasker#522 and codeguru42/tasker#748";
const OLD_TEXT = "You are orchestrator-docs-fix. Your scope is the issues codeguru42/tasker#756, codeguru42/tasker#522 and codeguru42/tasker#748. Run git branch --show-current. If it does not print main, read nothing and tell me. If git status --porcelain --untracked-files=no prints nothing and you have the Read tool, run git pull --ff-only origin main. After a pull that worked, read docs/dev/doc-reads.md with the Read tool, in pieces to the end. Then read AGENTS.md and docs/orchestrator.md as its doc-read rule says. If status printed a line, the pull failed or was denied, or you have no Read tool, run git fetch origin. Then read docs/dev/doc-reads.md, AGENTS.md and docs/orchestrator.md with git show origin/main:<path>. Read each start doc in full before any other work. Then start.";

describe("prompt-templates/start/orchestrator-set.md", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(path)).toEqual([]);
  });

  it("has no final newline", () => {
    expect(familyTemplateBody("start", "orchestrator-set").endsWith("\n")).toBe(false);
  });

  it("has a description for a load", () => {
    expect(readPromptTemplate(path).description.startsWith("Load this template when")).toBe(true);
  });

  it("has the placeholders SLUG and ISSUE_KEYS", () => {
    expect(Object.keys(readPromptTemplate(path).placeholders)).toEqual(["SLUG", "ISSUE_KEYS"]);
  });

  it("gives the old text after a fill with three keys", () => {
    const filled = fillFamilyTemplate("start", "orchestrator-set", { SLUG: "docs-fix", ISSUE_KEYS: KEYS });
    expect(filled).toBe(OLD_TEXT);
  });

  it("holds the own name, the scope, the start reads and no {{ after a fill", () => {
    const filled = fillFamilyTemplate("start", "orchestrator-set", { SLUG: "docs-fix", ISSUE_KEYS: KEYS });
    expect(filled).toContain("You are orchestrator-docs-fix.");
    expect(filled).toContain(`Your scope is the issues ${KEYS}.`);
    expect(filled).toContain("AGENTS.md and docs/orchestrator.md");
    expect(filled).toContain("git show origin/main:<path>");
    expect(filled).not.toContain("{{");
  });

  it("names one scope", () => {
    const body = familyTemplateBody("start", "orchestrator-set");
    expect(body.split("Your scope is").length - 1).toBe(1);
  });
});
