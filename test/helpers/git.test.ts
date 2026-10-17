import { existsSync } from "node:fs";
import { delimiter, dirname, join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { GitError, runGit } from "../../src/vcs/git/run.js";
import {
  assertTaskBranchShape,
  createTaskWorktree,
  taskBranchName,
  taskWorktreePath,
} from "../../src/vcs/git/worktree.js";
import { failureOf } from "./errors.js";
import { readArgLog, realCommandPath } from "./fake-commands.js";
import {
  addCloneCommit,
  commitInWorktree,
  copyCloneBranchToOrigin,
  GIT_TEST_IDENTITY,
  landBranchOnOriginMain,
  gitCloneTokens,
  gitBeforePushEnv,
  gitRecorderEnv,
  gitTestEnv,
  type GitOrigin,
  localBranches,
  makeGitClone,
  makeGitOrigin,
  sshKeyArgs,
  taskNames,
} from "./git.js";
import { useTempDir } from "./temp.js";

describe("makeGitOrigin", () => {
  let origin: GitOrigin;

  beforeEach(async () => {
    origin = await makeGitOrigin();
  });

  afterEach(() => {
    origin.remove();
  });

  const git = (...args: string[]) => runGit(args, { gitDir: origin.path, env: origin.env }).then((out) => out.trim());

  it("makes a bare origin with one commit on main", async () => {
    expect(await git("rev-parse", "--is-bare-repository")).toBe("true");
    expect(await git("symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(await git("rev-list", "--count", "main")).toBe("1");
  });

  it("adds a commit and returns the new head", async () => {
    const sha = await origin.addCommit("main");
    expect(await origin.branchHead("main")).toBe(sha);
    expect(await git("rev-list", "--count", "main")).toBe("2");
  });

  it("creates a branch at the head of main", async () => {
    await origin.createBranch("feature");
    expect(await origin.branchHead("feature")).toBe(await origin.branchHead("main"));
  });

  it("moves only the branch that gets the commit", async () => {
    await origin.createBranch("feature");
    const mainHead = await origin.branchHead("main");
    await origin.addCommit("feature", { file: "a.txt", content: "x" });
    expect(await origin.branchHead("main")).toBe(mainHead);
    expect(await origin.branchHead("feature")).not.toBe(mainHead);
    expect(await git("show", "feature:a.txt")).toBe("x");
  });

  it("returns undefined for a missing branch", async () => {
    expect(await origin.branchHead("missing")).toBeUndefined();
  });

  it("does not take a branch for the prefix of another branch", async () => {
    await origin.createBranch("a/b");
    expect(await origin.branchHead("a/b")).toBeDefined();
    expect(await origin.branchHead("a")).toBeUndefined();
  });

  it("rejects a commit on a missing branch with a GitError", async () => {
    await expect(origin.addCommit("missing")).rejects.toBeInstanceOf(GitError);
  });

  it("uses the fixed test identity", async () => {
    expect(await git("log", "-1", "--format=%an <%ae>", "main")).toBe(
      `${GIT_TEST_IDENTITY.name} <${GIT_TEST_IDENTITY.email}>`,
    );
  });

  it("reads no git configuration of the host", () => {
    expect(origin.env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(origin.env.GIT_CONFIG_NOSYSTEM).toBe("1");
  });

  it("removes its folder", () => {
    expect(existsSync(origin.dir)).toBe(true);
    origin.remove();
    expect(existsSync(origin.dir)).toBe(false);
  });

  it("commits a file in a nested folder", async () => {
    await origin.addCommit("main", { file: "dir/sub/a.txt", content: "y" });
    expect(await git("show", "main:dir/sub/a.txt")).toBe("y");
  });

  it("adds one commit for each call, also with the same file and content", async () => {
    const first = await origin.addCommit("main", { file: "same.txt", content: "z" });
    const second = await origin.addCommit("main", { file: "same.txt", content: "z" });
    expect(second).not.toBe(first);
    expect(await git("rev-list", "--count", "main")).toBe("3");
  });

  it.each(["/tmp/x", "../x", "a/../../x", ".git/config"])(
    "rejects the file %s and leaves main as it was",
    async (file) => {
      const before = await origin.branchHead("main");
      await expect(origin.addCommit("main", { file })).rejects.toThrow("addCommit needs a file inside the work repo");
      expect(await origin.branchHead("main")).toBe(before);
    },
  );

  it("rejects a branch name that starts with -", async () => {
    await expect(origin.createBranch("-d")).rejects.toThrow("the branch name must not start with -");
    await expect(origin.addCommit("-x")).rejects.toThrow("the branch name must not start with -");
  });
});

describe("taskNames", () => {
  it("gives the branch and the worktree of a GitHub issue number", () => {
    expect(taskNames("/w", 16)).toStrictEqual({
      branch: taskBranchName("issue-16", "x"),
      worktree: taskWorktreePath("/w", "issue-16"),
    });
  });

  it("uses the title for the branch", () => {
    expect(taskNames("/w", 5, "Add tasker show").branch).toBe(taskBranchName("issue-5", "Add tasker show"));
  });

  it("gives a branch with the shape of a task branch", () => {
    expect(() => assertTaskBranchShape(taskNames("/w", 1).branch)).not.toThrow();
  });
});

describe("makeGitClone", () => {
  let origin: GitOrigin;

  beforeEach(async () => {
    origin = await makeGitOrigin();
  });

  afterEach(() => {
    origin.remove();
  });

  it("makes a bare clone inside the origin folder with the remote branches fetched", async () => {
    const clone = await makeGitClone(origin);
    const git = (...args: string[]) => runGit(args, { gitDir: clone, env: origin.env }).then((out) => out.trim());

    expect(clone.startsWith(`${origin.dir}${sep}`)).toBe(true);
    expect(await git("rev-parse", "--is-bare-repository")).toBe("true");
    expect(await git("rev-parse", "refs/remotes/origin/main")).toBe(await origin.branchHead("main"));
  });

  it("puts the clone at the repo folder of tasker under the clone-data data root", async () => {
    const clone = await makeGitClone(origin);
    expect(clone).toBe(repoPaths(join(origin.dir, "clone-data"), "tasker").clone);
  });

  it("gives the publish tokens of that repo folder", async () => {
    await makeGitClone(origin);
    const { publishTokens } = repoPaths(join(origin.dir, "clone-data"), "tasker");
    expect(gitCloneTokens(origin)).toBe(publishTokens);
    expect(existsSync(dirname(publishTokens))).toBe(true);
  });
});

describe("addCloneCommit", () => {
  let origin: GitOrigin;
  let clone: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    clone = await makeGitClone(origin);
  });

  afterEach(() => {
    origin.remove();
  });

  const git = (...args: string[]) => runGit(args, { gitDir: clone, env: origin.env }).then((out) => out.trim());

  it("makes a new branch with origin main as the parent", async () => {
    const sha = await addCloneCommit(clone, origin.env, "b1");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await git("rev-parse", "refs/heads/b1")).toBe(sha);
    expect(await git("rev-parse", `${sha}^`)).toBe(await git("rev-parse", "refs/remotes/origin/main"));
  });

  it("makes only the branch that it names, and localBranches() lists it", async () => {
    await addCloneCommit(clone, origin.env, "b1");
    expect(await localBranches(clone, origin.env)).toEqual(["refs/heads/b1"]);
  });

  it("makes a child of the tip of an existing branch", async () => {
    const first = await addCloneCommit(clone, origin.env, "b1");
    const second = await addCloneCommit(clone, origin.env, "b1");
    expect(second).not.toBe(first);
    expect(await git("rev-parse", `${second}^`)).toBe(first);
    expect(await git("rev-parse", "refs/heads/b1")).toBe(second);
  });

  it("moves an existing branch to a commit on the given parent", async () => {
    const first = await addCloneCommit(clone, origin.env, "b1");
    const moved = await addCloneCommit(clone, origin.env, "b1", "refs/remotes/origin/main");
    expect(moved).not.toBe(first);
    expect(await git("rev-parse", "refs/heads/b1")).toBe(moved);
    expect(await git("rev-parse", `${moved}^`)).toBe(await git("rev-parse", "refs/remotes/origin/main"));
  });

  it("refuses a branch or a parent that starts with a dash", async () => {
    await failureOf(addCloneCommit(clone, origin.env, "-x"), Error);
    await failureOf(addCloneCommit(clone, origin.env, "b1", "-x"), Error);
  });

  it("names the value that starts with a dash in the error", async () => {
    const branchError = await failureOf(addCloneCommit(clone, origin.env, "-x", "refs/remotes/origin/main"), Error);
    expect(branchError.message).toContain('"-x"');
    const parentError = await failureOf(addCloneCommit(clone, origin.env, taskBranchName("issue-1", "x"), "-p"), Error);
    expect(parentError.message).toContain('"-p"');
  });
});

describe("landBranchOnOriginMain", () => {
  let origin: GitOrigin;
  let clone: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    clone = await makeGitClone(origin);
  });

  afterEach(() => {
    origin.remove();
  });

  const land = (branch: string) => landBranchOnOriginMain({ origin: origin.path, clone, branch, env: origin.env });

  it("moves main of the origin to the tip of the branch", async () => {
    const sha = await addCloneCommit(clone, origin.env, "tasker/x");
    await land("tasker/x");
    expect(await origin.branchHead("main")).toBe(sha);
  });

  it("rejects a branch that does not build on the tip of main, and main keeps its head", async () => {
    await addCloneCommit(clone, origin.env, "tasker/x");
    const head = await origin.addCommit("main");
    const error = await failureOf(land("tasker/x"), GitError);
    expect(error.message).toContain("non-fast-forward");
    expect(await origin.branchHead("main")).toBe(head);
  });

  it("rejects a name that starts with - and runs no git", async () => {
    const head = await origin.branchHead("main");
    const error = await failureOf(land("-x"), Error);
    expect(error.message).toBe("the branch name must not start with -: -x");
    expect(await origin.branchHead("main")).toBe(head);
  });
});

