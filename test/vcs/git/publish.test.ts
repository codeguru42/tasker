import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionClone } from "../../../src/vcs/git/provision.js";
import { deleteRemoteTaskBranch, landOnBase, publishTaskBranch } from "../../../src/vcs/git/publish.js";
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
  NOT_TASK_BRANCHES,
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

  function land(overrides: Partial<Parameters<typeof landOnBase>[0]> = {}): Promise<void> {
    return landOnBase({
      clone,
      remote: origin.path,
      publishTokens: tokens,
      sshKey: undefined,
      env,
      base: "main",
      revision: "0".repeat(40),
      ...overrides,
    });
  }

  function remove(
    overrides: Partial<Parameters<typeof deleteRemoteTaskBranch>[0]> = {},
  ): ReturnType<typeof deleteRemoteTaskBranch> {
    return deleteRemoteTaskBranch({
      clone,
      remote: origin.path,
      publishTokens: tokens,
      sshKey: undefined,
      env,
      branch: "issue-1-task",
      published: "0".repeat(40),
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

  // Makes origin refuse each push.
  function refusePushesOnOrigin(): void {
    const hooks = join(origin.path, "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
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

    describe("errors", () => {
      const named = "cannot publish the task branch: issue-1-task";

      it("names the branch when origin refuses the push", async () => {
        await addCloneCommit(clone, env, "issue-1-task");
        refusePushesOnOrigin();

        const error = await failureOf(publish(), Error);

        expect(error.message.startsWith(named)).toBe(true);
        expect(await origin.branchHead("issue-1-task")).toBeUndefined();
        expectNoTokenFile();
      });

      it("names the branch when the remote does not answer", async () => {
        await addCloneCommit(clone, env, "issue-1-task");

        const error = await failureOf(
          publish({ remote: join(origin.dir, "missing.git") }),
          Error,
        );

        expect(error.message.startsWith(named)).toBe(true);
        expectNoTokenFile();
      });

      it.each(["abc", "main"])("refuses the published revision %j before any git call", async (published) => {
        const error = await failureOf(publish({ published }), Error);
        expect(error.message).toBe(
          `the published revision is not a full revision: ${JSON.stringify(published)}`,
        );
        expect(gitCalls()).toEqual([]);
      });

      it.each(NOT_TASK_BRANCHES)("refuses the name %j before any git call", async (branch) => {
        const error = await failureOf(publish({ branch }), Error);
        expect(error.message).toBe(`not a task branch: ${JSON.stringify(branch)}`);
        expect(gitCalls()).toEqual([]);
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

  describe("landOnBase", () => {
    it("lands a child of the base by fast-forward", async () => {
      const revision = await addCloneCommit(clone, env, "issue-1-task");

      await land({ revision });

      expect(await origin.branchHead("main")).toBe(revision);
      expect(pushes()).toEqual([["push", "origin", `${revision}:refs/heads/main`]]);
      expectNoTokenFile();
      await expectPushNeedsToken();
    });

    it.each(["nope", "HEAD"])("refuses a base that origin does not have: %s", async (base) => {
      const revision = await addCloneCommit(clone, env, "issue-1-task");

      const error = await failureOf(land({ base, revision }), Error);

      expect(error.message).toBe(
        `cannot land ${revision} on the base branch: ${base}: the base branch does not exist on origin`,
      );
      expect(pushes()).toEqual([]);
      expect(await origin.branchHead(base)).toBeUndefined();
      expectNoTokenFile();
    });

    describe("input checks", () => {
      async function expectRefusedBeforeAnyGitCall(
        overrides: (revision: string) => Parameters<typeof land>[0],
        message: (revision: string) => string,
      ): Promise<void> {
        const revision = await addCloneCommit(clone, env, "issue-1-task");
        const main = await origin.branchHead("main");
        const mark = gitCalls().length;

        const error = await failureOf(land(overrides(revision)), Error);

        expect(error.message).toBe(message(revision));
        expect(gitCalls(mark)).toEqual([]);
        expect(await origin.branchHead("main")).toBe(main);
        expectNoTokenFile();
      }

      it("refuses a local base", async () => {
        await expectRefusedBeforeAnyGitCall(
          (revision) => ({ base: "refs/heads/main", revision }),
          (revision) =>
            `cannot land ${revision} on the base branch: refs/heads/main: the base is a local branch`,
        );
      });

      it("refuses an empty base", async () => {
        await expectRefusedBeforeAnyGitCall(
          (revision) => ({ base: "", revision }),
          (revision) => `cannot land ${revision}: the base branch is empty`,
        );
      });

      it("refuses a branch name as the revision", async () => {
        await expectRefusedBeforeAnyGitCall(
          () => ({ revision: "main" }),
          () => 'the revision is not a full revision: "main"',
        );
      });

      it("refuses a short revision", async () => {
        let short = "";
        await expectRefusedBeforeAnyGitCall(
          (revision) => {
            short = revision.slice(0, 7);
            return { revision: short };
          },
          () => `the revision is not a full revision: "${short}"`,
        );
      });
    });

    describe("errors", () => {
      it("names the base and the revision when the revision is not a fast-forward", async () => {
        const revision = await addCloneCommit(clone, env, "issue-1-task");
        const moved = await origin.addCommit("main");

        const error = await failureOf(land({ revision }), Error);

        expect(error.message.startsWith(`cannot land ${revision} on the base branch: main`)).toBe(
          true,
        );
        expect(await origin.branchHead("main")).toBe(moved);
        expectNoTokenFile();
      });

      it("names the base and the revision when the remote does not answer", async () => {
        const revision = await addCloneCommit(clone, env, "issue-1-task");

        const error = await failureOf(
          land({ revision, remote: join(origin.dir, "missing.git") }),
          Error,
        );

        expect(error.message.startsWith(`cannot land ${revision} on the base branch: main`)).toBe(
          true,
        );
        expectNoTokenFile();
      });
    });

    it("passes the ssh key to each ssh call", async () => {
      const ssh = await sshClone();
      const revision = await addCloneCommit(ssh.clone, ssh.fake.env, "issue-1-task");
      const mark = readArgLog(ssh.fake.logPath).length;

      await land({ ...ssh.overrides, revision });

      expect(await origin.branchHead("main")).toBe(revision);
      const calls = readArgLog(ssh.fake.logPath).slice(mark);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const call of calls) expect(call.slice(0, 6)).toEqual(sshKeyArgs(ssh.key));
    });
  });

  describe("deleteRemoteTaskBranch", () => {
    it("deletes the branch with a lease on the published revision", async () => {
      const published = await addCloneCommit(clone, env, "issue-1-task");
      await publish();

      const result = await remove({ published });

      expect(result).toEqual({ state: "deleted" });
      expect(await origin.branchHead("issue-1-task")).toBeUndefined();
      expect(pushes().at(-1)).toEqual([
        "push",
        `--force-with-lease=refs/heads/issue-1-task:${published}`,
        "origin",
        ":refs/heads/issue-1-task",
      ]);
      expectNoTokenFile();
      await expectPushNeedsToken();
    });

    it("reports a branch that origin no longer has, with no push", async () => {
      const published = await addCloneCommit(clone, env, "issue-1-task");

      const result = await remove({ published });

      expect(result).toEqual({ state: "already-gone" });
      expect(pushes()).toEqual([]);
      expectNoTokenFile();
    });

    it("refuses a branch that someone else moved, with no push", async () => {
      const published = await addCloneCommit(clone, env, "issue-1-task");
      await publish();
      const other = await origin.addCommit("issue-1-task");
      const before = pushes().length;

      const error = await failureOf(remove({ published }), Error);

      expect(error.message).toBe(
        `the task branch moved on origin: issue-1-task: tasker published ${published}, origin has ${other}`,
      );
      expect(pushes()).toHaveLength(before);
      expect(await origin.branchHead("issue-1-task")).toBe(other);
      expectNoTokenFile();
    });

    it("passes the ssh key to each ssh call", async () => {
      const ssh = await sshClone();
      const published = await addCloneCommit(ssh.clone, ssh.fake.env, "issue-1-task");
      await publish(ssh.overrides);
      const mark = readArgLog(ssh.fake.logPath).length;

      const result = await remove({ ...ssh.overrides, published });

      expect(result).toEqual({ state: "deleted" });
      const calls = readArgLog(ssh.fake.logPath).slice(mark);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const call of calls) expect(call.slice(0, 6)).toEqual(sshKeyArgs(ssh.key));
    });
  });
});
