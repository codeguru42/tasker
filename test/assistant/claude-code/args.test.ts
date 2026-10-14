import { describe, expect, it } from "vitest";
import type { RunInput } from "../../../src/assistant/provider.js";
import { claudeArgs } from "../../../src/assistant/claude-code/args.js";

const SESSION_ID = "e5f6ebac-a40e-48af-befc-f9a7d1af4c5b";

function input(overrides: Partial<RunInput> = {}): RunInput {
  return {
    sessionId: SESSION_ID,
    resume: false,
    prompt: "do it",
    cwd: "/work",
    env: {},
    timeoutMs: 1000,
    sessionDir: "/sessions",
    model: "opus",
    effort: "high",
    ...overrides,
  };
}

describe("claudeArgs", () => {
  it("gives the arguments of a new session", () => {
    expect(claudeArgs(input())).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--session-id",
      SESSION_ID,
      "--model",
      "opus",
      "--effort",
      "high",
    ]);
  });

  it("resumes a continued session, and still gives the model and the effort", () => {
    const args = claudeArgs(input({ resume: true, model: "sonnet[1m]", effort: "low" }));

    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--resume",
      SESSION_ID,
      "--model",
      "sonnet[1m]",
      "--effort",
      "low",
    ]);
    expect(args).not.toContain("--session-id");
  });

  it("gives the schema as inline JSON text", () => {
    const schema = { type: "object", properties: { word: { type: "string" } } };

    const args = claudeArgs(input({ jsonSchema: schema }));

    expect(args.slice(-2)).toEqual(["--json-schema", JSON.stringify(schema)]);
  });

  it("gives the permission mode", () => {
    const args = claudeArgs(input({ permissionMode: "dontAsk" }));

    expect(args.slice(-2)).toEqual(["--permission-mode", "dontAsk"]);
  });

  it("gives each tool rule as its own argument, with the two lists last", () => {
    const args = claudeArgs(
      input({
        permissionMode: "plan",
        allowedTools: ["Bash(git *)", "Edit"],
        disallowedTools: ["Bash(rm *)"],
      }),
    );

    expect(args.slice(args.indexOf("--allowedTools"))).toEqual([
      "--allowedTools",
      "Bash(git *)",
      "Edit",
      "--disallowedTools",
      "Bash(rm *)",
    ]);
  });

  it("leaves out an empty tool list", () => {
    const args = claudeArgs(input({ allowedTools: [], disallowedTools: [] }));

    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--disallowedTools");
  });

  it("never gives a budget", () => {
    const args = claudeArgs(
      input({ jsonSchema: {}, permissionMode: "auto", allowedTools: ["Edit"], disallowedTools: ["Write"] }),
    );

    expect(args).not.toContain("--max-budget-usd");
  });
});
