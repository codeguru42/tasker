import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BaseBranchMemory } from "../../../src/vcs/provider.js";
import { checkSummaries } from "../../helpers/doctor.js";
import {
  DENY_RULES,
  EXECUTE_COMMIT_TEXT,
  readDenyPaths,
  sandboxWritePaths,
  sharedFolder,
  trackedPaths,
} from "../../../src/vcs/git/assistant-surface.js";
import { resolveBaseBranch } from "../../../src/vcs/git/base-branch.js";
import {
  changedPaths,
  ownCommitsText,
  remoteTaskBranchSides,
  remoteTaskBranchState,
  uncommittedChanges,
  worktreeDiff,
} from "../../../src/vcs/git/changes.js";
import { worktreeState } from "../../../src/vcs/git/reconcile.js";
import { ReconcileConflictError } from "../../../src/vcs/errors.js";
import { gitDoctorChecks } from "../../../src/vcs/git/doctor.js";
import { createGitProvider } from "../../../src/vcs/git/provider.js";
import { remoteTip } from "../../../src/vcs/git/remote-tip.js";
import { repoPaths } from "../../../src/vcs/git/repo-paths.js";
import { runGit } from "../../../src/vcs/git/run.js";
import {
  listWorktrees,
  taskBranchExists,
  taskBranchName,
  taskBranchRevision,
  taskWorktreePath,
} from "../../../src/vcs/git/worktree.js";
import {
  commitInWorktree,
  copyCloneBranchToOrigin,
  gitOutput,
  localBranches,
  makeProviderFixture,
  type ProviderFixture,
} from "../../helpers/git.js";

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
  const containment = (git: ReturnType<typeof provider>, taskRef: string) =>
    git.baseContainment(fixture.context, { taskRef, baseRevision: base });

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
      expect(await localBranches(paths().clone, fixture.context.env)).toContain(`refs/heads/${workspace.taskRef}`);
    });
  });

  describe("localCopyPath", () => {
    it("gives the clone path like repoPaths", () => {
      expect(provider().localCopyPath(fixture.context)).toBe(paths().clone);
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
        issueKey: "codeguru42/tasker#5",
        note: () => {},
        explicit: "main",
        ask,
      });
      const mapped = await git.resolveBase(fixture.context, {
        memory: memory(),
        issueKey: "codeguru42/tasker#5",
        note: () => {},
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

    it("fetches origin and says whether the workspace contains the tip of the base", async () => {
      const { git, path, taskRef } = await workspace();
      const env = fixture.context.env;
      const head = await commitInWorktree(path, env, { file: "a.txt" });
      const tip = await fixture.origin.addCommit("main");
      expect(await containment(git, taskRef)).toEqual({ revision: head, baseTip: tip, contains: false });
      const moved = await gitOutput({ gitDir: paths().clone }, env, "rev-parse", base);
      expect(moved).toBe(tip);
    });

    it("fetches origin and says whether the base contains the task ref", async () => {
      const { git, path, taskRef } = await workspace();
      const env = fixture.context.env;
      const head = await commitInWorktree(path, env, { file: "a.txt" });
      const tip = await fixture.origin.addCommit("main");
      expect(await git.taskRefOnBase(fixture.context, { taskRef, baseRevision: base })).toEqual({
        revision: head,
        baseTip: tip,
        onBase: false,
      });
      const moved = await gitOutput({ gitDir: paths().clone }, env, "rev-parse", base);
      expect(moved).toBe(tip);
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

    it("gives the tip of a task ref like taskBranchRevision", async () => {
      const { git, path, taskRef } = await workspace();
      const head = await commitInWorktree(path, fixture.context.env, { file: "a.txt" });
      const direct = await taskBranchRevision({ clone: paths().clone, env: fixture.context.env, branch: taskRef });
      expect(direct).toBe(head);
      expect(await git.taskRefRevision(fixture.context, { taskRef })).toBe(direct);
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
      expect(await localBranches(paths().clone, fixture.context.env)).not.toContain(`refs/heads/${taskRef}`);
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
        issueKey: "codeguru42/tasker#5",
        note: () => {},
        explicit: "main",
        ask,
      });
      const head = await git.reconcile(fixture.context, {
        path,
        baseRevision: resolved.revision,
        strategy: "rebase",
      });
      expect(head).toBe(await gitOutput({ cwd: path }, fixture.context.env, "rev-parse", "HEAD"));
    });

    it("gives the head, the task ref and the changes of a workspace like worktreeState", async () => {
      const { git, path, taskRef } = await workspace();
      const env = fixture.context.env;
      await commitInWorktree(path, env, { file: "a.txt" });
      writeFileSync(join(path, "new.txt"), "new\n");
      const direct = await worktreeState({ clone: paths().clone, env, path });
      expect(direct.changes.length).toBeGreaterThan(0);
      expect(await git.workspaceState(fixture.context, { path })).toEqual({
        head: direct.head,
        taskRef: direct.branch,
        changes: direct.changes,
      });
      expect(direct.branch).toBe(taskRef);
    });

    it("gives an undefined task ref for a workspace with a detached head", async () => {
      const { git, path } = await workspace();
      const env = fixture.context.env;
      await runGit(["checkout", "--detach"], { cwd: path, env });
      const direct = await worktreeState({ clone: paths().clone, env, path });
      expect(direct.branch).toBeUndefined();
      expect((await git.workspaceState(fixture.context, { path })).taskRef).toBeUndefined();
    });

    it("moves the head to the tip of the base by a fast-forward", async () => {
      const { git, path, taskRef } = await workspace();
      const env = fixture.context.env;
      await fixture.origin.addCommit("main", { file: "other.txt" });
      const { baseTip } = await containment(git, taskRef);
      const result = await git.resync(fixture.context, { path, baseRevision: baseTip, strategy: "rebase" });
      expect(result).toEqual({ moved: true, how: "fast-forward", head: baseTip });
      expect(await gitOutput({ cwd: path }, env, "rev-parse", "HEAD")).toBe(baseTip);
    });

    it("leaves the head alone when the workspace contains the base", async () => {
      const { git, path, taskRef } = await workspace();
      const env = fixture.context.env;
      const head = await commitInWorktree(path, env, { file: "a.txt" });
      const { baseTip } = await containment(git, taskRef);
      const result = await git.resync(fixture.context, { path, baseRevision: baseTip, strategy: "merge" });
      expect(result).toEqual({ moved: false, how: "none", head });
      expect(await gitOutput({ cwd: path }, env, "rev-parse", "HEAD")).toBe(head);
    });

    it("replays the commits of the workspace onto a moved base and gives the new head", async () => {
      const { git, path, taskRef } = await workspace();
      const env = fixture.context.env;
      await commitInWorktree(path, env, { file: "a.txt" });
      await fixture.origin.addCommit("main", { file: "other.txt" });
      const { baseTip } = await containment(git, taskRef);
      const result = await git.replayOnto(fixture.context, { path, onto: baseTip });
      const head = await gitOutput({ cwd: path }, env, "rev-parse", "HEAD");
      expect(result).toBe(head);
      expect(await gitOutput({ cwd: path }, env, "rev-parse", "HEAD^")).toBe(baseTip);
      expect(existsSync(join(path, "a.txt"))).toBe(true);
    });

    it("rejects with ReconcileConflictError and keeps the head at the start on a conflict", async () => {
      const { git, path, taskRef } = await workspace();
      const env = fixture.context.env;
      const start = await commitInWorktree(path, env, { file: "a.txt", content: "task\n" });
      await fixture.origin.addCommit("main", { file: "a.txt", content: "base\n" });
      const { baseTip } = await containment(git, taskRef);
      await expect(
        git.resync(fixture.context, { path, baseRevision: baseTip, strategy: "rebase" }),
      ).rejects.toBeInstanceOf(ReconcileConflictError);
      expect(await gitOutput({ cwd: path }, env, "rev-parse", "HEAD")).toBe(start);
      expect(await git.uncommittedChanges(fixture.context, { path })).toEqual([]);
    });
  });

  describe("remote task ref and move", () => {
    it("reads the copy of the task ref on the remote like remoteTaskBranchState", async () => {
      const { git, taskRef } = await workspace();
      const { clone } = paths();
      const env = fixture.context.env;
      const { revision: absentLocal } = await containment(git, taskRef);
      const absent = await git.fetchedRemoteTaskRef(fixture.context, { taskRef, revision: absentLocal });
      expect(absent).toEqual({ state: "absent" });
      expect(absent).toEqual(await remoteTaskBranchState({ clone, env, branch: taskRef, local: absentLocal }));
      await copyCloneBranchToOrigin({ origin: fixture.origin.path, clone, branch: taskRef, env });
      const tip = await fixture.origin.addCommit(taskRef);
      const { revision } = await containment(git, taskRef);
      const present = await git.fetchedRemoteTaskRef(fixture.context, { taskRef, revision });
      expect(present).toEqual({ state: "present", revision: tip, relation: "local-ancestor" });
      expect(present).toEqual(await remoteTaskBranchState({ clone, env, branch: taskRef, local: revision }));
    });

    it("reads the two sides of a divergence like remoteTaskBranchSides", async () => {
      const { git, path, taskRef } = await workspace();
      const { clone } = paths();
      const env = fixture.context.env;
      await copyCloneBranchToOrigin({ origin: fixture.origin.path, clone, branch: taskRef, env });
      await fixture.origin.addCommit(taskRef, { file: "remote.txt" });
      await commitInWorktree(path, env, { file: "local.txt" });
      const { revision, baseTip } = await containment(git, taskRef);
      const remote = await git.fetchedRemoteTaskRef(fixture.context, { taskRef, revision });
      if (remote.state !== "present") throw new Error("the remote ref must be present");
      const result = await git.remoteTaskRefSides(fixture.context, {
        taskRef,
        revision,
        remoteRevision: remote.revision,
        baseRevision: baseTip,
      });
      expect(result.local).toHaveLength(1);
      expect(result.remote).toHaveLength(1);
      expect(result).toEqual(
        await remoteTaskBranchSides({
          clone,
          env,
          branch: taskRef,
          local: revision,
          remote: remote.revision,
          baseTip,
        }),
      );
    });

    it("moves the task ref and the head of the workspace to a revision and gives the head", async () => {
      const { git, path, taskRef } = await workspace();
      const env = fixture.context.env;
      const start = await gitOutput({ cwd: path }, env, "rev-parse", "HEAD");
      const tip = await commitInWorktree(path, env, { file: "a.txt" });
      expect(await git.moveWorkspace(fixture.context, { path, revision: start })).toBe(start);
      expect(await gitOutput({ cwd: path }, env, "rev-parse", "HEAD")).toBe(start);
      expect(await taskBranchRevision({ clone: paths().clone, env, branch: taskRef })).toBe(start);
      expect(await git.moveWorkspace(fixture.context, { path, revision: tip })).toBe(tip);
      expect(await taskBranchRevision({ clone: paths().clone, env, branch: taskRef })).toBe(tip);
    });

    it("puts the task ref and the workspace back at a revision and removes untracked files", async () => {
      const { git, path, taskRef } = await workspace();
      const start = await git.workspaceState(fixture.context, { path });
      await commitInWorktree(path, fixture.context.env, { file: "a.txt" });
      writeFileSync(join(path, "untracked.txt"), "x\n");
      await expect(
        git.restoreWorkspace(fixture.context, { path, taskRef, revision: start.head }),
      ).resolves.toBeUndefined();
      expect(await git.workspaceState(fixture.context, { path })).toEqual({
        head: start.head,
        taskRef,
        changes: [],
      });
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
    const keyedProvider = () => createGitProvider({ remote: fixture.origin.path, config: keyed() });

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

    it("gives the checks of gitDoctorChecks for the repos of the list", async () => {
      await provider().provision(fixture.context);
      const values = [
        {
          key: fixture.context.repoKey,
          remote: fixture.origin.path,
          config: { ...keyed(), authorName: "Doctor Author" },
        },
        { key: "other", remote: join(fixture.origin.dir, "missing.git"), config: {} },
      ];
      const list = values.map(({ key, remote, config }) => ({
        key,
        repo: { remote, vcs: { provider: "git" as const, config } },
      }));
      const o = { procRoot: "/proc", platform: "linux" } as const;

      const checks = keyedProvider().doctorChecks(list, { dataRoot: fixture.context.dataRoot, ...o });

      const direct = gitDoctorChecks({
        repos: values.map(({ key, remote, config }) => ({
          key,
          remote,
          clone: repoPaths(fixture.context.dataRoot, key).clone,
          config,
        })),
        ...o,
      });
      expect(checkSummaries(checks)).toEqual(checkSummaries(direct));

      const results = await Promise.all(checks.map((check) => check.run(fixture.context.env)));
      const directResults = await Promise.all(direct.map((check) => check.run(fixture.context.env)));
      expect(results).toEqual(directResults);

      const resultOf = (name: string) => results[checks.findIndex((check) => check.name === name)];
      const identity = resultOf(`git identity: ${fixture.context.repoKey}`);
      expect(identity?.status).toBe("warn");
      expect(identity?.detail).toContain('vcs.config.authorName is "Doctor Author"');
      expect(resultOf(`git connection: ${fixture.context.repoKey}`)).not.toEqual(resultOf("git connection: other"));
    });
  });
});
