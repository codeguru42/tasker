import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readPromptTemplate } from "../../src/prompts/template-file.js";
import { placeholderNames } from "../../src/prompts/template.js";
import { repoRoot } from "./processes.js";
import {
  commitText,
  EXECUTE_TURN_RULE_NAMES,
  executePrompts,
  rulesOf,
  SHARED_RULE_NAMES,
  templateCopyWithout,
} from "./prompts.js";

function rules(prompt: string): string[] {
  return rulesOf(prompt);
}

function commitRules(): string {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return commitText();
}

function prompts(root?: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return executePrompts(root);
}

function copyWithout(fileName: string): { root: string; missing: string } {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return templateCopyWithout(fileName);
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

describe("EXECUTE_TURN_RULE_NAMES", () => {
  it("is the list of the RULE_EXECUTE_ names of the execute-todo prompt", () => {
    const body = readPromptTemplate(
      join(fileURLToPath(repoRoot), "prompt-templates", "tasker", "execute-todo.md"),
    ).body;
    const used = [...placeholderNames(body)].filter((name) => name.startsWith("RULE_EXECUTE_"));
    expect(EXECUTE_TURN_RULE_NAMES).toEqual(used);
  });
});

describe("commitText", () => {
  it("gives the body of commit-rules.md", () => {
    const path = join(fileURLToPath(repoRoot), "prompt-templates", "tasker", "commit-rules.md");
    expect(commitRules()).toBe(readPromptTemplate(path).body);
  });
});

describe("executePrompts", () => {
  it("reads the prompts under the given root", () => {
    const { root } = copyWithout("shared-skills.md");
    expect(prompts(root)).toEqual(prompts());
  });
});

describe("templateCopyWithout", () => {
  it("gives a copy of the templates without the named file", () => {
    const { root, missing } = copyWithout("execute-file-access.md");
    expect(basename(root)).toBe("prompt-templates");
    expect(missing).toBe(join(root, "tasker", "execute-file-access.md"));
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(join(root, "tasker", "execute.md"))).toBe(true);
  });
});
