import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  connectionCheck,
  type GitDoctorRepo,
  gitDoctorChecks,
  gitVersionCheck,
  identityCheck,
  staleLockCheck,
} from "../../../src/vcs/git/doctor.js";
import type { GitVcsConfig } from "../../../src/vcs/git/config.js";
import { repoPaths } from "../../../src/vcs/git/repo-paths.js";
import { runGit } from "../../../src/vcs/git/run.js";
import { type ProcView, readProcView } from "../../../src/vcs/git/stale-locks.js";
import { readArgLog } from "../../helpers/fake-commands.js";
import { fakeSsh } from "../../helpers/fake-ssh.js";
import { gitTestEnv, makeGitClone, makeGitOrigin, sshKeyArgs, type GitOrigin, writeFakeGit } from "../../helpers/git.js";
import { writeFakeProc } from "../../helpers/processes.js";
import { ageFile, treeSnapshot, useTempDir } from "../../helpers/temp.js";

describe("gitVersionCheck", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = useTempDir("tasker-doctor-version-");
    env = gitTestEnv(dir);
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
    return { key: "o/r", remote, clone: repoPaths(join(origin.dir, "data"), "o/r").clone, config };
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

describe("staleLockCheck", () => {
  let origin: GitOrigin;
  let clone: string;
  let root: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    clone = await makeGitClone(origin);
    root = realpathSync(clone);
  });

  afterEach(() => {
    origin.remove();
  });

  function repo(cloneDir = clone): GitDoctorRepo {
    return { key: "o/r", remote: origin.path, clone: cloneDir, config: {} };
  }

  function makeLock(relative: string, ageMs = 90_000): void {
    const path = join(clone, relative);
    writeFileSync(path, "");
    ageFile(path, ageMs);
  }

  function view(openFiles: string[] = [], gitCwds: string[] = []): () => ProcView {
    return () => ({ readable: true, openFiles: new Set(openFiles), gitCwds });
  }

  it("has the name, the required flag and the time limit", () => {
    const check = staleLockCheck(repo(), view());
    expect(check.name).toBe("git lock files: o/r");
    expect(check.required).toBe(false);
    expect(check.timeoutMs).toBe(10000);
  });

  it("gives warn for an aged lock, with the path, the age and the remediation", async () => {
    makeLock("a.lock");
    const result = await staleLockCheck(repo(), view()).run(origin.env);
    expect(result.status).toBe("warn");
    expect(result.detail).toMatch(/^a\.lock \(9[01] s old\)$/);
    expect(result.remediation).toBe(
      "Doctor deletes nothing. Make sure that no tasker or git process uses the clone. Then delete each file by hand.",
    );
  });

  it("skips and names a lock that a process has open", async () => {
    makeLock("a.lock");
    const result = await staleLockCheck(repo(), view([join(root, "a.lock")])).run(origin.env);
    expect(result.status).toBe("ok");
    expect(result.detail).toBe("skipped a.lock: a process has it open");
  });

  it("skips and names a lock under the folder of a git process", async () => {
    makeLock("refs/heads/x.lock");
    const cwd = join(root, "refs");
    const result = await staleLockCheck(repo(), view([], [cwd])).run(origin.env);
    expect(result.status).toBe("ok");
    expect(result.detail).toBe(`skipped refs/heads/x.lock: a git process runs in ${cwd}`);
  });

  it("does not skip a lock for a git process in a folder above the clone", async () => {
    makeLock("a.lock");
    const result = await staleLockCheck(repo(), view([], [dirname(root)])).run(origin.env);
    expect(result.status).toBe("warn");
    expect(result.detail).toMatch(/^a\.lock \(9[01] s old\)$/);
  });

  it("does not skip a lock for a git process in /", async () => {
    makeLock("a.lock");
    const result = await staleLockCheck(repo(), view([], ["/"])).run(origin.env);
    expect(result.status).toBe("warn");
    expect(result.detail).toMatch(/^a\.lock \(9[01] s old\)$/);
  });

  it("lists the locks that are left and the skipped locks", async () => {
    makeLock("a.lock");
    makeLock("b.lock");
    const result = await staleLockCheck(repo(), view([join(root, "a.lock")])).run(origin.env);
    expect(result.status).toBe("warn");
    expect(result.detail).toMatch(/^b\.lock \(9[01] s old\)\nskipped a\.lock: a process has it open$/);
  });

  it("adds a note when it cannot read /proc", async () => {
    makeLock("a.lock");
    const missing = join(origin.dir, "no-proc");
    const result = await staleLockCheck(repo(), () => readProcView(missing)).run(origin.env);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain(
      "tasker cannot read /proc (ENOENT), so it cannot tell whether a process uses these files.",
    );
  });

  it("adds a note on a platform that is not Linux", async () => {
    makeLock("a.lock");
    const result = await staleLockCheck(repo(), () => undefined).run(origin.env);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain(
      "tasker reads open files only on Linux, so it cannot tell whether a process uses these files.",
    );
  });

  it("gives ok and does not read /proc when there is no stale lock", async () => {
    makeLock("fresh.lock", 1000);
    let calls = 0;
    const result = await staleLockCheck(repo(), () => {
      calls += 1;
      return undefined;
    }).run(origin.env);
    expect(result).toEqual({ status: "ok", detail: "no stale lock files" });
    expect(calls).toBe(0);
  });

  it("gives ok with no clone yet when the clone is missing", async () => {
    const result = await staleLockCheck(repo(join(origin.dir, "missing.git")), view()).run(
      origin.env,
    );
    expect(result.status).toBe("ok");
    expect(result.detail).toBe("no clone yet");
    expect(result.remediation).toBeUndefined();
  });

  it("gives the timeout result when the time limit is 0", async () => {
    makeLock("a.lock");
    const result = await staleLockCheck(repo(), view(), 0).run(origin.env);
    expect(result).toEqual({ status: "error", detail: "the check did not finish in 0 ms" });
  });
});

