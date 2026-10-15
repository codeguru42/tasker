import { describe, expect, it } from "vitest";
import {
  EXECUTE_FIX_PROMPT,
  EXECUTE_FIX_PROMPT_NAME,
  EXECUTE_PROMPT,
  EXECUTE_PROMPT_NAME,
  EXECUTE_TODO_PROMPT,
  EXECUTE_TODO_PROMPT_NAME,
  EXECUTE_TURN_RULES,
  currentTodoText,
  resolvedQuestionsText,
  todosText,
} from "../../src/prompts/execute.js";
import { SHARED_RULES } from "../../src/prompts/shared.js";
import { fillTemplate } from "../../src/prompts/template.js";
import { rulesOf } from "../helpers/prompts.js";
import { planTodo, validPlanAnswer } from "../helpers/plan.js";

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

describe("todosText", () => {
  function text(todos: Parameters<typeof todosText>[0], done: string[] = []): string {
    return todosText(todos, new Set(done));
  }

  it("marks a done todo with [x] and the others with [ ]", () => {
    expect(text(validPlanAnswer().todos, ["write-test"])).toBe(
      [
        "- [x] `write-test`: Add the a module",
        "  Write the failing test of the a module.",
        "- [ ] `make-it-pass`: Add the a module",
        "  Write the a module so that the test passes.",
        "  (depends on: write-test)",
      ].join("\n"),
    );
  });

  it("indents each line of a description by two spaces", () => {
    expect(text([planTodo("a", [], { description: "x\ny" })])).toBe(
      ["- [ ] `a`: Do a", "  x", "  y"].join("\n"),
    );
  });

  it("lists each dependency in the order of depends_on", () => {
    expect(text([planTodo("a"), planTodo("b"), planTodo("c", ["b", "a"])])).toContain("  (depends on: b, a)");
  });

  it("applies the dependency order", () => {
    expect(text([planTodo("a", ["b"]), planTodo("b")])).toBe(
      [
        "- [ ] `b`: Do b",
        "  The work of b.",
        "- [ ] `a`: Do a",
        "  The work of a.",
        "  (depends on: b)",
      ].join("\n"),
    );
  });
});

describe("currentTodoText", () => {
  it("gives the todo with its description and no dependency line", () => {
    expect(currentTodoText(planTodo("a"))).toBe("Current todo: `a`: Do a\n\nThe work of a.");
  });

  it("adds the dependencies after an empty line", () => {
    expect(currentTodoText(planTodo("c", ["a", "b"]))).toBe(
      "Current todo: `c`: Do c\n\nThe work of c.\n\n(depends on: a, b)",
    );
  });
});

describe("resolvedQuestionsText", () => {
  type Question = Parameters<typeof resolvedQuestionsText>[0][number];

  function resolved(id: string, version: number, answer: string | null): Question {
    return { question: { id, question: `Question ${id}?`, context: `Context of ${id}.` }, state: "resolved", version, answer };
  }

  it("gives None. for no question", () => {
    expect(resolvedQuestionsText([])).toBe("None.");
  });

  it("prints the feedback once for two questions of one version and one feedback", () => {
    expect(resolvedQuestionsText([resolved("q-one", 1, "Use main."), resolved("q-two", 1, "Use main.")])).toBe(
      [
        "Resolved in v1:",
        "- `q-one`: Question q-one?",
        "  context: Context of q-one.",
        "- `q-two`: Question q-two?",
        "  context: Context of q-two.",
        "Answered by the feedback given for v1:",
        "Use main.",
      ].join("\n"),
    );
  });

  it("separates two groups with an empty line", () => {
    expect(resolvedQuestionsText([resolved("q-one", 1, "Use main."), resolved("q-two", 2, "Use dev.")])).toBe(
      [
        "Resolved in v1:",
        "- `q-one`: Question q-one?",
        "  context: Context of q-one.",
        "Answered by the feedback given for v1:",
        "Use main.",
        "",
        "Resolved in v2:",
        "- `q-two`: Question q-two?",
        "  context: Context of q-two.",
        "Answered by the feedback given for v2:",
        "Use dev.",
      ].join("\n"),
    );
  });

  it("prints (no feedback given) for a null answer", () => {
    expect(resolvedQuestionsText([resolved("q-one", 1, null)])).toBe(
      [
        "Resolved in v1:",
        "- `q-one`: Question q-one?",
        "  context: Context of q-one.",
        "Answered by the feedback given for v1:",
        "(no feedback given)",
      ].join("\n"),
    );
  });
});
