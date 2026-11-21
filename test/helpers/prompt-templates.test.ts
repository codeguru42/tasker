import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { promptTemplateTestProblems } from "./prompt-templates.js";
import { repoRoot } from "./processes.js";
import { useTempDir, writeFileWithParents } from "./temp.js";

const PATH_PROBLEM =
  "the path is not prompt-templates/<family>/<name>.md, with lowercase letters, digits and - in each part";

function folders(): { templateDir: string; testDir: string } {
  const root = useTempDir("tasker-prompt-templates-");
  return { templateDir: join(root, "prompt-templates"), testDir: join(root, "test", "prompt-templates") };
}

describe("promptTemplateTestProblems", () => {
  it("reports a template with no test file, then none after the test file exists", () => {
    const { templateDir, testDir } = folders();
    writeFileWithParents(join(templateDir, "fam", "x.md"), "text\n");
    expect(promptTemplateTestProblems(templateDir, testDir)).toEqual([
      join("fam", "x.md") + ": has no test file fam/x.test.ts",
    ]);
    writeFileWithParents(join(testDir, "fam", "x.test.ts"), "\n");
    expect(promptTemplateTestProblems(templateDir, testDir)).toEqual([]);
  });

  it("reports the templates sorted by path", () => {
    const { templateDir, testDir } = folders();
    writeFileWithParents(join(templateDir, "b", "y.md"), "text\n");
    writeFileWithParents(join(templateDir, "a", "z.md"), "text\n");
    expect(promptTemplateTestProblems(templateDir, testDir)).toEqual([
      join("a", "z.md") + ": has no test file a/z.test.ts",
      join("b", "y.md") + ": has no test file b/y.test.ts",
    ]);
  });

  it("gives no problem for an empty folder", () => {
    const { templateDir, testDir } = folders();
    writeFileWithParents(join(templateDir, ".keep"), "");
    expect(promptTemplateTestProblems(templateDir, testDir)).toEqual([]);
  });

  it("gives no problem for a missing folder", () => {
    const { templateDir, testDir } = folders();
    expect(promptTemplateTestProblems(templateDir, testDir)).toEqual([]);
  });

  it("reports a .md file with a wrong path form", () => {
    const { templateDir, testDir } = folders();
    writeFileWithParents(join(templateDir, "x.md"), "text\n");
    expect(promptTemplateTestProblems(templateDir, testDir)).toEqual(["x.md: " + PATH_PROBLEM]);
  });

  it("gives no problem for the real folders", () => {
    const root = fileURLToPath(repoRoot);
    expect(promptTemplateTestProblems(join(root, "prompt-templates"), join(root, "test/prompt-templates"))).toEqual([]);
  });
});
