import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { packagePath } from "../../src/package-path.js";
import { readPromptTemplate } from "../../src/prompts/template-file.js";
import {
  fillFamilyTemplate,
  familyTemplateBody,
  familyTemplatePath,
  fragmentProblems,
  promptFileProblems,
  promptTemplateTestProblems,
  questionPaneTemplateProblems,
  sessionReadProblems,
} from "./prompt-templates.js";
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

  it("reports a rule name of the body that the list lacks", () => {
    expect(promptFileProblems("p", { DATA: "x" }, root("Text {{DATA}} {{RULE_FILE_ACCESS}}\n"))).toContain(
      "the body uses {{RULE_FILE_ACCESS}}, but placeholders does not list it",
    );
  });
});

function questionPaneText(placeholders: string[], body: string): string {
  const lines = placeholders.map((name) => `  ${name}: text`).join("\n");
  return `---\nname: q\ndescription: Load this template when you write a prompt.\nplaceholders:\n${lines}\n---\n${body}`;
}

function questionPaneFile(placeholders: string[], body: string): string {
  const path = join(useTempDir("tasker-question-pane-"), "prompt-templates", "question-pane", "q.md");
  writeFileWithParents(path, questionPaneText(placeholders, body));
  return path;
}

describe("questionPaneTemplateProblems", () => {
  const names = ["NAME", "FIRST_REPLY"];
  const body = "You are {{NAME}}. FIRST-REPLY {{FIRST_REPLY}}";
  const values = { NAME: "question-x", FIRST_REPLY: "Issue: x\nThe text {{NAME}} stays." };

  it("gives no problem for a valid template", () => {
    expect(questionPaneTemplateProblems(questionPaneFile(names, body), values)).toEqual([]);
  });

  it("reports a problem of the file check", () => {
    const text = "You are {{NAME}} {{OTHER}}. FIRST-REPLY {{FIRST_REPLY}}";
    expect(questionPaneTemplateProblems(questionPaneFile(names, text), values)).toContain(
      "the body uses {{OTHER}}, but placeholders does not list it",
    );
  });

  it("reports a body that does not end with the first reply", () => {
    expect(questionPaneTemplateProblems(questionPaneFile(names, `${body}\n`), values)).toContain(
      "the body does not end with FIRST-REPLY {{FIRST_REPLY}}",
    );
  });

  it("reports a filled text that holds {{ before the first reply", () => {
    expect(questionPaneTemplateProblems(questionPaneFile(names, body), { ...values, NAME: "{{X}}" })).toContain(
      "the filled text holds {{ before the first reply",
    );
  });

  it("reports a filled text that does not end with the first reply", () => {
    const problems = questionPaneTemplateProblems(
      questionPaneFile(names, "You are {{NAME}}. FIRST-REPLY {{FIRST_REPLY}} x"),
      { NAME: "question-x", FIRST_REPLY: "Issue: x" },
    );
    expect(problems).toContain("the body does not end with FIRST-REPLY {{FIRST_REPLY}}");
    expect(problems).toContain("the filled text does not end with FIRST-REPLY and the first reply");
  });
});

describe("sessionReadProblems", () => {
  const read = "2. Run git -C {{LOCAL_CLONE}} show origin/main:prompt-templates/question-pane/session.md.";

  it("gives no problem for a body that reads the session file", () => {
    expect(sessionReadProblems(questionPaneFile(["LOCAL_CLONE"], read))).toEqual([]);
  });

  it("reports a body that does not read the session file", () => {
    const text = "2. Run git -C {{LOCAL_CLONE}} show origin/main:docs/dev/question-pane.md.";
    expect(sessionReadProblems(questionPaneFile(["LOCAL_CLONE"], text))).toContain(
      "the body does not read prompt-templates/question-pane/session.md",
    );
  });

  it("reports a fence line", () => {
    expect(sessionReadProblems(questionPaneFile(["LOCAL_CLONE"], `${read}\n\`\`\`text\nx\n\`\`\`\n`))).toContain(
      "the body has a line that starts with three backticks",
    );
  });
});

describe("familyTemplatePath", () => {
  it("gives the path of the template of a family", () => {
    expect(familyTemplatePath("planner", "issue-review")).toBe(packagePath("prompt-templates/planner/issue-review.md"));
  });
});

describe("familyTemplateBody", () => {
  it("gives the body of the template of a family", () => {
    expect(familyTemplateBody("subagents", "task-restart")).toBe(
      readPromptTemplate(packagePath("prompt-templates/subagents/task-restart.md")).body,
    );
  });
});

describe("fillFamilyTemplate", () => {
  it("fills each placeholder with its value", () => {
    const names = Object.keys(
      readPromptTemplate(packagePath("prompt-templates/subagents/task-restart.md")).placeholders,
    );
    const values = Object.fromEntries(names.map((name) => [name, `value-of-${name}`]));
    const text = fillFamilyTemplate("subagents", "task-restart", values);
    expect(text).not.toContain("{{");
    for (const name of names) expect(text).toContain(`value-of-${name}`);
  });

  it("names the family and the template in the error for a missing value", () => {
    expect(() => fillFamilyTemplate("subagents", "task-restart", {})).toThrow(
      "prompt subagents/task-restart needs a value",
    );
  });
});
