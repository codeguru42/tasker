import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fillTemplate } from "../../../src/prompts/template.js";
import { checkPromptTemplate, readPromptTemplate } from "../../../src/prompts/template-file.js";
import { repoRoot } from "../../helpers/processes.js";

const path = join(fileURLToPath(repoRoot), "prompt-templates", "tasker", "commit-rules.md");

const template = () => readPromptTemplate(path);

describe("commit-rules", () => {
  it("is a valid template file", () => {
    expect(checkPromptTemplate(path)).toEqual([]);
  });

  it("lists BASE_REF as its only placeholder", () => {
    expect(Object.keys(template().placeholders)).toEqual(["BASE_REF"]);
  });

  it("has a body with no final newline", () => {
    expect(template().body.endsWith("\n")).toBe(false);
  });

  it("fills to the text of the base commit", () => {
    const filled = fillTemplate("commit-rules", template().body, { BASE_REF: "0123abc" });
    expect(createHash("sha256").update(filled).digest("hex")).toBe(
      "2a293905a4529bd97dccb7da79c87a6774ad89e48585f371386ada494c1e004f",
    );
  });
});