describe("copyCloneBranchToOrigin", () => {
  let origin: GitOrigin;
  let clone: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    clone = await makeGitClone(origin);
  });

  afterEach(() => {
    origin.remove();
  });

  const copy = (branch: string, to?: string) =>
    copyCloneBranchToOrigin({ origin: origin.path, clone, branch, to, env: origin.env });

  it("puts the branch of the clone on the origin under the same name", async () => {
    const sha = await addCloneCommit(clone, origin.env, "tasker/x");
    await copy("tasker/x");
    expect(await origin.branchHead("tasker/x")).toBe(sha);
  });

  it("puts the branch of the clone on the origin under the name in to", async () => {
    const sha = await addCloneCommit(clone, origin.env, "tasker/x");
    await copy("tasker/x", "other");
    expect(await origin.branchHead("other")).toBe(sha);
    expect(await origin.branchHead("tasker/x")).toBeUndefined();
  });

  it("rejects a branch or a to that starts with - and runs no git", async () => {
    await addCloneCommit(clone, origin.env, "tasker/x");
    const branchError = await failureOf(copy("-x"), Error);
    expect(branchError.message).toBe("the branch name must not start with -: -x");
    const toError = await failureOf(copy("tasker/x", "-y"), Error);
    expect(toError.message).toBe("the branch name must not start with -: -y");
    expect(await origin.branchHead("tasker/x")).toBeUndefined();
  });
});

