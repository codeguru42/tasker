import { canonicalPath } from "../real-path.js";
import type { VcsContext, VcsProvider, WorkspaceEntry } from "../vcs/provider.js";

export interface WorkspaceCleanup {
  worktree: "removed" | "already gone";
  branch: "deleted" | "already gone";
}

// The worktree entry that git lists at the stored path of the task, compared by the real path. Undefined when the
// task has no stored path or git lists no entry there.
export async function findTaskWorkspace(
  vcs: VcsProvider,
  ctx: VcsContext,
  worktreePath: string | null,
): Promise<WorkspaceEntry | undefined> {
  if (worktreePath === null) return undefined;
  return (await vcs.listWorkspaces(ctx)).find((e) => e.path === canonicalPath(worktreePath));
}

// Removes the worktree entry that the caller found, then deletes the local task branch when it still exists.
// It reports one line for each step that ran.
export async function cleanUpTaskWorkspace(
  vcs: VcsProvider,
  ctx: VcsContext,
  entry: WorkspaceEntry | undefined,
  branch: string | null,
  report: (line: string) => void,
): Promise<WorkspaceCleanup> {
  const result: WorkspaceCleanup = { worktree: "already gone", branch: "already gone" };
  if (entry !== undefined) {
    await vcs.removeWorkspace(ctx, { path: entry.path });
    report(`removed the worktree ${entry.path}`);
    result.worktree = "removed";
  }
  if (branch !== null && (await vcs.taskRefExists(ctx, { taskRef: branch }))) {
    await vcs.deleteTaskRef(ctx, { taskRef: branch });
    report(`deleted the branch ${branch}`);
    result.branch = "deleted";
  }
  return result;
}
