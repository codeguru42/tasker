/** Helpers that the tests of the subagent prompt templates share. */
import { packagePath } from "../../src/package-path.js";
import { fillTemplate } from "../../src/prompts/template.js";
import { readPromptTemplate } from "../../src/prompts/template-file.js";

/** Give the path of the template `prompt-templates/subagents/<name>.md`. */
export function subagentTemplatePath(name: string): string {
  return packagePath(`prompt-templates/subagents/${name}.md`);
}

/** Give the body of the template `prompt-templates/subagents/<name>.md`. */
export function subagentTemplateBody(name: string): string {
  return readPromptTemplate(subagentTemplatePath(name)).body;
}

/** Fill the template `prompt-templates/subagents/<name>.md` with the values. */
export function fillSubagentTemplate(name: string, values: Record<string, string>): string {
  return fillTemplate(`subagents/${name}`, subagentTemplateBody(name), values);
}
