import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jiraShortRef } from "../../../src/issue-key/short-ref.js";
import { sandboxWritePaths } from "../../../src/vcs/git/assistant-surface.js";
import { uncommittedChanges, worktreeDiff } from "../../../src/vcs/git/changes.js";
import { GitError, runGit } from "../../../src/vcs/git/run.js";
import { shellQuote } from "../../../src/shell-quote.js";
import {
  assertTaskBranchNameAndShape,
  assertTaskBranchShape,
  assertTaskWorktree,
  createTaskWorktree,
  deleteTaskBranch,
  discardWorktreeChanges,
  listWorktrees,
  removeTaskWorktree,
  taskBranchExists,
  taskBranchName,
  taskBranchRevision,
  taskWorktreePath,
} from "../../../src/vcs/git/worktree.js";
import { failureOf } from "../../helpers/errors.js";
import {
  NOT_TASK_BRANCHES,
  gitOutput,
  localBranches,
  makeGitClone,
  makeGitOrigin,
  type GitOrigin,
} from "../../helpers/git.js";

const BRANCH = taskBranchName("issue-1", "x");
const OTHER_BRANCH = taskBranchName("issue-2", "y");
const MISSING_BRANCH = taskBranchName("issue-2", "nosuch");

describe("taskBranchName", () => {
  it.each([
    ["issue-14", "Git provider: task workspaces", "issue-14-git-provider-task-workspaces"],
    ["PROJ-3", "Fix it", "PROJ-3-fix-it"],
    ["issue-17", "Fix it", "issue-17-fix-it"],
    ["PROJ-12", "Fix it", "PROJ-12-fix-it"],
    ["A-B9-3", "Fix it", "A-B9-3-fix-it"],
    ["PROJ-X-12", "Fix it", "PROJ-X-12-fix-it"],
    ["acme-atlassian-net-browse-PROJ-12", "Fix it", "acme-atlassian-net-browse-PROJ-12-fix-it"],
    ["x-y-example-com-browse-Q-1", "Fix it", "x-y-example-com-browse-Q-1-fix-it"],
  ])("joins %s and the title %j into %s", (shortRef, title, expected) => {
    expect(taskBranchName(shortRef, title)).toBe(expected);
  });
});

describe("taskBranchName with a bad short ref", () => {
  it.each([
    "",
    "-x",
    "a..b",
    "a/b",
    "x.lock",
    "HEAD",
    "a".repeat(101),
    "main",
    "master",
    "issue-0",
    "feature",
    "proj-12",
    "A_B9-3",
    "PROJ_X-12",
    "acme.atlassian.net-browse-PROJ-12",
  ])("refuses the short ref %j", (shortRef) => {
    expect(() => taskBranchName(shortRef, "Fix it")).toThrow(`not a safe short ref: ${JSON.stringify(shortRef)}`);
  });

  it("gives a short ref of exactly 100 characters alone", () => {
    const shortRef = `${"a".repeat(86)}-browse-PROJ-1`;
    expect(shortRef).toHaveLength(100);
    expect(taskBranchName(shortRef, "Fix it")).toBe(shortRef);
  });
});

describe("assertTaskBranchShape", () => {
  it.each(["issue-7", "issue-7-fix-it", "PROJ-X-12-fix-it", "jira-example-com-browse-PROJ-X-12-fix-it"])(
    "accepts %s",
    (branch) => {
      expect(() => assertTaskBranchShape(branch)).not.toThrow();
    },
  );

  it.each([
    "issue-7-fix_it",
    "issue-7-v1.2",
    "A_B9-3-fix-it",
    "acme.atlassian.net-browse-PROJ-12-fix-it",
    "issue-7--x",
  ])("refuses %s", (branch) => {
    expect(() => assertTaskBranchShape(branch)).toThrow(`not a task branch: ${JSON.stringify(branch)}`);
  });
});

