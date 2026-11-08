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
  it("names no operator", () => {
    expect(template).not.toMatch(/\boperator\b/i);
  });

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
    const rest = Object.fromEntries(Object.entries(values).filter(([name]) => name !== token));

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
    const filled = fillTemplate(EXECUTE_PROMPT_NAME, EXECUTE_PROMPT, PROMPTS[0].values);

    expect(rulesOf(filled)[4]).toBe("5. Commit as the repository does.");
  });

  it("runs the checks of the todo as rule 10", () => {
    expect(rulesOf(EXECUTE_PROMPT)[9]).toBe(
      "10. Run the tests of the todo at hand: the new test, to read its failure, then again after the change. If the todo asks for the whole test suite or another check of the whole repository, run it too. The commit of the failing test of a red/green pair can fail such a check where the rules of the repository permit it. The verify run of tasker runs outside your sandbox, and its result is the one that counts. If a test that you did not touch fails in your sandbox, find out whether your change causes the failure. The same holds for a check that fails in your sandbox. If your change causes the failure, fix it before the commit. Otherwise, name the test or the check in your final summary and go on. For such a failure, this rule wins over the pass condition of the todo.",
    );
  });

  it("runs each check alone as rule 11", () => {
    const rule = rulesOf(EXECUTE_PROMPT)[10];

    expect(rule).toContain(
      "Run each check alone. If the todo asks for a script that also runs the tests, run that script before the commit, as rule 10 says. Do not run that script for the baseline.",
    );
    expect(rule).not.toContain("never a script that also runs the tests");
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

  it("runs the fix checks as rule 4", () => {
    expect(rulesOf(EXECUTE_FIX_PROMPT)[3]).toBe(
      "4. This failure belongs to no single todo. Every todo of the plan is already recorded as done. Find the cause, fix it, and run the tests that the fix touches. Before you commit the fix, run each command that the todos of the plan run before a commit. Then commit the fix. tasker runs its own checks again afterwards.",
    );
  });
});

describe("EXECUTE_TODO_PROMPT", () => {
  it("runs the todo checks as rule 4", () => {
    expect(rulesOf(EXECUTE_TODO_PROMPT)[3]).toBe(
      "4. Run only the tests of this todo. If this todo asks for the whole test suite or another check of the whole repository, run it too.",
    );
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
    expect(text([planTodo("a", [], { description: "x\ny" })])).toBe(["- [ ] `a`: Do a", "  x", "  y"].join("\n"));
  });

  it("lists each dependency in the order of depends_on", () => {
    expect(text([planTodo("a"), planTodo("b"), planTodo("c", ["b", "a"])])).toContain("  (depends on: b, a)");
  });

  it("applies the dependency order", () => {
    expect(text([planTodo("a", ["b"]), planTodo("b")])).toBe(
      ["- [ ] `b`: Do b", "  The work of b.", "- [ ] `a`: Do a", "  The work of a.", "  (depends on: b)"].join("\n"),
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
    return {
      question: { id, question: `Question ${id}?`, context: `Context of ${id}.` },
      state: "resolved",
      version,
      answer,
    };
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
