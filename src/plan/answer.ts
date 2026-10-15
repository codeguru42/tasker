import { z } from "zod";
import { formatIssues } from "../zod-issues.js";
import { jsonSchemaOf } from "./json-schema.js";

const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: "must be kebab-case" });
const text = z.string().min(1);

const planAnswerSchema = z.strictObject({
  summary: z.array(text).min(1),
  plan_markdown: z.string().regex(/^## Summary(\r?\n|$)/, { message: 'must start with "## Summary"' }),
  files_changed: z.array(text),
  todos: z.array(z.strictObject({ id, title: text, description: text, depends_on: z.array(id) })),
  questions: z.array(z.strictObject({ id, question: text, context: text })),
});

export type PlanAnswer = z.infer<typeof planAnswerSchema>;

export function planAnswerJsonSchema(): Record<string, unknown> {
  return jsonSchemaOf(planAnswerSchema);
}

const PLACEHOLDER = "is a placeholder, not real text";

type PlanCheck = { ok: true; answer: PlanAnswer } | { ok: false; problems: string[] };

export function checkPlanAnswer(output: unknown): PlanCheck {
  if (output === undefined || output === null) {
    return { ok: false, problems: ["(root): the assistant returned no plan"] };
  }
  const parsed = planAnswerSchema.safeParse(output);
  if (!parsed.success) return { ok: false, problems: formatIssues(parsed.error.issues, "(root)") };
  // The checks are not zod refinements. docs/dev/assistants.md gives the reason.
  const answer = parsed.data;
  const problems: string[] = [];

  answer.todos.forEach((todo, i) => {
    if (todo.title.trim().length < 3) problems.push(`todos.${i}.title: ${PLACEHOLDER}`);
    if (todo.description.trim().length < 3) problems.push(`todos.${i}.description: ${PLACEHOLDER}`);
  });
  const newline = answer.plan_markdown.indexOf("\n");
  const body = newline === -1 ? "" : answer.plan_markdown.slice(newline + 1);
  if (body.trim().length < 20) {
    problems.push('plan_markdown: has no plan after the "## Summary" heading');
  }

  if (answer.todos.length === 0) problems.push("todos: a plan with no todos is not a plan");
  const todoIds = new Set<string>();
  answer.todos.forEach((todo, i) => {
    if (todoIds.has(todo.id)) problems.push(`todos.${i}.id: duplicate todo id "${todo.id}"`);
    todoIds.add(todo.id);
  });
  const questionIds = new Set<string>();
  answer.questions.forEach((question, i) => {
    if (questionIds.has(question.id)) {
      problems.push(`questions.${i}.id: duplicate question id "${question.id}"`);
    }
    questionIds.add(question.id);
  });
  answer.todos.forEach((todo, i) => {
    todo.depends_on.forEach((dependency, j) => {
      if (!todoIds.has(dependency)) {
        problems.push(
          `todos.${i}.depends_on.${j}: todo "${todo.id}" depends on unknown todo id "${dependency}"`,
        );
      }
    });
  });
  if (problems.length > 0) return { ok: false, problems };

  return { ok: true, answer: { ...answer, files_changed: cleanPlanPaths(answer.files_changed) } };
}

// The clean step of the paths of a plan: trim, no leading "./", no empty path and no repeat.
// The first copy of a path keeps its place.
export function cleanPlanPaths(paths: readonly string[]): string[] {
  const files = paths.map((path) => path.trim().replace(/^\.\//, "")).filter((path) => path !== "");
  return [...new Set(files)];
}
