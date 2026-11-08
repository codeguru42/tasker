import { describe, expect, it } from "vitest";
import { piArgs } from "../../../src/assistant/pi/args.js";
import type { PiFiles } from "../../../src/assistant/pi/args.js";
import type { RunInput } from "../../../src/assistant/provider.js";
import { runInput as sharedRunInput } from "../../helpers/fake-claude.js";

function callPiArgs(input: RunInput, files: PiFiles, limitsPath: string, schemaPath: string | undefined): string[] {
  return piArgs(input, files, limitsPath, schemaPath);
}

function runInput(overrides: Partial<RunInput> = {}): RunInput {
  return sharedRunInput({
    sessionId: "session-1",
    prompt: "prompt",
    cwd: "/work/tree",
    timeoutMs: 1000,
    model: "openrouter/openrouter/auto",
    ...overrides,
  });
}

const files: PiFiles = { guardFile: "/extensions/guard.js", answerFile: "/extensions/answer.js" };

describe("piArgs", () => {
  it("builds literal arguments for a new session with a schema", () => {
    expect(callPiArgs(runInput(), files, "/limits/session-1.json", "/schema/session-1.json")).toEqual([
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      "session-1",
      "--session-dir",
      "/sessions",
      "--tools",
      "read,grep,find,ls,submit_answer",
      "--no-mcp",
      "-e",
      "/extensions/guard.js",
      "--tasker-guard-limits",
      "/limits/session-1.json",
      "-e",
      "/extensions/answer.js",
      "--tasker-answer-schema",
      "/schema/session-1.json",
    ]);
  });

  it("builds literal arguments for a continued session without a schema", () => {
    expect(
      callPiArgs(runInput({ resume: true, model: "openrouter/auto", effort: "high" }), files, "/limits", undefined),
    ).toEqual([
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/auto",
      "--thinking",
      "high",
      "--session",
      "session-1",
      "--session-dir",
      "/sessions",
      "--tools",
      "read,grep,find,ls",
      "--no-mcp",
      "-e",
      "/extensions/guard.js",
      "--tasker-guard-limits",
      "/limits",
    ]);
  });

  it("uses a model id that contains a slash as one model value", () => {
    expect(callPiArgs(runInput({ model: "openrouter/anthropic/claude" }), files, "/limits", undefined)).toContain(
      "openrouter/openrouter/anthropic/claude",
    );
  });
});
