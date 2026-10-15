import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RemoteTip, remoteTip, tipMoved } from "../../../src/vcs/git/remote-tip.js";
import { runGit } from "../../../src/vcs/git/run.js";
import { failureOf } from "../../helpers/errors.js";
import { readArgLog } from "../../helpers/fake-commands.js";
import { fakeSsh } from "../../helpers/fake-ssh.js";
import { makeGitOrigin, sshKeyArgs, type GitOrigin } from "../../helpers/git.js";
import { useTempDir } from "../../helpers/temp.js";

describe("remoteTip", () => {
  let origin: GitOrigin;

  beforeEach(async () => {
    origin = await makeGitOrigin();
  });

  afterEach(() => {
    origin.remove();
  });

  function tip(branch: string, remote = origin.path): ReturnType<typeof remoteTip> {
    return remoteTip({ remote, branch, sshKey: undefined, env: origin.env });
  }

  it("gives the revision of a branch that exists", async () => {
    expect(await tip("main")).toEqual({
      state: "present",
      revision: await origin.branchHead("main"),
    });
  });

  it("gives absent for a branch that does not exist", async () => {
    expect(await tip("missing")).toEqual({ state: "absent" });
  });

  it("gives absent for a remote with no refs", async () => {
    const empty = useTempDir("tasker-empty-");
    await runGit(["init", "--bare", "--initial-branch=main", "--", empty], {
      cwd: empty,
      env: origin.env,
    });
    expect(await tip("main", empty)).toEqual({ state: "absent" });
  });

  it("gives absent when the name is only the tail of another branch", async () => {
    await origin.createBranch("a/refs/heads/feature");
    expect(await tip("feature")).toEqual({ state: "absent" });
  });

  it("gives absent when the name is only a tag", async () => {
    await runGit(["tag", "feature", "main"], { gitDir: origin.path, env: origin.env });
    expect(await tip("feature")).toEqual({ state: "absent" });
  });

  it.each(["a..b", "-x", "main~1", "main^{commit}", "../../heads/main"])(
    "gives absent for the text %s",
    async (branch) => {
      expect(await tip(branch)).toEqual({ state: "absent" });
    },
  );

  it("passes the ssh key to ssh", async () => {
    const ssh = fakeSsh(origin.dir, origin.env, "serve");
    const key = join(origin.dir, "id key");
    const result = await remoteTip({
      remote: ssh.remote(origin.path),
      branch: "main",
      sshKey: key,
      env: ssh.env,
    });
    expect(result).toEqual({ state: "present", revision: await origin.branchHead("main") });
    expect(readArgLog(ssh.logPath)[0]?.slice(0, 6)).toEqual(sshKeyArgs(key));
  });

  it("rejects with the remote name when the remote does not answer", async () => {
    const remote = join(origin.dir, "missing.git");
    const error = await failureOf(tip("main", remote), Error);
    expect(error.message.startsWith(`the remote does not answer: ${remote}`)).toBe(true);
  });

  it("refuses an empty branch name before it reads the remote", async () => {
    const remote = join(origin.dir, "missing.git");
    await expect(tip("", remote)).rejects.toThrow(/^the branch name is empty$/);
  });
});

describe("tipMoved", () => {
  const a: RemoteTip = { state: "present", revision: "a".repeat(40) };
  const b: RemoteTip = { state: "present", revision: "b".repeat(40) };
  const absent: RemoteTip = { state: "absent" };
  const moved = (from: string, to: string): string =>
    `the tip of the branch on the remote moved from ${from} to ${to}`;

  it("gives undefined when the tip did not move", () => {
    expect(tipMoved(a, { ...a })).toBeUndefined();
    expect(tipMoved(absent, { state: "absent" })).toBeUndefined();
  });

  it("names both revisions when the tip moved", () => {
    expect(tipMoved(a, b)).toBe(moved("a".repeat(40), "b".repeat(40)));
  });

  it("writes absent for a tip that does not exist", () => {
    expect(tipMoved(absent, a)).toBe(moved("absent", "a".repeat(40)));
    expect(tipMoved(a, absent)).toBe(moved("a".repeat(40), "absent"));
  });
});
