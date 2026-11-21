import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../helpers/processes.js";
import { fragmentProblems } from "../../helpers/prompt-templates.js";

const path = join(fileURLToPath(repoRoot), "prompt-templates", "tasker", "execute-file-access.md");

describe("execute-file-access", () => {
  it("is a fragment file with the exact text of the rule", () => {
    expect(
      fragmentProblems(
        path,
        "Never create or touch anything outside your working folder, with any tool, the shell included. That covers the configuration of tasker.",
      ),
    ).toEqual([]);
  });
});
