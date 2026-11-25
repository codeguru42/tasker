import { describe, expect, it } from "vitest";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { fillSubagentTemplate, subagentTemplateBody, subagentTemplatePath } from "../../helpers/subagent-prompts.js";

const sample: Record<string, string> = {
  ISSUE_KEY: "codeguru42/tasker#108",
  COMMAND: "tasker refine codeguru42/tasker#108",
  USER_WORDS: "Please refine the ticket again.",
  QUOTA_SLOT: "slot-1",
  SESSION_NAME: "codeguru42-tasker-108-2",
};

function fill(): string {
  return fillSubagentTemplate("task-command", sample);
}

describe("prompt template subagents/task-command", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(subagentTemplatePath("task-command"))).toEqual([]);
  });

  it("has exactly the placeholders of the issue and the session name", () => {
    expect(Object.keys(readPromptTemplate(subagentTemplatePath("task-command")).placeholders)).toEqual([
      "ISSUE_KEY",
      "COMMAND",
      "USER_WORDS",
      "QUOTA_SLOT",
      "SESSION_NAME",
    ]);
  });

  it("fills with fillTemplate with no throw, so no placeholder name collides with an untrusted name", () => {
    expect(() => fill()).not.toThrow();
  });

  it("leaves no {{ after a fill and holds the command, the words of the user, the slot and the session name", () => {
    const filled = fill();
    expect(filled).not.toContain("{{");
    for (const value of Object.values(sample)) expect(filled).toContain(value);
  });

  it("runs only its command and then gives its final report", () => {
    const body = subagentTemplateBody("task-command");
    expect(body).toContain("Run only this command, in the plain form, and then give your final report:");
    expect(body).toContain('Run no step of "Run one ticket".');
  });

  it("points to the base list in task.md", () => {
    expect(subagentTemplateBody("task-command")).toContain("prompt-templates/subagents/task.md");
  });
});
