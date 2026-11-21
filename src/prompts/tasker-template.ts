// Reads the prompt template files of the tasker family. docs/dev/assistants.md gives the rules of the family.
import { join } from "node:path";
import { packagePath } from "../package-path.js";
import { readPromptTemplate } from "./template-file.js";

export const TASKER_FAMILY = "tasker";

const RULE_NAME = /^RULE_[A-Z0-9_]+$/;
const RULE_PLACEHOLDER = /\{\{(RULE_[A-Z0-9_]+)\}\}/g;

// The file name of the fragment of a RULE_ placeholder, or undefined for any other name.
export function fragmentFileName(placeholder: string): string | undefined {
  if (!RULE_NAME.test(placeholder)) {
    return undefined;
  }
  const words = placeholder.slice("RULE_".length).toLowerCase().replaceAll("_", "-");
  return words.startsWith("execute-") ? `${words}.md` : `shared-${words}.md`;
}

// The body of the fragment file of a RULE_ placeholder.
export function readFragment(placeholder: string, root: string = packagePath("prompt-templates")): string {
  const file = fragmentFileName(placeholder);
  if (file === undefined) {
    throw new Error(`not a fragment placeholder: ${placeholder}`);
  }
  return readPromptTemplate(join(root, TASKER_FAMILY, file)).body;
}

// The text of a prompt file with each RULE_ placeholder replaced by its fragment. Data placeholders stay open.
export function taskerPrompt(name: string, root: string = packagePath("prompt-templates")): string {
  const { body } = readPromptTemplate(join(root, TASKER_FAMILY, `${name}.md`));
  return body.replace(RULE_PLACEHOLDER, (_match, placeholder: string) => readFragment(placeholder, root));
}
