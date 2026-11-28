import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packagePath } from "../../src/package-path.js";
import { readPromptTemplate } from "../../src/prompts/template-file.js";
import { startBlock } from "./doc-text.js";
import {
  fillPlannerTemplate,
  plannerDocWordRuns,
  plannerTemplateBody,
  standsAfterStartBlock,
  START_LINE,
} from "./planner-prompts.js";

const LAST_LINE = "After a pull that passed, read the docs.";

function textWith(before: string, after: string): string {
  return [before, START_LINE, "A middle line.", LAST_LINE, after].join("\n");
}

describe("plannerTemplateBody", () => {
  it("gives the body of the template file", () => {
    const path = packagePath("prompt-templates/planner/issue-review.md");
    expect(plannerTemplateBody("issue-review")).toBe(readPromptTemplate(path).body);
  });
});

describe("fillPlannerTemplate", () => {
  it("fills each placeholder with its value", () => {
    const path = packagePath("prompt-templates/planner/issue-review.md");
    const { placeholders } = readPromptTemplate(path);
    const values: Record<string, string> = {};
    for (const name of Object.keys(placeholders)) values[name] = `value-of-${name}`;
    const filled = fillPlannerTemplate("issue-review", values);
    expect(filled).not.toContain("{{");
    for (const value of Object.values(values)) expect(filled).toContain(value);
  });

  it("throws for a missing value", () => {
    expect(() => fillPlannerTemplate("issue-review", {})).toThrow("prompt planner/issue-review needs a value");
  });
});

describe("plannerDocWordRuns", () => {
  it("gives a run of 8 words that the doc holds", () => {
    const docPath = packagePath("docs/dev/planner-subagent/planner-subagent.md");
    expect(existsSync(docPath)).toBe(true);
    const doc = readFileSync(docPath, "utf8");
    const run = doc
      .split(/\s+/)
      .filter((word) => word !== "")
      .slice(0, 8)
      .join(" ");
    expect(plannerDocWordRuns(run)).toEqual([run]);
  });

  it("gives no run for words that the doc does not hold", () => {
    expect(plannerDocWordRuns("alpha beta gamma delta epsilon zeta eta theta")).toEqual([]);
  });
});

describe("standsAfterStartBlock", () => {
  it("gives true for a sentence after the block", () => {
    expect(standsAfterStartBlock(textWith("Intro.", "Last sentence."), "Last sentence.")).toBe(true);
  });

  it("gives false for a sentence before the block", () => {
    expect(standsAfterStartBlock(textWith("Last sentence.", "Outro."), "Last sentence.")).toBe(false);
  });

  it("gives false for a text with no start block", () => {
    expect(standsAfterStartBlock("Intro.\nLast sentence.", "Last sentence.")).toBe(false);
  });

  it("gives false for a text with no sentence", () => {
    expect(standsAfterStartBlock(textWith("Intro.", "Outro."), "Last sentence.")).toBe(false);
  });
});

describe("START_LINE", () => {
  it("starts the start block", () => {
    expect(startBlock([START_LINE, "A middle line.", LAST_LINE].join("\n"))).toBeDefined();
  });
});
