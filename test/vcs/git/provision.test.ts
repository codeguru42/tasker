import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, parse, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionClone } from "../../../src/vcs/git/provision.js";
import { sshCommand } from "../../../src/vcs/git/ssh.js";
import { GitError, runGit } from "../../../src/vcs/git/run.js";
import {
  type GitOrigin,
  makeGitOrigin,
  makeTempDir,
  readArgLog,
  writeFakeSsh,
  writeGitRecorder,
} from "../../helpers.js";

describe("provisionClone", () => {
  let origin: GitOrigin;
  let tmp: string;
  let clone: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    tmp = makeTempDir("tasker-provision-");
    clone = join(tmp, "data", "clones", "x", "repo.git");
  });

  afterEach(() => {
    origin.remove();
    rmSync(tmp, { recursive: true, force: true });
  });

  function revParse(ref: string): Promise<string> {
    return runGit(["rev-parse", ref], { gitDir: clone, env: origin.env }).then((out) =>
      out.trim(),
    );
  }

  it("rejects when the remote does not answer and creates no folder", async () => {
    const remote = join(tmp, "missing.git");
    await expect(provisionClone({ remote, clone, config: {}, env: origin.env })).rejects.toThrow(
      `the remote does not answer: ${remote}`,
    );
    expect(existsSync(join(tmp, "data"))).toBe(false);
  });

  it("rejects when the remote has no refs and creates no folder", async () => {
    const remote = join(tmp, "empty.git");
    await runGit(["init", "--bare", "--initial-branch=main", remote], {
      cwd: tmp,
      env: origin.env,
    });
    await expect(provisionClone({ remote, clone, config: {}, env: origin.env })).rejects.toThrow(
      `the remote has no refs: ${remote}`,
    );
    expect(existsSync(join(tmp, "data"))).toBe(false);
  });

  it("clones the remote and fetches its branches as origin/*", async () => {
    await origin.createBranch("feature");
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
    expect(await revParse("origin/main")).toBe(await origin.branchHead("main"));
    expect(await revParse("origin/feature")).toBe(await origin.branchHead("feature"));
  });

  it("clones the same repo that ls-remote checks when the remote path is relative", async () => {
    // A relative path that names the origin from the root of the file system.
    const remote = relative(parse(origin.path).root, origin.path);
    await provisionClone({ remote, clone, config: {}, env: origin.env });
    expect(await revParse("origin/main")).toBe(await origin.branchHead("main"));
    // The fetch of a complete clone runs in the clone and must reach the same repo.
    const head = await origin.addCommit("main");
    await provisionClone({ remote, clone, config: {}, env: origin.env });
    expect(await revParse("origin/main")).toBe(head);
  });

  it("fetches and keeps the clone when it is complete", async () => {
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
    writeFileSync(join(clone, "sentinel"), "keep me");
    const head = await origin.addCommit("main");
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
    expect(existsSync(join(clone, "sentinel"))).toBe(true);
    expect(await revParse("origin/main")).toBe(head);
  });

  it("clones again when an earlier clone stopped partway", async () => {
    mkdirSync(clone, { recursive: true });
    writeFileSync(join(clone, "junk"), "left by a clone that stopped");
    writeFileSync(`${clone}.incomplete`, "");
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
    expect(existsSync(join(clone, "junk"))).toBe(false);
    expect(await revParse("origin/main")).toBe(await origin.branchHead("main"));
    expect(existsSync(`${clone}.incomplete`)).toBe(false);
  });

  it("names the clone when its configuration is locked", async () => {
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
    writeFileSync(join(clone, "config.lock"), "");
    await expect(
      provisionClone({ remote: origin.path, clone, config: {}, env: origin.env }),
    ).rejects.toThrow(`the clone configuration is locked: ${clone}`);
  });

  it("removes the marker after success", async () => {
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
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

  describe("identity and signing", () => {
    it("writes authorName and authorEmail as user.name and user.email", async () => {
      const config = { authorName: "Bot Name", authorEmail: "bot@example.com" };
      await provisionClone({ remote: origin.path, clone, config, env: origin.env });
      expect(await localConfig("user.name")).toBe("Bot Name");
      expect(await localConfig("user.email")).toBe("bot@example.com");
    });

    it("writes nothing for a field that is not set, and each field is independent", async () => {
      await provisionClone({
        remote: origin.path,
        clone,
        config: { authorName: "Only Name" },
        env: origin.env,
      });
      expect(await localConfig("user.name")).toBe("Only Name");
      expect(await localConfig("user.email")).toBeUndefined();
    });

    it("turns off signing", async () => {
      await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
      expect(await localConfig("commit.gpgSign")).toBe("false");
      expect(await localConfig("tag.gpgSign")).toBe("false");
      expect(await localConfig("tag.forceSignAnnotated")).toBe("false");
    });

    it("updates a changed field and unsets a removed field on the next provision", async () => {
      await provisionClone({
        remote: origin.path,
        clone,
        config: { authorName: "Old Name", authorEmail: "old@example.com" },
        env: origin.env,
      });
      await provisionClone({
        remote: origin.path,
        clone,
        config: { authorName: "New Name" },
        env: origin.env,
      });
      expect(await localConfig("user.name")).toBe("New Name");
      expect(await localConfig("user.email")).toBeUndefined();
    });
  });

  describe("ssh key", () => {
    // A key path with every character that the include file or a shell can trip on.
    const hardKey = (): string => join(tmp, "k it's \" \\ $ ; # \t \n \r \u0001 key");
    let binDir: string;
    let sshLog: string;
    let remote: string;
    let sshEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      binDir = join(tmp, "bin");
      sshLog = join(tmp, "ssh.log");
      remote = `ssh://tasker.invalid${origin.path}`;
      sshEnv = { ...origin.env, PATH: `${binDir}${delimiter}${process.env.PATH}` };
    });

    async function coreSshCommand(): Promise<string> {
      const out = await runGit(["config", "--get", "core.sshCommand"], {
        gitDir: clone,
        env: origin.env,
      });
      return out.replace(/\n$/, "");
    }

    async function failureOf(promise: Promise<void>): Promise<Error> {
      const error: unknown = await promise.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      return error as Error;
    }

    it("writes the ssh command of the key to core.sshCommand through the include file", async () => {
      writeFakeSsh(binDir, sshLog, "serve");
      const key = hardKey();
      await provisionClone({ remote, clone, config: { sshKey: key }, env: sshEnv });
      expect(await coreSshCommand()).toBe(sshCommand(key));
    });

    it("keeps one include.path line after two provisions", async () => {
      writeFakeSsh(binDir, sshLog, "serve");
      const config = { sshKey: "/keys/a" };
      await provisionClone({ remote, clone, config, env: sshEnv });
      await provisionClone({ remote, clone, config, env: sshEnv });
      const out = await runGit(["config", "--get-all", "include.path"], {
        gitDir: clone,
        env: origin.env,
      });
      expect(out).toBe("tasker-ssh.config\n");
    });

    it("passes the key to ssh for ls-remote, clone and fetch", async () => {
      writeFakeSsh(binDir, sshLog, "serve");
      const key = hardKey();
      await provisionClone({ remote, clone, config: { sshKey: key }, env: sshEnv });
      const calls = readArgLog(sshLog);
      expect(calls.length).toBeGreaterThanOrEqual(3);
      for (const call of calls) {
        expect(call.slice(0, 6)).toEqual([
          "-i",
          key,
          "-o",
          "IdentitiesOnly=yes",
          "-o",
          "BatchMode=yes",
        ]);
      }
    });

    it("puts no key path or ssh command in any git argument", async () => {
      writeFakeSsh(binDir, sshLog, "serve");
      const gitLog = join(tmp, "git.log");
      const gitBin = join(tmp, "gitbin");
      writeGitRecorder(gitBin, gitLog);
      const key = hardKey();
      const env = { ...sshEnv, PATH: `${gitBin}${delimiter}${sshEnv.PATH}` };
      await provisionClone({ remote, clone, config: { sshKey: key }, env });
      const calls = readArgLog(gitLog);
      const args = calls.flat();
      for (const subcommand of ["ls-remote", "clone", "fetch", "config"]) {
        expect(args).toContain(subcommand);
      }
      for (const arg of calls.flat()) {
        expect(arg).not.toContain(key);
        expect(arg).not.toContain(sshCommand(key));
        expect(arg).not.toContain("IdentitiesOnly");
      }
    });

    it("lets the GIT_SSH_COMMAND of the user reach ssh when no key is set", async () => {
      writeFakeSsh(binDir, sshLog, "serve");
      const env = { ...sshEnv, GIT_SSH_COMMAND: "ssh -o User=fromuser" };
      await provisionClone({ remote, clone, config: {}, env });
      const calls = readArgLog(sshLog);
      expect(calls.length).toBeGreaterThanOrEqual(3);
      for (const call of calls) {
        expect(call).toContain("User=fromuser");
        expect(call).not.toContain("-i");
      }
    });

    it("hides the key in the error when ssh refuses", async () => {
      writeFakeSsh(binDir, sshLog, "refuse");
      const key = join(tmp, "no such it's key");
      const error = await failureOf(
        provisionClone({ remote, clone, config: { sshKey: key }, env: sshEnv }),
      );
      expect(error.message).toContain(remote);
      expect(error.message).not.toContain(key);
      expect(error.message).toContain("<sshKey>");
    });

    it("hides the key in the error when the fetch of a complete clone fails", async () => {
      writeFakeSsh(binDir, sshLog, "serve");
      const key = join(tmp, "no such it's key");
      const config = { sshKey: key };
      await provisionClone({ remote, clone, config, env: sshEnv });
      writeFakeSsh(binDir, sshLog, "refuse");
      const error = await failureOf(provisionClone({ remote, clone, config, env: sshEnv }));
      expect(error.message).not.toContain(key);
      expect(error.message).toContain("<sshKey>");
    });

    it("leaves the include file as it was when the configuration is locked", async () => {
      writeFakeSsh(binDir, sshLog, "serve");
      await provisionClone({ remote, clone, config: { sshKey: "/keys/a" }, env: sshEnv });
      writeFileSync(join(clone, "config.lock"), "");
      await expect(
        provisionClone({ remote, clone, config: { sshKey: "/keys/b" }, env: sshEnv }),
      ).rejects.toThrow(`the clone configuration is locked: ${clone}`);
      const file = readFileSync(join(clone, "tasker-ssh.config"), "utf8");
      expect(file).toContain(sshCommand("/keys/a"));
      expect(file).not.toContain("/keys/b");
    });
  });
});
