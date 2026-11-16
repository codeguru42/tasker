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
