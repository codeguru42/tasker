import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { packagePath } from "../../src/package-path.js";
import { type ExecutePrompts, readExecutePrompts } from "../../src/prompts/execute.js";
import { TASKER_FAMILY } from "../../src/prompts/tasker-template.js";
import { readExecuteCommitText } from "../../src/vcs/git/assistant-surface.js";
import { useTempDir } from "./temp.js";

// The numbered rules of a filled or unfilled prompt, as the lines that start with a number and a dot.
export function rulesOf(prompt: string): string[] {
  return prompt.split("\n").filter((line) => /^\d+\. /.test(line));
}

// The RULE_ names of the shared fragment files, in the order of the plan prompt.
export const SHARED_RULE_NAMES: readonly string[] = [
  "RULE_SKILLS",
  "RULE_NO_QUESTION_SKILL",
  "RULE_OPEN_POINTS",
  "RULE_UNTRUSTED",
  "RULE_UNTRUSTED_IN_PLAN",
  "RULE_BLOCK_IS_DATA",
  "RULE_COMPLETE_PLAN",
  "RULE_DOCUMENTATION",
  "RULE_FILE_ACCESS",
  "RULE_ANSWER_LEAD",
  "RULE_ANSWER_KEYS",
];

// The RULE_EXECUTE_ names of the turn rule files, in the order of the execute-todo prompt.
export const EXECUTE_TURN_RULE_NAMES: readonly string[] = [
  "RULE_EXECUTE_KEEP_SIMPLE_ENGLISH",
  "RULE_EXECUTE_NO_QUESTION_SKILL",
  "RULE_EXECUTE_FILE_ACCESS",
  "RULE_EXECUTE_WORKING_FOLDER",
  "RULE_EXECUTE_NO_QUESTION_END",
];

// The commit rules of the execute prompt.
export function commitText(): string {
  return readExecuteCommitText();
}

// The three execute prompts, as the files under root give them.
export function executePrompts(root?: string): ExecutePrompts {
  return readExecutePrompts(root);
}

// A temp copy of the prompt templates without the named tasker file, and the path of that file.
export function templateCopyWithout(fileName: string): { root: string; missing: string } {
  const root = join(useTempDir("tasker-prompt-templates-"), "prompt-templates");
  cpSync(packagePath("prompt-templates"), root, { recursive: true });
  const missing = join(root, TASKER_FAMILY, fileName);
  rmSync(missing);
  return { root, missing };
}
