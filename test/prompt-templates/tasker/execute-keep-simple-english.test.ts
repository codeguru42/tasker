import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../helpers/processes.js";
import { fragmentProblems } from "../../helpers/prompt-templates.js";

const path = join(fileURLToPath(repoRoot), "prompt-templates", "tasker", "execute-keep-simple-english.md");

describe("execute-keep-simple-english", () => {
  it("is a fragment file with the exact text of the rule", () => {
    expect(
      fragmentProblems(path, "Keep using the `simple-english` skill for this turn, as you did from the start."),
    ).toEqual([]);
  });
});
