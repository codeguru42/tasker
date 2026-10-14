import type { RunInput } from "../provider.js";

// The arguments of claude for one session. The prompt goes to stdin, so it is not here.
// The settings, when there are any, go as inline JSON after the permission mode.
// The two tool lists take any number of values, so they come last. Each rule is its own argument.
export function claudeArgs(input: RunInput, settings?: Record<string, unknown>): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    input.resume ? "--resume" : "--session-id",
    input.sessionId,
    "--model",
    input.model,
    "--effort",
    input.effort,
  ];
  if (input.jsonSchema !== undefined) args.push("--json-schema", JSON.stringify(input.jsonSchema));
  if (input.permissionMode !== undefined) args.push("--permission-mode", input.permissionMode);
  if (settings !== undefined) args.push("--settings", JSON.stringify(settings));
  if (input.allowedTools?.length) args.push("--allowedTools", ...input.allowedTools);
  if (input.disallowedTools?.length) args.push("--disallowedTools", ...input.disallowedTools);
  return args;
}
