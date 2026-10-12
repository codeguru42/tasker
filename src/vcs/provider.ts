import type { Check } from "../doctor/check.js";

// The local state of one repo, and the env of each child process.
export interface VcsContext {
  dataRoot: string;
  repoKey: string;
  env: NodeJS.ProcessEnv;
}

export interface Workspace {
  path: string;
  taskRef: string;
  state: "created" | "reused-task-ref" | "reused-workspace";
}

// The store functions that the resolve needs. TaskStore has them.
export interface BaseBranchMemory {
  getDefaultBaseBranch(repoKey: string): string | undefined;
  setDefaultBaseBranch(repoKey: string, branch: string): void;
  forgetDefaultBaseBranch(repoKey: string, branch: string): void;
}

export interface ResolveBaseRequest {
  memory: BaseBranchMemory;
  hint?: string;
  explicit?: string;
  defaultBase?: string;
  ask: () => Promise<string>;
}

export interface ResolvedBase {
  // The stored form: an origin branch name, or refs/heads/<x>.
  base: string;
  // baseRevision(base)
  revision: string;
  source: "hint" | "explicit" | "learned" | "config" | "ask";
  notes: string[];
}

export interface UncommittedChange {
  // The two status characters of git, for example " M", "??", "D " or "A ".
  status: string;
  // The raw path, relative to the root of the worktree.
  path: string;
}

export type ReconcileStrategy = "rebase" | "merge";

export interface PublishResult {
  state: "published" | "already-published";
  taskRef: string;
  revision: string;
  lease: boolean;
}

export interface AssistantSurface {
  executeCommitText: string;
  denyRules: readonly string[];
  denyReadPaths: string[];
  sandboxWritePaths(path: string): Promise<string[]>;
}

// The result of deleteRemoteTaskRef, and of deleteRemoteTaskBranch() in src/vcs/git/publish.ts.
export interface RemoteTaskRefDeletion {
  state: "deleted" | "already-gone";
}

/**
 * The version control operations of tasker. A command gets a provider from createVcsProvider()
 * and never imports from src/vcs/git/. Each operation has the errors and the side effects of its
 * git function, and no others.
 *
 * Push guard rule: a provider that cannot guard a push refuses to provision. Its provision()
 * rejects, and the provider never runs with a weaker guard.
 */
export interface VcsProvider {
  // Makes the local copy of the remote and guards a push.
  provision(ctx: VcsContext): Promise<void>;
  // Makes the folder of a task on a new or an existing task ref, from baseRevision.
  createWorkspace(
    ctx: VcsContext,
    o: { shortRef: string; title: string; baseRevision: string },
  ): Promise<Workspace>;
  // Removes the folder of a task. The task ref stays.
  removeWorkspace(ctx: VcsContext, o: { path: string }): Promise<void>;
  // Picks the base of a task, fetches the remote and gives the base with its revision.
  resolveBase(ctx: VcsContext, o: ResolveBaseRequest): Promise<ResolvedBase>;
  // The diff of the workspace against baseRevision, as text.
  diffAgainstBase(ctx: VcsContext, o: { path: string; baseRevision: string }): Promise<string>;
  // The commits of taskRef that baseRevision does not hold, as text.
  ownCommits(ctx: VcsContext, o: { taskRef: string; baseRevision: string }): Promise<string>;
  // The uncommitted changes of the workspace. An empty list means a clean workspace.
  uncommittedChanges(ctx: VcsContext, o: { path: string }): Promise<UncommittedChange[]>;
  // Moves the workspace onto baseRevision and gives its new head revision.
  // It does not fetch. Run resolveBase first, which fetches.
  // A conflict rejects with ReconcileConflictError (src/vcs/errors.ts).
  reconcile(
    ctx: VcsContext,
    o: { path: string; baseRevision: string; strategy: ReconcileStrategy },
  ): Promise<string>;
  // Pushes taskRef to the remote. published is the revision that the last publish gave.
  publish(
    ctx: VcsContext,
    o: { taskRef: string; published: string | undefined },
  ): Promise<PublishResult>;
  // Moves base on the remote to revision. It is a fast-forward.
  land(ctx: VcsContext, o: { base: string; revision: string }): Promise<void>;
  // Deletes taskRef on the remote when it is still at the published revision.
  deleteRemoteTaskRef(
    ctx: VcsContext,
    o: { taskRef: string; published: string },
  ): Promise<RemoteTaskRefDeletion>;
  // The text and the paths that the provider adds to the assistant of a task.
  assistantSurface(ctx: VcsContext): AssistantSurface;
  // The doctor checks of the repo. The checks do not run until the caller runs them.
  doctorChecks(ctx: VcsContext, o: { procRoot: string; platform: NodeJS.Platform }): Check[];
  // Writes the push guard again.
  installPushGuard(ctx: VcsContext): void;
}
