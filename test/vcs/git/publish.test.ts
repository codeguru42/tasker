import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionClone } from "../../../src/vcs/git/provision.js";
import { publishTaskBranch } from "../../../src/vcs/git/publish.js";
import { GitError, runGit } from "../../../src/vcs/git/run.js";
import {
  addCloneCommit,
  failureOf,
  fakeSsh,
  type GitOrigin,
  gitCloneTokens,
  makeGitClone,
  makeGitOrigin,
  NO_TOKEN,
  readArgLog,
  sshKeyArgs,
  writeGitRecorder,
} from "../../helpers.js";

describe("publish, land and delete", () => {
  let origin: GitOrigin;
  let clone: string;
  let tokens: string;
  let log: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    clone = await makeGitClone(origin);
    tokens = gitCloneTokens(origin);
    const bin = join(origin.dir, "bin");
    log = join(origin.dir, "git.log");
    writeGitRecorder(bin, log);
    env = { ...origin.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
  });

  afterEach(() => {
    origin.remove();
  });

  function publish(
    overrides: Partial<Parameters<typeof publishTaskBranch>[0]> = {},
  ): ReturnType<typeof publishTaskBranch> {
    return publishTaskBranch({
      clone,
      remote: origin.path,
      publishTokens: tokens,
      sshKey: undefined,
      env,
      branch: "issue-1-task",
      published: undefined,
      ...overrides,
    });
  }

  // The recorder calls after the first mark calls. runGit() puts "--bare --git-dir <path>" in
  // front of a call in a bare clone. This function drops it, so that a call starts with its subcommand.
  function gitCalls(mark = 0): string[][] {
    return readArgLog(log)
      .slice(mark)
      .map((call) => (call[0] === "--bare" && call[1] === "--git-dir" ? call.slice(3) : call));
  }

  function pushes(): string[][] {
    return gitCalls().filter((call) => call[0] === "push");
  }

  // A push with no token fails, so the token of a finished operation is used up or deleted.
  async function expectPushNeedsToken(): Promise<void> {
    const error = await failureOf(
      runGit(["push", "origin", "refs/remotes/origin/main:refs/heads/no-token"], {
        gitDir: clone,
        env: origin.env,
      }),
      GitError,
    );
    expect(error.stderr).toContain(NO_TOKEN);
    expect(await origin.branchHead("no-token")).toBeUndefined();
  }

  function expectNoTokenFile(): void {
    expect(existsSync(tokens) ? readdirSync(tokens) : []).toEqual([]);
  }

  // A second clone of origin that reaches origin through the fake ssh, with its publish options.
  async function sshClone() {
    const fake = fakeSsh(join(origin.dir, "ssh"), origin.env, "serve");
    const key = join(origin.dir, "id key");
    const sshPath = join(origin.dir, "clone-ssh", "repo.git");
    const sshTokens = join(origin.dir, "clone-ssh", "publish-tokens");
    await provisionClone({
      remote: fake.remote(origin.path),
      clone: sshPath,
      config: { sshKey: key },
      env: fake.env,
      publishTokens: sshTokens,
    });
    return {
      fake,
      key,
      clone: sshPath,
      overrides: {
        clone: sshPath,
        remote: fake.remote(origin.path),
        publishTokens: sshTokens,
        sshKey: key,
        env: fake.env,
      },
    };
  }

  describe("publishTaskBranch", () => {
    it("publishes a new branch with the empty lease", async () => {
      const revision = await addCloneCommit(clone, env, "issue-1-task");
      const main = await origin.branchHead("main");

      const result = await publish({ published: undefined });

      expect(result).toEqual({
        state: "published",
        branch: "issue-1-task",
        revision,
        lease: true,
      });
      expect(await origin.branchHead("issue-1-task")).toBe(revision);
      expect(await origin.branchHead("main")).toBe(main);
      expect(pushes()).toEqual([
        [
          "push",
          "--force-with-lease=refs/heads/issue-1-task:",
          "origin",
          "refs/heads/issue-1-task:refs/heads/issue-1-task",
        ],
      ]);
      expectNoTokenFile();
      await expectPushNeedsToken();
    });

    it("passes the ssh key to each ssh call", async () => {
      const ssh = await sshClone();
      const revision = await addCloneCommit(ssh.clone, ssh.fake.env, "issue-1-task");
      const mark = readArgLog(ssh.fake.logPath).length;

      const result = await publish(ssh.overrides);

      expect(result.state).toBe("published");
      expect(await origin.branchHead("issue-1-task")).toBe(revision);
      const calls = readArgLog(ssh.fake.logPath).slice(mark);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const call of calls) expect(call.slice(0, 6)).toEqual(sshKeyArgs(ssh.key));
    });

    it("reports a branch that origin already has, with no push and no lease", async () => {
      const revision = await addCloneCommit(clone, env, "issue-1-task");
      await publish({ published: undefined });
      const before = pushes().length;

      const result = await publish({ published: revision });

      expect(result).toEqual({
        state: "already-published",
        branch: "issue-1-task",
        revision,
        lease: false,
      });
      expect(pushes()).toHaveLength(before);
      expectNoTokenFile();
    });

    it("publishes a rebased branch with a lease on the published revision", async () => {
      const first = await addCloneCommit(clone, env, "issue-1-task");
      await publish({ published: undefined });
      const rebased = await addCloneCommit(clone, env, "issue-1-task", "refs/remotes/origin/main");

      const result = await publish({ published: first });

      expect(result).toEqual({
        state: "published",
        branch: "issue-1-task",
        revision: rebased,
        lease: true,
      });
      expect(await origin.branchHead("issue-1-task")).toBe(rebased);
      expect(pushes().at(-1)).toEqual([
        "push",
        `--force-with-lease=refs/heads/issue-1-task:${first}`,
        "origin",
        "refs/heads/issue-1-task:refs/heads/issue-1-task",
      ]);
      expectNoTokenFile();
      await expectPushNeedsToken();
    });

    describe("when someone else moved the branch", () => {
      const moved = "the task branch moved on origin: issue-1-task";

      async function expectRefusedWithNoPush(
        run: () => Promise<unknown>,
        message: string,
        originHead: string | undefined,
      ): Promise<void> {
        const before = pushes().length;
        const error = await failureOf(run(), Error);
        expect(error.message).toBe(message);
        expect(pushes()).toHaveLength(before);
        expect(await origin.branchHead("issue-1-task")).toBe(originHead);
        expectNoTokenFile();
      }

      it("refuses when origin has a revision that tasker did not publish", async () => {
        const first = await addCloneCommit(clone, env, "issue-1-task");
        await publish({ published: undefined });
        const other = await origin.addCommit("issue-1-task");
        await addCloneCommit(clone, env, "issue-1-task", "refs/remotes/origin/main");

        await expectRefusedWithNoPush(
          () => publish({ published: first }),
          `${moved}: tasker published ${first}, origin has ${other}`,
          other,
        );
      });

      it("refuses when origin no longer has the branch", async () => {
        const revision = await addCloneCommit(clone, env, "issue-1-task");

        await expectRefusedWithNoPush(
          () => publish({ published: revision }),
          `${moved}: tasker published ${revision}, origin does not have it`,
          undefined,
        );
      });

      it("refuses a first publish over a branch that someone else made", async () => {
        const main = await origin.branchHead("main");
        await origin.createBranch("issue-1-task");
        await addCloneCommit(clone, env, "issue-1-task", "refs/remotes/origin/main");
        await addCloneCommit(clone, env, "issue-1-task");

        await expectRefusedWithNoPush(
          () => publish({ published: undefined }),
          `${moved}: tasker never published it, origin has ${main}`,
          main,
        );
      });
    });

    it("passes the ssh key to the ls-remote call of an already published branch", async () => {
      const ssh = await sshClone();
      const revision = await addCloneCommit(ssh.clone, ssh.fake.env, "issue-1-task");
      await publish(ssh.overrides);
      const mark = readArgLog(ssh.fake.logPath).length;

      const result = await publish({ ...ssh.overrides, published: revision });

      expect(result.state).toBe("already-published");
      const calls = readArgLog(ssh.fake.logPath).slice(mark);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.slice(0, 6)).toEqual(sshKeyArgs(ssh.key));
    });
  });
});
