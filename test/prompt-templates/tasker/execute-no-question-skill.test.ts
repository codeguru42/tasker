import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../helpers/processes.js";
import { fragmentProblems } from "../../helpers/prompt-templates.js";

const path = join(fileURLToPath(repoRoot), "prompt-templates", "tasker", "execute-no-question-skill.md");

describe("execute-no-question-skill", () => {
  it("is a fragment file with the exact text of the rule", () => {
    expect(
      fragmentProblems(
        path,
        "Never use a skill that asks a person questions, for example `brainstorming`. No person can answer. There are no plan questions to ask now. If a real open point remains, use your best engineering judgment and note what you decided in your summary as an open question.",
      ),
    ).toEqual([]);
  });
});
