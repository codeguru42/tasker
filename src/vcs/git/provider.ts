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
import { changedPaths, fetchBaseContainment, ownCommitsText, uncommittedChanges, worktreeDiff } from "./changes.js";
import { deleteRemoteTaskBranch, landOnBase, publishTaskBranch } from "./publish.js";
import { gitDoctorChecks } from "./doctor.js";
import { installPushHook } from "./push-guard.js";
import { provisionClone } from "./provision.js";
import { remoteTip } from "./remote-tip.js";
import { reconcileWorktree } from "./reconcile.js";
import { repoPaths } from "./repo-paths.js";
import {
  createTaskWorktree,
  deleteTaskBranch,
  discardWorktreeChanges,
  listWorktrees,
  removeTaskWorktree,
  taskBranchExists,
  taskBranchName,
  taskWorktreePath,
} from "./worktree.js";

const WORKSPACE_STATE = {
  created: "created",
  "reused-branch": "reused-task-ref",
  "reused-worktree": "reused-workspace",
} as const;

// Maps the neutral names of VcsProvider to the git functions. It adds no behavior.
export function createGitProvider({
  remote,
  config,
}: {
  remote: string;
  config: GitVcsConfig;
}): VcsProvider {
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
    async resolveBase(ctx, { memory, hint, explicit, defaultBase, ask }) {
      const { clone } = pathsOf(ctx);
      return resolveBaseBranch({
        repoKey: ctx.repoKey,
        clone,
        sshKey: config.sshKey,
        env: ctx.env,
        memory,
        hint,
        explicit,
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
    async changedPaths(ctx, { taskRef, baseRevision }) {
      const { clone } = pathsOf(ctx);
      return changedPaths({ clone, env: ctx.env, branch: taskRef, baseRevision });
    },
    async uncommittedChanges(ctx, { path }) {
      const { clone } = pathsOf(ctx);
      return uncommittedChanges({ clone, env: ctx.env, path });
    },
    async baseContainment(ctx, { path, baseRevision }) {
      const { clone } = pathsOf(ctx);
      return fetchBaseContainment({ clone, env: ctx.env, sshKey: config.sshKey, path, baseRevision });
    },
    async reconcile(ctx, { path, baseRevision, strategy }) {
      const { clone } = pathsOf(ctx);
      return reconcileWorktree({ clone, env: ctx.env, path, baseRevision, strategy });
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
    doctorChecks(ctx, { procRoot, platform }) {
      const { clone } = pathsOf(ctx);
      return gitDoctorChecks({
        repos: [{ key: ctx.repoKey, remote, clone, config }],
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
