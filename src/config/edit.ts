import type { AssistantRole, ModelChoice } from "../assistant/provider.js";
import { isObject } from "../object.js";

// The text of a configuration file with the model, the effort or both of one role changed. It keeps every other
// key and the key order, writes an indent of two spaces and keeps the line end at the end of text.
// The loader requires models.plan, .execute and .review, each with model and effort, and the command loads the
// file before the edit. As a result, the role always exists in text. The function throws when the path is not an
// object. It never makes the key, so it never writes a default.
export function setRoleModel(
  text: string,
  repoKey: string,
  role: AssistantRole,
  change: Partial<ModelChoice>,
): string {
  const raw: unknown = JSON.parse(text);
  const steps = ["repos", repoKey, "assistant", "models", role];
  let node = raw;
  let walked = "";
  for (const step of steps) {
    walked = walked === "" ? step : `${walked}.${step}`;
    if (!isObject(node) || !Object.hasOwn(node, step) || !isObject(node[step])) {
      throw new Error(`the configuration has no object at ${walked}`);
    }
    node = node[step];
  }
  const choice = node as Record<string, unknown>;
  if (change.model !== undefined) choice.model = change.model;
  if (change.effort !== undefined) choice.effort = change.effort;
  return JSON.stringify(raw, null, 2) + (/\r?\n$/.exec(text)?.[0] ?? "");
}
