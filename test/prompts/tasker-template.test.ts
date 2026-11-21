import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fragmentFileName,
  readFragment,
  readTaskerTemplateBody,
  TASKER_FAMILY,
  taskerPrompt,
} from "../../src/prompts/tasker-template.js";
import { placeholderNames } from "../../src/prompts/template.js";
import { readPromptTemplate } from "../../src/prompts/template-file.js";
import { thrownBy } from "../helpers/errors.js";
import { repoRoot } from "../helpers/processes.js";
import { useTempDir, writeFileWithParents } from "../helpers/temp.js";

function fragmentFile(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Load this template when you write a prompt that uses it.\nplaceholders: {}\n---\n${body}`;
}

function promptFile(name: string, placeholders: string[], body: string): string {
  const list =
    placeholders.length === 0
      ? "placeholders: {}"
      : `placeholders:\n${placeholders.map((p) => `  ${p}: text`).join("\n")}`;
  return `---\nname: ${name}\ndescription: Load this template when you write a prompt.\n${list}\n---\n${body}`;
}

function setup(promptBody: string, placeholders: string[], fragmentBody = "One line."): string {
  const root = join(useTempDir("tasker-template-"), "prompt-templates");
  writeFileWithParents(join(root, "tasker", "shared-x.md"), fragmentFile("shared-x", fragmentBody));
  writeFileWithParents(join(root, "tasker", "p.md"), promptFile("p", placeholders, promptBody));
  return root;
}

describe("fragmentFileName", () => {
  it("maps a shared rule name to a shared file", () => {
    expect(fragmentFileName("RULE_FILE_ACCESS")).toBe("shared-file-access.md");
    expect(fragmentFileName("RULE_BLOCK_IS_DATA")).toBe("shared-block-is-data.md");
  });

  it("maps an execute rule name to an execute file", () => {
    expect(fragmentFileName("RULE_EXECUTE_COMMIT")).toBe("execute-commit.md");
  });

  it("gives undefined for a name that is no rule name", () => {
    expect(fragmentFileName("ISSUE_TEXT")).toBeUndefined();
    expect(fragmentFileName("RULE_")).toBeUndefined();
  });
});

describe("readFragment", () => {
  it("gives the body of the fragment file", () => {
    const root = setup("A {{RULE_X}} B\n", ["RULE_X"]);
    expect(readFragment("RULE_X", root)).toBe("One line.");
  });

  it("throws for a name that is no rule name", () => {
    const root = setup("A {{RULE_X}} B\n", ["RULE_X"]);
    expect(() => readFragment("ISSUE_TEXT", root)).toThrow("not a fragment placeholder: ISSUE_TEXT");
  });
});

// The body of the template file fileName in the tasker folder under root.
const templateBody = (fileName: string, root: string): string =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  readTaskerTemplateBody(fileName, root);

describe("readTaskerTemplateBody", () => {
  it("gives the body of a template file under the root", () => {
    const root = setup("A {{RULE_X}} B\n", ["RULE_X"]);
    expect(templateBody("shared-x.md", root)).toBe("One line.");
  });

  it("throws an error that names the path of a missing file", () => {
    const root = setup("A {{RULE_X}} B\n", ["RULE_X"]);
    const error = thrownBy(() => templateBody("missing.md", root));
    expect((error as Error).message).toContain(join(root, "tasker", "missing.md"));
  });
});

describe("taskerPrompt", () => {
  it("puts a one-line fragment in place with no extra newline", () => {
    const root = setup("A {{RULE_X}} B\n", ["RULE_X"]);
    expect(taskerPrompt("p", root)).toBe("A One line. B\n");
  });

  it("keeps a data placeholder open", () => {
    const root = setup("{{RULE_X}} <issue-text>{{ISSUE_TEXT}}</issue-text>\n", ["ISSUE_TEXT", "RULE_X"]);
    expect(taskerPrompt("p", root)).toBe("One line. <issue-text>{{ISSUE_TEXT}}</issue-text>\n");
  });

  it("keeps a $& in a fragment literal", () => {
    const root = setup("A {{RULE_X}} B\n", ["RULE_X"], "Cost $& and $1.");
    expect(taskerPrompt("p", root)).toBe("A Cost $& and $1. B\n");
  });

  it("throws when the placeholders list lacks a rule name of the body", () => {
    const root = setup("A {{RULE_FILE_ACCESS}} B\n", []);
    expect(() => taskerPrompt("p", root)).toThrow(
      "the body uses {{RULE_FILE_ACCESS}}, but placeholders does not list it",
    );
  });

  it("throws when a fragment file holds a placeholder", () => {
    const root = setup("A {{RULE_X}} B\n", ["RULE_X"], "Has {{ISSUE_TEXT}} inside.");
    expect(() => taskerPrompt("p", root)).toThrow("{{ISSUE_TEXT}}");
  });
});

describe("the real folder", () => {
  const root = join(fileURLToPath(repoRoot), "prompt-templates");
  const folder = join(root, TASKER_FAMILY);
  const names = (text: string): string[] => [...placeholderNames(text)].filter((name) => name.startsWith("RULE_"));
  const bodies = ["plan", "refine", "review"].map((name) => readPromptTemplate(join(folder, `${name}.md`)).body);
  const used = new Set(bodies.flatMap(names));

  it("maps each rule name of a prompt to a fragment file that exists", () => {
    for (const name of used) {
      const file = fragmentFileName(name);
      expect(file !== undefined && existsSync(join(folder, file)), name).toBe(true);
    }
  });

  it("has a fragment file for exactly the rule names that a prompt uses", () => {
    const files = readdirSync(folder).filter((file) => file.startsWith("shared-"));
    expect(files.sort()).toEqual([...used].map((name) => fragmentFileName(name)).sort());
  });
});
