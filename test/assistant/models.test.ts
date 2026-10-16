import { describe, expect, it } from "vitest";
import { modelIssue } from "../../src/assistant/models.js";

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

  it.each(["copilot", "pi"] as const)("accepts every model for %s", (provider) => {
    expect(modelIssue(provider, "gpt-5")).toBeUndefined();
  });
});
