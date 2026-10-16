import { z } from "zod";
import { formatIssues } from "../zod-issues.js";
import { jsonSchemaOf } from "../json-schema.js";

const turnResultSchema = z.strictObject({ result: z.enum(["done", "blocked"]), reason: z.string().optional() });

export function turnResultJsonSchema(): Record<string, unknown> {
  return jsonSchemaOf(turnResultSchema);
}

export type TurnRead = { kind: "done" } | { kind: "blocked"; reason: string } | { kind: "none"; detail: string };

// Never throws. docs/dev/assistants.md gives the reason for the strict read.
export function readTurnResult(output: unknown): TurnRead {
  if (output === undefined || output === null) return { kind: "none", detail: "returned no result" };
  const parsed = turnResultSchema.safeParse(output);
  if (!parsed.success) return { kind: "none", detail: formatIssues(parsed.error.issues, "(root)").join("; ") };
  if (parsed.data.result === "done") return { kind: "done" };
  const reason = parsed.data.reason?.trim();
  // An empty reason must also get the fallback text, and ?? would keep the empty text.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return { kind: "blocked", reason: reason ? reason : "(no reason given)" };
}
