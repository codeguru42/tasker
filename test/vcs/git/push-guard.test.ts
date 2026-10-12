import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionClone } from "../../../src/vcs/git/provision.js";
import { pushWithToken } from "../../../src/vcs/git/push-guard.js";
import { repoPaths } from "../../../src/vcs/git/repo-paths.js";
import { GitError, runGit } from "../../../src/vcs/git/run.js";
import {
  failureOf,
  fakeSsh,
  type GitOrigin,
  makeGitOrigin,
  makeTempDir,
  NO_TOKEN,
  readArgLog,
  sshKeyArgs,
} from "../../helpers.js";

const HEX = "0123456789abcdef";

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
    const paths = repoPaths(join(tmp, "data"), "x");
    clone = paths.clone;
    tokens = paths.publishTokens;
    wt = join(paths.worktrees, "wt");
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

  it("rejects a push from a worktree without a token", async () => {
    const error = await failureOf(
      runGit(["push", "origin", "HEAD:refs/heads/x"], { cwd: wt, env: origin.env }),
      GitError,
    );
    expect(error.stderr).toContain(NO_TOKEN);
    expect(await origin.branchHead("x")).toBeUndefined();
  });

  it("rejects a push that names the remote by its url", async () => {
    const error = await failureOf(
      runGit(["push", origin.path, "HEAD:refs/heads/x"], { cwd: wt, env: origin.env }),
      GitError,
    );
    expect(error.stderr).toContain(NO_TOKEN);
    expect(await origin.branchHead("x")).toBeUndefined();
  });

  it("rejects a push from the bare clone without a token", async () => {
    const error = await failureOf(
      runGit(["push", "origin", "main:refs/heads/y"], { gitDir: clone, env: origin.env }),
      GitError,
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
    const error = await failureOf(pushWith(token), GitError);
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
    const error = await failureOf(pushWith(token), GitError);
    expect(error.stderr).toContain(NO_TOKEN);
    expect(await origin.branchHead("x")).toBeUndefined();
    expect(existsSync(file)).toBe(true);
  });

  it("keeps the hook active when the global configuration sets core.hooksPath", async () => {
    const empty = join(tmp, "empty-hooks");
    mkdirSync(empty);
    const globalConfig = join(tmp, "global.gitconfig");
    writeFileSync(globalConfig, `[core]\n\thooksPath = ${empty}\n`);
    const env = { ...origin.env, GIT_CONFIG_GLOBAL: globalConfig };
    const paths = repoPaths(join(tmp, "data"), "g");
    clone = paths.clone;
    await provisionClone({
      remote: origin.path,
      clone,
      config: {},
      env,
      publishTokens: paths.publishTokens,
    });
    const other = join(paths.worktrees, "wt");
    await addWorktree("global", other);
    const error = await failureOf(
      runGit(["push", "origin", "HEAD:refs/heads/x"], { cwd: other, env }),
      GitError,
    );
    expect(error.stderr).toContain(NO_TOKEN);
    expect(await origin.branchHead("x")).toBeUndefined();
  });

  describe("pushWithToken", () => {
    const push = (
      args: string[],
      location: { cwd: string } | { gitDir: string },
      env: NodeJS.ProcessEnv = origin.env,
      sshKey?: string,
    ): Promise<void> =>
      pushWithToken(args, { location, publishTokens: tokens, sshKey, env });

    async function worktreeHead(): Promise<string> {
      return (await runGit(["rev-parse", "HEAD"], { cwd: wt, env: origin.env })).trim();
    }

    it("pushes from a worktree and leaves no token file", async () => {
      await push(["origin", "HEAD:refs/heads/x"], { cwd: wt });
      expect(await origin.branchHead("x")).toBe(await worktreeHead());
      expect(readdirSync(tokens)).toEqual([]);
    });

    it("makes a missing tokens folder with mode 0700", async () => {
      expect(existsSync(tokens)).toBe(false);
      await push(["origin", "HEAD:refs/heads/x"], { cwd: wt });
      expect(statSync(tokens).mode & 0o777).toBe(0o700);
    });

    it("keeps the mode of an existing tokens folder", async () => {
      mkdirSync(tokens, { recursive: true, mode: 0o755 });
      chmodSync(tokens, 0o755);
      await push(["origin", "HEAD:refs/heads/x"], { cwd: wt });
      expect(statSync(tokens).mode & 0o777).toBe(0o755);
    });

    it("rejects a push to a missing remote and leaves no token file", async () => {
      await expect(
        push([join(tmp, "missing.git"), "HEAD:refs/heads/x"], { cwd: wt }),
      ).rejects.toBeInstanceOf(GitError);
      expect(readdirSync(tokens)).toEqual([]);
    });

    it("replaces a token from the caller", async () => {
      const env = { ...origin.env, TASKER_PUBLISH_TOKEN: "bogus" };
      await push(["origin", "HEAD:refs/heads/x"], { cwd: wt }, env);
      expect(await origin.branchHead("x")).toBe(await worktreeHead());
    });

    it("pushes from the bare clone", async () => {
      await push(["origin", "main:refs/heads/y"], { gitDir: clone });
      expect(await origin.branchHead("y")).toBe(await origin.branchHead("main"));
    });

    it("passes the ssh key to ssh", async () => {
      const ssh = fakeSsh(origin.dir, origin.env, "serve");
      const key = join(origin.dir, "id key");
      await push([ssh.remote(origin.path), "HEAD:refs/heads/x"], { cwd: wt }, ssh.env, key);
      expect(readArgLog(ssh.logPath)[0]?.slice(0, 6)).toEqual(sshKeyArgs(key));
      expect(await origin.branchHead("x")).toBe(await worktreeHead());
    });
  });
});
