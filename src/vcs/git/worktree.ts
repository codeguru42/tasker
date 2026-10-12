import { join } from "node:path";
import { pathSlug } from "../../issue-key/path-slug.js";

const MAX_BRANCH_LENGTH = 100;

// pathSlug(), but undefined when no character is left. Any other error passes through.
function slugOrUndefined(value: string): string | undefined {
  try {
    return pathSlug(value);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("cannot make a path slug from")) {
      return undefined;
    }
    throw error;
  }
}

// True when name is one safe ref part: a path slug, at most MAX_BRANCH_LENGTH long, not "HEAD".
// Git accepts each such name, and none starts with "-".
function isTaskBranch(name: string): boolean {
  return (
    slugOrUndefined(name) === name && name.length <= MAX_BRANCH_LENGTH && name !== "HEAD"
  );
}

// Throws unless name passes isTaskBranch(). Run it before any git call that takes a branch.
export function assertTaskBranch(name: string): void {
  if (!isTaskBranch(name)) {
    throw new Error(`not a task branch name: ${JSON.stringify(name)}`);
  }
}

// The task branch: the short ref, then the issue title as a lower-case slug.
// The result is always a valid branch name:
// - The short ref ends with no "-" or ".", and the slug starts with none.
//   So the join makes no "--" and no "..".
// - The slug ends clean, so the result has no ".lock" end.
// - A result with a slug has a "-", so it is never "HEAD".
// - The length is at most MAX_BRANCH_LENGTH.
export function taskBranchName(shortRef: string, title: string): string {
  if (!isTaskBranch(shortRef)) {
    throw new Error(`not a safe short ref: ${JSON.stringify(shortRef)}`);
  }
  const room = MAX_BRANCH_LENGTH - shortRef.length - 1;
  if (room <= 0) return shortRef;
  // Lower case first, so a trailing ".LOCK" becomes ".lock" and pathSlug strips it.
  const first = slugOrUndefined(title.toLowerCase());
  if (first === undefined) return shortRef;
  // The cut keeps the first character of first, so this call cannot throw.
  const slug = pathSlug(first.slice(0, room));
  return `${shortRef}-${slug}`;
}

// The folder of one task worktree: <worktrees>/<shortRef>.
export function taskWorktreePath(worktrees: string, shortRef: string): string {
  return join(worktrees, shortRef);
}

export interface WorktreeEntry {
  path: string;
  branch?: string;
  // Set when the worktree is locked: "" for a lock with no reason.
  lockReason?: string;
}

export async function listWorktrees(options: {
  clone: string;
  env: NodeJS.ProcessEnv;
}): Promise<WorktreeEntry[]> {
  throw new Error(`not implemented: ${options.clone}`);
}
