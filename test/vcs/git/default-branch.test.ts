import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchRemoteDefaultBranch, remoteDefaultBranch } from "../../../src/vcs/git/default-branch.js";
import { runGit } from "../../../src/vcs/git/run.js";
import { readArgLog } from "../../helpers/fake-commands.js";
import { fakeSsh } from "../../helpers/fake-ssh.js";
import { makeGitOrigin, sshKeyArgs, type GitOrigin } from "../../helpers/git.js";

describe("remoteDefaultBranch", () => {
  let origin: GitOrigin;

  beforeEach(async () => {
    origin = await makeGitOrigin();
  });

  afterEach(() => {
    origin.remove();
  });

  it("returns main for the origin", async () => {
    const branch = await remoteDefaultBranch({
      remote: origin.path,
      sshKey: undefined,
      env: origin.env,
    });
    expect(branch).toBe("main");
  });

  it("returns the branch that HEAD of the origin points to", async () => {
    await origin.createBranch("trunk");
    await runGit(["symbolic-ref", "HEAD", "refs/heads/trunk"], {
      gitDir: origin.path,
      env: origin.env,
    });
    const branch = await remoteDefaultBranch({
      remote: origin.path,
      sshKey: undefined,
      env: origin.env,
    });
    expect(branch).toBe("trunk");
  });

  it("throws when HEAD of the origin is detached", async () => {
    const sha = await origin.branchHead("main");
    await runGit(["update-ref", "--no-deref", "HEAD", sha!], {
      gitDir: origin.path,
      env: origin.env,
    });
    await expect(remoteDefaultBranch({ remote: origin.path, sshKey: undefined, env: origin.env })).rejects.toThrow(
      `the remote has no symbolic HEAD: ${origin.path}`,
    );
  });

  it("passes the ssh key to ssh", async () => {
    const ssh = fakeSsh(origin.dir, origin.env, "serve");
    const key = join(origin.dir, "id key");
    const branch = await remoteDefaultBranch({
      remote: ssh.remote(origin.path),
      sshKey: key,
      env: ssh.env,
    });
    expect(branch).toBe("main");
    expect(readArgLog(ssh.logPath)[0]?.slice(0, 6)).toEqual(sshKeyArgs(key));
  });
});

describe("fetchRemoteDefaultBranch", () => {
  let origin: GitOrigin;

  beforeEach(async () => {
    origin = await makeGitOrigin();
  });

  afterEach(() => origin.remove());

  it("fetches origin before resolving and returns its symbolic HEAD branch name", async () => {
    const clone = join(origin.dir, "clone");
    await runGit(["clone", "--bare", origin.path, clone], { cwd: origin.dir, env: origin.env });
    await origin.createBranch("trunk");
    await runGit(["symbolic-ref", "HEAD", "refs/heads/trunk"], { gitDir: origin.path, env: origin.env });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- The helper is added by the green step.
    const branch = await fetchRemoteDefaultBranch({
      clone,
      remote: origin.path,
      sshKey: undefined,
      env: origin.env,
    });

    expect(branch).toBe("trunk");
    expect(await runGit(["rev-parse", "refs/remotes/origin/trunk"], { gitDir: clone, env: origin.env })).toMatch(
      /^[0-9a-f]{40}\n$/,
    );
  });

  it("does not fall back when the remote has no symbolic HEAD", async () => {
    const clone = join(origin.dir, "clone");
    await runGit(["clone", "--bare", origin.path, clone], { cwd: origin.dir, env: origin.env });
    const head = await origin.branchHead("main");
    await runGit(["update-ref", "--no-deref", "HEAD", head!], {
      gitDir: origin.path,
      env: origin.env,
    });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- The helper is added by the green step.
      fetchRemoteDefaultBranch({ clone, remote: origin.path, sshKey: undefined, env: origin.env }),
    ).rejects.toThrow(`the remote has no symbolic HEAD: ${origin.path}`);
  });
});
