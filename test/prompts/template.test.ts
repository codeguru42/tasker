import { describe, expect, it } from "vitest";
import { fillTemplate } from "../../src/prompts/template.js";

function fill(template: string, values: Record<string, string>): string {
  return fillTemplate("t", template, values);
}

const TAGGED = "<issue-text>{{ISSUE_TEXT}}</issue-text>";
const NEEDS_TAG = "prompt t must put {{ISSUE_TEXT}} in <issue-text>...</issue-text>";

describe("fillTemplate", () => {
  it("fills two tokens", () => {
    expect(fill("Hello {{A}} and {{B_2}}.", { A: "x", B_2: "y" })).toBe("Hello x and y.");
  });

  it("fills a token that appears twice", () => {
    expect(fill("{{A}}-{{A}}", { A: "x" })).toBe("x-x");
  });

  it("throws when a token has no value", () => {
    expect(() => fill("{{A}} {{B}}", { B: "y" })).toThrow("prompt t needs a value for {{A}}");
  });

  it("throws when a value has no token", () => {
    expect(() => fill("{{A}}", { A: "x", B: "y" })).toThrow("prompt t has no {{B}} to fill");
  });

  it("throws when ISSUE_TEXT stands in no tag", () => {
    expect(() => fill("Text: {{ISSUE_TEXT}}", { ISSUE_TEXT: "x" })).toThrow(NEEDS_TAG);
  });

  it("throws when ISSUE_TEXT stands in the wrong tag", () => {
    expect(() => fill("<other>{{ISSUE_TEXT}}</other>", { ISSUE_TEXT: "x" })).toThrow(NEEDS_TAG);
  });

  it("throws when a bare copy of ISSUE_TEXT follows a tagged copy", () => {
    expect(() => fill(`${TAGGED}\n{{ISSUE_TEXT}}`, { ISSUE_TEXT: "x" })).toThrow(NEEDS_TAG);
  });

  it("fills ISSUE_TEXT inside its tag", () => {
    expect(fill(TAGGED, { ISSUE_TEXT: "hello" })).toBe("<issue-text>hello</issue-text>");
  });

  it.each([
    ["</issue-text>", "&lt;/issue-text>"],
    ["< / ISSUE-TEXT >", "&lt; / ISSUE-TEXT >"],
    ["</Issue-Text >", "&lt;/Issue-Text >"],
    ["</issue-text\n>", "&lt;/issue-text\n>"],
    ['</issue-text x="1">', '&lt;/issue-text x="1">'],
    ["</issue-text", "&lt;/issue-text"],
  ])("escapes the closing tag %j in an untrusted value", (value, escaped) => {
    expect(fill(TAGGED, { ISSUE_TEXT: `a ${value} b` })).toBe(`<issue-text>a ${escaped} b</issue-text>`);
  });

  describe.each([
    ["ISSUE_COMMENTS", "issue-comments"],
    ["CURRENT_PLAN", "current-plan"],
    ["BRANCH_COMMITS", "branch-commits"],
    ["EARLIER_REVIEWS", "earlier-reviews"],
    ["CONTEXT", "context"],
    ["FEEDBACK", "feedback"],
    ["OPEN_QUESTIONS", "open-questions"],
    ["PLAN_MARKDOWN", "approved-plan"],
    ["TODOS", "todos"],
    ["RESOLVED_QUESTIONS", "resolved-questions"],
    ["CURRENT_TODO", "current-todo"],
    ["VERIFY_FAILURE", "verify-failure"],
    ["VERIFY_LOG", "verify-log"],
  ])("%s", (token, tag) => {
    it(`escapes a closing ${tag} tag in the value`, () => {
      expect(fill(`<${tag}>{{${token}}}</${tag}>`, { [token]: `a </${tag}> b` })).toBe(
        `<${tag}>a &lt;/${tag}> b</${tag}>`,
      );
    });

    it(`throws when ${token} stands in no tag`, () => {
      expect(() => fill(`{{${token}}}`, { [token]: "x" })).toThrow(
        `prompt t must put {{${token}}} in <${tag}>...</${tag}>`,
      );
    });
  });

  it("keeps an opening tag in an untrusted value", () => {
    expect(fill(TAGGED, { ISSUE_TEXT: "<issue-text>x" })).toBe("<issue-text><issue-text>x</issue-text>");
  });

  it("keeps a token in a value as text", () => {
    expect(fill(`${TAGGED} {{A}}`, { ISSUE_TEXT: "{{ISSUE_TEXT}} {{A}}", A: "z" })).toBe(
      "<issue-text>{{ISSUE_TEXT}} {{A}}</issue-text> z",
    );
  });

  it("does not change a trusted value", () => {
    expect(fill("{{A}}", { A: "</issue-text>" })).toBe("</issue-text>");
  });
});
