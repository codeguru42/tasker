import type { AssistantProviderId } from "./provider.js";

// An alias, or a full id, each with an optional [1m] suffix.
const CLAUDE_CODE_MODEL = /^(?:sonnet|opus|haiku|opusplan|fable|claude-[a-z0-9.-]+)(?:\[1m\])?$/;
const PI_THINKING_LEVEL = /:(?:off|minimal|low|medium|high|xhigh|max)$/;

function piModelParts(model: string): { upstream: string; modelId: string } | undefined {
  const slash = model.indexOf("/");
  const modelId = model.slice(slash + 1);
  if (slash < 1 || modelId.length === 0 || /\s/.test(model)) return undefined;
  return { upstream: model.slice(0, slash), modelId };
}

export function upstreamOf(model: string): string | undefined {
  const parts = piModelParts(model);
  return parts && !PI_THINKING_LEVEL.test(parts.modelId) ? parts.upstream : undefined;
}

// The error for model under provider, or undefined when the provider accepts the model.
// A provider with no model rule accepts every model.
export function modelIssue(provider: AssistantProviderId, model: string): string | undefined {
  switch (provider) {
    case "claude-code":
      return CLAUDE_CODE_MODEL.test(model) ? undefined : `is not a claude-code model: ${model}`;
    case "pi": {
      const parts = piModelParts(model);
      if (!parts) return `is not a pi model in the form <provider>/<model-id>: ${model}`;
      const thinkingLevel = PI_THINKING_LEVEL.exec(model)?.[0];
      if (thinkingLevel) return `ends in the pi thinking level ${thinkingLevel}: ${model}`;
      return undefined;
    }
    case "copilot":
    case "codex":
      return undefined;
  }
}
