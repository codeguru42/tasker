import type { VcsContext, VcsProvider } from "../provider.js";
import type { GitVcsConfig } from "./config.js";
import {
  DENY_RULES,
  EXECUTE_COMMIT_TEXT,
  readDenyPaths,
  sandboxWritePaths,
  sharedFolder,
  trackedPaths,
} from "./assistant-surface.js";
import { resolveBaseBranch } from "./base-branch.js";
import {
  changedPaths,
  fetchBaseContainment,
  fetchOnBase,
  ownCommitsText,
  remoteTaskBranchSides,
  remoteTaskBranchState,
  uncommittedChanges,
  worktreeDiff,
} from "./changes.js";
import { deleteRemoteTaskBranch, landOnBase, publishTaskBranch } from "./publish.js";
import { gitDoctorChecks } from "./doctor.js";
import { installPushHook } from "./push-guard.js";
import { provisionClone } from "./provision.js";
import { remoteTip } from "./remote-tip.js";
import {
  moveWorktreeTo,
  reconcileWorktree,
  replayOntoTip,
  restoreWorktree,
  resyncWorktree,
  worktreeState,
} from "./reconcile.js";
import { repoPaths } from "./repo-paths.js";
import {
  createTaskWorktree,
  deleteTaskBranch,
  discardWorktreeChanges,
  listWorktrees,
  removeTaskWorktree,
  taskBranchExists,
  taskBranchName,
  taskBranchRevision,
  taskWorktreePath,
} from "./worktree.js";

const WORKSPACE_STATE = {
  created: "created",
  "reused-branch": "reused-task-ref",
  "reused-worktree": "reused-workspace",
} as const;

