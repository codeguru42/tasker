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
      "--permission-mode",
      "plan",
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
      "--permission-mode",
      "plan",
    ]);
    expect(args).not.toContain("--session-id");
  });

  it("gives the schema as inline JSON text", () => {
    const schema = { type: "object", properties: { word: { type: "string" } } };

    const args = claudeArgs(runInput({ jsonSchema: schema }));

    expect(args[args.indexOf("--json-schema") + 1]).toBe(JSON.stringify(schema));
  });

  it("gives the plan mode for read-only access", () => {
    const args = claudeArgs(runInput({ access: "read-only" }));

    expect(args.slice(-2)).toEqual(["--permission-mode", "plan"]);
  });

  it("gives the default mode for workspace-write access", () => {
    const args = claudeArgs(runInput({ access: "workspace-write" }));

    expect(args[args.indexOf("--permission-mode") + 1]).toBe("default");
  });

  it("gives each tool rule as its own argument, with the two lists last", () => {
    const args = claudeArgs(
      runInput({
        access: "workspace-write",
        cwd: "/work",
        env: {},
        deniedCommands: ["git push"],
        deniedEditPaths: ["/a/**"],
      }),
    );

    expect(args.at(-3)).toBe("Bash(git push:*)");
    expect(args.slice(args.indexOf("--disallowedTools"))).toEqual([
      "--disallowedTools",
      "Bash(git push:*)",
      "Edit(//a/**)",
    ]);
    expect(args.indexOf("--allowedTools")).toBeLessThan(args.indexOf("--disallowedTools"));
    expect(args).toContain("Read(//work/**)");
  });

  it("gives no tool flag for the default input", () => {
    const args = claudeArgs(runInput());

    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--disallowedTools");
  });

  it("never gives a budget", () => {
    const args = claudeArgs(
      runInput({ jsonSchema: {}, access: "workspace-write", deniedCommands: ["git push"], deniedEditPaths: ["/a"] }),
    );

    expect(args).not.toContain("--max-budget-usd");
  });

  it("gives the settings as inline JSON after the permission mode and before the tool rules", () => {
    const settings = { sandbox: { enabled: true } };

    const args = claudeArgs(runInput({ access: "workspace-write", cwd: "/work", env: {} }), settings);

    const at = args.indexOf("--settings");
    expect(args[at + 1]).toBe(JSON.stringify(settings));
    expect(args.slice(at - 2, at)).toEqual(["--permission-mode", "default"]);
    expect(args[at + 2]).toBe("--allowedTools");
  });

  it("gives no --settings with no settings", () => {
    expect(claudeArgs(runInput({ access: "workspace-write" }))).not.toContain("--settings");
  });
});
