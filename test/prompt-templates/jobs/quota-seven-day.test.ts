import { describe, expect, it } from "vitest";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { orchestratorDocWordRuns, promptWordCount } from "../../helpers/orchestrator-prompts.js";
import { familyTemplateBody, familyTemplatePath, fillFamilyTemplate } from "../../helpers/prompt-templates.js";

const path = familyTemplatePath("jobs", "quota-seven-day");
const body = (): string => familyTemplateBody("jobs", "quota-seven-day");
const fill = (): string =>
  fillFamilyTemplate("jobs", "quota-seven-day", { ISSUE: "codeguru42/tasker#1000", TASK_SUBAGENT: "task-1000" });

describe("prompt-templates/jobs/quota-seven-day.md", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(path)).toEqual([]);
  });

  it("has a description for a load", () => {
    expect(readPromptTemplate(path).description.startsWith("Load this template when")).toBe(true);
  });

  it("has the placeholders ISSUE and TASK_SUBAGENT", () => {
    expect(Object.keys(readPromptTemplate(path).placeholders)).toEqual(["ISSUE", "TASK_SUBAGENT"]);
  });

  it("fills with no {{ left and holds both values", () => {
    const filled = fill();
    expect(filled).not.toContain("{{");
    expect(filled).toContain("codeguru42/tasker#1000");
    expect(filled).toContain("task-1000");
    expect(filled).toContain("When the job fires");
    expect(filled).toContain("seven_day");
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
