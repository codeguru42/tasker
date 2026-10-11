import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionClone } from "../../../src/vcs/git/provision.js";
import { GitError, runGit } from "../../../src/vcs/git/run.js";
import { type GitOrigin, makeGitOrigin, makeTempDir } from "../../helpers.js";

const NO_TOKEN = "tasker: the push has no valid publish token";

describe("the pre-push hook", () => {
  let origin: GitOrigin;
  let tmp: string;
  let clone: string;
  let tokens: string;
  let wt: string;

  // A worktree of the clone on a new branch from origin/main, with one empty commit.
  async function addWorktree(branch: string, path: string): Promise<void> {
    const env = origin.env;
    await runGit(["worktree", "add", "-b", branch, "--", path, "origin/main"], {
      gitDir: clone,
      env,
    });
    await runGit(["commit", "--allow-empty", "-m", "x"], { cwd: path, env });
  }

  beforeEach(async () => {
    origin = await makeGitOrigin();
    // The quote and the dollar sign test the shell quoting of the tokens path.
    tmp = makeTempDir("tasker-push-'$x-");
    clone = join(tmp, "data", "clones", "x", "repo.git");
    tokens = join(tmp, "data", "clones", "x", "publish-tokens");
    wt = join(tmp, "data", "worktrees", "x", "wt");
    await provisionClone({
      remote: origin.path,
      clone,
      config: {},
      env: origin.env,
      publishTokens: tokens,
    });
    await addWorktree("work", wt);
  });

  afterEach(() => {
    origin.remove();
    rmSync(tmp, { recursive: true, force: true });
  });

  async function failure(promise: Promise<string>): Promise<GitError> {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(GitError);
    return error as GitError;
  }

  it("rejects a push from a worktree without a token", async () => {
    const error = await failure(
      runGit(["push", "origin", "HEAD:refs/heads/x"], { cwd: wt, env: origin.env }),
    );
    expect(error.stderr).toContain(NO_TOKEN);
    expect(await origin.branchHead("x")).toBeUndefined();
  });

  it("rejects a push that names the remote by its url", async () => {
    const error = await failure(
      runGit(["push", origin.path, "HEAD:refs/heads/x"], { cwd: wt, env: origin.env }),
    );
    expect(error.stderr).toContain(NO_TOKEN);
    expect(await origin.branchHead("x")).toBeUndefined();
  });

  it("rejects a push from the bare clone without a token", async () => {
    const error = await failure(
      runGit(["push", "origin", "main:refs/heads/y"], { gitDir: clone, env: origin.env }),
    );
    expect(error.stderr).toContain(NO_TOKEN);
    expect(await origin.branchHead("y")).toBeUndefined();
  });
});
