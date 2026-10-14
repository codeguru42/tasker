import { z } from "zod";
import { formatIssues } from "../zod-issues.js";

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
  const schema: Record<string, unknown> = z.toJSONSchema(planAnswerSchema);
  delete schema.$schema;
  return schema;
}

type PlanCheck = { ok: true; answer: PlanAnswer } | { ok: false; problems: string[] };

export function checkPlanAnswer(output: unknown): PlanCheck {
  if (output === undefined || output === null) {
    return { ok: false, problems: ["(root): the assistant returned no plan"] };
  }
  const parsed = planAnswerSchema.safeParse(output);
  if (!parsed.success) return { ok: false, problems: formatIssues(parsed.error.issues, "(root)") };
  return { ok: true, answer: parsed.data };
}
