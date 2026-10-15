import { z } from "zod";
import { cleanPath, isPlaceholder, PLACEHOLDER } from "../answer-checks.js";
import { jsonSchemaOf } from "../json-schema.js";
import { formatIssues } from "../zod-issues.js";

const text = z.string().min(1);

const findingSchema = z.strictObject({
  file: text,
  line: z.number().int().min(1).optional(),
  // The schema does not restrict the value, so a run with another word does not fail.
  category: text.optional(),
  summary: text,
  failure_scenario: text,
});

const reviewAnswerSchema = z.strictObject({ findings: z.array(findingSchema) });

export type Finding = z.infer<typeof findingSchema>;
export type ReviewAnswer = z.infer<typeof reviewAnswerSchema>;

export function reviewAnswerJsonSchema(): Record<string, unknown> {
  return jsonSchemaOf(reviewAnswerSchema);
}

type ReviewCheck = { ok: true; answer: ReviewAnswer } | { ok: false; problems: string[] };

export function checkReviewAnswer(output: unknown): ReviewCheck {
  if (output === undefined || output === null) {
    return { ok: false, problems: ["(root): the assistant returned no review"] };
  }
  const parsed = reviewAnswerSchema.safeParse(output);
  if (!parsed.success) return { ok: false, problems: formatIssues(parsed.error.issues, "(root)") };
  // The checks are not zod refinements. docs/dev/assistants.md gives the reason.
  const problems: string[] = [];
  const findings = parsed.data.findings.map((finding, i) => {
    const file = cleanPath(finding.file);
    if (file === "") problems.push(`findings.${i}.file: is empty after a trim and the removal of a leading "./"`);
    if (isPlaceholder(finding.summary)) problems.push(`findings.${i}.summary: ${PLACEHOLDER}`);
    if (isPlaceholder(finding.failure_scenario)) problems.push(`findings.${i}.failure_scenario: ${PLACEHOLDER}`);
    return { ...finding, file };
  });
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, answer: { findings } };
}
