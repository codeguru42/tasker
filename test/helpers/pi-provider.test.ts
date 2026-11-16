import { describe, expect, it } from "vitest";
import { piAssistantMessage, REPORTED_PI_MODEL, ROUTER_PI_MODEL } from "./pi-provider.js";

describe("piAssistantMessage", () => {
  it("gives the default message", () => {
    expect(piAssistantMessage()).toEqual({
      role: "assistant",
      content: [],
      provider: "openrouter",
      model: "openrouter/auto",
      responseModel: "anthropic/claude-fable-5",
      stopReason: "stop",
    });
  });

  it("changes a key and removes a key whose value is undefined", () => {
    const message = piAssistantMessage({ stopReason: "error", responseModel: undefined });
    expect(message.stopReason).toBe("error");
    expect(message).not.toHaveProperty("responseModel");
  });

  it("names the models", () => {
    expect(ROUTER_PI_MODEL).toBe("openrouter/openrouter/auto");
    expect(REPORTED_PI_MODEL).toBe("openrouter/anthropic/claude-fable-5");
  });
});
