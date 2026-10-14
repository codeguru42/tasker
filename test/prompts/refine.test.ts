import { describe, expect, it } from "vitest";
import { openQuestionsText } from "../../src/prompts/refine.js";

const QUESTION = { id: "q-one", question: "Which file?", context: "Two exist." };
const QUESTION_LINE = "- `q-one`: Which file? (Two exist.)";

describe("openQuestionsText", () => {
  it("gives None. for no question", () => {
    expect(openQuestionsText([])).toBe("None.");
  });

  it("gives one line for one question", () => {
    expect(openQuestionsText([QUESTION])).toBe(QUESTION_LINE);
  });

  it("joins the lines of two questions in input order", () => {
    expect(
      openQuestionsText([
        QUESTION,
        { id: "q-two", question: "Which name?", context: "None is set." },
      ]),
    ).toBe(`${QUESTION_LINE}\n- \`q-two\`: Which name? (None is set.)`);
  });
});
