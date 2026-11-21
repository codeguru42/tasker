// The prompts of an execute run.
import type { PlanAnswer } from "../plan/answer.js";
import { orderTodos } from "../plan/todo-order.js";
import type { TaskStore } from "../store/store.js";
import { packagePath } from "../package-path.js";
import { taskerPrompt } from "./tasker-template.js";

type PlanTodo = PlanAnswer["todos"][number];
// The type comes from the store, so that it has one home.
type ResolvedQuestion = ReturnType<TaskStore["resolvedQuestionsThrough"]>[number];

export const EXECUTE_PROMPT_NAME = "execute";
export const EXECUTE_TODO_PROMPT_NAME = "execute-todo";
export const EXECUTE_FIX_PROMPT_NAME = "execute-fix";

// The text of a verify failure that has no log output.
export const NO_VERIFY_LOG = "(tasker kept no log output for this failure)";

// The two half sentences that fill {{RESULT_LEAD}} and {{BLOCKED}} of the turn prompts, so one change updates both.
export const EXECUTE_TURN_RULES = {
  resultLead: "End the turn with the structured result:",
  blocked: "`blocked` with a `reason` when you cannot finish it.",
} as const;

// The three execute prompts as archive text. The data placeholders and {{COMMIT_RULES}} stay open.
export interface ExecutePrompts {
  execute: string;
  todo: string;
  fix: string;
}

// Reads the three execute prompts from the template files under root. A missing or wrong file throws.
export function readExecutePrompts(root: string = packagePath("prompt-templates")): ExecutePrompts {
  // A function replacer, so that a $ in a value stays plain.
  const turn = (name: string): string =>
    taskerPrompt(name, root)
      .replace("{{RESULT_LEAD}}", () => EXECUTE_TURN_RULES.resultLead)
      .replace("{{BLOCKED}}", () => EXECUTE_TURN_RULES.blocked);
  return {
    execute: taskerPrompt(EXECUTE_PROMPT_NAME, root),
    todo: turn(EXECUTE_TODO_PROMPT_NAME),
    fix: turn(EXECUTE_FIX_PROMPT_NAME),
  };
}

function dependsOnText(todo: PlanTodo): string {
  return `(depends on: ${todo.depends_on.join(", ")})`;
}

// The todos of the plan in the order of their dependencies, each with its state. Throws for a dependency cycle.
export function todosText(todos: readonly PlanTodo[], doneIds: ReadonlySet<string>): string {
  return orderTodos(todos)
    .map((todo) => {
      const lines = [`- [${doneIds.has(todo.id) ? "x" : " "}] \`${todo.id}\`: ${todo.title}`];
      lines.push(...todo.description.split("\n").map((line) => `  ${line}`));
      if (todo.depends_on.length > 0) lines.push(`  ${dependsOnText(todo)}`);
      return lines.join("\n");
    })
    .join("\n");
}

// The todo of one turn, with its description and its dependencies.
export function currentTodoText(todo: PlanTodo): string {
  const parts = [`Current todo: \`${todo.id}\`: ${todo.title}`, "", todo.description];
  if (todo.depends_on.length > 0) parts.push("", dependsOnText(todo));
  return parts.join("\n");
}

// The resolved questions in groups. A new group starts when the version or the feedback changes.
export function resolvedQuestionsText(questions: readonly ResolvedQuestion[]): string {
  if (questions.length === 0) return "None.";
  const groups: ResolvedQuestion[][] = [];
  for (const entry of questions) {
    const last = groups.at(-1)?.[0];
    if (last?.version === entry.version && last.answer === entry.answer) {
      groups.at(-1)!.push(entry);
    } else {
      groups.push([entry]);
    }
  }
  return groups
    .map((group) => {
      const { version, answer } = group[0];
      return [
        `Resolved in v${version}:`,
        ...group.flatMap(({ question }) => [
          `- \`${question.id}\`: ${question.question}`,
          `  context: ${question.context}`,
        ]),
        `Answered by the feedback given for v${version}:`,
        answer ?? "(no feedback given)",
      ].join("\n");
    })
    .join("\n\n");
}
