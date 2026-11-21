import { describe, expect, it } from "vitest";
import { packagePath } from "../../../src/package-path.js";
import { checkPromptTemplate } from "../../../src/prompts/template-file.js";

describe("prompt-templates/pi/answer-section.md", () => {
  it("has no problem", () => {
    expect(checkPromptTemplate(packagePath("prompt-templates/pi/answer-section.md"))).toEqual([]);
  });
});
