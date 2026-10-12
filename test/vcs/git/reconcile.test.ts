import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type FoundState,
  type ReconcileStrategy,
  reconcileWorktree,
  restoreCommands,
  restoreWorktree,
  type StartState,
  worktreeState,
} from "../../../src/vcs/git/reconcile.js";
import { GitError, runGit } from "../../../src/vcs/git/run.js";
import { createTaskWorktree } from "../../../src/vcs/git/worktree.js";
import {
  commitInWorktree,
  failureOf,
  type GitOrigin,
  makeGitClone,
  makeGitOrigin,
} from "../../helpers.js";

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
  // Adds a commit to the base on origin and fetches it into the clone.
  const moveBase = async (change: { file?: string; content?: string; message?: string }) => {
    const tip = await origin.addCommit("main", change);
    await runGit(["fetch", "origin"], { gitDir: clone, env });
    return tip;
  };
  const state = (extra: Partial<Parameters<typeof worktreeState>[0]> = {}) =>
    worktreeState({ clone, env, path, ...extra });

  const reconcile = (
    strategy: ReconcileStrategy,
    extra: Partial<Parameters<typeof reconcileWorktree>[0]> = {},
  ) => reconcileWorktree({ clone, env, path, baseRevision: BASE, strategy, ...extra });
  const restore = (
    start: StartState,
    extra: Partial<Parameters<typeof restoreWorktree>[0]> = {},
  ) => restoreWorktree({ clone, env, path, start, ...extra });
  // Tells whether a rebase or a merge is in progress. It does not use the code under test.
  const inProgressNow = async () => {
    const exists = async (name: string) =>
      existsSync(resolve(target, await git("rev-parse", "--git-path", name)));
    return {
      rebase: (await exists("rebase-merge")) || (await exists("rebase-apply")),
      merge: await exists("MERGE_HEAD"),
    };
  };
  const expectAsBefore = async (start: StartState) => {
    expect(await state()).toEqual({ ...start, changes: [] });
    expect(await inProgressNow()).toEqual({ rebase: false, merge: false });
  };
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

  describe("restoreWorktree", () => {
    it("puts back a worktree with a commit, an untracked file and a staged change", async () => {
      const start = await state();
      await commitInWorktree(path, env, { file: "a.txt" });
      writeFileSync(join(target, "note.txt"), "x");
      writeFileSync(join(target, "staged.txt"), "y");
      await git("add", "staged.txt");
      await restore(start);
      await expectAsBefore(start);
    });

    it("puts back a worktree that a rebase stopped on a conflict", async () => {
      await commitInWorktree(path, env, { file: "a.txt" });
      await commitInWorktree(path, env, { file: "shared.txt", content: "task" });
      const start = await state();
      const base = await moveBase({ file: "shared.txt", content: "base" });
      await failureOf(git("rebase", base), GitError);
      expect((await state()).branch).toBeUndefined();
      await restore(start);
      await expectAsBefore(start);
    });

    it("puts back a worktree that a merge stopped on a conflict", async () => {
      await commitInWorktree(path, env, { file: "shared.txt", content: "task" });
      const start = await state();
      const base = await moveBase({ file: "shared.txt", content: "base" });
      await failureOf(git("merge", "--no-edit", base), GitError);
      expect((await inProgressNow()).merge).toBe(true);
      await restore(start);
      await expectAsBefore(start);
    });

    it("puts back a detached start and leaves the branch where it is", async () => {
      await git("checkout", "--detach");
      const start = await state();
      expect(start.branch).toBeUndefined();
      const branchHead = await git("rev-parse", `refs/heads/${BRANCH}`);
      await commitInWorktree(path, env, { file: "a.txt" });
      await restore(start);
      await expectAsBefore(start);
      expect(await git("rev-parse", `refs/heads/${BRANCH}`)).toBe(branchHead);
    });

    it("refuses a start revision that is not a full revision", async () => {
      const error = await failureOf(restore({ head: "main", branch: BRANCH }), Error);
      expect(error.message).toBe('the start revision is not a full revision: "main"');
    });

    it("refuses a start branch that is not a task branch name", async () => {
      const start = await state();
      const error = await failureOf(restore({ head: start.head, branch: "HEAD" }), Error);
      expect(error.message).toBe('not a task branch name: "HEAD"');
    });

    it("names the state and the commands when the restore cannot move the branch", async () => {
      await commitInWorktree(path, env, { file: "a.txt" });
      const start = await state();
      const base = await moveBase({});
      writeFileSync(join(clone, "refs", "heads", `${BRANCH}.lock`), "");
      await failureOf(git("rebase", base), GitError);
      const detachedHead = await git("rev-parse", "HEAD");
      // The failed checkout has already staged the removal of the base file.
      const error = await failureOf(restore(start), Error);
      expect(error.message.startsWith(
        `cannot restore the worktree: ${target}: HEAD is at ${detachedHead}, detached, 1 uncommitted changes. ` +
          `Run these git commands in the worktree, in this order: ` +
          `git checkout --force -B ${BRANCH} ${start.head}: `,
      )).toBe(true);
      expect(error.message).toContain(`${BRANCH}.lock`);
      expect(error.message).not.toContain("git rebase --abort");
    });
  });

  describe("reconcileWorktree", () => {
    it("rebases the task commits onto the base tip", async () => {
      await commitInWorktree(path, env, { file: "a.txt" });
      const tip = await moveBase({ file: "b.txt" });
      const result = await reconcile("rebase");
      expect(await git("rev-parse", "HEAD^")).toBe(tip);
      expect((await state()).branch).toBe(BRANCH);
      expect(result).toBe(await git("rev-parse", "HEAD"));
    });

    it("merges the base tip into the task branch", async () => {
      const old = await commitInWorktree(path, env, { file: "a.txt" });
      const tip = await moveBase({ file: "b.txt" });
      const result = await reconcile("merge");
      expect(await git("rev-parse", "HEAD^1", "HEAD^2")).toBe(`${old}\n${tip}`);
      expect(result).toBe(await git("rev-parse", "HEAD"));
    });

    it("brings the base file with a merge although the configuration says pull.twohead=ours", async () => {
      const config = join(origin.dir, "gitconfig");
      writeFileSync(config, "[pull]\n\ttwohead = ours\n");
      await commitInWorktree(path, env, { file: "a.txt" });
      await moveBase({ file: "b.txt", content: "from the base" });
      await reconcile("merge", { env: { ...env, GIT_CONFIG_GLOBAL: config } });
      expect(await git("show", "HEAD:b.txt")).toBe("from the base");
    });

    it("refuses a dirty worktree and changes nothing", async () => {
      await commitInWorktree(path, env, { file: "a.txt" });
      await moveBase({ file: "b.txt" });
      writeFileSync(join(target, "note.txt"), "x");
      const start = await state();
      const error = await failureOf(reconcile("rebase"), Error);
      expect(error.message).toBe(`the worktree has uncommitted changes: ${target}: "note.txt"`);
      expect(await state()).toEqual(start);
    });

    it("refuses a base that is not a full revision or ref", async () => {
      const error = await failureOf(reconcile("rebase", { baseRevision: "main" }), Error);
      expect(error.message).toContain("not a full revision or ref");
    });
  });
});

