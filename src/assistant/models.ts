import type { AssistantProviderId } from "./provider.js";

// An alias, or a full id, each with an optional [1m] suffix.
const CLAUDE_CODE_MODEL = /^(?:sonnet|opus|haiku|opusplan|fable|claude-[a-z0-9.-]+)(?:\[1m\])?$/;

// The error for model under provider, or undefined when the provider accepts the model.
// A provider with no model rule accepts every model.
export function modelIssue(provider: AssistantProviderId, model: string): string | undefined {
  switch (provider) {
    case "claude-code":
      return CLAUDE_CODE_MODEL.test(model) ? undefined : `is not a claude-code model: ${model}`;
    case "copilot":
    case "pi":
      return undefined;
  }
}
