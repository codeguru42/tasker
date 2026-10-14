import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join, parse, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ProvisionOptions, provisionClone } from "../../../src/vcs/git/provision.js";
import { repoPaths } from "../../../src/vcs/git/repo-paths.js";
import { remoteCwd, sshCommand } from "../../../src/vcs/git/ssh.js";
import { GitError, runGit } from "../../../src/vcs/git/run.js";
import { createTaskWorktree } from "../../../src/vcs/git/worktree.js";
import {
  failureOf,
  type FakeSsh,
  fakeSsh,
  type GitOrigin,
  localBranches,
  makeGitOrigin,
  useTempDir,
  readArgLog,
  sshKeyArgs,
  taskNames,
  writeGitRecorder,
} from "../../helpers.js";

describe("provisionClone", () => {
  let origin: GitOrigin;
  let tmp: string;
  let clone: string;
  let tokens: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    tmp = useTempDir("tasker-provision-");
    ({ clone, publishTokens: tokens } = repoPaths(join(tmp, "data"), "x"));
  });

  afterEach(() => {
    origin.remove();
  });

  // provisionClone() with the usual options of this file. overrides replaces single values.
  function provision(overrides: Partial<ProvisionOptions> = {}): Promise<void> {
    return provisionClone({
      remote: origin.path,
      clone,
      config: {},
      env: origin.env,
      publishTokens: tokens,
      ...overrides,
    });
  }

  function revParse(ref: string): Promise<string> {
    return runGit(["rev-parse", ref], { gitDir: clone, env: origin.env }).then((out) =>
      out.trim(),
    );
  }

  it("rejects when the remote does not answer and creates no folder", async () => {
    const remote = join(tmp, "missing.git");
    await expect(provision({ remote })).rejects.toThrow(`the remote does not answer: ${remote}`);
    expect(existsSync(join(tmp, "data"))).toBe(false);
  });

  it("rejects when the remote has no refs and creates no folder", async () => {
    const remote = join(tmp, "empty.git");
    await runGit(["init", "--bare", "--initial-branch=main", remote], {
      cwd: tmp,
      env: origin.env,
    });
    await expect(provision({ remote })).rejects.toThrow(`the remote has no refs: ${remote}`);
    expect(existsSync(join(tmp, "data"))).toBe(false);
  });

  it("clones the remote and fetches its branches as origin/*", async () => {
    await origin.createBranch("feature");
    await provision();
    expect(await revParse("origin/main")).toBe(await origin.branchHead("main"));
    expect(await revParse("origin/feature")).toBe(await origin.branchHead("feature"));
  });

  it("makes a clone with no local branch", async () => {
    await origin.createBranch("feature");
    await provision();
    expect(await localBranches(clone, origin.env)).toEqual([]);
    expect(await revParse("refs/remotes/origin/main")).toBe(await origin.branchHead("main"));
    expect(await revParse("refs/remotes/origin/feature")).toBe(await origin.branchHead("feature"));
  });

  it("makes a worktree from origin/main while HEAD of the clone names no branch", async () => {
    await provision();
    const target = await runGit(["symbolic-ref", "HEAD"], { gitDir: clone, env: origin.env });
    expect(target.startsWith("refs/heads/")).toBe(true);
    const error = await failureOf(
      runGit(["rev-parse", "--verify", "--quiet", "HEAD"], { gitDir: clone, env: origin.env }),
      GitError,
    );
    expect(error.exitCode).toBe(1);
    const { branch, worktree } = taskNames(join(tmp, "worktrees"), 1);
    await createTaskWorktree({
      clone,
      env: origin.env,
      path: worktree,
      branch,
      baseRevision: "refs/remotes/origin/main",
    });
    expect(await localBranches(clone, origin.env)).toEqual([`refs/heads/${branch}`]);
  });

  it("makes a sha1 clone when the user default is sha256", async () => {
    await provision({ env: { ...origin.env, GIT_DEFAULT_HASH: "sha256" } });
    const format = await runGit(["rev-parse", "--show-object-format"], {
      gitDir: clone,
      env: origin.env,
    });
    expect(format.trim()).toBe("sha1");
    expect(await revParse("refs/remotes/origin/main")).toBe(await origin.branchHead("main"));
  });

  it("clones the same repo that ls-remote checks when the remote path is relative", async () => {
    // A relative path that names the origin from the root of the file system.
    const remote = relative(parse(origin.path).root, origin.path);
    await provision({ remote });
    expect(await revParse("origin/main")).toBe(await origin.branchHead("main"));
    // The fetch of a complete clone runs in the clone and must reach the same repo.
    const head = await origin.addCommit("main");
    await provision({ remote });
    expect(await revParse("origin/main")).toBe(head);
  });

  it("fetches and keeps the clone when it is complete", async () => {
    await provision();
    writeFileSync(join(clone, "sentinel"), "keep me");
    const head = await origin.addCommit("main");
    await provision();
    expect(existsSync(join(clone, "sentinel"))).toBe(true);
    expect(await revParse("origin/main")).toBe(head);
  });

  it("clones again when an earlier clone stopped partway", async () => {
    mkdirSync(clone, { recursive: true });
    writeFileSync(join(clone, "junk"), "left by a clone that stopped");
    writeFileSync(`${clone}.incomplete`, "");
    await provision();
    expect(existsSync(join(clone, "junk"))).toBe(false);
    expect(await revParse("origin/main")).toBe(await origin.branchHead("main"));
    expect(existsSync(`${clone}.incomplete`)).toBe(false);
  });

  it("names the clone when its configuration is locked", async () => {
    await provision();
    writeFileSync(join(clone, "config.lock"), "");
    await expect(provision()).rejects.toThrow(`the clone configuration is locked: ${clone}`);
  });

  it("removes the marker after success", async () => {
    await provision();
    expect(existsSync(`${clone}.incomplete`)).toBe(false);
  });

  // The value of key in the clone, or undefined when git exits with 1 (the key is not set).
  async function localConfig(key: string): Promise<string | undefined> {
    try {
      const out = await runGit(["config", "--local", "--get", key], {
        gitDir: clone,
        env: origin.env,
      });
      return out.trim();
    } catch (error) {
      if (error instanceof GitError && error.exitCode === 1) {
        return undefined;
      }
      throw error;
    }
  }

  // Every local line of key in the clone, or [] when git exits with 1 (the key is not set).
  async function localConfigAll(key: string): Promise<string[]> {
    try {
      const out = await runGit(["config", "--local", "--get-all", key], {
        gitDir: clone,
        env: origin.env,
      });
      return out.split("\n").filter((line) => line !== "");
    } catch (error) {
      if (error instanceof GitError && error.exitCode === 1) {
        return [];
      }
      throw error;
    }
  }

  it("fetches from a changed remote into the same clone", async () => {
    await provision();
    const other = await makeGitOrigin();
    try {
      const head = await other.addCommit("main");
      await provision({ remote: other.path });
      expect(await localConfigAll("remote.origin.url")).toEqual([other.path]);
      expect(await revParse("origin/main")).toBe(head);
    } finally {
      other.remove();
    }
  });

  it("writes the same url for a relative remote as a plain git clone does", async () => {
    const remote = relative(parse(origin.path).root, origin.path);
    // A separate plain clone that provision never touches, so its url is what git clone wrote.
    const plain = join(tmp, "plain.git");
    await runGit(["clone", "--bare", "--", remote, plain], { cwd: remoteCwd(), env: origin.env });
    const written = await runGit(["config", "--get", "remote.origin.url"], {
      gitDir: plain,
      env: origin.env,
    });
    await provision({ remote });
    expect(await localConfigAll("remote.origin.url")).toEqual([written.trim()]);
    await provision({ remote });
    expect(await localConfigAll("remote.origin.url")).toEqual([written.trim()]);
  });

  // Adds each value as one more local line of key in the clone.
  async function addLines(key: string, values: string[]): Promise<void> {
    for (const value of values) {
      await runGit(["config", "--add", key, value], { gitDir: clone, env: origin.env });
    }
  }

  it("leaves only the tasker fetch refspec on a complete clone", async () => {
    await provision();
    await addLines("remote.origin.fetch", ["+refs/tags/*:refs/tags/*"]);
    await provision();
    expect(await localConfigAll("remote.origin.fetch")).toEqual([
      "+refs/heads/*:refs/remotes/origin/*",
    ]);
  });

  describe("identity and signing", () => {
    it("removes every user.email line when authorEmail is not set", async () => {
      await provision();
      await addLines("user.email", ["one@example.com", "two@example.com"]);
      await provision();
      expect(await localConfigAll("user.email")).toEqual([]);
    });

    it("leaves one user.name line with authorName when the clone has two", async () => {
      await provision();
      await addLines("user.name", ["Old One", "Old Two"]);
      await provision({ config: { authorName: "New Name" } });
      expect(await localConfigAll("user.name")).toEqual(["New Name"]);
    });

    it("writes authorName and authorEmail as user.name and user.email", async () => {
      const config = { authorName: "Bot Name", authorEmail: "bot@example.com" };
      await provision({ config });
      expect(await localConfig("user.name")).toBe("Bot Name");
      expect(await localConfig("user.email")).toBe("bot@example.com");
    });

    it("writes nothing for a field that is not set, and each field is independent", async () => {
      await provision({ config: { authorName: "Only Name" } });
      expect(await localConfig("user.name")).toBe("Only Name");
      expect(await localConfig("user.email")).toBeUndefined();
    });

    it("turns off signing", async () => {
      await provision();
      expect(await localConfig("commit.gpgSign")).toBe("false");
      expect(await localConfig("tag.gpgSign")).toBe("false");
      expect(await localConfig("tag.forceSignAnnotated")).toBe("false");
    });

    it("updates a changed field and unsets a removed field on the next provision", async () => {
      await provision({ config: { authorName: "Old Name", authorEmail: "old@example.com" } });
      await provision({ config: { authorName: "New Name" } });
      expect(await localConfig("user.name")).toBe("New Name");
      expect(await localConfig("user.email")).toBeUndefined();
    });
  });

  describe("ssh key", () => {
    // A key path with every character that the include file or a shell can trip on.
    const hardKey = (): string => join(tmp, "k it's \" \\ $ ; # \t \n \r \u0001 key");
    let ssh: FakeSsh;
    let remote: string;

    beforeEach(() => {
      ssh = fakeSsh(tmp, origin.env, "serve");
      remote = ssh.remote(origin.path);
    });

    async function coreSshCommand(): Promise<string> {
      const out = await runGit(["config", "--get", "core.sshCommand"], {
        gitDir: clone,
        env: origin.env,
      });
      return out.replace(/\n$/, "");
    }

    it("writes the ssh command of the key to core.sshCommand through the include file", async () => {
      const key = hardKey();
      await provision({ remote, config: { sshKey: key }, env: ssh.env });
      expect(await coreSshCommand()).toBe(sshCommand(key));
    });

    it("keeps one include.path line after two provisions", async () => {
      const config = { sshKey: "/keys/a" };
      await provision({ remote, config, env: ssh.env });
      await provision({ remote, config, env: ssh.env });
      const out = await runGit(["config", "--get-all", "include.path"], {
        gitDir: clone,
        env: origin.env,
      });
      expect(out).toBe("tasker-ssh.config\n");
    });

    it("passes the key to ssh for ls-remote and fetch", async () => {
      const key = hardKey();
      await provision({ remote, config: { sshKey: key }, env: ssh.env });
      const calls = readArgLog(ssh.logPath);
      expect(calls.length).toBeGreaterThanOrEqual(2);
      for (const call of calls) {
        expect(call.slice(0, 6)).toEqual(sshKeyArgs(key));
      }
    });

    it("puts no key path or ssh command in any git argument", async () => {
      const gitLog = join(tmp, "git.log");
      const gitBin = join(tmp, "gitbin");
      writeGitRecorder(gitBin, gitLog);
      const key = hardKey();
      const env = { ...ssh.env, PATH: `${gitBin}${delimiter}${ssh.env.PATH}` };
      await provision({ remote, config: { sshKey: key }, env });
      const calls = readArgLog(gitLog);
      const args = calls.flat();
      for (const subcommand of ["ls-remote", "init", "remote", "fetch", "config"]) {
        expect(args).toContain(subcommand);
      }
      expect(args).not.toContain("clone");
      for (const arg of calls.flat()) {
        expect(arg).not.toContain(key);
        expect(arg).not.toContain(sshCommand(key));
        expect(arg).not.toContain("IdentitiesOnly");
      }
    });

    it("lets the GIT_SSH_COMMAND of the user reach ssh when no key is set", async () => {
      const env = { ...ssh.env, GIT_SSH_COMMAND: "ssh -o User=fromuser" };
      await provision({ remote, env });
      const calls = readArgLog(ssh.logPath);
      expect(calls.length).toBeGreaterThanOrEqual(2);
      for (const call of calls) {
        expect(call).toContain("User=fromuser");
        expect(call).not.toContain("-i");
      }
    });

    it("hides the key in the error when ssh refuses", async () => {
      fakeSsh(tmp, origin.env, "refuse");
      const key = join(tmp, "no such it's key");
      const error = await failureOf(
        provision({ remote, config: { sshKey: key }, env: ssh.env }),
        Error,
      );
      expect(error.message).toContain(remote);
      expect(error.message).not.toContain(key);
      expect(error.message).toContain("<sshKey>");
    });

    it("hides the key in the error when the fetch of a complete clone fails", async () => {
      const key = join(tmp, "no such it's key");
      const config = { sshKey: key };
      await provision({ remote, config, env: ssh.env });
      fakeSsh(tmp, origin.env, "refuse");
      const error = await failureOf(provision({ remote, config, env: ssh.env }), Error);
      expect(error.message).not.toContain(key);
      expect(error.message).toContain("<sshKey>");
    });

    it("leaves the include file as it was when the configuration is locked", async () => {
      await provision({ remote, config: { sshKey: "/keys/a" }, env: ssh.env });
      writeFileSync(join(clone, "config.lock"), "");
      await expect(
        provision({ remote, config: { sshKey: "/keys/b" }, env: ssh.env }),
      ).rejects.toThrow(`the clone configuration is locked: ${clone}`);
      const file = readFileSync(join(clone, "tasker-ssh.config"), "utf8");
      expect(file).toContain(sshCommand("/keys/a"));
      expect(file).not.toContain("/keys/b");
    });
  });

  describe("the pre-push hook", () => {
    const hook = (): string => join(clone, "hooks", "pre-push");

    it("writes an executable shell script", async () => {
      await provision();
      expect(statSync(hook()).mode & 0o777).toBe(0o755);
      expect(readFileSync(hook(), "utf8").startsWith("#!/bin/sh\n")).toBe(true);
    });

    it("writes a deleted hook again", async () => {
      await provision();
      rmSync(hook());
      await provision();
      expect(existsSync(hook())).toBe(true);
    });

    it("makes a deleted hooks folder again", async () => {
      await provision();
      rmSync(join(clone, "hooks"), { recursive: true });
      await provision();
      expect(existsSync(hook())).toBe(true);
    });

    it("removes a leftover temporary hook file", async () => {
      await provision();
      writeFileSync(`${hook()}.tmp`, "left behind");
      await provision();
      expect(existsSync(`${hook()}.tmp`)).toBe(false);
    });

    it("sets core.hooksPath to the hooks folder of the clone again", async () => {
      const env = origin.env;
      await provision();
      const get = (...args: string[]): Promise<string> =>
        runGit(["config", ...args, "core.hooksPath"], { gitDir: clone, env });
      expect((await get("--get")).trim()).toBe(resolve(clone, "hooks"));
      await runGit(["config", "core.hooksPath", join(tmp, "other")], { gitDir: clone, env });
      await provision();
      expect((await get("--get")).trim()).toBe(resolve(clone, "hooks"));
      expect((await get("--get-all")).trim().split("\n")).toEqual([resolve(clone, "hooks")]);
    });

    it("rejects when the hook cannot be installed", async () => {
      await provision();
      rmSync(join(clone, "hooks"), { recursive: true });
      writeFileSync(join(clone, "hooks"), "a file where the folder belongs");
      await expect(provision()).rejects.toThrow(
        `cannot install the pre-push hook in the clone: ${clone}`,
      );
    });
  });
});
