import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitError, runGit } from "../../../src/vcs/git/run.js";
import {
  createTaskWorktree,
  listWorktrees,
  removeTaskWorktree,
  taskBranchName,
  taskWorktreePath,
} from "../../../src/vcs/git/worktree.js";
import { failureOf, makeGitClone, makeGitOrigin, type GitOrigin } from "../../helpers.js";

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

  const create = (extra: Partial<Parameters<typeof createTaskWorktree>[0]> = {}) =>
    createTaskWorktree({
      clone,
      env,
      path: taskWorktreePath(worktrees, "issue-1"),
      branch: "issue-1-x",
      baseRevision: "refs/remotes/origin/main",
      ...extra,
    });
  const gitIn = (cwd: string, ...args: string[]) =>
    runGit(args, { cwd, env }).then((out) => out.trim());

  describe("listWorktrees", () => {
    const base = "refs/remotes/origin/main";
    const list = () => listWorktrees({ clone, env });
    const add = (...args: string[]) => runGit(["worktree", "add", ...args], { gitDir: clone, env });

    it("gives no entry for a new clone", async () => {
      expect(await list()).toEqual([]);
    });

    it("lists a worktree on a branch", async () => {
      const path = join(realpathSync(origin.dir), "w1");
      await add("-b", "b1", "--", path, base);
      expect(await list()).toEqual([{ path, branch: "b1" }]);
    });

    it("lists a detached worktree without a branch", async () => {
      const path = join(realpathSync(origin.dir), "w1");
      await add("--detach", "--", path, base);
      expect(await list()).toEqual([{ path }]);
    });

    it("gives the reason of a locked worktree", async () => {
      const path = join(realpathSync(origin.dir), "w1");
      await add("-b", "b1", "--", path, base);
      await runGit(["worktree", "lock", "--reason", "r", "--", path], { gitDir: clone, env });
      expect(await list()).toEqual([{ path, branch: "b1", lockReason: "r" }]);
    });

    it("gives an empty reason for a lock with no reason", async () => {
      const path = join(realpathSync(origin.dir), "w1");
      await add("-b", "b1", "--", path, base);
      await runGit(["worktree", "lock", "--", path], { gitDir: clone, env });
      expect(await list()).toEqual([{ path, branch: "b1", lockReason: "" }]);
    });

    it("lists the real path of a worktree added through a symlinked parent", async () => {
      const real = join(realpathSync(origin.dir), "real");
      mkdirSync(real);
      const link = join(origin.dir, "link");
      symlinkSync(real, link);
      await add("-b", "b1", "--", join(link, "w1"), base);
      expect(await list()).toEqual([{ path: join(real, "w1"), branch: "b1" }]);
    });
  });

  describe("createTaskWorktree, new branch", () => {
    it("makes a new branch and a worktree at the base", async () => {
      const path = taskWorktreePath(worktrees, "issue-1");
      expect(existsSync(worktrees)).toBe(false);
      expect(await create()).toBe("created");
      expect(await gitIn(path, "rev-parse", "HEAD")).toBe(await origin.branchHead("main"));
      expect(await gitIn(path, "symbolic-ref", "HEAD")).toBe("refs/heads/issue-1-x");
      await runGit(["show-ref", "--verify", "--quiet", "--", "refs/heads/issue-1-x"], {
        gitDir: clone,
        env,
      });
    });

    it("gives the new branch no upstream", async () => {
      await create();
      const error = await failureOf(
        runGit(["config", "--get", "branch.issue-1-x.remote"], { gitDir: clone, env }),
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
  });

  describe("removeTaskWorktree", () => {
    const remove = (extra: Partial<Parameters<typeof removeTaskWorktree>[0]> = {}) =>
      removeTaskWorktree({ clone, env, path: taskWorktreePath(worktrees, "issue-1"), ...extra });
    const path = () => taskWorktreePath(worktrees, "issue-1");
    const branchExists = () =>
      runGit(["show-ref", "--verify", "--quiet", "--", "refs/heads/issue-1-x"], {
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
      expect(await listWorktrees({ clone, env })).toEqual([]);
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
      expect(await listWorktrees({ clone, env })).toEqual([]);
    });

    it("refuses a plain folder", async () => {
      mkdirSync(path(), { recursive: true });
      await failureOf(remove(), GitError);
      expect(existsSync(path())).toBe(true);
    });
  });

  describe("createTaskWorktree, reused worktree", () => {
    const head = (branch: string) =>
      runGit(["show-ref", "--verify", "--hash", "--", `refs/heads/${branch}`], {
        gitDir: clone,
        env,
      }).then((out) => out.trim());

    it("uses the worktree again and does not move the branch", async () => {
      expect(await create()).toBe("created");
      const before = await head("issue-1-x");
      expect(await create()).toBe("reused-worktree");
      expect(await head("issue-1-x")).toBe(before);
      expect(await listWorktrees({ clone, env })).toHaveLength(1);
    });

    it("uses the worktree again when the worktrees folder is a symlink", async () => {
      const real = join(origin.dir, "real-worktrees");
      mkdirSync(real);
      symlinkSync(real, worktrees);
      expect(await create()).toBe("created");
      expect(await create()).toBe("reused-worktree");
      expect(await listWorktrees({ clone, env })).toHaveLength(1);
    });
  });

  describe("createTaskWorktree, reused branch", () => {
    const path = () => taskWorktreePath(worktrees, "issue-1");
    const head = (branch: string) =>
      runGit(["show-ref", "--verify", "--hash", "--", `refs/heads/${branch}`], {
        gitDir: clone,
        env,
      }).then((out) => out.trim());

    // Makes the branch with one own commit and no worktree. Returns the commit SHA.
    const branchWithOwnCommit = async () => {
      await create();
      await gitIn(path(), "commit", "--allow-empty", "-m", "own");
      const own = await head("issue-1-x");
      await removeTaskWorktree({ clone, env, path: path() });
      return own;
    };

    it("adds a worktree for a branch that no worktree holds", async () => {
      const own = await branchWithOwnCommit();
      expect(own).not.toBe(await origin.branchHead("main"));
      expect(await create()).toBe("reused-branch");
      expect(await gitIn(path(), "rev-parse", "HEAD")).toBe(own);
      expect(await head("issue-1-x")).toBe(own);
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
      const entries = await listWorktrees({ clone, env });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.path).toBe(path());
      expect(existsSync(path())).toBe(true);
    });
  });

  describe("createTaskWorktree, stopped create", () => {
    const path = () => taskWorktreePath(worktrees, "issue-1");
    const lock = (...reason: string[]) =>
      runGit(["worktree", "lock", ...reason, "--", path()], { gitDir: clone, env });

    it("repairs a worktree that a stopped checkout left, then unlocks it", async () => {
      await create();
      await lock("--reason", "initializing");
      rmSync(join(path(), ".gitignore"));
      writeFileSync(join(path(), "README.md"), "partial\n");
      expect(await create()).toBe("reused-worktree");
      expect(await gitIn(path(), "status", "--porcelain")).toBe("");
      expect(readFileSync(join(path(), ".gitignore"), "utf8")).toBe("ign\n");
      expect(readFileSync(join(path(), "README.md"), "utf8")).toBe("initial commit\n");
      const entries = await listWorktrees({ clone, env });
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
  });

  describe("createTaskWorktree, conflicts", () => {
    const path = () => taskWorktreePath(worktrees, "issue-1");
    const base = "refs/remotes/origin/main";
    const branches = () =>
      runGit(["for-each-ref", "--format=%(refname)", "refs/heads"], { gitDir: clone, env });
    const addRaw = (...args: string[]) =>
      runGit(["worktree", "add", ...args], { gitDir: clone, env });

    // Makes sure that create fails with message and changes no branch and no worktree.
    const expectConflict = async (message: string) => {
      const branchesBefore = await branches();
      const worktreesBefore = await listWorktrees({ clone, env });
      const error = await failureOf(create(), Error);
      expect(error.message).toBe(message);
      expect(await branches()).toBe(branchesBefore);
      expect(await listWorktrees({ clone, env })).toEqual(worktreesBefore);
    };

    it("refuses another branch at the path", async () => {
      await addRaw("-b", "other", "--", path(), base);
      await expectConflict(`the worktree path has another branch: ${path()} (other)`);
    });

    it("refuses a detached worktree at the path", async () => {
      await addRaw("--detach", "--", path(), base);
      await expectConflict(`the worktree path has another branch: ${path()} (detached)`);
    });

    it("refuses the branch in a worktree at another path", async () => {
      const other = join(realpathSync(origin.dir), "other");
      await addRaw("-b", "issue-1-x", "--", other, base);
      await expectConflict(`the branch issue-1-x is in another worktree: ${other}`);
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
