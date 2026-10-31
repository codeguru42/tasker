import { resolve } from "node:path";
import { claudeConfigDir } from "../config-folders.js";
import type { RunInput } from "../provider.js";

type ClaudePermissionMode = "plan" | "default";

// The path is absolute. The // prefix marks an absolute path in the rule syntax of claude.
const rule = (tool: string, absolutePath: string) => `${tool}(/${absolutePath})`;

// The rules of claude for the neutral limits of one run. This is the one home of the rule syntax of claude.
export function claudeRules(input: RunInput): {
  permissionMode: ClaudePermissionMode;
  allowedTools: string[];
  disallowedTools: string[];
} {
  const cwd = input.cwd;
  const claudeDir = claudeConfigDir(input.env);
  // A deny wins over an allow, so git data changes only through git in the sandboxed shell.
  // The Edit rules cover each tool that edits a file, also Write. claude 2.1.310 warns that a Write deny rule
  // does not match in the file permission checks, and that only Edit rules match.
  const disallowedTools = [
    ...input.deniedCommands.map((words) => `Bash(${words}:*)`),
    ...input.deniedEditPaths.map((path) => rule("Edit", path)),
  ];
  if (input.access === "read-only") return { permissionMode: "plan", allowedTools: [], disallowedTools };
  return {
    // The default mode lets the PermissionRequest hook of tasker answer each question that no rule decides.
    // permissionHookSettings gives the reason.
    permissionMode: "default",
    // The path rules keep Read, Glob and Grep in the worktree.
    allowedTools: [
      rule("Read", `${cwd}/**`),
      rule("Glob", `${cwd}/**`),
      rule("Grep", `${cwd}/**`),
      rule("Edit", `${cwd}/**`),
      rule("Write", `${cwd}/**`),
      "Bash",
      // claude answers --json-schema through this tool. Without this rule, the hook denies the call (see permissionHookSettings).
      "StructuredOutput",
      "Skill",
      "TodoWrite",
      rule("NotebookEdit", `${cwd}/**`),
      // The model calls Agent. The init event of claude 2.1.300 lists Task.
      "Agent",
      "Task",
      // A skill points the model at reference files in these folders. Without these rules, the hook denies the read (see permissionHookSettings).
      // Never allow the whole folder: it holds the credentials and the settings.
      ...(claudeDir === undefined
        ? []
        : [rule("Read", `${resolve(claudeDir)}/skills/**`), rule("Read", `${resolve(claudeDir)}/plugins/**`)]),
    ],
    disallowedTools,
  };
}
