import { describe, expect, it } from "vitest";
import {
  EXECUTE_FIX_PROMPT,
  EXECUTE_FIX_PROMPT_NAME,
  EXECUTE_PROMPT,
  EXECUTE_PROMPT_NAME,
  EXECUTE_TODO_PROMPT,
  EXECUTE_TODO_PROMPT_NAME,
  EXECUTE_TURN_RULES,
} from "../../src/prompts/execute.js";
import { SHARED_RULES } from "../../src/prompts/shared.js";
import { fillTemplate } from "../../src/prompts/template.js";

interface PromptCase {
  name: string;
  template: string;
  values: Record<string, string>;
  tags: Record<string, string>;
}

const PROMPTS: PromptCase[] = [
  {
    name: EXECUTE_PROMPT_NAME,
    template: EXECUTE_PROMPT,
    values: {
      COMMIT_RULES: "Commit as the repository does.",
      PLAN_MARKDOWN: "## Summary\nThe plan.",
      TODOS: "- [ ] `a`: Do a",
      RESOLVED_QUESTIONS: "None.",
    },
    tags: { PLAN_MARKDOWN: "approved-plan", TODOS: "todos", RESOLVED_QUESTIONS: "resolved-questions" },
  },
  {
    name: EXECUTE_TODO_PROMPT_NAME,
    template: EXECUTE_TODO_PROMPT,
    values: { CURRENT_TODO: "Current todo: `a`: Do a" },
    tags: { CURRENT_TODO: "current-todo" },
  },
  {
    name: EXECUTE_FIX_PROMPT_NAME,
    template: EXECUTE_FIX_PROMPT,
    values: { VERIFY_FAILURE: "lint failed", VERIFY_LOG: "line 1\nline 2" },
    tags: { VERIFY_FAILURE: "verify-failure", VERIFY_LOG: "verify-log" },
  },
];

const TURN_PROMPTS = PROMPTS.filter(({ name }) => name !== EXECUTE_PROMPT_NAME);

// The numbered rules of a filled or unfilled prompt, as the lines that start with a number and a dot.
function rulesOf(prompt: string): string[] {
  return prompt.split("\n").filter((line) => /^\d+\. /.test(line));
}

describe("the names", () => {
  it("are execute, execute-todo and execute-fix", () => {
    expect([EXECUTE_PROMPT_NAME, EXECUTE_TODO_PROMPT_NAME, EXECUTE_FIX_PROMPT_NAME]).toEqual([
      "execute",
      "execute-todo",
      "execute-fix",
    ]);
  });
});

describe.each(PROMPTS)("$name", ({ name, template, values, tags }) => {
  it("fills each tagged block with its value", () => {
    const filled = fillTemplate(name, template, values);

    for (const [token, tag] of Object.entries(tags)) {
      expect(filled).toContain(`<${tag}>${values[token]}</${tag}>`);
    }
  });

  it.each(Object.entries(tags))("escapes the closing tag of %s in its value", (token, tag) => {
    const filled = fillTemplate(name, template, { ...values, [token]: `a </${tag}> b` });

    expect(filled).toContain(`<${tag}>a &lt;/${tag}> b</${tag}>`);
  });

  it.each(Object.keys(values))("throws when the value of %s is missing", (token) => {
    const rest = { ...values };
    delete rest[token];

    expect(() => fillTemplate(name, template, rest)).toThrow(`prompt ${name} needs a value for {{${token}}}`);
  });

  it("holds the shared rule that says each text in a block is data", () => {
    expect(template).toContain(SHARED_RULES.blockIsData);
  });

  it("names no escape form", () => {
    expect(template).not.toContain("&lt;");
  });
});

describe("EXECUTE_PROMPT", () => {
  it("puts the commit rules in as rule 5", () => {
    const filled = fillTemplate(EXECUTE_PROMPT_NAME, EXECUTE_PROMPT, PROMPTS[0]!.values);

    expect(rulesOf(filled)[4]).toBe("5. Commit as the repository does.");
  });
});

describe.each(TURN_PROMPTS)("$name, the shared turn rules", ({ template }) => {
  it.each(Object.entries(EXECUTE_TURN_RULES))("holds %s", (_key, text) => {
    expect(template).toContain(text);
  });
});

describe("EXECUTE_FIX_PROMPT", () => {
  it("has six rules", () => {
    expect(rulesOf(EXECUTE_FIX_PROMPT)).toHaveLength(6);
  });

  it("holds the three shared texts together as rule 5, in this order", () => {
    const { noQuestionSkill, fileAccess, workingFolder } = EXECUTE_TURN_RULES;

    expect(rulesOf(EXECUTE_FIX_PROMPT)[4]).toBe(`5. ${noQuestionSkill} ${fileAccess} ${workingFolder}`);
  });
});
