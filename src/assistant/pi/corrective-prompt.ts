import { packagePath } from "../../package-path.js";
import { fillTemplate } from "../../prompts/template.js";
import { readPromptTemplate } from "../../prompts/template-file.js";

export const CORRECTIVE_TEMPLATE_PATH = packagePath("prompt-templates/pi/corrective.md");

export function readCorrectiveTemplate(path: string): string {
  return readPromptTemplate(path).body;
}

export function correctivePrompt(
  template: string,
  problems: readonly string[],
  schema: Record<string, unknown>,
): string {
  return fillTemplate("pi/corrective", template, {
    PROBLEMS: problems.map((problem) => `- ${problem}`).join("\n"),
    SCHEMA: JSON.stringify(schema, null, 2),
  });
}
