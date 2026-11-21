import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../helpers/processes.js";
import { fragmentProblems } from "../../helpers/prompt-templates.js";

const path = join(fileURLToPath(repoRoot), "prompt-templates", "tasker", "execute-working-folder.md");

describe("execute-working-folder", () => {
  it("is a fragment file with the exact text of the rule", () => {
    expect(
      fragmentProblems(
        path,
        "Your working folder is already the worktree of the task, and each command starts there. Run commands from it with relative paths. Never `cd` to the absolute path of the worktree, and never pass that path to `git -C`. The settings of the assistant of the user can deny those forms, also when the same command without them runs.",
      ),
    ).toEqual([]);
  });
});
