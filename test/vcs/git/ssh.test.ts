import { rmSync } from "node:fs";
import { userInfo } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitError } from "../../../src/vcs/git/run.js";
import {
  cloneUrl,
  hideSshKey,
  remoteCwd,
  runRemoteGit,
  sshCommand,
  sshEnv,
} from "../../../src/vcs/git/ssh.js";
import { gitTestEnv, makeTempDir, readArgLog, writeFakeSsh } from "../../helpers.js";

describe("sshCommand", () => {
  it("quotes the key path and writes each ' as '\\''", () => {
    expect(sshCommand("/k/it's my key")).toBe(
      "ssh -i '/k/it'\\''s my key' -o IdentitiesOnly=yes -o BatchMode=yes",
    );
  });
});

describe("sshEnv", () => {
  it("adds GIT_SSH_COMMAND when a key is set", () => {
    const env = sshEnv({ PATH: "/bin" }, "/k/id");
    expect(env).toEqual({ PATH: "/bin", GIT_SSH_COMMAND: sshCommand("/k/id") });
  });

  it("replaces the GIT_SSH_COMMAND of the user when a key is set", () => {
    const env = sshEnv({ GIT_SSH_COMMAND: "ssh -o User=fromuser" }, "/k/id");
    expect(env.GIT_SSH_COMMAND).toBe(sshCommand("/k/id"));
  });

  it("returns the env as it is when no key is set", () => {
    const env = { PATH: "/bin", GIT_SSH_COMMAND: "ssh -o User=fromuser" };
    expect(sshEnv(env, undefined)).toEqual(env);
  });

  it("does not change the env of the caller", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/bin" };
    sshEnv(env, "/k/id");
    expect(env).toEqual({ PATH: "/bin" });
  });
});

describe("hideSshKey", () => {
  const home = "/home/alice";

  it("hides the whole ssh command", () => {
    const key = "/k/it's";
    expect(hideSshKey(`failed: ${sshCommand(key)} end`, key, home)).toBe("failed: <sshKey> end");
  });

  it("hides the raw key", () => {
    expect(hideSshKey("Identity file /k/id not accessible", "/k/id", home)).toBe(
      "Identity file <sshKey> not accessible",
    );
  });

  it("hides the expansion of a ~/ key with the given home folder", () => {
    expect(hideSshKey("Identity file /home/alice/keys/id not accessible", "~/keys/id", home)).toBe(
      "Identity file <sshKey> not accessible",
    );
    expect(hideSshKey("raw ~/keys/id here", "~/keys/id", home)).toBe("raw <sshKey> here");
  });

  it("hides the part of a ~name/ key after the first /", () => {
    expect(hideSshKey("Identity file /home/bob/keys/id missing", "~bob/keys/id", home)).toBe(
      "Identity file /home/bob<sshKey> missing",
    );
  });

  it("hides each occurrence", () => {
    expect(hideSshKey("/k/id and /k/id", "/k/id", home)).toBe("<sshKey> and <sshKey>");
  });

  it("returns the text as it is when no key is set", () => {
    expect(hideSshKey("some /k/id text", undefined, home)).toBe("some /k/id text");
  });
});

describe("runRemoteGit", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  let logPath: string;

  beforeEach(() => {
    dir = makeTempDir("tasker-ssh-");
    logPath = join(dir, "ssh.log");
    writeFakeSsh(join(dir, "bin"), logPath, "refuse");
    env = { ...gitTestEnv(dir), PATH: `${join(dir, "bin")}${delimiter}${process.env.PATH}` };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function failure(sshKey: string): Promise<GitError> {
    const error: unknown = await runRemoteGit(
      ["ls-remote", "--", "ssh://tasker.invalid/repo.git"],
      { cwd: dir, env },
      sshKey,
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GitError);
    return error as GitError;
  }

  it("hides a key path with a space and a ' in the error", async () => {
    const key = join(dir, "it's my key");
    const error = await failure(key);
    for (const text of [error.message, error.stdout, error.stderr]) {
      expect(text).not.toContain(key);
    }
    expect(error.stderr).toContain("<sshKey>");
    expect(error.message).toContain("<sshKey>");
    expect(error.cause).toBeUndefined();
  });

  it("hides a ~/ key and its expanded form in the error", async () => {
    const error = await failure("~/tasker-no-such-key");
    const expanded = `${userInfo().homedir}/tasker-no-such-key`;
    for (const text of [error.message, error.stdout, error.stderr]) {
      expect(text).not.toContain("~/tasker-no-such-key");
      expect(text).not.toContain(expanded);
      expect(text).not.toContain("tasker-no-such-key");
    }
    expect(error.stderr).toContain("<sshKey>");
    expect(error.cause).toBeUndefined();
  });

  it("passes the ssh command of the key to ssh", async () => {
    const key = join(dir, "k");
    await failure(key);
    expect(readArgLog(logPath)[0]?.slice(0, 6)).toEqual([
      "-i",
      key,
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
    ]);
  });
});

describe("cloneUrl", () => {
  const root = remoteCwd();

  it.each([
    ["a/b", `${root}a/b`],
    ["/abs/repo.git", "/abs/repo.git"],
    ["host:path", "host:path"],
    ["git@github.com:o/r.git", "git@github.com:o/r.git"],
    ["ssh://h/x", "ssh://h/x"],
    ["file:///x", "file:///x"],
    ["a/b:c", `${root}a/b:c`],
    ["tmp/x/../x/src/", `${root}tmp/x/../x/src/`],
  ])("writes %s as %s", (remote, expected) => {
    expect(cloneUrl(remote)).toBe(expected);
  });
});
