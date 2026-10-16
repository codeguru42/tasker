import { canonicalPath } from "../real-path.js";
import type { Task } from "../store/store.js";
import type { VcsContext, VcsProvider } from "../vcs/provider.js";

export interface WorkspaceCleanup {
  worktree: "removed" | "already gone";
  branch: "deleted" | "already gone";
}

// Removes the worktree entry of the task, then deletes its local task branch. Each step first checks that its target
// still exists, so a second run finishes the steps that are left. It reports one line for each step that ran.
export async function cleanUpTaskWorkspace(
  vcs: VcsProvider,
  ctx: VcsContext,
  task: Pick<Task, "worktreePath" | "branch">,
  report: (line: string) => void,
): Promise<WorkspaceCleanup> {
  const worktreePath = task.worktreePath;
  const entry =
    worktreePath === null
      ? undefined
      : (await vcs.listWorkspaces(ctx)).find((e) => e.path === canonicalPath(worktreePath));
  const result: WorkspaceCleanup = { worktree: "already gone", branch: "already gone" };
  if (entry !== undefined) {
    await vcs.removeWorkspace(ctx, { path: entry.path });
    report(`removed the worktree ${entry.path}`);
    result.worktree = "removed";
  }
  if (task.branch !== null && (await vcs.taskRefExists(ctx, { taskRef: task.branch }))) {
    await vcs.deleteTaskRef(ctx, { taskRef: task.branch });
    report(`deleted the branch ${task.branch}`);
    result.branch = "deleted";
  }
  return result;
}
