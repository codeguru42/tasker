import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionCheck, type GitDoctorRepo, gitVersionCheck, identityCheck } from "../../../src/vcs/git/doctor.js";
import type { GitVcsConfig } from "../../../src/vcs/git/provision.js";
import { runGit } from "../../../src/vcs/git/run.js";
import {
  type GitOrigin,
  fakeSsh,
  gitTestEnv,
  makeGitClone,
  makeGitOrigin,
  makeTempDir,
  readArgLog,
  sshKeyArgs,
  writeFakeGit,
} from "../../helpers.js";

describe("gitVersionCheck", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = makeTempDir("tasker-doctor-version-");
    env = gitTestEnv(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Runs the check with a fake git that prints output as its version.
  function runWithFakeGit(output: string, timeoutMs?: number) {
    const binDir = join(dir, "bin");
    writeFakeGit(binDir, `echo '${output}'`);
    return gitVersionCheck(timeoutMs).run({ ...env, PATH: binDir });
  }

  it("has the name, the required flag and the time limit", () => {
    const check = gitVersionCheck();
    expect(check.name).toBe("git version");
    expect(check.required).toBe(true);
    expect(check.timeoutMs).toBe(5000);
  });

  it.each([
    ["git version 2.47.3", "2.47.3"],
    ["git version 2.47.3.windows.1", "2.47.3.windows.1"],
    ["git version 2.39.5 (Apple Git-154)", "2.39.5"],
    ["git version 2.47.0.rc1", "2.47.0.rc1"],
    ["git version 2.20.0", "2.20.0"],
  ])("gives ok for %s", async (output, found) => {
    const result = await runWithFakeGit(output);
    expect(result).toEqual({ status: "ok", detail: `git ${found} (minimum 2.20)` });
  });

  it("gives error for a version older than 2.20", async () => {
    const result = await runWithFakeGit("git version 2.19.6");
    expect(result.status).toBe("error");
    expect(result.detail).toBe("git 2.19.6 is older than the minimum 2.20.");
    expect(result.remediation).toBe("Install git 2.20 or newer.");
  });

  it("gives error for output that is not a version", async () => {
    const result = await runWithFakeGit("nonsense");
    expect(result.status).toBe("error");
    expect(result.detail).toBe("cannot read the git version from: nonsense");
  });

  it("gives ok for the real git", async () => {
    const result = await gitVersionCheck().run(env);
    expect(result.status).toBe("ok");
    expect(result.detail).toMatch(/^git \d+\.\d+/);
  });

  it("gives error when git is not installed", async () => {
    const emptyBin = join(dir, "empty-bin");
    mkdirSync(emptyBin);
    const result = await gitVersionCheck().run({ ...env, PATH: emptyBin });
    expect(result.status).toBe("error");
    expect(result.detail).toBe("git is not installed. tasker needs git 2.20 or newer.");
    expect(result.remediation).toBe("Install git 2.20 or newer.");
  });

  it("gives the timeout result when git does not finish", async () => {
    const binDir = join(dir, "bin");
    writeFakeGit(binDir, "exec sleep 5");
    const started = Date.now();
    const result = await gitVersionCheck(200).run({ ...env, PATH: `${binDir}:${env.PATH}` });
    expect(result).toEqual({ status: "error", detail: "the check did not finish in 200 ms" });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("identityCheck", () => {
  let origin: GitOrigin;
  let clone: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    clone = await makeGitClone(origin);
    env = origin.env;
  });

  afterEach(() => {
    origin.remove();
  });

  function repo(config: GitVcsConfig, cloneDir = clone): GitDoctorRepo {
    return { key: "o/r", remote: origin.path, clone: cloneDir, config };
  }

  function setLocal(key: string, value: string): Promise<string> {
    return runGit(["config", key, value], { gitDir: clone, env });
  }

  it("has the name, the required flag and the time limit", () => {
    const check = identityCheck(repo({}));
    expect(check.name).toBe("git identity: o/r");
    expect(check.required).toBe(false);
    expect(check.timeoutMs).toBe(5000);
  });

  it("gives ok when the identity of the clone matches vcs.config", async () => {
    await setLocal("user.name", "Ann");
    await setLocal("user.email", "ann@example.com");
    const result = await identityCheck(repo({ authorName: "Ann", authorEmail: "ann@example.com" })).run(env);
    expect(result).toEqual({ status: "ok", detail: "a commit in the clone gets Ann <ann@example.com>" });
  });

  it("gives warn when the name differs from vcs.config", async () => {
    await setLocal("user.name", "Bob");
    await setLocal("user.email", "ann@example.com");
    const result = await identityCheck(repo({ authorName: "Ann" })).run(env);
    expect(result.status).toBe("warn");
    expect(result.detail).toBe('vcs.config.authorName is "Ann", but a commit in the clone gets "Bob"');
    expect(result.remediation).toBe(
      "Provision the clone again. Provision writes vcs.config.authorName and vcs.config.authorEmail to the clone configuration.",
    );
  });

  it("does not compare a field that vcs.config leaves unset", async () => {
    await setLocal("user.name", "Bob");
    await setLocal("user.email", "ann@example.com");
    const result = await identityCheck(repo({ authorEmail: "ann@example.com" })).run(env);
    expect(result).toEqual({ status: "ok", detail: "a commit in the clone gets Bob <ann@example.com>" });
  });

  it("counts a global identity", async () => {
    const globalFile = join(origin.dir, "global.gitconfig");
    writeFileSync(globalFile, "[user]\n\tname = Glob\n\temail = glob@example.com\n");
    const result = await identityCheck(repo({ authorName: "Glob" })).run({
      ...env,
      GIT_CONFIG_GLOBAL: globalFile,
    });
    expect(result).toEqual({ status: "ok", detail: "a commit in the clone gets Glob <glob@example.com>" });
  });

  it("counts a local empty user.name as not set", async () => {
    await setLocal("user.name", "");
    await setLocal("user.email", "ann@example.com");
    const result = await identityCheck(repo({})).run(env);
    expect(result.status).toBe("warn");
    expect(result.remediation).toBe(
      "Set vcs.config.authorName and vcs.config.authorEmail, or set a global git identity.",
    );
  });

  it("gives warn when the clone gets no identity at all", async () => {
    const result = await identityCheck(repo({})).run(env);
    expect(result.status).toBe("warn");
    expect(result.remediation).toBe(
      "Set vcs.config.authorName and vcs.config.authorEmail, or set a global git identity.",
    );
  });

  it("says that a commit gets no user.name when the clone has none", async () => {
    const result = await identityCheck(repo({ authorName: "Ann" })).run(env);
    expect(result.status).toBe("warn");
    expect(result.detail).toBe('vcs.config.authorName is "Ann", but a commit in the clone gets no user.name');
  });

  it("gives ok with no clone yet when the clone is missing", async () => {
    const missing = join(origin.dir, "missing.git");
    const result = await identityCheck(repo({ authorName: "Ann" }, missing)).run({
      ...env,
      GIT_CONFIG_GLOBAL: (() => {
        const file = join(origin.dir, "other.gitconfig");
        writeFileSync(file, "[user]\n\tname = Other\n");
        return file;
      })(),
    });
    expect(result.status).toBe("ok");
    expect(result.detail).toBe("no clone yet");
    expect(result.remediation).toBeUndefined();
  });
});

describe("connectionCheck", () => {
  let origin: GitOrigin;

  beforeEach(async () => {
    origin = await makeGitOrigin();
  });

  afterEach(() => {
    origin.remove();
  });

  function repo(remote: string, config: GitVcsConfig = {}): GitDoctorRepo {
    return { key: "o/r", remote, clone: join(origin.dir, "clone", "repo.git"), config };
  }

  it("has the name, the required flag and the time limit", () => {
    const check = connectionCheck(repo(origin.path));
    expect(check.name).toBe("git connection: o/r");
    expect(check.required).toBe(true);
    expect(check.timeoutMs).toBe(30000);
  });

  it("gives ok for a local origin", async () => {
    const result = await connectionCheck(repo(origin.path)).run(origin.env);
    expect(result).toEqual({ status: "ok", detail: `the remote answers: ${origin.path}` });
  });

  it("gives error for a path that does not exist", async () => {
    const missing = join(origin.dir, "missing.git");
    const result = await connectionCheck(repo(missing)).run(origin.env);
    expect(result.status).toBe("error");
    expect(result.detail).toContain(`the remote does not answer: ${missing}`);
    expect(result.remediation).toBe(
      "Make sure that remote names the repo and that the remote answers.",
    );
  });

  it("gives ok with the account for an ssh remote that answers", async () => {
    const ssh = fakeSsh(origin.dir, origin.env, { greet: "octocat", repo: "serve" });
    const result = await connectionCheck(repo(ssh.remote(origin.path))).run(ssh.env);
    expect(result.status).toBe("ok");
    expect(result.detail).toBe(
      `the remote answers: ${ssh.remote(origin.path)}\nThe remote sees the ssh account octocat.`,
    );
  });

  it("names the account when the repo is missing, and runs the probe after ls-remote", async () => {
    const key = join(origin.dir, "key");
    const ssh = fakeSsh(origin.dir, origin.env, { greet: "octocat", repo: "missing" });
    const result = await connectionCheck(repo(ssh.remote(origin.path), { sshKey: key })).run(ssh.env);
    expect(result.status).toBe("error");
    expect(result.detail).toContain("the remote does not answer:");
    expect(result.detail).toContain("Repository not found.");
    expect(result.detail).toContain("The remote sees the ssh account octocat.");
    expect(result.remediation).toContain("The remote sees the ssh account octocat.");
    expect(result.remediation).toContain("vcs.config.sshKey");
    const calls = readArgLog(ssh.logPath);
    expect(calls).toHaveLength(2);
    expect(calls[0].slice(0, 6)).toEqual(sshKeyArgs(key));
    expect(calls[0]).not.toContain("-T");
    expect(calls[1]).toContain("-T");
  });

  it.each([`it's-key`, "~/k"])("hides the key %s in the texts", async (name) => {
    const key = name.startsWith("~/") ? name : join(origin.dir, name);
    const ssh = fakeSsh(origin.dir, origin.env, "refuse");
    const result = await connectionCheck(repo(ssh.remote(origin.path), { sshKey: key })).run(ssh.env);
    expect(result.status).toBe("error");
    const texts = `${result.detail}\n${result.remediation}`;
    expect(texts).not.toContain(key);
    expect(texts).not.toContain(name);
    expect(texts).not.toContain(userInfo().homedir);
    expect(texts).not.toContain("ssh -i");
    expect(readArgLog(ssh.logPath)[0].slice(0, 6)).toEqual(sshKeyArgs(key));
  });

  it("gives the timeout result when ssh hangs", async () => {
    const ssh = fakeSsh(origin.dir, origin.env, "hang");
    const started = Date.now();
    const result = await connectionCheck(repo(ssh.remote(origin.path)), 300).run(ssh.env);
    expect(result).toEqual({ status: "error", detail: "the check did not finish in 300 ms" });
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
