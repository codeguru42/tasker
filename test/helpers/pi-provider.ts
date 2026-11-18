import { createPiProvider as fromCreatePiProvider } from "../../src/assistant/pi/provider.js";
import type { AssistantProvider } from "../../src/assistant/provider.js";

export function createPiProvider(): AssistantProvider {
  return fromCreatePiProvider();
}

export const ROUTER_PI_MODEL = "openrouter/openrouter/auto";
export const REPORTED_PI_MODEL = "openrouter/anthropic/claude-fable-5";

// An assistant message of pi. A key with the value undefined in change is removed.
export function piAssistantMessage(change: Record<string, unknown> = {}): Record<string, unknown> {
  const message = {
    role: "assistant",
    content: [],
    provider: "openrouter",
    model: "openrouter/auto",
    responseModel: "anthropic/claude-fable-5",
    stopReason: "stop",
    ...change,
  };
  return Object.fromEntries(Object.entries(message).filter(([, value]) => value !== undefined));
}

const MEASURED_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

// The usage of the first measured run of an assistant message (pi 1.1.0). The values of cost are not measured.
export const PI_MEASURED_USAGE_1 = {
  input: 3,
  output: 63,
  cacheRead: 0,
  cacheWrite: 8576,
  reasoning: 56,
  totalTokens: 8642,
  cost: { ...MEASURED_COST },
};

// The usage of the second measured run of an assistant message (pi 1.1.0).
export const PI_MEASURED_USAGE_2 = {
  input: 3,
  output: 31,
  cacheRead: 8576,
  cacheWrite: 19,
  reasoning: 24,
  totalTokens: 8629,
  cost: { ...MEASURED_COST },
};

export const PI_MEASURED_TOKENS_1 = {
  inputTokens: 3,
  outputTokens: 63,
  cacheCreationInputTokens: 8576,
  cacheReadInputTokens: 0,
};

export const PI_MEASURED_TOKENS_2 = {
  inputTokens: 3,
  outputTokens: 31,
  cacheCreationInputTokens: 19,
  cacheReadInputTokens: 8576,
};

const PI_ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  totalTokens: 0,
  cost: { ...MEASURED_COST },
};

// The stream events of one assistant message, in the measured shapes: a message_start with usage 0, one
// message_update for each value of options.updates, and a message_end with the final usage. With
// options.ended false the events stop before the message_end. The message is the final message.
export function piStreamedAssistant(
  usage: Record<string, unknown>,
  timestamp: number,
  options: { ended?: boolean; updates?: Record<string, unknown>[] } = {},
): { events: Record<string, unknown>[]; message: Record<string, unknown> } {
  const start = piAssistantMessage({
    api: "openai-completions",
    usage: { ...PI_ZERO_USAGE },
    stopReason: "pending",
    timestamp,
    responseModel: undefined,
  });
  const message = piAssistantMessage({
    api: "openai-completions",
    usage,
    stopReason: "stop",
    timestamp,
    responseModel: undefined,
  });
  const events: Record<string, unknown>[] = [
    { type: "message_start", message: start },
    ...(options.updates ?? [usage]).map((update) => ({
      type: "message_update",
      usage: update,
      assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
    })),
  ];
  if (options.ended !== false) events.push({ type: "message_end", message });
  return { events, message };
}
