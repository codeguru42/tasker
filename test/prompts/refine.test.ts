import { describe, expect, it } from "vitest";
import {
  PLAIN_REFINE_CONTEXT,
  REFINE_PROMPT,
  REFINE_PROMPT_NAME,
  openQuestionsText,
} from "../../src/prompts/refine.js";
import { rulesOf } from "../helpers/prompts.js";
import { SHARED_RULES } from "../../src/prompts/shared.js";
import { fillTemplate } from "../../src/prompts/template.js";

const QUESTION = { id: "q-one", question: "Which file?", context: "Two exist." };
const QUESTION_LINE = "- `q-one`: Which file? (Two exist.)";

const VALUES = {
  CURRENT_PLAN: "## Summary\nThe plan.",
  BRANCH_COMMITS: "abc1234 feat: Add a thing\n+line",
  CONTEXT: "The context.",
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
    "<context>The context.</context>",
    "<feedback>Use a map.</feedback>",
    `<open-questions>${QUESTION_LINE}</open-questions>`,
  ])("fills with %j", (part) => {
    expect(fillRefine()).toContain(part);
  });

  it.each(Object.entries(SHARED_RULES))("holds the shared rule %s", (_name, text) => {
    expect(REFINE_PROMPT).toContain(text);
  });

  it("gives the context in rule 9 and the feedback in rule 10", () => {
    const rules = rulesOf(REFINE_PROMPT);
    expect(rules[8]).toMatch(/^9\. The context of this refine stands in this block:/);
    expect(rules[9]).toMatch(/^10\. The feedback of the operator/);
  });

  it("names no escape form", () => {
    expect(REFINE_PROMPT).not.toContain("&lt;");
  });
});

describe("PLAIN_REFINE_CONTEXT", () => {
  it("is the line of a plain refine", () => {
    expect(PLAIN_REFINE_CONTEXT).toBe("The operator read the plan and asks for a revision.");
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
