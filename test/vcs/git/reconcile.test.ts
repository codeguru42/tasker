import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type FoundState,
  moveWorktreeTo,
  rebaseOnto,
  reconcileWorktree,
  restoreCommands,
  resyncWorktree,
  restoreWorktree,
  type StartState,
  worktreeState,
} from "../../../src/vcs/git/reconcile.js";
import { ReconcileConflictError } from "../../../src/vcs/errors.js";
import type { ReconcileStrategy } from "../../../src/vcs/provider.js";
import { GitError, runGit } from "../../../src/vcs/git/run.js";
import { createTaskWorktree, taskBranchName } from "../../../src/vcs/git/worktree.js";
import { failureOf } from "../../helpers/errors.js";
import { readArgLog } from "../../helpers/fake-commands.js";
import {
  commitInWorktree,
  gitRecorderEnv,
  landBranchOnOriginMain,
  makeGitClone,
  makeGitOrigin,
  taskNames,
  type GitOrigin,
  writeGitFailAfter,
} from "../../helpers/git.js";

describe("git reconcile", () => {
  let origin: GitOrigin;
  let env: NodeJS.ProcessEnv;
  let clone: string;
  let path: string;
  let branch: string;
  let target: string;

  const BASE = "refs/remotes/origin/main";

  beforeEach(async () => {
    origin = await makeGitOrigin();
    env = origin.env;
    clone = await makeGitClone(origin);
    ({ branch, worktree: path } = taskNames(join(origin.dir, "worktrees"), 16));
    await createTaskWorktree({ clone, env, path, branch, baseRevision: BASE });
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

  const reconcile = (strategy: ReconcileStrategy, extra: Partial<Parameters<typeof reconcileWorktree>[0]> = {}) =>
    reconcileWorktree({ clone, env, path, baseRevision: BASE, strategy, ...extra });
  // A task commit and a base commit that change the same file. It gives the base tip.
  const conflictSetup = async () => {
    await commitInWorktree(path, env, { file: "shared.txt", content: "task" });
    return moveBase({ file: "shared.txt", content: "base" });
  };
  const onto = (extra: Partial<Parameters<typeof rebaseOnto>[0]> = {}) =>
    rebaseOnto({ clone, env, path, upstream: "", onto: BASE, ...extra });
  const resync = (strategy: ReconcileStrategy, extra: Partial<Parameters<typeof resyncWorktree>[0]> = {}) =>
    resyncWorktree({ clone, env, path, baseRevision: BASE, strategy, ...extra });
  const restore = (start: StartState, extra: Partial<Parameters<typeof restoreWorktree>[0]> = {}) =>
    restoreWorktree({ clone, env, path, start, ...extra });
  // Tells whether a rebase or a merge is in progress. It does not use the code under test.
  const inProgressNow = async () => {
    const exists = async (name: string) => existsSync(resolve(target, await git("rev-parse", "--git-path", name)));
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
        branch,
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
      const branchHead = await git("rev-parse", `refs/heads/${branch}`);
      await commitInWorktree(path, env, { file: "a.txt" });
      await restore(start);
      await expectAsBefore(start);
      expect(await git("rev-parse", `refs/heads/${branch}`)).toBe(branchHead);
    });

    it("refuses a start revision that is not a full revision", async () => {
      const error = await failureOf(restore({ head: "main", branch }), Error);
      expect(error.message).toBe('the start revision is not a full revision: "main"');
    });

    it("refuses a start branch that is not a task branch name", async () => {
      const start = await state();
      const error = await failureOf(restore({ head: start.head, branch: "HEAD" }), Error);
      expect(error.message).toBe('not a task branch name: "HEAD"');
    });

    it("refuses a start branch that is not a task branch before any git call", async () => {
      const start = await state();
      const plain = join(origin.dir, "plain");
      mkdirSync(plain);
      const error = await failureOf(restore({ head: start.head, branch: "main" }, { path: plain }), Error);
      expect(error.message).toBe('not a task branch: "main"');
    });

    it("names the state and the commands when the restore cannot move the branch", async () => {
      await commitInWorktree(path, env, { file: "a.txt" });
      const start = await state();
      const base = await moveBase({});
      writeFileSync(join(clone, "refs", "heads", `${branch}.lock`), "");
      await failureOf(git("rebase", base), GitError);
      const detachedHead = await git("rev-parse", "HEAD");
      // The failed checkout has already staged the removal of the base file.
      const error = await failureOf(restore(start), Error);
      expect(
        error.message.startsWith(
          `cannot restore the worktree: ${target}: HEAD is at ${detachedHead}, detached, 1 uncommitted changes. ` +
            `Run these git commands in the worktree, in this order: ` +
            `git checkout --force -B ${branch} ${start.head}: `,
        ),
      ).toBe(true);
      expect(error.message).toContain(`${branch}.lock`);
      expect(error.message).not.toContain("git rebase --abort");
    });
  });

  describe("reconcileWorktree", () => {
    it("refuses a worktree on a branch that is not a task branch and changes nothing", async () => {
      await git("checkout", "-b", "feature-x");
      const start = await state();
      const branchHead = await git("rev-parse", "refs/heads/feature-x");
      const error = await failureOf(reconcile("rebase"), Error);
      expect(error.message).toBe('not a task branch: "feature-x"');
      expect(await state()).toEqual(start);
      expect(await git("rev-parse", "refs/heads/feature-x")).toBe(branchHead);
    });

    it("rebases the task commits onto the base tip", async () => {
      await commitInWorktree(path, env, { file: "a.txt" });
      const tip = await moveBase({ file: "b.txt" });
      const result = await reconcile("rebase");
      expect(await git("rev-parse", "HEAD^")).toBe(tip);
      expect((await state()).branch).toBe(branch);
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

    it("restores the worktree and rethrows when the step fails after it moved the branch", async () => {
      await commitInWorktree(path, env, { file: "a.txt" });
      await moveBase({ file: "b.txt" });
      const start = await state();
      const bin = join(origin.dir, "bin");
      writeGitFailAfter(bin, "rebase");
      const error = await failureOf(
        reconcile("rebase", { env: { ...env, PATH: `${bin}${delimiter}${String(process.env.PATH)}` } }),
        GitError,
      );
      expect(error.subcommand).toBe("rebase");
      await expectAsBefore(start);
    });

    it("throws the error of the restore when the restore fails too", async () => {
      await commitInWorktree(path, env, { file: "a.txt" });
      await moveBase({ file: "b.txt" });
      writeFileSync(join(clone, "refs", "heads", `${branch}.lock`), "");
      const error = await failureOf(reconcile("rebase"), Error);
      expect(error).not.toBeInstanceOf(GitError);
      expect(error.message).toContain("cannot restore the worktree");
      expect(error.message).toContain(`${branch}.lock`);
    });

    it.each(["rebase", "merge"] as const)("aborts a %s that stops on a conflict", async (strategy) => {
      const base = await conflictSetup();
      const start = await state();
      const error = await failureOf(reconcile(strategy), ReconcileConflictError);
      expect(error.paths).toEqual(["shared.txt"]);
      expect(error.message).toBe(`the ${strategy} onto ${base} stopped on conflicts: ${target}: "shared.txt"`);
      await expectAsBefore(start);
    });
  });

  describe("rebaseOnto", () => {
    it("rebases only the commits after the upstream", async () => {
      const upstream = await commitInWorktree(path, env, { file: "p.txt" });
      await commitInWorktree(path, env, { file: "g.txt" });
      const h = await commitInWorktree(path, env, { file: "h.txt" });
      const tip = await moveBase({ file: "b.txt" });
      const result = await onto({ upstream, onto: tip });
      expect(result).toBe(await git("rev-parse", "HEAD"));
      expect(result).not.toBe(h);
      expect(await git("rev-parse", "HEAD~2")).toBe(tip);
      expect(await git("ls-files")).toContain("g.txt");
      expect(await git("ls-files")).toContain("h.txt");
      expect(await git("ls-files")).not.toContain("p.txt");
      expect((await state()).branch).toBe(branch);
    });

    it("aborts and restores when a commit conflicts", async () => {
      const upstream = await commitInWorktree(path, env, { file: "p.txt" });
      await commitInWorktree(path, env, { file: "shared.txt", content: "task" });
      const tip = await moveBase({ file: "shared.txt", content: "base" });
      const start = await state();
      const error = await failureOf(onto({ upstream, onto: tip }), ReconcileConflictError);
      expect(error.paths).toEqual(["shared.txt"]);
      expect(error.message).toBe(`the rebase onto ${tip} stopped on conflicts: ${target}: "shared.txt"`);
      await expectAsBefore(start);
    });
  });

  describe("moveWorktreeTo", () => {
    const move = (revision: string, extra: Partial<Parameters<typeof moveWorktreeTo>[0]> = {}) =>
      moveWorktreeTo({ clone, env, path, revision, ...extra });

    it("moves the branch, HEAD and the tracked files to a descendant revision", async () => {
      const base = await git("rev-parse", "HEAD");
      const tip = await commitInWorktree(path, env, { file: "a.txt", content: "moved" });
      await git("reset", "--hard", base);
      expect(existsSync(join(target, "a.txt"))).toBe(false);
      expect(await move(tip)).toBe(tip);
      expect(await git("rev-parse", "HEAD")).toBe(tip);
      expect(await git("rev-parse", `refs/heads/${branch}`)).toBe(tip);
      expect(await git("show", "HEAD:a.txt")).toBe("moved");
      expect(existsSync(join(target, "a.txt"))).toBe(true);
      expect(await git("symbolic-ref", "HEAD")).toBe(`refs/heads/${branch}`);
      expect(await state()).toEqual({ head: tip, branch, changes: [] });
    });

    it("moves the branch, HEAD and the tracked files to an ancestor revision", async () => {
      const base = await git("rev-parse", "HEAD");
      await commitInWorktree(path, env, { file: "a.txt" });
      expect(await move(base)).toBe(base);
      expect(await git("rev-parse", `refs/heads/${branch}`)).toBe(base);
      expect(existsSync(join(target, "a.txt"))).toBe(false);
      expect(await state()).toEqual({ head: base, branch, changes: [] });
    });

    it("refuses an untracked file and changes nothing", async () => {
      const base = await git("rev-parse", "HEAD");
      const tip = await commitInWorktree(path, env, { file: "a.txt" });
      await git("reset", "--hard", base);
      writeFileSync(join(target, "a.txt"), "mine");
      const error = await failureOf(move(tip), Error);
      expect(error.message).toBe(`the worktree has uncommitted changes: ${target}: ["a.txt"]`);
      expect(await state()).toEqual({ head: base, branch, changes: [{ status: "??", path: "a.txt" }] });
      expect(await git("rev-parse", `refs/heads/${branch}`)).toBe(base);
    });

    it("refuses a detached HEAD and does not move it", async () => {
      const base = await git("rev-parse", "HEAD");
      const tip = await commitInWorktree(path, env, { file: "a.txt" });
      await git("checkout", "--detach", base);
      const error = await failureOf(move(tip), Error);
      expect(error.message).toBe(`the worktree has a detached HEAD: ${target}`);
      expect(await git("rev-parse", "HEAD")).toBe(base);
      expect(await git("rev-parse", `refs/heads/${branch}`)).toBe(tip);
    });

    it("refuses a branch without the shape of a task branch and does not move it", async () => {
      const base = await git("rev-parse", "HEAD");
      const tip = await commitInWorktree(path, env, { file: "a.txt" });
      const other = "feature-x";
      await git("checkout", "-b", other);
      await failureOf(move(base), Error);
      expect(await git("rev-parse", `refs/heads/${other}`)).toBe(tip);
      expect(await git("rev-parse", "HEAD")).toBe(tip);
    });

    it("refuses HEAD~1 before any git call", async () => {
      const recorded = gitRecorderEnv(origin.dir, env);
      const error = await failureOf(move("HEAD~1", { env: recorded.env }), Error);
      expect(error.message).toBe('not a full revision or ref: "HEAD~1"');
      expect(readArgLog(recorded.log)).toEqual([]);
    });
  });

  describe("resyncWorktree", () => {
    it("does nothing when the base did not move", async () => {
      await commitInWorktree(path, env, { file: "a.txt" });
      const start = await state();
      expect(await resync("rebase")).toEqual({ moved: false, how: "none", head: start.head });
    });

    it("does nothing when the task already holds the base", async () => {
      await commitInWorktree(path, env, { file: "a.txt" });
      const tip = await moveBase({ file: "b.txt" });
      await git("merge", "--no-edit", tip);
      const start = await state();
      expect(await resync("rebase")).toEqual({ moved: false, how: "none", head: start.head });
      expect(await git("rev-parse", "HEAD")).toBe(start.head);
    });

    it("does nothing when the base fast-forwarded to the task head outside tasker", async () => {
      await commitInWorktree(path, env, { file: "a.txt" });
      const start = await state();
      // Origin main takes the task commit by a fast-forward, as a landing outside tasker does.
      await landBranchOnOriginMain({ origin: origin.path, clone, branch, env });
      await runGit(["fetch", "origin"], { gitDir: clone, env });
      expect(await git("rev-parse", BASE)).toBe(start.head);
      expect(await resync("rebase")).toEqual({ moved: false, how: "none", head: start.head });
      expect(await git("rev-parse", "HEAD")).toBe(start.head);
    });

    it("fast-forwards a task with no own commits", async () => {
      const tip = await moveBase({ file: "b.txt" });
      expect(await resync("rebase")).toEqual({ moved: true, how: "fast-forward", head: tip });
      expect(await git("rev-parse", `refs/heads/${branch}`)).toBe(tip);
    });

    it.each(["rebase", "merge"] as const)("brings a diverged task onto the base with a %s", async (strategy) => {
      await commitInWorktree(path, env, { file: "a.txt" });
      await moveBase({ file: "b.txt" });
      const result = await resync(strategy);
      expect(result).toEqual({
        moved: true,
        how: strategy,
        head: await git("rev-parse", "HEAD"),
      });
    });

    it("aborts and restores when a diverged task conflicts", async () => {
      await conflictSetup();
      const start = await state();
      await failureOf(resync("rebase"), ReconcileConflictError);
      await expectAsBefore(start);
    });
  });
});

describe("restoreCommands", () => {
  const BRANCH = taskBranchName("issue-16", "x");
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const onBranch: StartState = { head: A, branch: BRANCH };
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
    expect(restoreCommands(onBranch, { ...right, head: B })).toEqual([`git checkout --force -B ${BRANCH} ${A}`]);
  });

  it("checks out the branch again when HEAD is detached", () => {
    expect(restoreCommands(onBranch, { ...right, branch: undefined })).toEqual([
      `git checkout --force -B ${BRANCH} ${A}`,
    ]);
  });

  it("detaches again when a detached start finds a branch", () => {
    const detached: StartState = { head: A, branch: undefined };
    expect(restoreCommands(detached, { ...right, branch: BRANCH })).toEqual([`git checkout --force --detach ${A}`]);
  });

  it("cleans untracked files", () => {
    expect(restoreCommands(onBranch, { ...right, changes: [untracked] })).toEqual(["git clean -fd"]);
  });

  it("resets tracked changes", () => {
    expect(restoreCommands(onBranch, { ...right, changes: [tracked] })).toEqual(["git reset --hard"]);
  });

  it("gives no reset when a checkout is in the list", () => {
    expect(restoreCommands(onBranch, { ...right, head: B, changes: [tracked, untracked] })).toEqual([
      `git checkout --force -B ${BRANCH} ${A}`,
      "git clean -fd",
    ]);
  });
});