// Maps the neutral names of VcsProvider to the git functions. It adds no behavior.
export function createGitProvider({ remote, config }: { remote: string; config: GitVcsConfig }): VcsProvider {
  // The paths of the repo of ctx in the data root.
  const pathsOf = (ctx: VcsContext) => repoPaths(ctx.dataRoot, ctx.repoKey);
  // The options that publish, land and the remote delete of a task ref share for ctx.
  const remoteOptionsOf = (ctx: VcsContext) => {
    const { clone, publishTokens } = pathsOf(ctx);
    return { clone, remote, publishTokens, sshKey: config.sshKey, env: ctx.env };
  };
  return {
    async provision(ctx) {
      const { clone, publishTokens } = pathsOf(ctx);
      await provisionClone({ remote, clone, config, env: ctx.env, publishTokens });
    },
    async createWorkspace(ctx, { shortRef, title, baseRevision }) {
      const { clone, worktrees } = pathsOf(ctx);
      const taskRef = taskBranchName(shortRef, title);
      const path = taskWorktreePath(worktrees, shortRef);
      const state = await createTaskWorktree({
        clone,
        env: ctx.env,
        path,
        branch: taskRef,
        baseRevision,
      });
      return { path, taskRef, state: WORKSPACE_STATE[state] };
    },
    async removeWorkspace(ctx, { path }) {
      const { clone } = pathsOf(ctx);
      await removeTaskWorktree({ clone, env: ctx.env, path });
    },
    async listWorkspaces(ctx) {
      const { clone } = pathsOf(ctx);
      return listWorktrees({ clone, env: ctx.env });
    },
    async taskRefExists(ctx, { taskRef }) {
      const { clone } = pathsOf(ctx);
      return taskBranchExists({ clone, env: ctx.env, branch: taskRef });
    },
    async deleteTaskRef(ctx, { taskRef }) {
      const { clone } = pathsOf(ctx);
      await deleteTaskBranch({ clone, env: ctx.env, branch: taskRef });
    },
    async discardWorkspaceChanges(ctx, { path }) {
      const { clone } = pathsOf(ctx);
      await discardWorktreeChanges({ clone, env: ctx.env, path });
    },
    async resolveBase(ctx, { memory, hint, explicit, blocker, defaultBase, ask }) {
      const { clone } = pathsOf(ctx);
      return resolveBaseBranch({
        repoKey: ctx.repoKey,
        clone,
        sshKey: config.sshKey,
        env: ctx.env,
        memory,
        hint,
        explicit,
        blocker,
        defaultBaseBranch: defaultBase,
        ask,
      });
    },
    async diffAgainstBase(ctx, { path, baseRevision }) {
      const { clone } = pathsOf(ctx);
      return worktreeDiff({ clone, env: ctx.env, path, baseRevision });
    },
    async ownCommits(ctx, { taskRef, baseRevision }) {
      const { clone } = pathsOf(ctx);
      return ownCommitsText({ clone, env: ctx.env, branch: taskRef, baseRevision });
    },
    async taskRefRevision(ctx, { taskRef }) {
      const { clone } = pathsOf(ctx);
      return taskBranchRevision({ clone, env: ctx.env, branch: taskRef });
    },
    async changedPaths(ctx, { taskRef, baseRevision }) {
      const { clone } = pathsOf(ctx);
      return changedPaths({ clone, env: ctx.env, branch: taskRef, baseRevision });
    },
    async uncommittedChanges(ctx, { path }) {
      const { clone } = pathsOf(ctx);
      return uncommittedChanges({ clone, env: ctx.env, path });
    },
    async baseContainment(ctx, { taskRef, baseRevision }) {
      const { clone } = pathsOf(ctx);
      return fetchBaseContainment({ clone, env: ctx.env, sshKey: config.sshKey, branch: taskRef, baseRevision });
    },
    async taskRefOnBase(ctx, { taskRef, baseRevision }) {
      const { clone } = pathsOf(ctx);
      return fetchOnBase({ clone, env: ctx.env, sshKey: config.sshKey, branch: taskRef, baseRevision });
    },
    async fetchedRemoteTaskRef(ctx, { taskRef, revision }) {
      const { clone } = pathsOf(ctx);
      return remoteTaskBranchState({ clone, env: ctx.env, branch: taskRef, local: revision });
    },
    async remoteTaskRefSides(ctx, { taskRef, revision, remoteRevision, baseRevision }) {
      const { clone } = pathsOf(ctx);
      return remoteTaskBranchSides({
        clone,
        env: ctx.env,
        branch: taskRef,
        local: revision,
        remote: remoteRevision,
        baseTip: baseRevision,
      });
    },
    async moveWorkspace(ctx, { path, revision }) {
      const { clone } = pathsOf(ctx);
      return moveWorktreeTo({ clone, env: ctx.env, path, revision });
    },
    async restoreWorkspace(ctx, { path, taskRef, revision }) {
      const { clone } = pathsOf(ctx);
      await restoreWorktree({ clone, env: ctx.env, path, start: { head: revision, branch: taskRef } });
    },
    async reconcile(ctx, { path, baseRevision, strategy }) {
      const { clone } = pathsOf(ctx);
      return reconcileWorktree({ clone, env: ctx.env, path, baseRevision, strategy });
    },
    async resync(ctx, { path, baseRevision, strategy }) {
      const { clone } = pathsOf(ctx);
      return resyncWorktree({ clone, env: ctx.env, path, baseRevision, strategy });
    },
    async replayOnto(ctx, { path, onto }) {
      const { clone } = pathsOf(ctx);
      return replayOntoTip({ clone, env: ctx.env, path, onto });
    },
    async workspaceState(ctx, { path }) {
      const { clone } = pathsOf(ctx);
      const { head, branch, changes } = await worktreeState({ clone, env: ctx.env, path });
      return { head, taskRef: branch, changes };
    },
    async publish(ctx, { taskRef, published }) {
      const result = await publishTaskBranch({ ...remoteOptionsOf(ctx), branch: taskRef, published });
      return { state: result.state, taskRef: result.branch, revision: result.revision, lease: result.lease };
    },
    async land(ctx, { base, revision }) {
      await landOnBase({ ...remoteOptionsOf(ctx), base, revision });
    },
    async deleteRemoteTaskRef(ctx, { taskRef, published }) {
      return deleteRemoteTaskBranch({ ...remoteOptionsOf(ctx), branch: taskRef, published });
    },
    async remoteTaskRefTip(ctx, { taskRef }) {
      return remoteTip({ remote, branch: taskRef, sshKey: config.sshKey, env: ctx.env });
    },
    assistantSurface(ctx) {
      const { clone, publishTokens } = pathsOf(ctx);
      return {
        executeCommitText: EXECUTE_COMMIT_TEXT,
        denyRules: DENY_RULES,
        denyReadPaths: readDenyPaths(config),
        publishTokensPath: publishTokens,
        sandboxWritePaths: (path) => sandboxWritePaths({ clone, env: ctx.env, path }),
        sharedFolder: (path) => sharedFolder({ clone, env: ctx.env, path }),
        trackedPaths: (path, paths) => trackedPaths({ env: ctx.env, path, paths }),
      };
    },
    doctorChecks(repos, { dataRoot, procRoot, platform }) {
      return gitDoctorChecks({
        repos: repos.map((r) => ({
          key: r.key,
          remote: r.repo.remote,
          clone: repoPaths(dataRoot, r.key).clone,
          config: r.repo.vcs.config,
        })),
        procRoot,
        platform,
      });
    },
    installPushGuard(ctx) {
      const { clone, publishTokens } = pathsOf(ctx);
      installPushHook(clone, publishTokens);
    },
  };
}