describe("commitInWorktree", () => {
  let origin: GitOrigin;
  let worktree: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    const clone = await makeGitClone(origin);
    const names = taskNames(join(origin.dir, "worktrees"), 15);
    worktree = names.worktree;
    await createTaskWorktree({
      clone,
      env: origin.env,
      path: worktree,
      branch: names.branch,
      baseRevision: "refs/remotes/origin/main",
    });
  });

  afterEach(() => {
    origin.remove();
  });

  const git = (...args: string[]) => runGit(args, { cwd: worktree, env: origin.env }).then((out) => out.trim());

  it("commits the file and returns the new head", async () => {
    const sha = await commitInWorktree(worktree, origin.env, { file: "a/b.txt", content: "x" });
    expect(await git("rev-parse", "HEAD")).toBe(sha);
    expect(await git("show", "HEAD:a/b.txt")).toBe("x");
  });

  it("throws for a file outside the worktree", async () => {
    await expect(commitInWorktree(worktree, origin.env, { file: "../x" })).rejects.toThrow(
      "commitInWorktree needs a file inside the worktree: ../x",
    );
  });
});

describe("sshKeyArgs", () => {
  it("gives the six ssh arguments of a key", () => {
    expect(sshKeyArgs("/k")).toEqual(["-i", "/k", "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes"]);
  });
});

describe("gitRecorderEnv", () => {
  it("puts the recorder first on the PATH of the base env and keeps the other values", () => {
    const dir = useTempDir("tasker-recorder-");
    const base = { ...gitTestEnv(dir), PATH: `/other${delimiter}${String(process.env.PATH)}`, MARK: "kept" };
    const { env, log } = gitRecorderEnv(dir, base);
    expect(env.PATH).toBe(`${join(dir, "gitbin")}${delimiter}${base.PATH}`);
    expect(env.MARK).toBe("kept");
    expect(log).toBe(join(dir, "git.log"));
  });

  it("logs each git call and runs the real git", async () => {
    const dir = useTempDir("tasker-recorder-");
    const base = { ...gitTestEnv(dir), PATH: `/other${delimiter}${String(process.env.PATH)}`, MARK: "kept" };
    const { env, log } = gitRecorderEnv(dir, base);
    const out = await runGit(["version"], { cwd: dir, env });
    expect(out).toMatch(/^git version /);
    expect(readArgLog(log)).toEqual([["version"]]);
  });

  it("gives the bin folder alone when the base env has no PATH", () => {
    const dir = useTempDir("tasker-recorder-");
    const { env } = gitRecorderEnv(dir, { HOME: dir });
    expect(env.PATH).toBe(join(dir, "gitbin"));
  });
});

describe("gitBeforePushEnv", () => {
  it("puts the wrapper first on the PATH of the base env and keeps the other values", () => {
    const dir = useTempDir("tasker-before-push-");
    const base = { ...gitTestEnv(dir), PATH: `/other${delimiter}${String(process.env.PATH)}`, MARK: "kept" };
    const env = gitBeforePushEnv(dir, base, [realCommandPath("true")]);
    expect(env.PATH).toBe(`${join(dir, "gitbin-before-push")}${delimiter}${base.PATH}`);
    expect(env.MARK).toBe("kept");
  });

  it("runs the command before a push and not before another call", async () => {
    const dir = useTempDir("tasker-before-push-");
    const marker = join(dir, "marker");
    const env = gitBeforePushEnv(dir, gitTestEnv(dir), [realCommandPath("touch"), marker]);
    await runGit(["version"], { cwd: dir, env });
    expect(existsSync(marker)).toBe(false);
    await failureOf(runGit(["push"], { cwd: dir, env }), GitError);
    expect(existsSync(marker)).toBe(true);
  });
});
