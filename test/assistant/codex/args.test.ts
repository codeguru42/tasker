import { describe, expect, it } from "vitest";
import { codexArgs } from "../../../src/assistant/codex/args.js";
import type { Effort, RunInput, SandboxLimits } from "../../../src/assistant/provider.js";
import { expectedCodexArgs } from "../../helpers/fake-codex.js";
import { runInput } from "../../helpers/fake-claude.js";

function sandboxOf(denyRead: string[], allowWrite: string[] = []): SandboxLimits {
  return { allowWrite, denyRead, trackedPaths: async () => [], sharedFolder: "/shared" };
}

function argsOf(overrides: Partial<RunInput> = {}, files: { threadId?: string; schemaPath?: string } = {}) {
  return codexArgs(runInput(overrides), files);
}

describe("codexArgs", () => {
  it("gives the arguments of a new session with no sandbox", () => {
    expect(argsOf()).toEqual(expectedCodexArgs({ model: "haiku", effort: "low" }));
  });

  it("writes one key for each denied path with JSON.stringify", () => {
    const denyRead = ["/h/.ssh", "/h/a b", '/h/q"t'];

    expect(argsOf({ sandbox: sandboxOf(denyRead) })).toEqual(
      expectedCodexArgs({ model: "haiku", effort: "low", denyRead }),
    );
  });

  it("gives the arguments of a continued session", () => {
    expect(argsOf({ resume: true }, { threadId: "T1" })).toEqual(
      expectedCodexArgs({ model: "haiku", effort: "low", threadId: "T1" }),
    );
  });

  it("adds the schema file to a new session", () => {
    expect(argsOf({}, { schemaPath: "/s/a.schema.json" })).toEqual(
      expectedCodexArgs({ model: "haiku", effort: "low", schemaPath: "/s/a.schema.json" }),
    );
  });

  it("adds the schema file to a continued session", () => {
    expect(argsOf({ resume: true }, { threadId: "T1", schemaPath: "/s/a.schema.json" })).toEqual(
      expectedCodexArgs({ model: "haiku", effort: "low", threadId: "T1", schemaPath: "/s/a.schema.json" }),
    );
  });

  it("gives one key for a path that repeats", () => {
    const args = argsOf({ sandbox: sandboxOf(["/h/.ssh", "/h/.ssh"]) });

    expect(args).toEqual(expectedCodexArgs({ model: "haiku", effort: "low", denyRead: ["/h/.ssh"] }));
    expect(args.join("\n").split('"/h/.ssh"').length - 1).toBe(1);
  });

  it("does not read allowWrite", () => {
    expect(argsOf({ sandbox: sandboxOf([], ["/w", "/x"]) })).toEqual(argsOf({ sandbox: sandboxOf([]) }));
  });

  it("does not read deniedCommands", () => {
    expect(argsOf({ deniedCommands: ["git push", "herdr"] })).toEqual(argsOf());
  });

  it("never puts the prompt in the list", () => {
    expect(argsOf({ prompt: "SECRET PROMPT" }).join("\n")).not.toContain("SECRET PROMPT");
  });

  it.each<Effort>(["low", "medium", "high"])("passes the effort %s", (effort) => {
    expect(argsOf({ effort })).toContain(`model_reasoning_effort="${effort}"`);
  });

  it("holds no sandbox flag and no ephemeral flag", () => {
    const args = argsOf({ sandbox: sandboxOf(["/a"]) }, { threadId: "T1", schemaPath: "/s" });

    expect(args).not.toContain("-s");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("--ephemeral");
    expect(args.join("\n")).not.toContain("sandbox_mode");
  });
});
