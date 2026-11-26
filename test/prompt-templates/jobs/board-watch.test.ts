import { describe, expect, it } from "vitest";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { orchestratorDocWordRuns, promptWordCount } from "../../helpers/orchestrator-prompts.js";
import { familyTemplateBody, familyTemplatePath, fillFamilyTemplate } from "../../helpers/prompt-templates.js";

const path = familyTemplatePath("jobs", "board-watch");
const body = (): string => familyTemplateBody("jobs", "board-watch");

describe("prompt-templates/jobs/board-watch.md", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(path)).toEqual([]);
  });

  it("has a description for a load", () => {
    expect(readPromptTemplate(path).description.startsWith("Load this template when")).toBe(true);
  });

  it("has no placeholder", () => {
    expect(Object.keys(readPromptTemplate(path).placeholders)).toEqual([]);
  });

  it("starts with Board watch: and names Pick the tickets", () => {
    expect(body().startsWith("Board watch:")).toBe(true);
    expect(body()).toContain("Pick the tickets");
    expect(fillFamilyTemplate("jobs", "board-watch", {})).toBe(body());
  });

  it("fills with no {{ left", () => {
    expect(fillFamilyTemplate("jobs", "board-watch", {})).not.toContain("{{");
  });

  it("has at most 150 words", () => {
    expect(promptWordCount(body())).toBeLessThanOrEqual(150);
  });

  it("shares no 8-word run with the docs", () => {
    expect(orchestratorDocWordRuns(body())).toEqual([]);
  });

  it("names no operator", () => {
    expect(body().toLowerCase()).not.toContain("operator");
  });
});