describe("gitDoctorChecks", () => {
  let first: GitOrigin;
  let second: GitOrigin;
  let repos: GitDoctorRepo[];
  let procRoot: string;

  beforeEach(async () => {
    first = await makeGitOrigin();
    second = await makeGitOrigin();
    repos = [
      { key: "a/one", remote: first.path, clone: await makeGitClone(first), config: {} },
      { key: "b/two", remote: second.path, clone: await makeGitClone(second), config: {} },
    ];
    procRoot = join(first.dir, "proc");
    writeFakeProc(procRoot, []);
  });

  afterEach(() => {
    first.remove();
    second.remove();
  });

  function checks() {
    return gitDoctorChecks({ repos, procRoot, platform: "linux" });
  }

  function lockIn(repo: GitDoctorRepo): string {
    const path = join(realpathSync(repo.clone), "a.lock");
    writeFileSync(path, "");
    ageFile(path, 90_000);
    return path;
  }

  it("gives the version check, then three checks for each repo", () => {
    expect(checks().map(({ name, required, timeoutMs }) => ({ name, required, timeoutMs }))).toEqual([
      { name: "git version", required: true, timeoutMs: 5000 },
      { name: "git identity: a/one", required: false, timeoutMs: 5000 },
      { name: "git connection: a/one", required: true, timeoutMs: 30000 },
      { name: "git lock files: a/one", required: false, timeoutMs: 10000 },
      { name: "git identity: b/two", required: false, timeoutMs: 5000 },
      { name: "git connection: b/two", required: true, timeoutMs: 30000 },
      { name: "git lock files: b/two", required: false, timeoutMs: 10000 },
    ]);
  });

  it("reads /proc once for all lock-file checks", async () => {
    lockIn(repos[0]);
    const secondLock = lockIn(repos[1]);
    const [, , , lockOne, , , lockTwo] = checks();
    expect((await lockOne.run(first.env)).status).toBe("warn");
    writeFakeProc(procRoot, [{ pid: 7, comm: "bash", openFiles: [secondLock] }]);
    const result = await lockTwo.run(first.env);
    expect(result.status).toBe("warn");
    expect(result.detail).not.toContain("skipped");
  });

  it("writes nothing in the clone", async () => {
    lockIn(repos[0]);
    const before = treeSnapshot(repos[0].clone);
    for (const check of checks()) {
      await check.run(first.env);
    }
    expect(treeSnapshot(repos[0].clone)).toEqual(before);
  });
});
