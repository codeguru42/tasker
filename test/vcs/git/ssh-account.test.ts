import { beforeEach, describe, expect, it } from "vitest";
import { sshAccount, sshTarget } from "../../../src/vcs/git/ssh-account.js";
import { readArgLog } from "../../helpers/fake-commands.js";
import { fakeSsh, type FakeSsh, type FakeSshMode } from "../../helpers/fake-ssh.js";
import { gitTestEnv, sshKeyArgs } from "../../helpers/git.js";
import { useTempDir } from "../../helpers/temp.js";

describe("sshTarget", () => {
  it.each([
    ["git@github.com:o/r.git", { destination: "git@github.com" }],
    ["github.com:o/r.git", { destination: "github.com" }],
    ["ssh://git@host:2222/o/r", { destination: "git@host", port: "2222" }],
    ["ssh://host/o/r", { destination: "host" }],
    ["git+ssh://git@host/o/r", { destination: "git@host" }],
    ["ssh+git://host/o/r", { destination: "host" }],
    ["ssh://[::1]/x", { destination: "::1" }],
  ])("reads the target of %s", (remote, expected) => {
    expect(sshTarget(remote)).toEqual(expected);
  });

  it.each([
    "/local",
    "../rel:x",
    "https://h/x",
    "file:///x",
    "ssh://-oProxyCommand=x/r",
    "-oX:y",
    "ssh://-u@h/x",
    "ssh://h:2x/r",
  ])("gives no target for %s", (remote) => {
    expect(sshTarget(remote)).toBeUndefined();
  });
});

describe("sshAccount", () => {
  let dir: string;
  let baseEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = useTempDir("tasker-ssh-account-");
    baseEnv = gitTestEnv(dir);
  });

  function setup(mode: FakeSshMode): FakeSsh {
    return fakeSsh(dir, baseEnv, mode);
  }

  function probe(ssh: FakeSsh, sshKey: string | undefined, signal = AbortSignal.timeout(10000)) {
    return sshAccount({ remote: ssh.remote("/o/r"), sshKey, env: ssh.env, signal });
  }

  it("reads the account from the greeting", async () => {
    const ssh = setup({ greet: "octocat", repo: "serve" });
    const key = `${dir}/key`;
    expect(await probe(ssh, key)).toEqual({ state: "found", account: "octocat" });
    expect(readArgLog(ssh.logPath)).toEqual([[...sshKeyArgs(key), "-T", "--", "tasker.invalid"]]);
  });

  it.each([`it's-key`, "~/k"])("passes the key %s to ssh as it is", async (name) => {
    const ssh = setup({ greet: "octocat", repo: "serve" });
    const key = name.startsWith("~/") ? name : `${dir}/${name}`;
    expect(await probe(ssh, key)).toEqual({ state: "found", account: "octocat" });
    expect(readArgLog(ssh.logPath)).toEqual([[...sshKeyArgs(key), "-T", "--", "tasker.invalid"]]);
  });

  it("gives the port to ssh", async () => {
    const ssh = setup({ greet: "octocat", repo: "serve" });
    const remote = "ssh://git@tasker.invalid:2222/o/r";
    await sshAccount({ remote, sshKey: undefined, env: ssh.env, signal: AbortSignal.timeout(10000) });
    const [call] = readArgLog(ssh.logPath);
    expect(call.slice(-5)).toEqual(["-T", "-p", "2222", "--", "git@tasker.invalid"]);
  });

  it("gives none when ssh prints no greeting", async () => {
    const ssh = setup("serve");
    expect(await probe(ssh, undefined)).toEqual({ state: "none" });
  });

  it("gives git-ssh and starts nothing when GIT_SSH is set", async () => {
    const ssh = setup({ greet: "octocat", repo: "serve" });
    const result = await sshAccount({
      remote: ssh.remote("/o/r"),
      sshKey: undefined,
      env: { ...ssh.env, GIT_SSH: "/x/ssh" },
      signal: AbortSignal.timeout(10000),
    });
    expect(result).toEqual({ state: "git-ssh" });
    expect(readArgLog(ssh.logPath)).toEqual([]);
  });

  it("rejects fast when the signal fires", async () => {
    const ssh = setup("hang");
    const started = Date.now();
    await expect(probe(ssh, undefined, AbortSignal.timeout(200))).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
