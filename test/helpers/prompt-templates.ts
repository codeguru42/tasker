import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PATH_PROBLEM, promptTemplateParts } from "../../src/prompts/template-file.js";

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
