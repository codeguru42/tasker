import { describe, expect, it } from "vitest";
import { taskBranchName } from "../../../src/vcs/git/worktree.js";

describe("taskBranchName", () => {
  it.each([
    ["issue-14", "Git provider: task workspaces", "issue-14-git-provider-task-workspaces"],
    ["PROJ-3", "Fix it", "PROJ-3-fix-it"],
  ])("joins %s and the title %j into %s", (shortRef, title, expected) => {
    expect(taskBranchName(shortRef, title)).toBe(expected);
  });
});
