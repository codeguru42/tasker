// The start of the stored form of a local base branch, and of the full name of a local branch.
export const LOCAL_PREFIX = "refs/heads/";

// Gives the name of the branch on origin for a stored base.
export function branchOfBase(base: string): string {
  return base.startsWith(LOCAL_PREFIX) ? base.slice(LOCAL_PREFIX.length) : base;
}
