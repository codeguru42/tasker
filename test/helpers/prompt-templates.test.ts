import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fragmentProblems, promptFileProblems, promptTemplateTestProblems } from "./prompt-templates.js";
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

function fragmentText(body: string, placeholders = "{}"): string {
  return `---\nname: shared-x\ndescription: Load this template when you write a prompt.\nplaceholders: ${placeholders}\n---\n${body}`;
}

function promptText(body: string): string {
  return `---\nname: p\ndescription: Load this template when you write a prompt.\nplaceholders:\n  DATA: text\n---\n${body}`;
}

describe("fragmentProblems", () => {
  function fragment(text: string): string {
    const path = join(useTempDir("tasker-fragment-"), "prompt-templates", "tasker", "shared-x.md");
    writeFileWithParents(path, text);
    return path;
  }

  it("gives no problem for a valid fragment", () => {
    expect(fragmentProblems(fragment(fragmentText("One line.")), "One line.")).toEqual([]);
  });

  it("reports a placeholder in the body", () => {
    expect(fragmentProblems(fragment(fragmentText("One {{X}} line.")), "One {{X}} line.")).not.toEqual([]);
  });

  it("reports a final newline in the body", () => {
    expect(fragmentProblems(fragment(fragmentText("One line.\n")), "One line.")).toContain(
      "the body ends with a newline",
    );
  });

  it("reports a body that is not the text", () => {
    expect(fragmentProblems(fragment(fragmentText("One line.")), "Other line.")).toContain("the body is not the text");
  });
});

describe("promptFileProblems", () => {
  function root(body: string): string {
    const dir = join(useTempDir("tasker-prompt-file-"), "prompt-templates");
    writeFileWithParents(join(dir, "tasker", "p.md"), promptText(body));
    return dir;
  }

  it("gives no problem for a valid prompt", () => {
    expect(promptFileProblems("p", { DATA: "x" }, root("Text {{DATA}}\n"))).toEqual([]);
  });

  it("reports a body that ends with two newlines", () => {
    expect(promptFileProblems("p", { DATA: "x" }, root("Text {{DATA}}\n\n"))).toContain(
      "the filled text has an extra newline",
    );
  });
});
