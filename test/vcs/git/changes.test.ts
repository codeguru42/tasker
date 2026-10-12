import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { worktreeDiff } from "../../../src/vcs/git/changes.js";
import { runGit } from "../../../src/vcs/git/run.js";
import { createTaskWorktree } from "../../../src/vcs/git/worktree.js";
import {
  commitInWorktree,
  failureOf,
  type GitOrigin,
  makeGitClone,
  makeGitOrigin,
} from "../../helpers.js";

describe("git changes", () => {
  let origin: GitOrigin;
  let env: NodeJS.ProcessEnv;
  let clone: string;
  let path: string;

  const BASE = "refs/remotes/origin/main";
  const BRANCH = "issue-15-x";

  beforeEach(async () => {
    origin = await makeGitOrigin();
    env = origin.env;
    clone = await makeGitClone(origin);
    path = join(origin.dir, "worktrees", "issue-15");
    await createTaskWorktree({ clone, env, path, branch: BRANCH, baseRevision: BASE });
  });

  afterEach(() => {
    origin.remove();
  });

  // Runs git in the worktree and gives the trimmed output.
  const git = (...args: string[]) => runGit(args, { cwd: path, env }).then((out) => out.trim());
  const diff = (extra: Partial<Parameters<typeof worktreeDiff>[0]> = {}) =>
    worktreeDiff({ clone, env, path, baseRevision: BASE, ...extra });
  // Adds a commit to the base on origin and fetches it into the clone.
  const moveBase = async () => {
    await origin.addCommit("main", { file: "base-only.txt" });
    await runGit(["fetch", "origin"], { gitDir: clone, env });
  };

  describe("worktreeDiff", () => {
    it("shows a commit of the branch", async () => {
      await commitInWorktree(path, env, { file: "feature.txt", content: "feature text" });
      const text = await diff();
      expect(text).toContain("feature.txt");
      expect(text).toContain("+feature text");
    });

    it("does not show a file that the base got after the fork", async () => {
      await commitInWorktree(path, env, { file: "feature.txt" });
      await moveBase();
      expect(await diff()).not.toContain("base-only.txt");
    });

    it("does not show an uncommitted change", async () => {
      await commitInWorktree(path, env, { file: "feature.txt" });
      writeFileSync(join(path, "README.md"), "changed\n");
      expect(await git("status", "--porcelain")).toBe("M README.md");
      expect(await diff()).not.toContain("README.md");
    });

    it("refuses a base that is not a full revision or a ref", async () => {
      const error = await failureOf(diff({ baseRevision: "main" }), Error);
      expect(error.message).toBe('not a full revision or ref: "main"');
    });

    it("refuses a folder that is not a worktree of the clone", async () => {
      const plain = join(origin.dir, "plain");
      mkdirSync(plain);
      const error = await failureOf(diff({ path: plain }), Error);
      expect(error.message).toBe(`not a worktree of the clone: ${plain}`);
    });
  });
});
