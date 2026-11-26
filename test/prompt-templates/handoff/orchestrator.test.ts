import { describe, expect, it } from "vitest";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { handoffPromptRead, orchestratorDocWordRuns, promptWordCount } from "../../helpers/orchestrator-prompts.js";
import { familyTemplateBody, familyTemplatePath, fillFamilyTemplate } from "../../helpers/prompt-templates.js";

const path = familyTemplatePath("handoff", "orchestrator");
const body = (): string => familyTemplateBody("handoff", "orchestrator");

const VALUES = {
  SCOPE: "the milestone M31 — Orchestrator",
  HANDOFF_PATH: "/home/u/.local/share/tasker/handoff/2026-11-25-1200-m31-orchestrator.md",
  SESSION_NAME: "orchestrator-m31",
  FIRST_FREE_ITEM_ID: "42",
  EXTRA_DOCS: "",
  OPEN_ISSUES: "",
};

function joinPrompt(filled: string): string {
  return filled
    .split("\n")
    .filter((line) => line !== "")
    .join(" ");
}

describe("prompt-templates/handoff/orchestrator.md", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(path)).toEqual([]);
  });

  it("has a description for a load", () => {
    expect(readPromptTemplate(path).description.startsWith("Load this template when")).toBe(true);
  });

  it("has the placeholders in order", () => {
    expect(Object.keys(readPromptTemplate(path).placeholders)).toEqual([
      "SCOPE",
      "HANDOFF_PATH",
      "SESSION_NAME",
      "FIRST_FREE_ITEM_ID",
      "EXTRA_DOCS",
      "OPEN_ISSUES",
    ]);
  });

  it("fills with no {{ left", () => {
    expect(fillFamilyTemplate("handoff", "orchestrator", VALUES)).not.toContain("{{");
  });

  it("has at most 150 words besides the prompt read", () => {
    expect(promptWordCount(body())).toBeLessThanOrEqual(150);
  });

  it("shares no 8-word run with the docs", () => {
    expect(orchestratorDocWordRuns(body())).toEqual([]);
  });

  it("names no operator", () => {
    expect(body().toLowerCase()).not.toContain("operator");
  });

  it("starts with the prompt read", () => {
    expect(body().split("\n")[0]).toBe(handoffPromptRead("docs/orchestrator.md"));
  });

  it("names the start section and the folder check", () => {
    expect(body()).toContain("The start of the new orchestrator");
    expect(body()).toContain("The check of the handoff folder");
  });

  it("holds each optional value alone on a line", () => {
    const lines = body().split("\n");
    expect(lines).toContain("{{OPEN_ISSUES}}");
    expect(lines).toContain("{{EXTRA_DOCS}}");
  });

  it("joins a milestone fill with no empty value", () => {
    const joined = joinPrompt(fillFamilyTemplate("handoff", "orchestrator", VALUES));
    expect(joined).toContain(handoffPromptRead("docs/orchestrator.md"));
    expect(joined).toContain(VALUES.HANDOFF_PATH);
    expect(joined).toContain(VALUES.SESSION_NAME);
    expect(joined).toContain("42");
    expect(joined).toContain("The start of the new orchestrator");
    expect(joined).toContain("The check of the handoff folder");
    expect(joined).not.toContain("{{");
    expect(joined).not.toContain("\n");
    expect(joined).not.toContain("  ");
    expect(joined).not.toContain("Open issues:");
    expect(joined).not.toContain("Extra docs:");
    expect(joined).toBe(joined.trim());
  });

  it("joins a set fill with the open issues", () => {
    const keys = "codeguru42/tasker#1, codeguru42/tasker#2 and codeguru42/tasker#3";
    const joined = joinPrompt(
      fillFamilyTemplate("handoff", "orchestrator", {
        ...VALUES,
        SCOPE: "a set of issues",
        OPEN_ISSUES: `Open issues: ${keys}.`,
      }),
    );
    expect(joined).toContain(keys);
    expect(joined).not.toContain("  ");
  });

  it("holds the extra docs after a fill", () => {
    const joined = joinPrompt(
      fillFamilyTemplate("handoff", "orchestrator", { ...VALUES, EXTRA_DOCS: "Extra docs: docs/dev/release.md." }),
    );
    expect(joined).toContain("Extra docs: docs/dev/release.md.");
  });

  it("holds no name step", () => {
    expect(body()).not.toMatch(/read (your|its) own name/i);
    expect(body()).not.toContain("PI_SESSION_FILE");
    expect(body()).not.toContain("ListAgents");
  });
});
