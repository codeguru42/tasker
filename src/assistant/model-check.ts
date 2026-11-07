import type { Check } from "../doctor/check.js";
import { timedCheck } from "../doctor/timed-check.js";
import { modelIssue } from "./models.js";
import type { AssistantProviderId } from "./provider.js";

export function assistantModelCheck(provider: AssistantProviderId, name: string, model: string): Check {
  return timedCheck({ name, required: true, timeoutMs: 1000 }, async () => {
    const issue = modelIssue(provider, model);
    return issue === undefined
      ? { status: "ok", detail: `${model} is a ${provider} model` }
      : { status: "error", detail: issue };
  });
}
