import { userInfo } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitError } from "../../../src/vcs/git/run.js";
import {
  cloneUrl,
  hideSshKey,
  isLocalRemote,
  remoteCwd,
  runRemoteGit,
  sshCommand,
  sshEnv,
} from "../../../src/vcs/git/ssh.js";
import { failureOf } from "../../helpers/errors.js";
import { readArgLog } from "../../helpers/fake-commands.js";
import { fakeSsh, type FakeSsh } from "../../helpers/fake-ssh.js";
import { gitTestEnv, sshKeyArgs } from "../../helpers/git.js";
import { useTempDir } from "../../helpers/temp.js";

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
  let ssh: FakeSsh;

  beforeEach(() => {
    dir = useTempDir("tasker-ssh-");
    ssh = fakeSsh(dir, gitTestEnv(dir), "refuse");
  });

  async function failure(sshKey: string): Promise<GitError> {
    return failureOf(
      runRemoteGit(
        ["ls-remote", "--", ssh.remote("/repo.git")],
        { cwd: dir, env: ssh.env },
        sshKey,
      ),
      GitError,
    );
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
    expect(readArgLog(ssh.logPath)[0]?.slice(0, 6)).toEqual(sshKeyArgs(key));
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

describe("isLocalRemote", () => {
  it.each(["/a", "a", "./x:y", "a/b:c"])("says that %s is a local path", (remote) => {
    expect(isLocalRemote(remote)).toBe(true);
  });

  it.each(["host:path", "git@h:o/r", "ssh://h/x", "https://h/x"])(
    "says that %s is not a local path",
    (remote) => {
      expect(isLocalRemote(remote)).toBe(false);
    },
  );
});
