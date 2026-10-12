// The error of a rebase or a merge that stopped on conflicts. The worktree is back at the start.
export class ReconcileConflictError extends Error {
  readonly paths: string[];

  constructor(message: string, paths: string[]) {
    super(message);
    this.name = "ReconcileConflictError";
    this.paths = paths;
  }
}
