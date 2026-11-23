import { describe, expect, it } from "vitest";
import { startBlock } from "../../helpers/doc-text.js";
import { PLANNER_WAIT, plannerTemplateBody, START_LINE } from "../../helpers/planner-prompts.js";

const names = ["issue-draft", "issue-review", "issue-post"];

function block(name: string): string | undefined {
  return startBlock(plannerTemplateBody(name));
}

describe("the start steps of the issue prompt templates", () => {
  for (const name of names) {
    it(`${name}.md has a start block that starts with the start line and holds the wait`, () => {
      const found = block(name);
      expect(found).toBeDefined();
      expect(found?.startsWith(START_LINE)).toBe(true);
      expect(found).toContain(PLANNER_WAIT);
    });
  }

  it("has the same start block in the three templates", () => {
    const blocks = names.map(block);
    expect(blocks[0]).toBeDefined();
    expect(blocks[1]).toBe(blocks[0]);
    expect(blocks[2]).toBe(blocks[0]);
  });
});
