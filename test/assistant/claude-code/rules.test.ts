import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeRules } from "../../../src/assistant/claude-code/rules.js";
import type { RunInput } from "../../../src/assistant/provider.js";
import { runInput } from "../../helpers/fake-claude.js";

// The rules of claude for one run input. The input comes from the shared test helper.
const rulesOf = (overrides: Partial<RunInput> = {}) => claudeRules(runInput(overrides));

const writeAllowList = (cwd: string, folder?: string): string[] => [
  `Read(/${cwd}/**)`,
  `Glob(/${cwd}/**)`,
  `Grep(/${cwd}/**)`,
  `Edit(/${cwd}/**)`,
  `Write(/${cwd}/**)`,
  "Bash",
  "StructuredOutput",
  "Skill",
  "TodoWrite",
  `NotebookEdit(/${cwd}/**)`,
  "Agent",
  "Task",
  ...(folder === undefined ? [] : [`Read(/${folder}/skills/**)`, `Read(/${folder}/plugins/**)`]),
];

describe("claudeRules", () => {
  it("gives the plan mode and no allow list for read-only access", () => {
    expect(rulesOf({ access: "read-only" })).toEqual({
      permissionMode: "plan",
      allowedTools: [],
      disallowedTools: [],
    });
  });

  it("gives no allow list for read-only access, also when HOME is set", () => {
    expect(rulesOf({ access: "read-only", env: { HOME: "/h" } })).toEqual({
      permissionMode: "plan",
      allowedTools: [],
      disallowedTools: [],
    });
  });

  it("gives the default mode and the allow list of the worktree for workspace-write access", () => {
    expect(rulesOf({ access: "workspace-write", cwd: "/work", env: { HOME: "/h" } })).toEqual({
      permissionMode: "default",
      allowedTools: writeAllowList("/work", "/h/.claude"),
      disallowedTools: [],
    });
  });

  it("makes a relative CLAUDE_CONFIG_DIR absolute", () => {
    const folder = resolve("rel-claude");
    expect(rulesOf({ access: "workspace-write", cwd: "/work", env: { CLAUDE_CONFIG_DIR: "rel-claude" } })).toEqual({
      permissionMode: "default",
      allowedTools: writeAllowList("/work", folder),
      disallowedTools: [],
    });
  });

  it("gives no skill rule when there is no configuration folder", () => {
    expect(writeAllowList("/work")).toHaveLength(12);
    expect(rulesOf({ access: "workspace-write", cwd: "/work", env: {} })).toEqual({
      permissionMode: "default",
      allowedTools: writeAllowList("/work"),
      disallowedTools: [],
    });
  });

  it("turns a denied command into a Bash rule", () => {
    expect(rulesOf({ deniedCommands: ["git push"] })).toEqual({
      permissionMode: "plan",
      allowedTools: [],
      disallowedTools: ["Bash(git push:*)"],
    });
  });

  it("turns a denied edit path into an Edit rule", () => {
    expect(rulesOf({ deniedEditPaths: ["/a/.git", "/a/**"] })).toEqual({
      permissionMode: "plan",
      allowedTools: [],
      disallowedTools: ["Edit(//a/.git)", "Edit(//a/**)"],
    });
  });

  it("puts the command rules before the path rules", () => {
    expect(
      rulesOf({
        access: "workspace-write",
        cwd: "/work",
        env: {},
        deniedCommands: ["git push", "herdr"],
        deniedEditPaths: ["/a/**"],
      }),
    ).toEqual({
      permissionMode: "default",
      allowedTools: writeAllowList("/work"),
      disallowedTools: ["Bash(git push:*)", "Bash(herdr:*)", "Edit(//a/**)"],
    });
  });
});
