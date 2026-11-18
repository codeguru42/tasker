import { describe, expect, it } from "vitest";
import {
  PI_MEASURED_TOKENS_1,
  PI_MEASURED_TOKENS_2,
  PI_MEASURED_USAGE_1,
  PI_MEASURED_USAGE_2,
  piAssistantMessage,
  piStreamedAssistant,
  REPORTED_PI_MODEL,
  ROUTER_PI_MODEL,
} from "./pi-provider.js";

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

describe("piStreamedAssistant", () => {
  it("builds the measured start, update and end events", () => {
    const { events, message } = piStreamedAssistant(PI_MEASURED_USAGE_1, 1001);
    expect(events.map((event) => event.type)).toEqual(["message_start", "message_update", "message_end"]);
    const start = events[0].message as Record<string, unknown>;
    expect(Object.keys(start).sort()).toEqual(
      ["api", "content", "model", "provider", "role", "stopReason", "timestamp", "usage"].sort(),
    );
    expect(start).toMatchObject({ role: "assistant", content: [], stopReason: "pending", timestamp: 1001 });
    expect(start.usage).toMatchObject({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
    expect(events[1]).toEqual({
      type: "message_update",
      usage: PI_MEASURED_USAGE_1,
      assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
    });
    expect(events[2]).toEqual({ type: "message_end", message });
    expect(message).toMatchObject({
      role: "assistant",
      usage: PI_MEASURED_USAGE_1,
      stopReason: "stop",
      timestamp: 1001,
    });
    expect(message).not.toHaveProperty("responseModel");
  });

  it("leaves out the end and uses the given updates", () => {
    const { events, message } = piStreamedAssistant(PI_MEASURED_USAGE_1, 1002, {
      ended: false,
      updates: [PI_MEASURED_USAGE_2, PI_MEASURED_USAGE_1],
    });
    expect(events.map((event) => event.type)).toEqual(["message_start", "message_update", "message_update"]);
    expect(events.slice(1).map((event) => event.usage)).toEqual([PI_MEASURED_USAGE_2, PI_MEASURED_USAGE_1]);
    expect(message.usage).toEqual(PI_MEASURED_USAGE_1);
  });

  it("names the measured token counts", () => {
    expect(PI_MEASURED_TOKENS_1).toEqual({
      inputTokens: 3,
      outputTokens: 63,
      cacheCreationInputTokens: 8576,
      cacheReadInputTokens: 0,
    });
    expect(PI_MEASURED_TOKENS_2).toEqual({
      inputTokens: 3,
      outputTokens: 31,
      cacheCreationInputTokens: 19,
      cacheReadInputTokens: 8576,
    });
  });
});
