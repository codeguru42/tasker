import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionClone } from "../../../src/vcs/git/provision.js";
import { GitError, runGit } from "../../../src/vcs/git/run.js";
import { type GitOrigin, makeGitOrigin, makeTempDir } from "../../helpers.js";

const HEX = "0123456789abcdef";
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

  // Pushes HEAD of the worktree to x with token in TASKER_PUBLISH_TOKEN.
  function pushWith(token: string): Promise<string> {
    return runGit(["push", "origin", "HEAD:refs/heads/x"], {
      cwd: wt,
      env: { ...origin.env, TASKER_PUBLISH_TOKEN: token },
    });
  }

  it("accepts a push with a valid token and uses the token up", async () => {
    const token = HEX.repeat(4);
    mkdirSync(tokens, { recursive: true });
    writeFileSync(join(tokens, token), "");
    await pushWith(token);
    const head = (await runGit(["rev-parse", "HEAD"], { cwd: wt, env: origin.env })).trim();
    expect(await origin.branchHead("x")).toBe(head);
    expect(existsSync(join(tokens, token))).toBe(false);
    const error = await failure(pushWith(token));
    expect(error.stderr).toContain(NO_TOKEN);
  });

  it.each([
    ["an empty token", ""],
    ["a path", "../evil"],
    ["a token that starts with a dash", "-x"],
    ["a token of 63 characters", HEX.repeat(4).slice(1)],
    ["a token of 65 characters", `${HEX.repeat(4)}a`],
    ["a token in upper case", HEX.repeat(4).toUpperCase()],
    ["a token with a space", "a b"],
  ])("rejects %s and keeps the file", async (_name, token) => {
    mkdirSync(tokens, { recursive: true });
    const file = join(tokens, token);
    if (token !== "") {
      writeFileSync(file, "");
    }
    const error = await failure(pushWith(token));
    expect(error.stderr).toContain(NO_TOKEN);
    expect(await origin.branchHead("x")).toBeUndefined();
    expect(existsSync(file)).toBe(true);
  });
});
