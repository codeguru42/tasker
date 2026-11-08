const CORRECTIVE_PROMPT = [
  "Tasker refuses your last answer. Tasker found these problems:",
  "",
  "<problems>",
  "",
  "Give the whole answer again. Call the tool `submit_answer` one time, as your last action. If the tool is gone, end",
  "your reply with one JSON object in a fenced `json` block. The answer must match this JSON Schema:",
  "",
  "```json",
  "<schema>",
  "```",
].join("\n");

export function correctivePrompt(problems: readonly string[], schema: Record<string, unknown>): string {
  const problemsText = problems.map((problem) => `- ${problem}`).join("\n");
  return CORRECTIVE_PROMPT.replace(/<problems>|<schema>/gu, (placeholder) =>
    placeholder === "<problems>" ? problemsText : JSON.stringify(schema, null, 2),
  );
}
