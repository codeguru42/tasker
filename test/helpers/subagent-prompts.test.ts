import { describe, expect, it } from "vitest";
import { fillSubagentTemplate, subagentTemplateBody, subagentTemplatePath } from "./subagent-prompts.js";

describe("subagentTemplatePath", () => {
  it("gives the path of the template file", () => {
    expect(subagentTemplatePath("task")).toMatch(/prompt-templates\/subagents\/task\.md$/);
  });
});

describe("subagentTemplateBody", () => {
  it("gives the body of the template file", () => {
    expect(subagentTemplateBody("task-restart")).toContain("{{TASK_STATE}}");
  });
});

describe("fillSubagentTemplate", () => {
  it("fills each placeholder with its value", () => {
    const sample = {
      ISSUE_KEY: "codeguru42/tasker#108",
      SESSION_NAME: "codeguru42-tasker-108-2",
      TASK_STATE: "state-of-the-task",
      WORKTREE_PATH: "../tasker-worktrees/codeguru42-tasker-108-2",
    };
    const filled = fillSubagentTemplate("task-restart", sample);
    expect(filled).toContain("state-of-the-task");
    expect(filled).not.toContain("{{");
  });
});
