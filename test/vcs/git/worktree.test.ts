import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "../../../src/vcs/git/run.js";
import { taskBranchName, taskWorktreePath } from "../../../src/vcs/git/worktree.js";
import { makeGitClone, makeGitOrigin, type GitOrigin } from "../../helpers.js";

describe("taskBranchName", () => {
  it.each([
    ["issue-14", "Git provider: task workspaces", "issue-14-git-provider-task-workspaces"],
    ["PROJ-3", "Fix it", "PROJ-3-fix-it"],
  ])("joins %s and the title %j into %s", (shortRef, title, expected) => {
    expect(taskBranchName(shortRef, title)).toBe(expected);
  });
});

describe("taskBranchName with a bad short ref", () => {
  it.each(["", "-x", "a..b", "a/b", "x.lock", "HEAD", "a".repeat(101)])(
    "refuses the short ref %j",
    (shortRef) => {
      expect(() => taskBranchName(shortRef, "Fix it")).toThrow(
        `not a safe short ref: ${JSON.stringify(shortRef)}`,
      );
    },
  );

  it("gives a short ref of exactly 100 characters alone", () => {
    const shortRef = "a".repeat(100);
    expect(taskBranchName(shortRef, "Fix it")).toBe(shortRef);
  });
});

describe("taskWorktreePath", () => {
  it("puts the worktree in the worktrees folder, named after the short ref", () => {
    expect(taskWorktreePath("/data/worktrees/x", "issue-14")).toBe(
      join("/data/worktrees/x", "issue-14"),
    );
  });
});

describe("git fixture", () => {
  let origin: GitOrigin;
  let clone: string;
  let worktrees: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    await origin.addCommit("main", { file: ".gitignore", content: "ign\n" });
    clone = await makeGitClone(origin);
    worktrees = join(origin.dir, "worktrees");
    env = origin.env;
  });

  afterEach(() => {
    origin.remove();
  });

  it("makes the fixture", () => {
    expect(clone).toContain(origin.dir);
    expect(worktrees).toContain(origin.dir);
  });

  describe("taskBranchName for any title", () => {
    // The room for the slug after "issue-7-" is 100 - 7 - 1 = 92 characters.
    it.each([
      ["only symbols", "!!!", "issue-7"],
      ["an empty title", "", "issue-7"],
      ["only slashes", "///", "issue-7"],
      ["only spaces", "   ", "issue-7"],
      ["an upper-case .LOCK end", "Use X.LOCK", "issue-7-use-x"],
      ["repeated .lock ends", "a.lock.lock", "issue-7-a"],
      ["two dots", "a..b", "issue-7-a.b"],
      ["a leading dash", "-leading dash", "issue-7-leading-dash"],
      ["leading and trailing dots", "..dots..", "issue-7-dots"],
      ["a trailing dot", "trailing.", "issue-7-trailing"],
      ["an @{ sequence", "@{x}", "issue-7-x"],
      ["ref special characters", "a^b~c:d", "issue-7-a-b-c-d"],
      ["the word HEAD", "HEAD", "issue-7-head"],
      ["non-ASCII characters", "Café ☕", "issue-7-caf"],
      ["a title of exactly the room", "a".repeat(92), `issue-7-${"a".repeat(92)}`],
      ["a cut that lands on a dash", `${"a".repeat(91)}-bbb`, `issue-7-${"a".repeat(91)}`],
      ["a cut that lands on a dot", `${"a".repeat(91)}.bbb`, `issue-7-${"a".repeat(91)}`],
    ])("gives a valid name for %s", async (_label, title, expected) => {
      const name = taskBranchName("issue-7", title);
      expect(name).toBe(expected);
      expect(name.length).toBeLessThanOrEqual(100);
      await runGit(["check-ref-format", "--branch", name], { cwd: origin.dir, env });
    });

    it("keeps a 500-character title within 100 characters", async () => {
      const name = taskBranchName("issue-7", "word ".repeat(100));
      expect(name.length).toBeLessThanOrEqual(100);
      expect(name).toMatch(/^issue-7-word-word/);
      await runGit(["check-ref-format", "--branch", name], { cwd: origin.dir, env });
    });
  });
});
