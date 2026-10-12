import { existsSync, rmSync } from "node:fs";
import { delimiter, join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitError, runGit } from "../src/vcs/git/run.js";
import { createTaskWorktree } from "../src/vcs/git/worktree.js";
import {
  addCloneCommit,
  commitInWorktree,
  failureOf,
  fakeSsh,
  GIT_TEST_IDENTITY,
  gitTestEnv,
  localBranches,
  makeGitClone,
  makeGitOrigin,
  makeTempDir,
  sshKeyArgs,
  type GitOrigin,
} from "./helpers.js";

describe("makeGitOrigin", () => {
  let origin: GitOrigin;

  beforeEach(async () => {
    origin = await makeGitOrigin();
  });

  afterEach(() => {
    origin.remove();
  });

  const git = (...args: string[]) =>
    runGit(args, { gitDir: origin.path, env: origin.env }).then((out) => out.trim());

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
      await expect(origin.addCommit("main", { file })).rejects.toThrow(
        "addCommit needs a file inside the work repo",
      );
      expect(await origin.branchHead("main")).toBe(before);
    },
  );

  it("rejects a branch name that starts with -", async () => {
    await expect(origin.createBranch("-d")).rejects.toThrow(
      "the branch name must not start with -",
    );
    await expect(origin.addCommit("-x")).rejects.toThrow("the branch name must not start with -");
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
    const git = (...args: string[]) =>
      runGit(args, { gitDir: clone, env: origin.env }).then((out) => out.trim());

    expect(clone.startsWith(`${origin.dir}${sep}`)).toBe(true);
    expect(await git("rev-parse", "--is-bare-repository")).toBe("true");
    expect(await git("rev-parse", "refs/remotes/origin/main")).toBe(
      await origin.branchHead("main"),
    );
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

  const git = (...args: string[]) =>
    runGit(args, { gitDir: clone, env: origin.env }).then((out) => out.trim());

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
    const branchError = await failureOf(
      addCloneCommit(clone, origin.env, "-x", "refs/remotes/origin/main"),
      Error,
    );
    expect(branchError.message).toContain('"-x"');
    const parentError = await failureOf(addCloneCommit(clone, origin.env, "issue-1-x", "-p"), Error);
    expect(parentError.message).toContain('"-p"');
  });
});

describe("commitInWorktree", () => {
  let origin: GitOrigin;
  let worktree: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    const clone = await makeGitClone(origin);
    worktree = join(origin.dir, "worktrees", "issue-15");
    await createTaskWorktree({
      clone,
      env: origin.env,
      path: worktree,
      branch: "issue-15-x",
      baseRevision: "refs/remotes/origin/main",
    });
  });

  afterEach(() => {
    origin.remove();
  });

  const git = (...args: string[]) =>
    runGit(args, { cwd: worktree, env: origin.env }).then((out) => out.trim());

  it("commits the file and returns the new head", async () => {
    const sha = await commitInWorktree(worktree, origin.env, { file: "a/b.txt", content: "x" });
    expect(await git("rev-parse", "HEAD")).toBe(sha);
    expect(await git("show", "HEAD:a/b.txt")).toBe("x");
  });

  it("throws for a file outside the worktree", async () => {
    await expect(
      commitInWorktree(worktree, origin.env, { file: "../x" }),
    ).rejects.toThrow("commitInWorktree needs a file inside the worktree: ../x");
  });
});

describe("failureOf", () => {
  it("gives the error of a rejected promise", async () => {
    const error = new GitError("m", "x", "", "", 1);
    expect(await failureOf(Promise.reject(error), GitError)).toBe(error);
  });

  it("rejects when the promise resolves", async () => {
    await expect(failureOf(Promise.resolve(1), Error)).rejects.toThrow("resolved");
  });

  it("rejects when the error has another type", async () => {
    await expect(failureOf(Promise.reject(new Error("m")), GitError)).rejects.toThrow("not a");
  });
});

describe("fakeSsh", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir("tasker-fake-ssh-");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("puts the bin folder first on the PATH", () => {
    const ssh = fakeSsh(dir, gitTestEnv(dir), "serve");
    expect(ssh.env.PATH?.startsWith(join(dir, "bin") + delimiter)).toBe(true);
  });

  it("gives the ssh remote of a repo path", () => {
    const ssh = fakeSsh(dir, gitTestEnv(dir), "serve");
    expect(ssh.remote("/x/o.git")).toBe("ssh://tasker.invalid/x/o.git");
  });

  it("writes the fake ssh into the bin folder", () => {
    fakeSsh(dir, gitTestEnv(dir), "refuse");
    expect(existsSync(join(dir, "bin", "ssh"))).toBe(true);
  });
});

describe("sshKeyArgs", () => {
  it("gives the six ssh arguments of a key", () => {
    expect(sshKeyArgs("/k")).toEqual([
      "-i",
      "/k",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
    ]);
  });
});
