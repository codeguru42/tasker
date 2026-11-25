/** Helpers that the tests of the subagent prompt templates share. */
import { fillFamilyTemplate, familyTemplateBody, familyTemplatePath } from "./prompt-templates.js";

/** Give the path of the template `prompt-templates/subagents/<name>.md`. */
export function subagentTemplatePath(name: string): string {
  return familyTemplatePath("subagents", name);
}

/** Give the body of the template `prompt-templates/subagents/<name>.md`. */
export function subagentTemplateBody(name: string): string {
  return familyTemplateBody("subagents", name);
}

/** Fill the template `prompt-templates/subagents/<name>.md` with the values. */
export function fillSubagentTemplate(name: string, values: Record<string, string>): string {
  return fillFamilyTemplate("subagents", name, values);
}
