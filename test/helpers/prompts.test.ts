import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readPromptTemplate } from "../../src/prompts/template-file.js";
import { placeholderNames } from "../../src/prompts/template.js";
import { repoRoot } from "./processes.js";
import { rulesOf, SHARED_RULE_NAMES } from "./prompts.js";

function rules(prompt: string): string[] {
  return rulesOf(prompt);
}

describe("rulesOf", () => {
  it("gives the numbered lines and skips the sub-items", () => {
    expect(rules("1. a\n   - b\n2. c\n")).toEqual(["1. a", "2. c"]);
  });

  it("counts a line with a two-digit number", () => {
    expect(rules("10. x")).toEqual(["10. x"]);
  });

  it.each(["x 1. y", "1.x"])("does not count the line %j", (line) => {
    expect(rules(line)).toEqual([]);
  });
});

describe("SHARED_RULE_NAMES", () => {
  it("is the set of the RULE_ names of the plan prompt", () => {
    const body = readPromptTemplate(join(fileURLToPath(repoRoot), "prompt-templates", "tasker", "plan.md")).body;
    const used = [...placeholderNames(body)].filter((name) => name.startsWith("RULE_"));
    expect(SHARED_RULE_NAMES).toHaveLength(11);
    expect(new Set(SHARED_RULE_NAMES).size).toBe(SHARED_RULE_NAMES.length);
    expect([...SHARED_RULE_NAMES].sort()).toEqual(used.sort());
  });
});
