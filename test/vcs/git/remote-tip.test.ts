import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { remoteTip } from "../../../src/vcs/git/remote-tip.js";
import { runGit } from "../../../src/vcs/git/run.js";
import {
  type GitOrigin,
  makeGitOrigin,
  makeTempDir,
  readArgLog,
  writeFakeSsh,
} from "../../helpers.js";

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
    const empty = makeTempDir("tasker-empty-");
    try {
      await runGit(["init", "--bare", "--initial-branch=main", "--", empty], {
        cwd: empty,
        env: origin.env,
      });
      expect(await tip("main", empty)).toEqual({ state: "absent" });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
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
    const binDir = join(origin.dir, "bin");
    const logPath = join(origin.dir, "ssh.log");
    writeFakeSsh(binDir, logPath, "serve");
    const key = join(origin.dir, "id key");
    const result = await remoteTip({
      remote: `ssh://tasker.invalid${origin.path}`,
      branch: "main",
      sshKey: key,
      env: { ...origin.env, PATH: `${binDir}:${process.env.PATH}` },
    });
    expect(result).toEqual({ state: "present", revision: await origin.branchHead("main") });
    expect(readArgLog(logPath)[0]?.slice(0, 6)).toEqual([
      "-i",
      key,
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
    ]);
  });

  it("rejects with the remote name when the remote does not answer", async () => {
    const remote = join(origin.dir, "missing.git");
    const error = await tip("main", remote).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message.startsWith(`the remote does not answer: ${remote}`)).toBe(true);
  });
});
