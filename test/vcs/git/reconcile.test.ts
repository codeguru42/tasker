import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { worktreeState } from "../../../src/vcs/git/reconcile.js";
import { runGit } from "../../../src/vcs/git/run.js";
import { createTaskWorktree } from "../../../src/vcs/git/worktree.js";
import { failureOf, type GitOrigin, makeGitClone, makeGitOrigin } from "../../helpers.js";

describe("git reconcile", () => {
  let origin: GitOrigin;
  let env: NodeJS.ProcessEnv;
  let clone: string;
  let path: string;
  let target: string;

  const BASE = "refs/remotes/origin/main";
  const BRANCH = "issue-16-x";

  beforeEach(async () => {
    origin = await makeGitOrigin();
    env = origin.env;
    clone = await makeGitClone(origin);
    path = join(origin.dir, "worktrees", "issue-16");
    await createTaskWorktree({ clone, env, path, branch: BRANCH, baseRevision: BASE });
    target = realpathSync(path);
  });

  afterEach(() => {
    origin.remove();
  });

  // Runs git in the worktree and gives the trimmed output.
  const git = (...args: string[]) => runGit(args, { cwd: path, env }).then((out) => out.trim());
  const state = (extra: Partial<Parameters<typeof worktreeState>[0]> = {}) =>
    worktreeState({ clone, env, path, ...extra });

  describe("worktreeState", () => {
    it("gives the head, the branch and no changes for a fresh worktree", async () => {
      expect(await state()).toEqual({
        head: await git("rev-parse", BASE),
        branch: BRANCH,
        changes: [],
      });
    });

    it("gives no branch for a detached HEAD", async () => {
      await git("checkout", "--detach");
      const result = await state();
      expect(result.branch).toBeUndefined();
      expect(result.head).toBe(await git("rev-parse", "HEAD"));
    });

    it("lists an untracked file in the changes", async () => {
      writeFileSync(join(target, "note.txt"), "x");
      expect((await state()).changes).toEqual([{ status: "??", path: "note.txt" }]);
    });

    it("refuses a folder that is not a worktree", async () => {
      const plain = join(origin.dir, "plain");
      mkdirSync(plain);
      const error = await failureOf(state({ path: plain }), Error);
      expect(error.message).toBe(`not a worktree of the clone: ${plain}`);
    });
  });
});
