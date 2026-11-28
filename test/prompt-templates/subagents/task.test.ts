import { describe, expect, it } from "vitest";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { fillSubagentTemplate, subagentTemplateBody, subagentTemplatePath } from "../../helpers/subagent-prompts.js";

const ONE_WRITE =
  'The comment of step 11 of "Run one ticket" is your only write on GitHub issues, labels and the project board.';
const DENIAL = "After a denial, your report gives the exact command and the exact text of the denial, in full.";

const sample: Record<string, string> = {
  ISSUE_KEY: "codeguru42/tasker#108",
  MILESTONE: "M31",
  OFF_LIMITS: "none",
  LANDING_ORDER: "codeguru42/tasker#108",
  PARENT: "none",
  QUOTA_SLOT: "slot-1",
  QUOTA_JOB: "no",
  SESSION_NAME: "codeguru42-tasker-108",
  AGENT_FOLDER: "/tmp/agent-108",
  COMMENT_LINKS: "none",
  TICKET_DOCS: "none",
  HINTS: "none",
};

function fill(values: Record<string, string> = {}): string {
  return fillSubagentTemplate("task", { ...sample, ...values });
}

describe("prompt template subagents/task", () => {
  it("is a valid prompt template", () => {
    expect(checkPromptTemplate(subagentTemplatePath("task"))).toEqual([]);
  });

  it("has exactly the placeholders of the issue", () => {
    expect(Object.keys(readPromptTemplate(subagentTemplatePath("task")).placeholders)).toEqual([
      "ISSUE_KEY",
      "MILESTONE",
      "OFF_LIMITS",
      "LANDING_ORDER",
      "PARENT",
      "QUOTA_SLOT",
      "QUOTA_JOB",
      "SESSION_NAME",
      "AGENT_FOLDER",
      "COMMENT_LINKS",
      "TICKET_DOCS",
      "HINTS",
    ]);
  });

  it("fills with fillTemplate with no throw, so no placeholder name collides with an untrusted name", () => {
    expect(() => fill()).not.toThrow();
  });

  it("leaves no {{ after a fill and holds the issue key", () => {
    const filled = fill();
    expect(filled).not.toContain("{{");
    expect(filled).toContain("codeguru42/tasker#108");
  });

  it("names each path of the base list", () => {
    const filled = fill();
    for (const path of [
      "AGENTS.md",
      "docs/orchestrator.md",
      "docs/sessions.md",
      "docs/dev/GLOSSARY.md",
      "docs/dev/rules.md",
      "docs/dev/first-refine.md",
      "docs/dev/rebase-conflicts.md",
      "docs/dev/working-with-the-user.md",
      '"The pages"',
      "docs/dev/handoff.md",
      "docs/dev/orchestrator/handoff-orchestrator.md",
    ]) {
      expect(filled).toContain(path);
    }
  });

  it("gives the plain-form merge with the three bans", () => {
    const filled = fill();
    expect(filled).toContain("tasker merge codeguru42/tasker#108");
    expect(filled).toContain("Use no `cd`, no pipe and no `2>&1`.");
  });

  it("asks for the exact command and the full denial", () => {
    expect(fill()).toContain(DENIAL);
  });

  it("states the one write on GitHub", () => {
    expect(fill()).toContain(ONE_WRITE);
  });

  it("gives the worktree path form and no instruction to read the worktree: line", () => {
    expect(fill()).toContain("../tasker-worktrees/codeguru42-tasker-108");
    const lines = subagentTemplateBody("task")
      .split("\n")
      .filter((line) => line.includes("worktree:"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.startsWith("Never")).toBe(true);
  });

  it("states that a ticket with parent none is not stacked", () => {
    const filled = fill({ PARENT: "none" });
    expect(filled).toContain("Parent of this stacked ticket: none");
    expect(filled).toContain("If the parent is none, this ticket has no parent and is not stacked.");
  });

  it("holds the parent of a stacked ticket", () => {
    const filled = fill({ PARENT: "codeguru42/tasker#107" });
    expect(filled).toContain("Parent of this stacked ticket: codeguru42/tasker#107");
    expect(filled).not.toContain("{{");
  });

  it("does not mention the comments when the links are none", () => {
    const filled = fill({ COMMENT_LINKS: "none" });
    expect(filled).toContain(ONE_WRITE);
    expect(filled.replace(ONE_WRITE, "")).not.toMatch(/comment/i);
    expect(filled).not.toMatch(/change of scope/i);
    expect(filled).not.toMatch(/design gap/i);
  });

  it("holds each comment link", () => {
    const links = "https://github.com/codeguru42/tasker/issues/108#issuecomment-1\nhttps://github.com/codeguru42/tasker/issues/108#issuecomment-2";
    const filled = fill({ COMMENT_LINKS: links });
    for (const link of links.split("\n")) expect(filled).toContain(link);
  });
});