describe("assertTaskBranchNameAndShape", () => {
  it("accepts a task branch", () => {
    expect(() => assertTaskBranchNameAndShape("issue-7-fix-it")).not.toThrow();
  });

  it("refuses a name that is not a task branch name", () => {
    expect(() => assertTaskBranchNameAndShape("HEAD")).toThrow('not a task branch name: "HEAD"');
  });

  it("refuses a name with the wrong shape", () => {
    expect(() => assertTaskBranchNameAndShape("main")).toThrow('not a task branch: "main"');
  });
});

describe("taskWorktreePath", () => {
  it("puts the worktree in the worktrees folder, named after the short ref", () => {
    expect(taskWorktreePath("/data/worktrees/x", "issue-14")).toBe(join("/data/worktrees/x", "issue-14"));
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

  const base = "refs/remotes/origin/main";
  // The task worktree that create() makes by default.
  const path = () => taskWorktreePath(worktrees, "issue-1");
  const create = (extra: Partial<Parameters<typeof createTaskWorktree>[0]> = {}) =>
    createTaskWorktree({
      clone,
      env,
      path: path(),
      branch: BRANCH,
      baseRevision: base,
      ...extra,
    });
  const gitIn = (cwd: string, ...args: string[]) => gitOutput({ cwd }, env, ...args);
  const list = () => listWorktrees({ clone, env });
  const head = (branch: string) =>
    gitOutput({ gitDir: clone }, env, "show-ref", "--verify", "--hash", "--", `refs/heads/${branch}`);
  const addWorktree = (...args: string[]) => runGit(["worktree", "add", ...args], { gitDir: clone, env });
  const remove = (extra: Partial<Parameters<typeof removeTaskWorktree>[0]> = {}) =>
    removeTaskWorktree({ clone, env, path: path(), ...extra });

  describe("listWorktrees", () => {
    it("gives no entry for a new clone", async () => {
      expect(await list()).toEqual([]);
    });

    it("lists a worktree on a branch", async () => {
      const wt = join(realpathSync(origin.dir), "w1");
      await addWorktree("-b", "b1", "--", wt, base);
      expect(await list()).toEqual([{ path: wt, taskRef: "b1" }]);
    });

    it("lists a detached worktree without a branch", async () => {
      const wt = join(realpathSync(origin.dir), "w1");
      await addWorktree("--detach", "--", wt, base);
      expect(await list()).toEqual([{ path: wt }]);
    });

    it("gives the reason of a locked worktree", async () => {
      const wt = join(realpathSync(origin.dir), "w1");
      await addWorktree("-b", "b1", "--", wt, base);
      await runGit(["worktree", "lock", "--reason", "r", "--", wt], { gitDir: clone, env });
      expect(await list()).toEqual([{ path: wt, taskRef: "b1", lockReason: "r" }]);
    });

    it("gives an empty reason for a lock with no reason", async () => {
      const wt = join(realpathSync(origin.dir), "w1");
      await addWorktree("-b", "b1", "--", wt, base);
      await runGit(["worktree", "lock", "--", wt], { gitDir: clone, env });
      expect(await list()).toEqual([{ path: wt, taskRef: "b1", lockReason: "" }]);
    });

    it("lists the real path of a worktree added through a symlinked parent", async () => {
      const real = join(realpathSync(origin.dir), "real");
      mkdirSync(real);
      const link = join(origin.dir, "link");
      symlinkSync(real, link);
      await addWorktree("-b", "b1", "--", join(link, "w1"), base);
      expect(await list()).toEqual([{ path: join(real, "w1"), taskRef: "b1" }]);
    });
  });

  describe("createTaskWorktree, new branch", () => {
    it("makes a new branch and a worktree at the base", async () => {
      expect(existsSync(worktrees)).toBe(false);
      expect(await create()).toBe("created");
      expect(await gitIn(path(), "rev-parse", "HEAD")).toBe(await origin.branchHead("main"));
      expect(await gitIn(path(), "symbolic-ref", "HEAD")).toBe(`refs/heads/${BRANCH}`);
      await runGit(["show-ref", "--verify", "--quiet", "--", `refs/heads/${BRANCH}`], {
        gitDir: clone,
        env,
      });
    });

    it("gives the new branch no upstream", async () => {
      await create();
      const error = await failureOf(
        runGit(["config", "--get", `branch.${BRANCH}.remote`], { gitDir: clone, env }),
        GitError,
      );
      expect(error.exitCode).toBe(1);
    });

    it.each(["", "-x", "a..b", "HEAD", "a/b", "x.lock", "a".repeat(101)])(
      "refuses the branch name %j before any git call",
      async (branch) => {
        const error = await failureOf(create({ branch, env: {} }), Error);
        expect(error.message).toBe(`not a task branch name: ${JSON.stringify(branch)}`);
      },
    );

    it.each(NOT_TASK_BRANCHES)(
      "refuses the name %j, which has no task branch shape, before any git call or folder",
      async (branch) => {
        const error = await failureOf(create({ branch, env: {} }), Error);
        expect(error.message).toBe(`not a task branch: ${JSON.stringify(branch)}`);
        expect(existsSync(dirname(path()))).toBe(false);
      },
    );
  });

  describe("removeTaskWorktree", () => {
    const branchExists = () =>
      runGit(["show-ref", "--verify", "--quiet", "--", `refs/heads/${BRANCH}`], {
        gitDir: clone,
        env,
      }).then(
        () => true,
        () => false,
      );

    it("removes a clean worktree and keeps the branch", async () => {
      await create();
      await remove();
      expect(existsSync(path())).toBe(false);
      expect(await list()).toEqual([]);
      expect(await branchExists()).toBe(true);
    });

    it("refuses a worktree with a changed tracked file", async () => {
      await create();
      writeFileSync(join(path(), "README.md"), "changed\n");
      const error = await failureOf(remove(), GitError);
      expect(error.stderr).toContain("contains modified or untracked files");
      expect(readFileSync(join(path(), "README.md"), "utf8")).toBe("changed\n");
    });

    it("refuses a worktree with only an untracked file", async () => {
      await create();
      writeFileSync(join(path(), "new.txt"), "new\n");
      const error = await failureOf(remove(), GitError);
      expect(error.stderr).toContain("contains modified or untracked files");
      expect(existsSync(join(path(), "new.txt"))).toBe(true);
    });

    it("removes a worktree with only an ignored file", async () => {
      await create();
      writeFileSync(join(path(), "ign"), "ignored\n");
      await remove();
      expect(existsSync(path())).toBe(false);
    });

    it("refuses a locked worktree", async () => {
      await create();
      await runGit(["worktree", "lock", "--", path()], { gitDir: clone, env });
      await failureOf(remove(), GitError);
      expect(existsSync(path())).toBe(true);
    });

    it("removes a registered worktree with no folder", async () => {
      await create();
      rmSync(path(), { recursive: true });
      await remove();
      expect(await list()).toEqual([]);
    });

    it("refuses a plain folder", async () => {
      mkdirSync(path(), { recursive: true });
      await failureOf(remove(), GitError);
      expect(existsSync(path())).toBe(true);
    });
  });

  describe("createTaskWorktree, reused worktree", () => {
    it("uses the worktree again and does not move the branch", async () => {
      expect(await create()).toBe("created");
      const before = await head(BRANCH);
      expect(await create()).toBe("reused-worktree");
      expect(await head(BRANCH)).toBe(before);
      expect(await list()).toHaveLength(1);
    });

    it("uses the worktree again when the worktrees folder is a symlink", async () => {
      const real = join(origin.dir, "real-worktrees");
      mkdirSync(real);
      symlinkSync(real, worktrees);
      expect(await create()).toBe("created");
      expect(await create()).toBe("reused-worktree");
      expect(await list()).toHaveLength(1);
    });
  });

  describe("createTaskWorktree, reused branch", () => {
    // Makes the branch with one own commit and no worktree. Returns the commit SHA.
    const branchWithOwnCommit = async () => {
      await create();
      await gitIn(path(), "commit", "--allow-empty", "-m", "own");
      const own = await head(BRANCH);
      await remove();
      return own;
    };

    it("adds a worktree for a branch that no worktree holds", async () => {
      const own = await branchWithOwnCommit();
      expect(own).not.toBe(await origin.branchHead("main"));
      expect(await create()).toBe("reused-branch");
      expect(await gitIn(path(), "rev-parse", "HEAD")).toBe(own);
      expect(await head(BRANCH)).toBe(own);
    });

    it("accepts an empty folder at the path", async () => {
      const own = await branchWithOwnCommit();
      mkdirSync(path());
      expect(await create()).toBe("reused-branch");
      expect(await gitIn(path(), "rev-parse", "HEAD")).toBe(own);
    });

    it("replaces an unlocked entry whose folder is gone", async () => {
      await create();
      rmSync(path(), { recursive: true });
      expect(await create()).toBe("reused-branch");
      const entries = await list();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.path).toBe(path());
      expect(existsSync(path())).toBe(true);
    });
  });

  describe("createTaskWorktree, stopped create", () => {
    const lock = (...reason: string[]) => runGit(["worktree", "lock", ...reason, "--", path()], { gitDir: clone, env });

    it("repairs a worktree that a stopped checkout left, then unlocks it", async () => {
      await create();
      await lock("--reason", "initializing");
      rmSync(join(path(), ".gitignore"));
      writeFileSync(join(path(), "README.md"), "partial\n");
      expect(await create()).toBe("reused-worktree");
      expect(await gitIn(path(), "status", "--porcelain")).toBe("");
      expect(readFileSync(join(path(), ".gitignore"), "utf8")).toBe("ign\n");
      expect(readFileSync(join(path(), "README.md"), "utf8")).toBe("initial commit\n");
      const entries = await list();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.lockReason).toBeUndefined();
    });

    it("refuses a worktree locked initializing with an empty folder", async () => {
      await create();
      await lock("--reason", "initializing");
      rmSync(path(), { recursive: true });
      mkdirSync(path());
      const error = await failureOf(create(), Error);
      expect(error.message).toBe(`the worktree is locked: ${path()} (initializing)`);
    });

    it("refuses a worktree locked for another reason", async () => {
      await create();
      await lock("--reason", "r");
      const error = await failureOf(create(), Error);
      expect(error.message).toBe(`the worktree is locked: ${path()} (r)`);
    });

    it("refuses a worktree locked with no reason", async () => {
      await create();
      await lock();
      const error = await failureOf(create(), Error);
      expect(error.message).toBe(`the worktree is locked: ${path()} ()`);
    });

    it("refuses an unlocked worktree with no .git file", async () => {
      await create();
      rmSync(join(path(), ".git"));
      const error = await failureOf(create(), Error);
      expect(error.message).toBe(`the worktree has no .git file: ${path()}`);
    });

    it("refuses an unlocked worktree whose .git is a folder", async () => {
      await create();
      rmSync(join(path(), ".git"));
      await runGit(["init"], { cwd: path(), env });
      const error = await failureOf(create(), Error);
      expect(error.message).toBe(`the worktree has no .git file: ${path()}`);
    });
  });

  describe("createTaskWorktree, conflicts", () => {
    // Makes sure that create fails with message and changes no branch and no worktree.
    const expectConflict = async (message: string) => {
      const branchesBefore = await localBranches(clone, env);
      const worktreesBefore = await list();
      const error = await failureOf(create(), Error);
      expect(error.message).toBe(message);
      expect(await localBranches(clone, env)).toEqual(branchesBefore);
      expect(await list()).toEqual(worktreesBefore);
    };

    it("refuses another branch at the path", async () => {
      await addWorktree("-b", "other", "--", path(), base);
      await expectConflict(`the worktree path has another branch: ${path()} (other)`);
    });

    it("refuses a detached worktree at the path", async () => {
      await addWorktree("--detach", "--", path(), base);
      await expectConflict(`the worktree path has another branch: ${path()} (detached)`);
    });

    it("refuses the branch in a worktree at another path", async () => {
      const other = join(realpathSync(origin.dir), "other");
      await addWorktree("-b", BRANCH, "--", other, base);
      await expectConflict(`the branch ${BRANCH} is in another worktree: ${other}`);
    });

    it("refuses a file at the path", async () => {
      mkdirSync(worktrees);
      writeFileSync(path(), "file\n");
      await expectConflict(`something else is at the worktree path: ${path()}`);
    });

    it("refuses a folder with files at the path", async () => {
      mkdirSync(path(), { recursive: true });
      writeFileSync(join(path(), "file"), "file\n");
      await expectConflict(`something else is at the worktree path: ${path()}`);
    });
  });

  describe("taskBranchExists", () => {
    it("gives true after create()", async () => {
      await create();
      expect(await taskBranchExists({ clone, env, branch: BRANCH })).toBe(true);
    });

    it("gives false for a missing branch", async () => {
      expect(await taskBranchExists({ clone, env, branch: MISSING_BRANCH })).toBe(false);
    });

    it.each(["", "-x", "a..b", "HEAD"])("refuses the branch name %j before any git call", async (branch) => {
      const error = await failureOf(taskBranchExists({ clone, env: {}, branch }), Error);
      expect(error.message).toBe(`not a task branch name: ${JSON.stringify(branch)}`);
    });
  });

  describe("deleteTaskBranch", () => {
    const deleteBranch = (extra: Partial<Parameters<typeof deleteTaskBranch>[0]> = {}) =>
      deleteTaskBranch({ clone, env, branch: BRANCH, ...extra });

    it("deletes the local branch and leaves the origin alone", async () => {
      await origin.createBranch(BRANCH);
      const remoteHead = await origin.branchHead(BRANCH);
      await create();
      await remove();
      await deleteBranch();
      expect(await localBranches(clone, env)).not.toContain(`refs/heads/${BRANCH}`);
      expect(await origin.branchHead(BRANCH)).toBe(remoteHead);
    });

    it("refuses a missing branch", async () => {
      await failureOf(deleteBranch({ branch: MISSING_BRANCH }), GitError);
    });

    it("refuses a branch that a worktree holds", async () => {
      await create();
      await failureOf(deleteBranch(), GitError);
      expect(await localBranches(clone, env)).toContain(`refs/heads/${BRANCH}`);
    });

    it.each(["", "-x", "a..b", "HEAD"])("refuses the branch name %j before any git call", async (branch) => {
      const error = await failureOf(deleteBranch({ branch, env: {} }), Error);
      expect(error.message).toBe(`not a task branch name: ${JSON.stringify(branch)}`);
    });

    it.each(NOT_TASK_BRANCHES)(
      "refuses the name %j, which has no task branch shape, before any git call",
      async (branch) => {
        const error = await failureOf(deleteBranch({ branch, env: {} }), Error);
        expect(error.message).toBe(`not a task branch: ${JSON.stringify(branch)}`);
      },
    );

    describe.each(["issue-17", "PROJ-12", jiraShortRef("acme.atlassian.net/browse/PROJ-12"), jiraShortRef("A_B9-3")])(
      "the result of taskBranchName() for %s",
      (shortRef) => {
        it.each(["Fix it", "", "word ".repeat(100)])("has the shape for the title %j", (title) => {
          expect(() => assertTaskBranchShape(taskBranchName(shortRef, title))).not.toThrow();
        });
      },
    );
  });

  describe("discardWorktreeChanges", () => {
    const discard = (extra: Partial<Parameters<typeof discardWorktreeChanges>[0]> = {}) =>
      discardWorktreeChanges({ clone, env, path: path(), ...extra });

    it("discards all changes, keeps ignored files and leaves a removable worktree", async () => {
      await create();
      writeFileSync(join(path(), "README.md"), "changed\n");
      writeFileSync(join(path(), "staged.txt"), "staged\n");
      await gitIn(path(), "add", "staged.txt");
      rmSync(join(path(), ".gitignore"));
      writeFileSync(join(path(), "untracked.txt"), "untracked\n");
      mkdirSync(join(path(), "folder"));
      writeFileSync(join(path(), "folder", "file.txt"), "file\n");
      mkdirSync(join(path(), "nested"));
      await runGit(["init"], { cwd: join(path(), "nested"), env });
      writeFileSync(join(path(), "nested", "file.txt"), "nested\n");
      writeFileSync(join(path(), "ign"), "ignored\n");

      await discard();

      expect(await gitIn(path(), "status", "--porcelain")).toBe("");
      expect(readFileSync(join(path(), "README.md"), "utf8")).toBe("initial commit\n");
      expect(readFileSync(join(path(), ".gitignore"), "utf8")).toBe("ign\n");
      expect(existsSync(join(path(), "nested"))).toBe(false);
      expect(existsSync(join(path(), "ign"))).toBe(true);
      await remove();
      expect(existsSync(path())).toBe(false);
    });

    it("refuses a folder that is not a worktree of the clone", async () => {
      mkdirSync(path(), { recursive: true });
      writeFileSync(join(path(), "file.txt"), "file\n");
      const error = await failureOf(discard(), Error);
      expect(error.message).toBe(`not a worktree of the clone: ${path()}`);
      expect(existsSync(join(path(), "file.txt"))).toBe(true);
    });

    it("refuses a listed worktree with no .git file and leaves the outer repo alone", async () => {
      const outer = join(origin.dir, "outer");
      await runGit(["init", "--initial-branch=main", "--", outer], { cwd: origin.dir, env });
      writeFileSync(join(outer, "tracked.txt"), "committed\n");
      await gitIn(outer, "add", "tracked.txt");
      await gitIn(outer, "commit", "-m", "outer");
      writeFileSync(join(outer, "tracked.txt"), "changed\n");
      writeFileSync(join(outer, "untracked.txt"), "untracked\n");
      const wt = taskWorktreePath(join(outer, "worktrees"), "issue-1");
      await create({ path: wt });
      rmSync(join(wt, ".git"));

      const error = await failureOf(discard({ path: wt }), Error);

      expect(error.message).toBe(`the worktree has no .git file: ${wt}`);
      expect(readFileSync(join(outer, "tracked.txt"), "utf8")).toBe("changed\n");
      expect(existsSync(join(outer, "untracked.txt"))).toBe(true);
      expect(existsSync(join(wt, "README.md"))).toBe(true);
    });
  });

  describe("assertTaskWorktree", () => {
    const guard = (extra: Partial<Parameters<typeof assertTaskWorktree>[0]> = {}) =>
      assertTaskWorktree({ clone, env, path: path(), ...extra });

    it("gives the real path of a worktree of the clone", async () => {
      await create();
      expect(await guard()).toBe(realpathSync(path()));
    });

    it("refuses a folder that is not a worktree of the clone", async () => {
      mkdirSync(path(), { recursive: true });
      const error = await failureOf(guard(), Error);
      expect(error.message).toBe(`not a worktree of the clone: ${path()}`);
    });

    it("refuses a listed worktree whose .git is a folder", async () => {
      await create();
      rmSync(join(path(), ".git"));
      mkdirSync(join(path(), ".git"));
      const error = await failureOf(guard(), Error);
      expect(error.message).toBe(`the worktree has no .git file: ${realpathSync(path())}`);
    });

    // The admin dir of a worktree, read with a plain git call.
    const adminDir = (worktree: string) => gitIn(worktree, "rev-parse", "--git-dir");
    const ownGitDirError = () => `the worktree does not use its own git dir in the clone: ${realpathSync(path())}`;
    const marker = () => join(origin.dir, "fsmonitor-ran");

    // Points the commondir file of the worktree at a bare repo whose config runs a command
    // that writes the marker when git starts in the worktree.
    const tamperCommondir = async () => {
      const admin = await adminDir(path());
      await runGit(["init", "--bare", "fake.git"], { cwd: origin.dir, env });
      const fake = join(origin.dir, "fake.git");
      await runGit(["config", "core.fsmonitor", `touch ${shellQuote(marker())}; false`], {
        gitDir: fake,
        env,
      });
      writeFileSync(join(admin, "commondir"), `${fake}\n`);
    };

    it.each([
      [
        "the .git file names the admin dir of a second task worktree",
        // This case passes facts 1 to 3. Only fact 4 (the gitdir file of the admin dir) catches it.
        async (admin: string) => {
          await create({
            path: taskWorktreePath(worktrees, "issue-2"),
            branch: OTHER_BRANCH,
          });
          const other = await adminDir(taskWorktreePath(worktrees, "issue-2"));
          writeFileSync(join(path(), ".git"), `gitdir: ${other}\n`);
          return admin;
        },
      ],
      [
        "the .git file names the clone",
        async () => {
          writeFileSync(join(path(), ".git"), `gitdir: ${realpathSync(clone)}\n`);
        },
      ],
      [
        "the commondir file names another bare repo",
        async (admin: string) => {
          await runGit(["init", "--bare", "other.git"], { cwd: origin.dir, env });
          writeFileSync(join(admin, "commondir"), `${join(origin.dir, "other.git")}\n`);
        },
      ],
      [
        "the commondir file is missing",
        async (admin: string) => {
          rmSync(join(admin, "commondir"));
        },
      ],
    ])("refuses a worktree when %s", async (_name, tamper) => {
      await create();
      await tamper(await adminDir(path()));
      const error = await failureOf(guard(), Error);
      expect(error.message).toBe(ownGitDirError());
    });

    it.each([
      ["discardWorktreeChanges", () => discardWorktreeChanges({ clone, env, path: path() })],
      ["worktreeDiff", () => worktreeDiff({ clone, env, path: path(), baseRevision: base })],
      ["uncommittedChanges", () => uncommittedChanges({ clone, env, path: path() })],
      ["sandboxWritePaths", () => sandboxWritePaths({ clone, env, path: path() })],
    ])("%s refuses a tampered worktree before git starts there", async (_name, call) => {
      await create();
      await tamperCommondir();
      const error = await failureOf(call(), Error);
      expect(error.message).toBe(ownGitDirError());
      expect(existsSync(marker())).toBe(false);
    });

    it("runs the fake config when git starts in a tampered worktree", async () => {
      await create();
      await tamperCommondir();
      await runGit(["status", "--porcelain"], { cwd: path(), env });
      expect(existsSync(marker())).toBe(true);
    });
  });

  describe("taskBranchRevision", () => {
    const revision = (extra: Partial<Parameters<typeof taskBranchRevision>[0]> = {}) =>
      taskBranchRevision({ clone, env, branch: BRANCH, ...extra });

    it("gives the SHA of a created branch", async () => {
      await create();
      expect(await revision()).toBe(await origin.branchHead("main"));
    });

    it("refuses a missing branch", async () => {
      const error = await failureOf(revision(), Error);
      expect(error.message).toBe(`cannot resolve the task branch: ${BRANCH}`);
    });

    it("does not read another ref through the git name rules", async () => {
      const sha = (await origin.branchHead("main"))!;
      await runGit(["update-ref", `refs/heads/refs/heads/${BRANCH}`, sha], {
        gitDir: clone,
        env,
      });
      const error = await failureOf(revision(), Error);
      expect(error.message).toBe(`cannot resolve the task branch: ${BRANCH}`);
    });

    it.each(["", "a..b", "x~1", "x^{commit}", "-x"])("refuses the branch name %j", async (branch) => {
      const error = await failureOf(revision({ branch }), Error);
      expect(error.message).toBe(`not a task branch name: ${JSON.stringify(branch)}`);
    });
  });

  describe("taskBranchName for any title", () => {
    // The room for the slug after "issue-7-" is 100 - 7 - 1 = 92 characters.
    it.each([
      ["only symbols", "!!!", "issue-7"],
      ["an empty title", "", "issue-7"],
      ["only slashes", "///", "issue-7"],
      ["only spaces", "   ", "issue-7"],
      ["an upper-case .LOCK end", "Use X.LOCK", "issue-7-use-x-lock"],
      ["repeated .lock ends", "a.lock.lock", "issue-7-a-lock-lock"],
      ["two dots", "a..b", "issue-7-a-b"],
      ["a double dash", "a--b", "issue-7-a-b"],
      ["an underscore", "snake_case", "issue-7-snake-case"],
      ["a cut that lands on an underscore", `${"a".repeat(91)}_bbb`, `issue-7-${"a".repeat(91)}`],
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
