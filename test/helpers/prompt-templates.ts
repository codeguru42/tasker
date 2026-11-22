import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { packagePath } from "../../src/package-path.js";
import { TASKER_FAMILY, taskerPrompt } from "../../src/prompts/tasker-template.js";
import { fillTemplate } from "../../src/prompts/template.js";
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
  const filled = fillTemplate(name, taskerPrompt(name, root), values);
  if (filled.includes("{{")) problems.push("the filled text holds {{");
  if (!filled.endsWith("\n") || filled.endsWith("\n\n")) problems.push("the filled text has an extra newline");
  return problems;
}

// The problems of the question-pane template at path, and of its text after a fill with values. The body ends with
// FIRST-REPLY {{FIRST_REPLY}}, the filled text ends with FIRST-REPLY and the first reply, and the filled text holds no
// {{ before the first reply.
export function questionPaneTemplateProblems(path: string, values: Record<string, string>): string[] {
  const problems = checkPromptTemplate(path);
  if (problems.length > 0) return problems;
  const template = readPromptTemplate(path);
  if (!template.body.endsWith("FIRST-REPLY {{FIRST_REPLY}}")) {
    problems.push("the body does not end with FIRST-REPLY {{FIRST_REPLY}}");
  }
  const filled = fillTemplate(template.name, template.body, values);
  const end = `FIRST-REPLY ${values.FIRST_REPLY}`;
  let head = filled;
  if (filled.endsWith(end)) {
    head = filled.slice(0, filled.length - end.length);
  } else {
    problems.push("the filled text does not end with FIRST-REPLY and the first reply");
  }
  if (head.includes("{{")) problems.push("the filled text holds {{ before the first reply");
  return problems;
}

// The problems of the read step of the session file in the question-pane template at path. It throws if the file is
// not valid.
export function sessionReadProblems(path: string): string[] {
  const problems: string[] = [];
  const body = readPromptTemplate(path).body;
  if (!body.includes("git -C {{LOCAL_CLONE}} show origin/main:prompt-templates/question-pane/session.md")) {
    problems.push("the body does not read prompt-templates/question-pane/session.md");
  }
  if (/^\s*```/m.test(body)) problems.push("the body has a line that starts with three backticks");
  return problems;
}
