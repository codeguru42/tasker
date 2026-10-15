import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BaseBranchMemory } from "../../../src/vcs/provider.js";
import {
  DENY_RULES,
  EXECUTE_COMMIT_TEXT,
  readDenyPaths,
  sandboxWritePaths,
  sharedFolder,
  trackedPaths,
} from "../../../src/vcs/git/assistant-surface.js";
import { resolveBaseBranch } from "../../../src/vcs/git/base-branch.js";
import { changedPaths, ownCommitsText, uncommittedChanges, worktreeDiff } from "../../../src/vcs/git/changes.js";
import { createGitProvider } from "../../../src/vcs/git/provider.js";
import { remoteTip } from "../../../src/vcs/git/remote-tip.js";
import { repoPaths } from "../../../src/vcs/git/repo-paths.js";
import { runGit } from "../../../src/vcs/git/run.js";
import {
  listWorktrees,
  taskBranchExists,
  taskBranchName,
  taskWorktreePath,
} from "../../../src/vcs/git/worktree.js";
import { commitInWorktree, localBranches, makeProviderFixture, type ProviderFixture } from "../../helpers/git.js";

describe("createGitProvider", () => {
  let fixture: ProviderFixture;

  beforeEach(async () => {
    fixture = await makeProviderFixture();
  });

  afterEach(() => {
    fixture.remove();
  });

  const paths = () => repoPaths(fixture.context.dataRoot, fixture.context.repoKey);
  const provider = () => createGitProvider({ remote: fixture.origin.path, config: {} });
  const base = "refs/remotes/origin/main";

  describe("provision and workspaces", () => {
    it("makes the clone of the repo at its folder", async () => {
      await provider().provision(fixture.context);
      expect(existsSync(paths().clone)).toBe(true);
    });

    it("creates, reuses and reuses the task ref of a workspace", async () => {
      const git = provider();
      await git.provision(fixture.context);
      const input = { shortRef: "issue-1", title: "Add the thing", baseRevision: base };
      const first = await git.createWorkspace(fixture.context, input);
      expect(first).toEqual({
        path: taskWorktreePath(paths().worktrees, "issue-1"),
        taskRef: taskBranchName("issue-1", "Add the thing"),
        state: "created",
      });
      const second = await git.createWorkspace(fixture.context, input);
      expect(second.state).toBe("reused-workspace");
      await git.removeWorkspace(fixture.context, { path: first.path });
      const third = await git.createWorkspace(fixture.context, input);
      expect(third.state).toBe("reused-task-ref");
    });

    it("removes the folder of a workspace and keeps its task ref", async () => {
      const git = provider();
      await git.provision(fixture.context);
      const workspace = await git.createWorkspace(fixture.context, {
        shortRef: "issue-1",
        title: "Add the thing",
        baseRevision: base,
      });
      await git.removeWorkspace(fixture.context, { path: workspace.path });
      expect(existsSync(workspace.path)).toBe(false);
      expect(await localBranches(paths().clone, fixture.context.env)).toContain(
        `refs/heads/${workspace.taskRef}`,
      );
    });
  });

  describe("installPushGuard", () => {
    it("writes the hook again with the folder of the publish tokens", async () => {
      const git = provider();
      await git.provision(fixture.context);
      const hook = join(paths().clone, "hooks", "pre-push");
      rmSync(hook);
      git.installPushGuard(fixture.context);
      expect(existsSync(hook)).toBe(true);
      expect(readFileSync(hook, "utf8")).toContain(resolve(paths().publishTokens));
    });
  });

  function memory(): BaseBranchMemory {
    const stored = new Map<string, string>();
    return {
      getDefaultBaseBranch: (repoKey) => stored.get(repoKey),
      setDefaultBaseBranch: (repoKey, branch) => void stored.set(repoKey, branch),
      forgetDefaultBaseBranch: (repoKey) => void stored.delete(repoKey),
    };
  }

  const ask = () => Promise.reject(new Error("ask must not run"));

  // A provisioned repo with one workspace.
  async function workspace() {
    const git = provider();
    await git.provision(fixture.context);
    const created = await git.createWorkspace(fixture.context, {
      shortRef: "issue-1",
      title: "Add the thing",
      baseRevision: base,
    });
    return { git, ...created };
  }

  describe("base, changes and reconcile", () => {
    it("resolves the base like resolveBaseBranch", async () => {
      const git = provider();
      await git.provision(fixture.context);
      const direct = await resolveBaseBranch({
        repoKey: fixture.context.repoKey,
        clone: paths().clone,
        sshKey: undefined,
        env: fixture.context.env,
        memory: memory(),
        explicit: "main",
        ask,
      });
      const mapped = await git.resolveBase(fixture.context, {
        memory: memory(),
        explicit: "main",
        ask,
      });
      expect(mapped).toEqual(direct);
    });

    it("gives the diff and the own commits like the git functions", async () => {
      const { git, path, taskRef } = await workspace();
      await commitInWorktree(path, fixture.context.env, { file: "a.txt" });
      const { clone } = paths();
      const env = fixture.context.env;
      expect(await git.diffAgainstBase(fixture.context, { path, baseRevision: base })).toBe(
        await worktreeDiff({ clone, env, path, baseRevision: base }),
      );
      expect(await git.ownCommits(fixture.context, { taskRef, baseRevision: base })).toBe(
        await ownCommitsText({ clone, env, branch: taskRef, baseRevision: base }),
      );
    });

    it("gives the changed paths like changedPaths", async () => {
      const { git, path, taskRef } = await workspace();
      await commitInWorktree(path, fixture.context.env, { file: "a.txt" });
      const direct = await changedPaths({
        clone: paths().clone,
        env: fixture.context.env,
        branch: taskRef,
        baseRevision: base,
      });
      expect(direct).toEqual(["a.txt"]);
      expect(await git.changedPaths(fixture.context, { taskRef, baseRevision: base })).toEqual(direct);
    });

    it("lists the uncommitted changes like uncommittedChanges", async () => {
      const { git, path } = await workspace();
      writeFileSync(join(path, "new.txt"), "new\n");
      const direct = await uncommittedChanges({
        clone: paths().clone,
        env: fixture.context.env,
        path,
      });
      expect(direct.length).toBeGreaterThan(0);
      expect(await git.uncommittedChanges(fixture.context, { path })).toEqual(direct);
    });

    it("lists the workspaces like listWorktrees", async () => {
      const { git, path } = await workspace();
      const direct = await listWorktrees({ clone: paths().clone, env: fixture.context.env });
      expect(direct.map((entry) => entry.path)).toContain(path);
      expect(await git.listWorkspaces(fixture.context)).toEqual(direct);
    });

    it("finds a task ref like taskBranchExists", async () => {
      const { git, taskRef } = await workspace();
      const { clone } = paths();
      const env = fixture.context.env;
      const missing = taskBranchName("issue-2", "nosuch");
      expect(await taskBranchExists({ clone, env, branch: taskRef })).toBe(true);
      expect(await git.taskRefExists(fixture.context, { taskRef })).toBe(true);
      expect(await taskBranchExists({ clone, env, branch: missing })).toBe(false);
      expect(await git.taskRefExists(fixture.context, { taskRef: missing })).toBe(false);
    });

    it("deletes a task ref after the workspace is removed", async () => {
      const { git, path, taskRef } = await workspace();
      await git.removeWorkspace(fixture.context, { path });
      await git.deleteTaskRef(fixture.context, { taskRef });
      expect(await localBranches(paths().clone, fixture.context.env)).not.toContain(
        `refs/heads/${taskRef}`,
      );
    });

    it("discards the changes of a workspace", async () => {
      const { git, path } = await workspace();
      writeFileSync(join(path, "README.md"), "changed\n");
      writeFileSync(join(path, "new.txt"), "new\n");
      expect((await git.uncommittedChanges(fixture.context, { path })).length).toBeGreaterThan(0);
      await git.discardWorkspaceChanges(fixture.context, { path });
      expect(await git.uncommittedChanges(fixture.context, { path })).toEqual([]);
    });

    it("reconciles the workspace onto the new base and gives its head", async () => {
      const { git, path } = await workspace();
      await commitInWorktree(path, fixture.context.env, { file: "a.txt" });
      await fixture.origin.addCommit("main", { file: "other.txt" });
      const resolved = await git.resolveBase(fixture.context, {
        memory: memory(),
        explicit: "main",
        ask,
      });
      const head = await git.reconcile(fixture.context, {
        path,
        baseRevision: resolved.revision,
        strategy: "rebase",
      });
      expect(head).toBe(
        (await runGit(["rev-parse", "HEAD"], { cwd: path, env: fixture.context.env })).trim(),
      );
    });
  });

  describe("publish, land and delete", () => {
    // A workspace with one commit, published to the origin.
    async function published() {
      const made = await workspace();
      await commitInWorktree(made.path, fixture.context.env, { file: "a.txt" });
      const result = await made.git.publish(fixture.context, {
        taskRef: made.taskRef,
        published: undefined,
      });
      return { ...made, result };
    }

    it("publishes the task ref to the origin", async () => {
      const { taskRef, result } = await published();
      expect(result.taskRef).toBe(taskRef);
      expect(result.revision).toBe(await fixture.origin.branchHead(taskRef));
    });

    it("lands the revision on the base", async () => {
      const { git, result } = await published();
      await git.land(fixture.context, { base: "main", revision: result.revision });
      expect(await fixture.origin.branchHead("main")).toBe(result.revision);
    });

    it("deletes the task ref from the origin", async () => {
      const { git, taskRef, result } = await published();
      const deletion = await git.deleteRemoteTaskRef(fixture.context, {
        taskRef,
        published: result.revision,
      });
      expect(deletion).toEqual({ state: "deleted" });
      expect(await fixture.origin.branchHead(taskRef)).toBeUndefined();
    });
  });

  describe("remote tip", () => {
    it("gives the tip of a task ref that exists on the origin like remoteTip", async () => {
      const { origin, context } = fixture;
      const tip = await provider().remoteTaskRefTip(context, { taskRef: "main" });
      expect(tip).toEqual({ state: "present", revision: await origin.branchHead("main") });
      expect(tip).toEqual(
        await remoteTip({ remote: origin.path, branch: "main", sshKey: undefined, env: context.env }),
      );
    });

    it("gives absent for a task ref that does not exist like remoteTip", async () => {
      const { origin, context } = fixture;
      const tip = await provider().remoteTaskRefTip(context, { taskRef: "issue-1-missing" });
      expect(tip).toEqual({ state: "absent" });
      expect(tip).toEqual(
        await remoteTip({ remote: origin.path, branch: "issue-1-missing", sshKey: undefined, env: context.env }),
      );
    });
  });

  describe("assistant surface and doctor checks", () => {
    const keyed = () => ({ sshKey: join(fixture.origin.dir, "keys", "id") });
    const keyedProvider = () =>
      createGitProvider({ remote: fixture.origin.path, config: keyed() });

    it("gives the text, the rules and the deny paths of the git code", () => {
      const surface = keyedProvider().assistantSurface(fixture.context);
      expect(surface.executeCommitText).toBe(EXECUTE_COMMIT_TEXT);
      expect(surface.denyRules).toEqual(DENY_RULES);
      expect(surface.denyReadPaths).toEqual(readDenyPaths(keyed()));
    });

    it("gives the folder of the publish tokens of the repo", () => {
      const surface = keyedProvider().assistantSurface(fixture.context);
      expect(surface.publishTokensPath).toBe(paths().publishTokens);
    });

    it("gives the write paths of a workspace like sandboxWritePaths", async () => {
      const { path } = await workspace();
      const surface = keyedProvider().assistantSurface(fixture.context);
      expect(await surface.sandboxWritePaths(path)).toEqual(
        await sandboxWritePaths({ clone: paths().clone, env: fixture.context.env, path }),
      );
    });

    it("gives the shared folder of a workspace like sharedFolder", async () => {
      const { path } = await workspace();
      const surface = keyedProvider().assistantSurface(fixture.context);
      expect(await surface.sharedFolder(path)).toBe(
        await sharedFolder({ clone: paths().clone, env: fixture.context.env, path }),
      );
    });

    it("gives the tracked paths of a workspace like trackedPaths", async () => {
      const { path } = await workspace();
      writeFileSync(join(path, "kept.txt"), "x\n");
      await runGit(["add", "kept.txt"], { cwd: path, env: fixture.context.env });
      const surface = keyedProvider().assistantSurface(fixture.context);
      const names = ["kept.txt", "other.txt"];
      expect(await surface.trackedPaths(path, names)).toEqual(["kept.txt"]);
      expect(await surface.trackedPaths(path, names)).toEqual(
        await trackedPaths({ env: fixture.context.env, path, paths: names }),
      );
    });

    it("names the four checks of the repo", () => {
      const checks = keyedProvider().doctorChecks(fixture.context, {
        procRoot: "/proc",
        platform: "linux",
      });
      expect(checks.map((check) => check.name)).toEqual([
        "git version",
        "git identity: tasker",
        "git connection: tasker",
        "git lock files: tasker",
      ]);
    });
  });
});
