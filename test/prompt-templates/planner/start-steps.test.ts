import { describe, expect, it } from "vitest";
import { packagePath } from "../../../src/package-path.js";
import { readPromptTemplate } from "../../../src/prompts/template-file.js";
import { startBlock } from "../../helpers/doc-text.js";

const START_LINE =
  "Do the start steps in the folder where your session starts, which is the local clone. No command has a -C option.";
const WAIT = "timeout 20 bash -c 'sleep 5'";

const names = ["issue-draft", "issue-review", "issue-post"];

function block(name: string): string | undefined {
  return startBlock(readPromptTemplate(packagePath(`prompt-templates/planner/${name}.md`)).body);
}

describe("the start steps of the issue prompt templates", () => {
  for (const name of names) {
    it(`${name}.md has a start block that starts with the start line and holds the wait`, () => {
      const found = block(name);
      expect(found).toBeDefined();
      expect(found?.startsWith(START_LINE)).toBe(true);
      expect(found).toContain(WAIT);
    });
  }

  it("has the same start block in the three templates", () => {
    const blocks = names.map(block);
    expect(blocks[0]).toBeDefined();
    expect(blocks[1]).toBe(blocks[0]);
    expect(blocks[2]).toBe(blocks[0]);
  });
});
