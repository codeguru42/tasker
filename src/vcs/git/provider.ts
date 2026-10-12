import type { VcsProvider } from "../provider.js";
import type { GitVcsConfig } from "./config.js";
import { installPushHook } from "./push-guard.js";
import { provisionClone } from "./provision.js";
import { repoPaths } from "./repo-paths.js";
import {
  createTaskWorktree,
  removeTaskWorktree,
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
  return {
    async provision(ctx) {
      const { clone, publishTokens } = repoPaths(ctx.dataRoot, ctx.repoKey);
      await provisionClone({ remote, clone, config, env: ctx.env, publishTokens });
    },
    async createWorkspace(ctx, { shortRef, title, baseRevision }) {
      const { clone, worktrees } = repoPaths(ctx.dataRoot, ctx.repoKey);
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
      const { clone } = repoPaths(ctx.dataRoot, ctx.repoKey);
      await removeTaskWorktree({ clone, env: ctx.env, path });
    },
    installPushGuard(ctx) {
      const { clone, publishTokens } = repoPaths(ctx.dataRoot, ctx.repoKey);
      installPushHook(clone, publishTokens);
    },
  };
}
