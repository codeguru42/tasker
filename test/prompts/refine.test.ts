import { describe, expect, it } from "vitest";
import { REFINE_PROMPT, REFINE_PROMPT_NAME, openQuestionsText } from "../../src/prompts/refine.js";
import { SHARED_RULES } from "../../src/prompts/shared.js";
import { fillTemplate } from "../../src/prompts/template.js";

const QUESTION = { id: "q-one", question: "Which file?", context: "Two exist." };
const QUESTION_LINE = "- `q-one`: Which file? (Two exist.)";

const VALUES = {
  CURRENT_PLAN: "## Summary\nThe plan.",
  BRANCH_COMMITS: "abc1234 feat: Add a thing\n+line",
  FEEDBACK: "Use a map.",
  OPEN_QUESTIONS: openQuestionsText([QUESTION]),
};

function fillRefine(): string {
  return fillTemplate(REFINE_PROMPT_NAME, REFINE_PROMPT, VALUES);
}

describe("REFINE_PROMPT_NAME", () => {
  it("is refine", () => {
    expect(REFINE_PROMPT_NAME).toBe("refine");
  });
});

describe("REFINE_PROMPT", () => {
  it.each([
    "<current-plan>## Summary\nThe plan.</current-plan>",
    "<branch-commits>abc1234 feat: Add a thing\n+line</branch-commits>",
    "<feedback>Use a map.</feedback>",
    `<open-questions>${QUESTION_LINE}</open-questions>`,
  ])("fills with %j", (part) => {
    expect(fillRefine()).toContain(part);
  });

  it.each(Object.entries(SHARED_RULES))("holds the shared rule %s", (_name, text) => {
    expect(REFINE_PROMPT).toContain(text);
  });

  it("names no escape form", () => {
    expect(REFINE_PROMPT).not.toContain("&lt;");
  });
});

describe("openQuestionsText", () => {
  it("gives None. for no question", () => {
    expect(openQuestionsText([])).toBe("None.");
  });

  it("gives one line for one question", () => {
    expect(openQuestionsText([QUESTION])).toBe(QUESTION_LINE);
  });

  it("joins the lines of two questions in input order", () => {
    expect(openQuestionsText([QUESTION, { id: "q-two", question: "Which name?", context: "None is set." }])).toBe(
      `${QUESTION_LINE}\n- \`q-two\`: Which name? (None is set.)`,
    );
  });
});
