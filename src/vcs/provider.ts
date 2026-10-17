import type { Config, RepoConfig } from "../config/schema.js";
import type { Check } from "../doctor/check.js";
import { createGitProvider } from "./git/provider.js";

// The local state of one repo, and the env of each child process.
export interface VcsContext {
  dataRoot: string;
  repoKey: string;
  env: NodeJS.ProcessEnv;
}

export interface WorkspaceEntry {
  path: string;
  taskRef?: string;
  // Set when the workspace is locked: "" for a lock with no reason.
  lockReason?: string;
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

export interface BaseContainment {
  // The revision of the tip of the task ref.
  revision: string;
  // The revision of the tip of the base after the fetch.
  baseTip: string;
  // True when the task ref contains the tip of the base.
  contains: boolean;
}

export interface TaskRefOnBase {
  // The revision of the tip of the task ref.
  revision: string;
  // The revision of the tip of the base after the fetch.
  baseTip: string;
  // True when the tip of the base contains the task ref.
  onBase: boolean;
}

export interface UncommittedChange {
  // The two status characters of git, for example " M", "??", "D " or "A ".
  status: string;
  // The raw path, relative to the root of the worktree.
  path: string;
}

// The text of one change: the raw status of the version control, a space, the path. A leading space of the status stays.
export function uncommittedChangeText(change: UncommittedChange): string {
  return `${change.status} ${change.path}`;
}

export type ReconcileStrategy = "rebase" | "merge";

export interface ResyncResult {
  moved: boolean;
  how: "none" | "fast-forward" | "rebase" | "merge";
  head: string;
}

// The head, the task ref and the uncommitted changes of a workspace. taskRef is undefined for a detached head.
export interface WorkspaceState {
  head: string;
  taskRef: string | undefined;
  changes: UncommittedChange[];
}

// How the local tip of a task ref relates to its copy on the remote after the fetch.
export type RemoteTaskRefRelation = "equal" | "local-ancestor" | "remote-ancestor" | "diverged";

// The copy of a task ref on the remote, as the last fetch left it.
export type FetchedRemoteTaskRef =
  { state: "absent" } | { state: "present"; revision: string; relation: RemoteTaskRefRelation };

export type RemoteTip = { state: "present"; revision: string } | { state: "absent" };

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
  // The folder of the publish tokens of the repo.
  publishTokensPath: string;
  sandboxWritePaths(path: string): Promise<string[]>;
  // The absolute path of the folder that the workspaces of the clone share.
  sharedFolder(path: string): Promise<string>;
  // The subset of paths (relative to the workspace path) that the version control tracks, from one call.
  // A folder counts when it holds a tracked entry. The input order stays.
  trackedPaths(path: string, paths: readonly string[]): Promise<string[]>;
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
  provision: (ctx: VcsContext) => Promise<void>;
  // Makes the folder of a task on a new or an existing task ref, from baseRevision.
  createWorkspace(ctx: VcsContext, o: { shortRef: string; title: string; baseRevision: string }): Promise<Workspace>;
  // Removes the folder of a task. The task ref stays.
  removeWorkspace(ctx: VcsContext, o: { path: string }): Promise<void>;
  // The workspaces of the repo, each with its real path.
  listWorkspaces(ctx: VcsContext): Promise<WorkspaceEntry[]>;
  // True when the local taskRef exists.
  taskRefExists(ctx: VcsContext, o: { taskRef: string }): Promise<boolean>;
  // Deletes the local taskRef. It makes no remote call.
  deleteTaskRef(ctx: VcsContext, o: { taskRef: string }): Promise<void>;
  // Discards the uncommitted changes of the workspace. Ignored files stay.
  discardWorkspaceChanges(ctx: VcsContext, o: { path: string }): Promise<void>;
  // Picks the base of a task, fetches the remote and gives the base with its revision.
  resolveBase(ctx: VcsContext, o: ResolveBaseRequest): Promise<ResolvedBase>;
  // The diff of the workspace against baseRevision, as text.
  diffAgainstBase(ctx: VcsContext, o: { path: string; baseRevision: string }): Promise<string>;
  // The commits of taskRef that baseRevision does not hold, as text.
  ownCommits(ctx: VcsContext, o: { taskRef: string; baseRevision: string }): Promise<string>;
  // The revision of the tip of the local taskRef.
  taskRefRevision(ctx: VcsContext, o: { taskRef: string }): Promise<string>;
  // The paths that taskRef changes against baseRevision, raw, in the order of the version control.
  // A rename gives the old and the new path. It needs no workspace.
  changedPaths(ctx: VcsContext, o: { taskRef: string; baseRevision: string }): Promise<string[]>;
  // The uncommitted changes of the workspace. An empty list means a clean workspace.
  uncommittedChanges(ctx: VcsContext, o: { path: string }): Promise<UncommittedChange[]>;
  // Fetches the remote, reads the tip of the task ref of a workspace and the tip of its base, and says whether the task
  // ref contains the tip of the base.
  baseContainment(ctx: VcsContext, o: { taskRef: string; baseRevision: string }): Promise<BaseContainment>;
  // Fetches the remote, reads the tip of the local task ref and the tip of its base, and says whether the base
  // contains the task ref. It reads the local copy and needs no workspace.
  taskRefOnBase(ctx: VcsContext, o: { taskRef: string; baseRevision: string }): Promise<TaskRefOnBase>;
  // Moves the workspace onto baseRevision and gives its new head revision.
  // It does not fetch. Run resolveBase first, which fetches.
  // A conflict rejects with ReconcileConflictError (src/vcs/errors.ts).
  reconcile(ctx: VcsContext, o: { path: string; baseRevision: string; strategy: ReconcileStrategy }): Promise<string>;
  // Moves the workspace onto baseRevision and says how the head moved. It does not fetch.
  // A conflict rejects with ReconcileConflictError (src/vcs/errors.ts) and the workspace is restored.
  resync(
    ctx: VcsContext,
    o: { path: string; baseRevision: string; strategy: ReconcileStrategy },
  ): Promise<ResyncResult>;
  // Reads the head, the task ref and the uncommitted changes of the workspace. It changes nothing.
  workspaceState(ctx: VcsContext, o: { path: string }): Promise<WorkspaceState>;
  // Pushes taskRef to the remote. published is the revision that the last publish gave.
  publish(ctx: VcsContext, o: { taskRef: string; published: string | undefined }): Promise<PublishResult>;
  // Moves base on the remote to revision. It is a fast-forward.
  land(ctx: VcsContext, o: { base: string; revision: string }): Promise<void>;
  // Deletes taskRef on the remote when it is still at the published revision.
  deleteRemoteTaskRef(ctx: VcsContext, o: { taskRef: string; published: string }): Promise<RemoteTaskRefDeletion>;
  // The tip of taskRef on the remote: present with its revision, or absent. A failed read rejects and never gives absent.
  remoteTaskRefTip(ctx: VcsContext, o: { taskRef: string }): Promise<RemoteTip>;
  // The text and the paths that the provider adds to the assistant of a task.
  assistantSurface(ctx: VcsContext): AssistantSurface;
  // The doctor checks of the repo. The checks do not run until the caller runs them.
  doctorChecks(ctx: VcsContext, o: { procRoot: string; platform: NodeJS.Platform }): Check[];
  // Writes the push guard again.
  installPushGuard(ctx: VcsContext): void;
}

// The only place that picks a provider. It reads vcs.provider and passes remote and vcs.config.
export function createVcsProvider(repo: Pick<RepoConfig, "remote" | "vcs">): VcsProvider {
  switch (repo.vcs.provider) {
    case "git":
      return createGitProvider({ remote: repo.remote, config: repo.vcs.config });
  }
}

// The provider and the context of one repo of the configuration.
export function vcsForRepo(
  config: Config,
  repoKey: string,
  env: NodeJS.ProcessEnv,
): { vcs: VcsProvider; ctx: VcsContext } {
  return {
    vcs: createVcsProvider(config.repos[repoKey]),
    ctx: { dataRoot: config.dataRoot, repoKey, env },
  };
}
