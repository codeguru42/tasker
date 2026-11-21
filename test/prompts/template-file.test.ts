import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPromptTemplate, promptTemplateParts, readPromptTemplate } from "../../src/prompts/template-file.js";
import { useTempDir, writeFileWithParents } from "../helpers/temp.js";

const PATH_PROBLEM =
  "the path is not prompt-templates/<family>/<name>.md, with lowercase letters, digits and - in each part";
const DESCRIPTION = "description: Load this template when a test needs it.";

function writeTemplate(family: string, name: string, text: string): string {
  const path = join(useTempDir("tasker-prompt-"), "prompt-templates", family, `${name}.md`);
  writeFileWithParents(path, text);
  return path;
}

function front(...lines: string[]): string {
  return ["---", ...lines, "---", ""].join("\n");
}

const VALID = `${front("name: x", DESCRIPTION, "placeholders:", "  A: the first value")}Body {{A}}\n`;

describe("checkPromptTemplate", () => {
  it("gives no problem for a valid file", () => {
    expect(checkPromptTemplate(writeTemplate("fam", "x", VALID))).toEqual([]);
  });

  it("reports a wrong name", () => {
    const text = `${front("name: y", DESCRIPTION, "placeholders:", "  A: v")}{{A}}\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual(['name "y" is not the file name "x"']);
  });

  it("reports a missing description", () => {
    const text = `${front("name: x", "placeholders:", "  A: v")}{{A}}\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual(["description is missing"]);
  });

  it("reports a description with a wrong start", () => {
    const text = `${front("name: x", "description: Use this.", "placeholders:", "  A: v")}{{A}}\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual([
      'description does not start with "Load this template when"',
    ]);
  });

  it("reports a missing placeholders key", () => {
    const text = `${front("name: x", DESCRIPTION)}no braces\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual(["placeholders is missing"]);
  });

  it("reports CRLF line ends", () => {
    expect(checkPromptTemplate(writeTemplate("fam", "x", VALID.replaceAll("\n", "\r\n")))).toEqual([
      "the file has CRLF line ends",
    ]);
  });

  it("reports a missing front matter", () => {
    expect(checkPromptTemplate(writeTemplate("fam", "x", "just text\n"))).toEqual([
      "the file has no front matter between two --- lines",
    ]);
  });

  it.each([
    ["a missing description", [], "description is missing"],
    ["a wrong description", ["description: Use this."], 'description does not start with "Load this template when"'],
  ])("reports three problems in one run with %s", (_label, descriptionLines, descriptionProblem) => {
    const text = `${front("name: y", ...descriptionLines)}no braces\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual([
      'name "y" is not the file name "x"',
      descriptionProblem,
      "placeholders is missing",
    ]);
  });

  it("reports a placeholder that the body does not use and one that the list lacks", () => {
    const text = `${front("name: x", DESCRIPTION, "placeholders:", "  B: v")}{{A}}\n`;
    const problems = checkPromptTemplate(writeTemplate("fam", "x", text));
    expect(problems).toHaveLength(2);
    expect(problems).toEqual(
      expect.arrayContaining([
        "placeholders lists {{B}}, but the body does not use it",
        "the body uses {{A}}, but placeholders does not list it",
      ]),
    );
  });

  it("accepts an empty placeholders list and a body with no braces", () => {
    const text = `${front("name: x", DESCRIPTION, "placeholders: {}")}plain\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual([]);
  });

  it("treats a lowercase {{a}} as plain text", () => {
    const text = `${front("name: x", DESCRIPTION, "placeholders: {}")}{{a}}\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual([]);
  });

  it("reports a front matter line with an unknown key", () => {
    const text = `${front("name: x", "color: red", DESCRIPTION, "placeholders: {}")}plain\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual([
      "front matter line 3 is not a known key: color: red",
    ]);
  });

  it("reports a placeholders key that is not a placeholder name", () => {
    const text = `${front("name: x", DESCRIPTION, "placeholders:", "  a: v")}plain\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual([
      "placeholders has a key that is not a placeholder name: a",
    ]);
  });

  it("reports a repeated name", () => {
    const text = `${front("name: x", "name: y", DESCRIPTION, "placeholders: {}")}plain\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual(["front matter line 3 repeats the key name"]);
  });

  it("reports a repeated description", () => {
    const text = `${front("name: x", DESCRIPTION, "description: Use this.", "placeholders: {}")}plain\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual([
      "front matter line 4 repeats the key description",
    ]);
  });

  it("reports a placeholders list followed by an empty placeholders key", () => {
    const text = `${front("name: x", DESCRIPTION, "placeholders:", "  A: v", "placeholders: {}")}{{A}}\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual([
      "front matter line 6 repeats the key placeholders",
    ]);
  });

  it("reports a repeated key and another fault in one run", () => {
    const text = `${front("name: x", "name: z", "placeholders: {}")}plain\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual([
      "front matter line 3 repeats the key name",
      "description is missing",
    ]);
  });

  it("reports a placeholder that stands twice in the list", () => {
    const text = `${front("name: x", DESCRIPTION, "placeholders:", "  A: the first value", "  A: the second value")}{{A}}\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual([
      "front matter line 6 repeats the placeholder A",
    ]);
  });

  it("reports a repeated placeholder and a repeated key in line order", () => {
    const text = `${front("name: x", "name: y", DESCRIPTION, "placeholders:", "  A: v", "  A: w")}{{A}}\n`;
    expect(checkPromptTemplate(writeTemplate("fam", "x", text))).toEqual([
      "front matter line 3 repeats the key name",
      "front matter line 7 repeats the placeholder A",
    ]);
  });

  it.each([["x"], ["Family/x"], ["a/b/c"]])("reports the path problem for prompt-templates/%s.md", (rest) => {
    const parts = rest.split("/");
    const name = parts.pop()!;
    const path = writeTemplate(parts.join("/"), name, VALID);
    expect(checkPromptTemplate(path)).toContain(PATH_PROBLEM);
  });

  it("reports a file that cannot be read", () => {
    const problems = checkPromptTemplate(join(useTempDir("tasker-prompt-"), "prompt-templates", "fam", "x.md"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("the file cannot be read: ");
  });
});

describe("promptTemplateParts", () => {
  it("gives the family and the name of a valid path", () => {
    expect(promptTemplateParts("/a/prompt-templates/fam-1/x-2.md")).toEqual({ family: "fam-1", name: "x-2" });
  });

  it.each(["/a/x.md", "/a/prompt-templates/x.md", "/a/prompt-templates/Fam/x.md", "/a/prompt-templates/a/b/c.md"])(
    "gives nothing for %s",
    (path) => {
      expect(promptTemplateParts(path)).toBeUndefined();
    },
  );
});

describe("readPromptTemplate", () => {
  it("gives the fields and the exact body", () => {
    const text = `${front("name: x", DESCRIPTION, "placeholders:", "  A: the first value")}line 1\n\nline 3\n{{A}}\n`;
    expect(readPromptTemplate(writeTemplate("fam", "x", text))).toEqual({
      name: "x",
      description: "Load this template when a test needs it.",
      placeholders: { A: "the first value" },
      body: "line 1\n\nline 3\n{{A}}\n",
    });
  });

  it("keeps a body with a final newline", () => {
    const text = `${front("name: x", DESCRIPTION, "placeholders: {}")}line 1\n\nline 3\n`;
    expect(readPromptTemplate(writeTemplate("fam", "x", text)).body).toBe("line 1\n\nline 3\n");
  });

  it("keeps a body with no final newline", () => {
    const text = `${front("name: x", DESCRIPTION, "placeholders: {}")}line 1`;
    expect(readPromptTemplate(writeTemplate("fam", "x", text)).body).toBe("line 1");
  });

  it("throws one error with the path and each problem", () => {
    const text = `${front("name: y", DESCRIPTION)}plain\n`;
    const path = writeTemplate("fam", "x", text);
    expect(() => readPromptTemplate(path)).toThrow(
      `prompt template ${path} has problems:\n- name "y" is not the file name "x"\n- placeholders is missing`,
    );
  });

  it("throws an error with the path for a missing file", () => {
    const path = join(useTempDir("tasker-prompt-"), "prompt-templates", "fam", "x.md");
    expect(() => readPromptTemplate(path)).toThrow(path);
    expect(() => readPromptTemplate(path)).toThrow("ENOENT");
  });
});
