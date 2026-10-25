import type { AssistantRole } from "../assistant/provider.js";
import { isObject } from "../object.js";
import type { SessionRole } from "./schema.js";

export interface RoleChange {
  model?: string;
  effort?: string;
}

// The text of a configuration file with the model, the effort or both of one assistant role changed. It keeps
// every other key and the key order, writes an indent of two spaces and keeps the line end at the end of text.
// The loader requires models.plan, .execute and .review, each with model and effort, and the command loads the
// file before the edit. As a result, the role always exists in text. The function throws when the path is not an
// object. It never makes the key, so it never writes a default.
export function setRoleModel(text: string, repoKey: string, role: AssistantRole, change: RoleChange): string {
  return editChoice(text, ["repos", repoKey, "assistant", "models", role], 0, change);
}

// Same as setRoleModel for a session role. The keys sessions, models and the role are optional in a file. The
// function adds each one that is missing, so a new role gets the keys model and effort in this order.
export function setSessionRoleModel(text: string, repoKey: string, role: SessionRole, change: RoleChange): string {
  return editChoice(text, ["repos", repoKey, "sessions", "models", role], 3, change);
}

// Walks the steps from the root. The last `created` steps are made as empty objects when they are missing.
function editChoice(text: string, steps: string[], created: number, change: RoleChange): string {
  const raw: unknown = JSON.parse(text);
  const firstCreated = steps.length - created;
  let node = raw;
  let walked = "";
  steps.forEach((step, index) => {
    walked = walked === "" ? step : `${walked}.${step}`;
    if (isObject(node) && !Object.hasOwn(node, step) && index >= firstCreated) node[step] = {};
    if (!isObject(node) || !Object.hasOwn(node, step) || !isObject(node[step])) {
      throw new Error(`the configuration has no object at ${walked}`);
    }
    node = node[step];
  });
  const choice = node as Record<string, unknown>;
  if (change.model !== undefined) choice.model = change.model;
  if (change.effort !== undefined) choice.effort = change.effort;
  return JSON.stringify(raw, null, 2) + (/\r?\n$/.exec(text)?.[0] ?? "");
}
