import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../helpers/processes.js";
import { fragmentProblems } from "../../helpers/prompt-templates.js";

const path = join(fileURLToPath(repoRoot), "prompt-templates", "tasker", "execute-no-question-end.md");

describe("execute-no-question-end", () => {
  it("is a fragment file with the exact text of the rule", () => {
    expect(
      fragmentProblems(
        path,
        "Never end a turn with a question or a request for permission, because nobody is present. One denied command does not mean that every command is denied. Try another way, and report `blocked` only when the work truly cannot be finished.",
      ),
    ).toEqual([]);
  });
});
