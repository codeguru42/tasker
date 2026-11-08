import { describe, expect, it } from "vitest";
import { SHARED_RULES } from "../../src/prompts/shared.js";

describe("SHARED_RULES.answerKeys", () => {
  it("allows required checks before commits", () => {
    expect(SHARED_RULES.answerKeys).toContain(
      "The rules of the repository can ask for commands before each commit, for example a formatter, a linter or the whole test suite. Find these rules in the files of the repository, for example a contributing guide or the instructions for an assistant. Each todo that makes a commit runs each such command before the commit, and the todo names each command and its pass condition. For the commit of a failing test, the pass condition permits each failure that the rules of the repository permit for such a commit. A todo runs no other check of the whole repository. tasker runs the verify commands itself after the execute run.",
    );
    expect(SHARED_RULES.answerKeys).not.toContain(
      "A todo never runs the full test suite or another check of the whole repository, because tasker runs the verify commands itself after the execute run.",
    );
  });
});
