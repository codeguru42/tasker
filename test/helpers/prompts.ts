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
