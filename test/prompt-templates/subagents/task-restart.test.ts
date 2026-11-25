import { describe, expect, it } from "vitest";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { fillSubagentTemplate, subagentTemplateBody, subagentTemplatePath } from "../../helpers/subagent-prompts.js";

const sample: Record<string, string> = {
  ISSUE_KEY: "codeguru42/tasker#108",
  SESSION_NAME: "codeguru42-tasker-108-2",
  TASK_STATE: "state: executing",
  WORKTREE_PATH: "../tasker-worktrees/codeguru42-tasker-108-2",
};

function fill(): string {
  return fillSubagentTemplate("task-restart", sample);
}

describe("prompt template subagents/task-restart", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(subagentTemplatePath("task-restart"))).toEqual([]);
  });

  it("has exactly the placeholders of the issue", () => {
    expect(Object.keys(readPromptTemplate(subagentTemplatePath("task-restart")).placeholders)).toEqual([
      "ISSUE_KEY",
      "SESSION_NAME",
      "TASK_STATE",
      "WORKTREE_PATH",
    ]);
  });

  it("fills with fillTemplate with no throw, so no placeholder name collides with an untrusted name", () => {
    expect(() => fill()).not.toThrow();
  });

  it("holds the suffix and the state after a fill", () => {
    const filled = fill();
    expect(filled).not.toContain("{{");
    expect(filled).toContain("codeguru42-tasker-108-2");
    expect(filled).toContain("state: executing");
    expect(filled).toContain("../tasker-worktrees/codeguru42-tasker-108-2");
  });

  it("says that it is a second session and names the suffix", () => {
    const body = subagentTemplateBody("task-restart");
    expect(body).toContain("You are a second session for the ticket");
    expect(body).toContain("has a suffix");
  });
});
