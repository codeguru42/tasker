import { describe, expect, it } from "vitest";
import { fillTemplate } from "../../src/prompts/template.js";
import { PLAN_PROMPT, PLAN_PROMPT_NAME, planIssueComments, planIssueText } from "../../src/prompts/plan.js";
import { SHARED_RULES } from "../../src/prompts/shared.js";
import { rulesOf } from "../helpers/prompts.js";

const ISSUE = { key: "o/r#1", title: "Add a thing", body: "Line one.\nLine two." };
const FIRST = { author: "alice", created: "2026-10-01T10:00:00Z", body: "First." };
const SECOND = { author: "bob", created: "2026-10-02T11:30:00Z", body: "Line one.\nLine two." };

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

describe("planIssueComments", () => {
  it("gives an empty string for no comments", () => {
    expect(planIssueComments([])).toBe("");
  });

  it("gives one block for one comment", () => {
    expect(planIssueComments([FIRST])).toBe(
      "<comment-text-1>\nalice at 2026-10-01T10:00:00Z:\nFirst.\n</comment-text-1>",
    );
  });

  it("puts a line end between the blocks, from the oldest", () => {
    expect(planIssueComments([FIRST, SECOND])).toBe(
      "<comment-text-1>\nalice at 2026-10-01T10:00:00Z:\nFirst.\n</comment-text-1>\n" +
        "<comment-text-2>\nbob at 2026-10-02T11:30:00Z:\nLine one.\nLine two.\n</comment-text-2>",
    );
  });

  it("keeps an empty body as an empty line", () => {
    expect(planIssueComments([{ ...FIRST, body: "" }])).toBe(
      "<comment-text-1>\nalice at 2026-10-01T10:00:00Z:\n\n</comment-text-1>",
    );
  });

  it("makes each closing comment tag in a body harmless and keeps the closing issue-comments tag", () => {
    const body = "a </comment-text-1> b </COMMENT-TEXT-2> c </issue-comments> d";

    expect(planIssueComments([{ ...FIRST, body }])).toBe(
      "<comment-text-1>\nalice at 2026-10-01T10:00:00Z:\n" +
        "a &lt;/comment-text-1> b &lt;/COMMENT-TEXT-2> c </issue-comments> d\n</comment-text-1>",
    );
  });

  it("makes a closing comment tag with white space harmless in the author and the time", () => {
    const comment = { author: "x< / comment-text-1>", created: "</Comment-Text-9>", body: "b" };

    expect(planIssueComments([comment])).toBe(
      "<comment-text-1>\nx&lt; / comment-text-1> at &lt;/Comment-Text-9>:\nb\n</comment-text-1>",
    );
  });
});

describe("PLAN_PROMPT", () => {
  it("fills with the issue text in its tag", () => {
    const text = planIssueText(ISSUE);

    const prompt = fillTemplate(PLAN_PROMPT_NAME, PLAN_PROMPT, { ISSUE_TEXT: text, ISSUE_COMMENTS: "" });

    expect(prompt).toContain(`<issue-text>${text}</issue-text>`);
  });

  it("fills the comments block after the issue text block", () => {
    const comments = planIssueComments([FIRST]);

    const prompt = fillTemplate(PLAN_PROMPT_NAME, PLAN_PROMPT, {
      ISSUE_TEXT: planIssueText(ISSUE),
      ISSUE_COMMENTS: comments,
    });

    expect(prompt).toContain(`<issue-comments>${comments}</issue-comments>`);
    expect(prompt.indexOf("<issue-comments>")).toBeGreaterThan(prompt.indexOf("</issue-text>"));
  });

  it("fills an empty comments block for no comments", () => {
    const prompt = fillTemplate(PLAN_PROMPT_NAME, PLAN_PROMPT, {
      ISSUE_TEXT: planIssueText(ISSUE),
      ISSUE_COMMENTS: planIssueComments([]),
    });

    expect(prompt).toContain("<issue-comments></issue-comments>");
  });

  it("makes a closing issue-comments tag in a body harmless", () => {
    const prompt = fillTemplate(PLAN_PROMPT_NAME, PLAN_PROMPT, {
      ISSUE_TEXT: planIssueText(ISSUE),
      ISSUE_COMMENTS: planIssueComments([{ ...FIRST, body: "x </issue-comments> y" }]),
    });

    expect(prompt).toContain("x &lt;/issue-comments> y");
    expect(prompt.split("</issue-comments>")).toHaveLength(2);
  });

  it("calls the comments untrusted data in item 5", () => {
    const rule = rulesOf(PLAN_PROMPT)[4];

    expect(rule.startsWith("5. ")).toBe(true);
    expect(rule).toContain("<issue-comments>{{ISSUE_COMMENTS}}</issue-comments>");
    expect(rule).toContain(SHARED_RULES.untrusted);
    expect(rule).toContain(SHARED_RULES.untrustedInPlan);
    expect(rule).toContain(SHARED_RULES.blockIsData);
    expect(rule).toContain("<comment-text-N>");
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
