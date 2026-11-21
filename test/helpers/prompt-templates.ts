import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { packagePath } from "../../src/package-path.js";
import { TASKER_FAMILY, taskerPrompt } from "../../src/prompts/tasker-template.js";
import { fillTemplate, placeholderNames } from "../../src/prompts/template.js";
import {
  checkPromptTemplate,
  PATH_PROBLEM,
  promptTemplateParts,
  readPromptTemplate,
} from "../../src/prompts/template-file.js";

// The problems of the template folder: a .md file with a wrong path form, and a template with no test file
// <testDir>/<family>/<name>.test.ts. The problems come sorted by the path of the template. A missing folder has none.
export function promptTemplateTestProblems(templateDir: string, testDir: string): string[] {
  if (!existsSync(templateDir)) return [];
  const problems: string[] = [];
  const files = readdirSync(templateDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".md"))
    .sort();
  for (const file of files) {
    const parts = promptTemplateParts(join(templateDir, file));
    if (!parts) {
      problems.push(`${file}: ${PATH_PROBLEM}`);
    } else if (!existsSync(join(testDir, parts.family, `${parts.name}.test.ts`))) {
      problems.push(`${file}: has no test file ${parts.family}/${parts.name}.test.ts`);
    }
  }
  return problems;
}

// The problems of the fragment file at path. A fragment has no placeholder, and its body is exactly text.
export function fragmentProblems(path: string, text: string): string[] {
  const problems = checkPromptTemplate(path);
  if (problems.length > 0) return problems;
  const template = readPromptTemplate(path);
  if (Object.keys(template.placeholders).length > 0) problems.push("placeholders is not {}");
  if (template.body !== text) problems.push("the body is not the text");
  if (template.body.endsWith("\n") && !text.endsWith("\n")) problems.push("the body ends with a newline");
  return problems;
}

// The problems of the prompt file tasker/<name>.md under root, and of its filled text. The values fill each data
// placeholder.
export function promptFileProblems(
  name: string,
  values: Record<string, string>,
  root: string = packagePath("prompt-templates"),
): string[] {
  const path = join(root, TASKER_FAMILY, `${name}.md`);
  const problems = checkPromptTemplate(path);
  if (problems.length > 0) return problems;
  const template = readPromptTemplate(path);
  const used = [...placeholderNames(template.body)].sort().join(", ");
  const listed = Object.keys(template.placeholders).sort().join(", ");
  if (used !== listed) problems.push(`the placeholders of the body (${used}) differ from the list (${listed})`);
  const filled = fillTemplate(name, taskerPrompt(name, root), values);
  if (filled.includes("{{")) problems.push("the filled text holds {{");
  if (!filled.endsWith("\n") || filled.endsWith("\n\n")) problems.push("the filled text has an extra newline");
  return problems;
}
