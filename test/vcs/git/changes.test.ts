import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedPaths, worktreeDiff } from "../../../src/vcs/git/changes.js";
import { runGit } from "../../../src/vcs/git/run.js";
import { createTaskWorktree, removeTaskWorktree } from "../../../src/vcs/git/worktree.js";
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
  const paths = (extra: Partial<Parameters<typeof changedPaths>[0]> = {}) =>
    changedPaths({ clone, env, branch: BRANCH, baseRevision: BASE, ...extra });
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

  describe("changedPaths", () => {
    it.each(["with space.txt", 'quo"te.txt', "new\nline.txt", "tab\tt.txt", "é.txt", "-dash.txt"])(
      "gives the raw path %j",
      async (file) => {
        await commitInWorktree(path, env, { file });
        expect(await paths()).toEqual([file]);
      },
    );

    it("lists a deleted file", async () => {
      await commitInWorktree(path, env, { file: "gone.txt" });
      await git("rm", "gone.txt");
      await git("commit", "-m", "remove gone.txt");
      expect(await paths()).toEqual(["gone.txt"]);
    });

    it("lists a binary file", async () => {
      await commitInWorktree(path, env, { file: "data.bin", content: "a\0b" });
      expect(await paths()).toEqual(["data.bin"]);
    });

    it("lists the old and the new path of a rename", async () => {
      await git("mv", "README.md", "moved.md");
      await git("commit", "-m", "rename README.md");
      expect((await paths()).sort()).toEqual(["README.md", "moved.md"]);
    });

    it("does not list a file that the base got after the fork", async () => {
      await commitInWorktree(path, env, { file: "feature.txt" });
      await moveBase();
      expect(await paths()).toEqual(["feature.txt"]);
    });

    it("gives an empty list for a fresh branch", async () => {
      expect(await paths()).toEqual([]);
    });

    it("works after the worktree is removed", async () => {
      await commitInWorktree(path, env, { file: "feature.txt" });
      await removeTaskWorktree({ clone, env, path });
      expect(await paths()).toEqual(["feature.txt"]);
    });

    it("refuses a missing task branch", async () => {
      const error = await failureOf(paths({ branch: "issue-99" }), Error);
      expect(error.message).toBe("cannot resolve the task branch: issue-99");
    });
  });
});
