import { describe, expect, it } from "vitest";
import { modelIssue, upstreamOf } from "../../src/assistant/models.js";

describe("modelIssue", () => {
  it.each([
    "sonnet",
    "opus",
    "haiku",
    "opusplan",
    "fable",
    "claude-opus-5-5",
    "claude-sonnet-4.5",
    "claude-3-5-haiku-20241022",
    "opus[1m]",
    "claude-sonnet-5-5[1m]",
  ])("accepts the claude-code model %s", (model) => {
    expect(modelIssue("claude-code", model)).toBeUndefined();
  });

  it.each([
    "gpt-5",
    "Opus",
    "claude-",
    "claude-Opus-5",
    "claude_opus",
    "opus[2m]",
    "opus [1m]",
    "opus[1m][1m]",
    "[1m]",
    " opus",
  ])("rejects the claude-code model %j", (model) => {
    expect(modelIssue("claude-code", model)).toBe(`is not a claude-code model: ${model}`);
  });

  it.each(["copilot", "codex"] as const)("accepts every model for %s", (provider) => {
    expect(modelIssue(provider, "gpt-5")).toBeUndefined();
  });

  it.each(["openrouter/auto", "openrouter/openrouter/auto", "openrouter/auto:free"])(
    "accepts the pi model %s",
    (model) => {
      expect(modelIssue("pi", model)).toBeUndefined();
    },
  );

  it.each(["/auto", "openrouter/", "openrouter", "openrouter/auto now"])("rejects the pi model form %j", (model) => {
    expect(modelIssue("pi", model)).toBe(`is not a pi model in the form <provider>/<model-id>: ${model}`);
  });

  it.each([":off", ":minimal", ":low", ":medium", ":high", ":xhigh", ":max"])(
    "rejects the pi thinking suffix %s",
    (suffix) => {
      const model = `openrouter/auto${suffix}`;
      expect(modelIssue("pi", model)).toBe(`ends in the pi thinking level ${suffix}: ${model}`);
    },
  );

  it("reports a thinking suffix when the model id is empty after the slash", () => {
    expect(modelIssue("pi", "openrouter/:high")).toBe("ends in the pi thinking level :high: openrouter/:high");
  });

  it("reports the model form error before the thinking suffix error", () => {
    const model = "openrouter/auto now:high";
    expect(modelIssue("pi", model)).toBe(`is not a pi model in the form <provider>/<model-id>: ${model}`);
  });
});

describe("upstreamOf", () => {
  it.each([
    ["openrouter/auto", "openrouter"],
    ["openrouter/openrouter/auto", "openrouter"],
    ["openrouter/auto:free", "openrouter"],
  ])("returns the upstream for %s", (model, upstream) => {
    expect(upstreamOf(model)).toBe(upstream);
  });

  it.each([
    "/auto",
    "openrouter/",
    "openrouter",
    "openrouter/auto now",
    "openrouter/:high",
    "openrouter/auto now:high",
  ])("returns undefined for %j", (model) => {
    expect(upstreamOf(model)).toBeUndefined();
  });
});
