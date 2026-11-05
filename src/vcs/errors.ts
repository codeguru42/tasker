import type { RemoteTip } from "./provider.js";

// A task branch on origin no longer has the revision that tasker recorded.
export class RemoteTaskRefMovedError extends Error {
  readonly taskRef: string;
  readonly published: string | undefined;
  readonly tip: RemoteTip;

  constructor(taskRef: string, published: string | undefined, tip: RemoteTip) {
    const before = published === undefined ? "tasker never published it" : `tasker published ${published}`;
    const now = tip.state === "absent" ? "origin does not have it" : `origin has ${tip.revision}`;
    super(`the task branch moved on origin: ${taskRef}: ${before}, ${now}`);
    this.name = "RemoteTaskRefMovedError";
    this.taskRef = taskRef;
    this.published = published;
    this.tip = tip;
  }
}

// The error of a rebase or a merge that stopped on conflicts. The worktree is back at the start.
export class ReconcileConflictError extends Error {
  readonly paths: string[];

  constructor(message: string, paths: string[]) {
    super(message);
    this.name = "ReconcileConflictError";
    this.paths = paths;
  }
}
