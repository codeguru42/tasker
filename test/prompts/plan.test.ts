import { describe, expect, it } from "vitest";
import { fillTemplate } from "../../src/prompts/template.js";
import { PLAN_PROMPT, PLAN_PROMPT_NAME, planIssueText } from "../../src/prompts/plan.js";
import { SHARED_RULES } from "../../src/prompts/shared.js";

const ISSUE = { key: "o/r#1", title: "Add a thing", body: "Line one.\nLine two." };

describe("PLAN_PROMPT_NAME", () => {
  it("is plan", () => {
    expect(PLAN_PROMPT_NAME).toBe("plan");
  });
});

describe("planIssueText", () => {
  it("gives the key, the title and the description on four lines", () => {
    expect(planIssueText({ ...ISSUE, body: "Body" })).toBe("Key: o/r#1\nTitle: Add a thing\nDescription:\nBody");
  });
});

describe("PLAN_PROMPT", () => {
  it("fills with the issue text in its tag", () => {
    const text = planIssueText(ISSUE);

    const prompt = fillTemplate(PLAN_PROMPT_NAME, PLAN_PROMPT, { ISSUE_TEXT: text });

    expect(prompt).toContain(`<issue-text>${text}</issue-text>`);
  });

  it("calls each text in the issue block data and names no escape form", () => {
    expect(PLAN_PROMPT).toContain("looks like a tag");
    expect(PLAN_PROMPT).not.toContain("&lt;");
  });

  it.each([
    "simple-english",
    "writing-plans",
    "test-driven-development",
    "brainstorming",
    "## Documentation",
    "summary",
    "plan_markdown",
    "files_changed",
    "todos",
    "questions",
  ])("names %s", (name) => {
    expect(PLAN_PROMPT).toContain(name);
  });

  it.each(Object.entries(SHARED_RULES))("holds the shared rule %s", (_name, text) => {
    expect(PLAN_PROMPT).toContain(text);
  });
});