describe("restoreCommands", () => {
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const onBranch: StartState = { head: A, branch: "issue-16-x" };
  const right: FoundState = { ...onBranch, changes: [], rebase: false, merge: false };
  const tracked = { status: " M", path: "a.txt" };
  const untracked = { status: "??", path: "n.txt" };

  it("gives no command for the right state", () => {
    expect(restoreCommands(onBranch, right)).toEqual([]);
  });

  it("aborts a rebase in progress", () => {
    expect(restoreCommands(onBranch, { ...right, rebase: true })).toEqual(["git rebase --abort"]);
  });

  it("aborts a merge in progress", () => {
    expect(restoreCommands(onBranch, { ...right, merge: true })).toEqual(["git merge --abort"]);
  });

  it("checks out the branch again when the head is wrong", () => {
    expect(restoreCommands(onBranch, { ...right, head: B })).toEqual([
      `git checkout --force -B issue-16-x ${A}`,
    ]);
  });

  it("checks out the branch again when HEAD is detached", () => {
    expect(restoreCommands(onBranch, { ...right, branch: undefined })).toEqual([
      `git checkout --force -B issue-16-x ${A}`,
    ]);
  });

  it("detaches again when a detached start finds a branch", () => {
    const detached: StartState = { head: A, branch: undefined };
    expect(restoreCommands(detached, { ...right, branch: "issue-16-x" })).toEqual([
      `git checkout --force --detach ${A}`,
    ]);
  });

  it("cleans untracked files", () => {
    expect(restoreCommands(onBranch, { ...right, changes: [untracked] })).toEqual([
      "git clean -fd",
    ]);
  });

  it("resets tracked changes", () => {
    expect(restoreCommands(onBranch, { ...right, changes: [tracked] })).toEqual([
      "git reset --hard",
    ]);
  });

  it("gives no reset when a checkout is in the list", () => {
    expect(restoreCommands(onBranch, { ...right, head: B, changes: [tracked, untracked] })).toEqual([
      `git checkout --force -B issue-16-x ${A}`,
      "git clean -fd",
    ]);
  });
});
