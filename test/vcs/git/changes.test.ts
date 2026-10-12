import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changedPaths,
  hasCommitsNotIn,
  isAncestor,
  NO_OWN_COMMITS,
  ownCommitsText,
  uncommittedChanges,
  uncommittedRefusal,
  worktreeDiff,
} from "../../../src/vcs/git/changes.js";
import { GitError, runGit } from "../../../src/vcs/git/run.js";
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
  const ownCommits = (extra: Partial<Parameters<typeof ownCommitsText>[0]> = {}) =>
    ownCommitsText({ clone, env, branch: BRANCH, baseRevision: BASE, ...extra });
  const changes = (extra: Partial<Parameters<typeof uncommittedChanges>[0]> = {}) =>
    uncommittedChanges({ clone, env, path, ...extra });
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
      await git("rm", "README.md");
      await git("commit", "-m", "remove README.md");
      expect(await paths()).toEqual(["README.md"]);
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

  describe("ownCommitsText", () => {
    it("gives the no commits text for a fresh branch", async () => {
      expect(await ownCommits()).toBe(NO_OWN_COMMITS);
      expect(NO_OWN_COMMITS).toBe("This branch has no commits of its own since its base yet.");
    });

    it("gives the commits oldest first, each with its diff", async () => {
      const first = await commitInWorktree(path, env, {
        file: "one.txt",
        content: "one text",
        message: "first",
      });
      const second = await commitInWorktree(path, env, {
        file: "two.txt",
        content: "two text",
        message: "second",
      });
      const text = await ownCommits();
      const at = (needle: string) => text.indexOf(needle);
      expect(at(`commit ${first}`)).toBeGreaterThanOrEqual(0);
      expect(at(`commit ${first}`)).toBeLessThan(at("+one text"));
      expect(at("+one text")).toBeLessThan(at(`commit ${second}`));
      expect(at(`commit ${second}`)).toBeLessThan(at("+two text"));
    });

    it("does not show a file that the base got after the fork", async () => {
      await commitInWorktree(path, env, { file: "feature.txt" });
      await moveBase();
      expect(await ownCommits()).not.toContain("base-only.txt");
    });
  });

  describe("hasCommitsNotIn", () => {
    const has = (head: string, others: readonly string[]) =>
      hasCommitsNotIn({ clone, env, head, others });

    it("is true for a branch commit that the base does not reach", async () => {
      const sha = await commitInWorktree(path, env, { file: "feature.txt" });
      expect(await has(sha, [BASE])).toBe(true);
    });

    it("is false when another revision reaches the head", async () => {
      const sha = await commitInWorktree(path, env, { file: "feature.txt" });
      expect(await has(sha, [BASE, sha])).toBe(false);
    });

    it("is false for a fresh branch", async () => {
      expect(await has(`refs/heads/${BRANCH}`, [BASE])).toBe(false);
    });

    it("is true for each existing head when others is empty", async () => {
      expect(await has(BASE, [])).toBe(true);
    });

    it("refuses a head that is not a full revision or a ref", async () => {
      const error = await failureOf(has("main", [BASE]), Error);
      expect(error.message).toBe('not a full revision or ref: "main"');
    });
  });

  describe("uncommittedChanges", () => {
    it("gives an empty list for a clean worktree", async () => {
      expect(await changes()).toEqual([]);
    });

    it("lists a changed file and a new file", async () => {
      writeFileSync(join(path, "README.md"), "changed\n");
      writeFileSync(join(path, "new.txt"), "new\n");
      expect(await changes()).toEqual([
        { status: " M", path: "README.md" },
        { status: "??", path: "new.txt" },
      ]);
    });

    it("lists a new file when the configuration hides untracked files", async () => {
      await git("config", "status.showUntrackedFiles", "no");
      writeFileSync(join(path, "new.txt"), "new\n");
      expect(await changes()).toEqual([{ status: "??", path: "new.txt" }]);
    });

    it.each(["with space.txt", 'quo"te.txt', "new\nline.txt", "tab\tt.txt", "é.txt", "-dash.txt"])(
      "gives the raw path %j",
      async (file) => {
        writeFileSync(join(path, file), "text\n");
        expect(await changes()).toEqual([{ status: "??", path: file }]);
      },
    );

    it("gives two records for a staged rename", async () => {
      await git("mv", "README.md", "moved.md");
      expect(await changes()).toEqual([
        { status: "D ", path: "README.md" },
        { status: "A ", path: "moved.md" },
      ]);
    });

    it("refuses a folder that is not a worktree of the clone", async () => {
      const plain = join(origin.dir, "plain");
      mkdirSync(plain);
      const error = await failureOf(changes({ path: plain }), Error);
      expect(error.message).toBe(`not a worktree of the clone: ${plain}`);
    });
  });

  describe("isAncestor", () => {
    const ancestor = (a: string, d: string) =>
      isAncestor({ clone, env, ancestor: a, descendant: d });

    it("is true for the base and a branch commit", async () => {
      const sha = await commitInWorktree(path, env, { file: "feature.txt" });
      expect(await ancestor(BASE, sha)).toBe(true);
    });

    it("is true for the same commit", async () => {
      expect(await ancestor(BASE, BASE)).toBe(true);
    });

    it("is false the other way", async () => {
      const sha = await commitInWorktree(path, env, { file: "feature.txt" });
      expect(await ancestor(sha, BASE)).toBe(false);
    });

    it("passes on the failure of git for a commit that the clone does not have", async () => {
      const error = await failureOf(ancestor("1".repeat(40), BASE), GitError);
      expect(error.subcommand).toBe("merge-base");
      expect(error.exitCode).toBe(128);
    });

    it("refuses a missing ref", async () => {
      const error = await failureOf(ancestor("refs/heads/missing", BASE), Error);
      expect(error.message).toBe("cannot resolve the revision: refs/heads/missing");
    });
  });
});

describe("uncommittedRefusal", () => {
  it("names each path as JSON text", () => {
    const text = uncommittedRefusal("/w", [
      { status: " M", path: "README.md" },
      { status: "??", path: "a, b\n.txt" },
    ]);
    expect(text).toBe(
      `the worktree has uncommitted changes: /w: ${JSON.stringify("README.md")}, ${JSON.stringify("a, b\n.txt")}`,
    );
  });
});
