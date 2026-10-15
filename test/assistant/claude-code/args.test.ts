import { describe, expect, it } from "vitest";
import { claudeArgs } from "../../../src/assistant/claude-code/args.js";
import { TEST_SESSION_ID, runInput } from "../../helpers/fake-claude.js";

describe("claudeArgs", () => {
  it("gives the arguments of a new session", () => {
    expect(claudeArgs(runInput())).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--session-id",
      TEST_SESSION_ID,
      "--model",
      "haiku",
      "--effort",
      "low",
    ]);
  });

  it("resumes a continued session, and still gives the model and the effort", () => {
    const args = claudeArgs(runInput({ resume: true, model: "sonnet[1m]", effort: "low" }));

    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--resume",
      TEST_SESSION_ID,
      "--model",
      "sonnet[1m]",
      "--effort",
      "low",
    ]);
    expect(args).not.toContain("--session-id");
  });

  it("gives the schema as inline JSON text", () => {
    const schema = { type: "object", properties: { word: { type: "string" } } };

    const args = claudeArgs(runInput({ jsonSchema: schema }));

    expect(args.slice(-2)).toEqual(["--json-schema", JSON.stringify(schema)]);
  });

  it("gives the permission mode", () => {
    const args = claudeArgs(runInput({ permissionMode: "dontAsk" }));

    expect(args.slice(-2)).toEqual(["--permission-mode", "dontAsk"]);
  });

  it("gives each tool rule as its own argument, with the two lists last", () => {
    const args = claudeArgs(
      runInput({
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
    const args = claudeArgs(runInput({ allowedTools: [], disallowedTools: [] }));

    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--disallowedTools");
  });

  it("never gives a budget", () => {
    const args = claudeArgs(
      runInput({ jsonSchema: {}, permissionMode: "auto", allowedTools: ["Edit"], disallowedTools: ["Write"] }),
    );

    expect(args).not.toContain("--max-budget-usd");
  });

  it("gives the settings as inline JSON after the permission mode and before the tool rules", () => {
    const settings = { sandbox: { enabled: true } };

    const args = claudeArgs(
      runInput({ permissionMode: "dontAsk", allowedTools: ["Edit"], disallowedTools: ["Write"] }),
      settings,
    );

    const at = args.indexOf("--settings");
    expect(args[at + 1]).toBe(JSON.stringify(settings));
    expect(args.slice(at - 2, at)).toEqual(["--permission-mode", "dontAsk"]);
    expect(args[at + 2]).toBe("--allowedTools");
  });

  it("gives no --settings with no settings", () => {
    expect(claudeArgs(runInput({ permissionMode: "dontAsk" }))).not.toContain("--settings");
  });
});
