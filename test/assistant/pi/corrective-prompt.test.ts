import { describe, expect, it } from "vitest";
import {
  CORRECTIVE_TEMPLATE_PATH,
  correctivePrompt,
  readCorrectiveTemplate,
} from "../../../src/assistant/pi/corrective-prompt.js";
import { thrownBy } from "../../helpers/errors.js";
import { useMissingFile } from "../../helpers/temp.js";

describe("correctivePrompt", () => {
  it("gives the corrective prompt of the base", () => {
    const result = correctivePrompt(
      readCorrectiveTemplate(CORRECTIVE_TEMPLATE_PATH),
      ["first problem", "second problem"],
      { type: "object", properties: { a: { type: "string" } } },
    );

    expect(result).toBe(
      [
        "Tasker refuses your last answer. Tasker found these problems:",
        "",
        "- first problem",
        "- second problem",
        "",
        "Give the whole answer again. Call the tool `submit_answer` one time, as your last action. If the tool is gone, end",
        "your reply with one JSON object in a fenced `json` block. The answer must match this JSON Schema:",
        "",
        "```json",
        "{",
        '  "type": "object",',
        '  "properties": {',
        '    "a": {',
        '      "type": "string"',
        "    }",
        "  }",
        "}",
        "```",
      ].join("\n"),
    );
  });

  it("keeps placeholders in a problem as plain text", () => {
    const result = correctivePrompt(
      readCorrectiveTemplate(CORRECTIVE_TEMPLATE_PATH),
      ["x <schema> {{SCHEMA}} {{PROBLEMS}}"],
      {},
    );

    expect(result).toContain("- x <schema> {{SCHEMA}} {{PROBLEMS}}");
    expect(result.split("```json").length).toBe(2);
  });

  it("fills with fillTemplate", () => {
    expect(String(thrownBy(() => correctivePrompt("{{PROBLEMS}} {{SCHEMA}} {{OTHER}}", ["p"], {})))).toContain(
      "needs a value for {{OTHER}}",
    );
  });

  it("names the path of a missing template", () => {
    const path = useMissingFile("tasker-pi-corrective-", "corrective.md");

    expect(String(thrownBy(() => readCorrectiveTemplate(path)))).toContain(path);
  });
});
