import { reposByProvider } from "../config/repo-groups.js";
import type { Config, RepoConfig } from "../config/schema.js";
import type { Check } from "../doctor/check.js";
import { createGitProvider } from "./git/provider.js";

// One repo of the doctor checks: its key and its own remote and configuration.
export interface VcsDoctorRepo {
  key: string;
  repo: Pick<RepoConfig, "remote" | "vcs">;
}

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

// The base that the blocker step of start picks: the local branch of the task of a ready blocker.
export interface BlockerBase {
  // The key of the blocker issue.
  key: string;
  // refs/heads/<branch>
  base: string;
}

export interface ResolveBaseRequest {
  memory: BaseBranchMemory;
  // The key of the issue that gets the task.
  issueKey: string;
  // Prints a line at once.
  note: (line: string) => void;
  hint?: string;
  explicit?: string;
  blocker?: BlockerBase;
  defaultBase?: string;
  ask: () => Promise<string>;
}

export interface ResolvedBase {
  // The stored form: an origin branch name, or refs/heads/<x>.
  base: string;
  // baseRevision(base)
  revision: string;
  source: "hint" | "explicit" | "blocker" | "learned" | "config" | "ask";
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

// Where a replay starts. The replay starts after the synced base tip, or after the merge base when the merge base is
// newer. A fallback to the merge base holds the reason: the task has no synced base tip, the head does not build on it,
// or git could not check it (exitCode is the exit code of git).
export type ReplayStart =
  | { from: "synced-base-tip"; syncedBaseTip: string }
  | { from: "merge-base"; mergeBase: string; why: "newer-merge-base"; syncedBaseTip: string }
  | { from: "merge-base"; mergeBase: string; why: "no-synced-base-tip" }
  | { from: "merge-base"; mergeBase: string; why: "not-ancestor"; syncedBaseTip: string }
  | { from: "merge-base"; mergeBase: string; why: "check-failed"; syncedBaseTip: string; exitCode: number | null };

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

// One commit of one side of a divergence. samePatch is true when the other side has a commit with the
// same patch. merge is true for a commit with more than one parent.
export interface SideRevision {
  revision: string;
  subject: string;
  merge: boolean;
  samePatch: boolean;
}

// A commit of the local side. onBase is true when the base tip reaches the commit.
export interface LocalSideRevision extends SideRevision {
  onBase: boolean;
}

// The commits that only one tip reaches, oldest first.
export interface RemoteTaskRefSides {
  local: LocalSideRevision[];
  remote: SideRevision[];
}

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
  // Compares the local task ref with its copy on the remote, as the last fetch left it. It does not
  // fetch. Run baseContainment first, which fetches. The revision is the local tip of the task ref,
  // as baseContainment gives it.
  fetchedRemoteTaskRef(ctx: VcsContext, o: { taskRef: string; revision: string }): Promise<FetchedRemoteTaskRef>;
  // Reads the two sides of a divergence of the local tip (revision) and the remote tip, as the last fetch left
  // it. The operation does not fetch and changes nothing.
  remoteTaskRefSides(
    ctx: VcsContext,
    o: { taskRef: string; revision: string; remoteRevision: string; baseRevision: string },
  ): Promise<RemoteTaskRefSides>;
  // Moves the task ref and the workspace to revision and gives the new head revision. The revision can
  // be an ancestor, a descendant or on another line. It refuses a workspace with uncommitted changes,
  // a detached head and a task ref without the shape of a task ref. It does not fetch.
  moveWorkspace(ctx: VcsContext, o: { path: string; revision: string }): Promise<string>;
  // Puts the task ref and the workspace back at revision. It ends a rebase or a merge in progress, and
  // it removes the uncommitted changes and the untracked files. Ignored files stay. A failure rejects
  // with an error that names the commands that put the workspace back.
  restoreWorkspace(ctx: VcsContext, o: { path: string; taskRef: string; revision: string }): Promise<void>;
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
  // Replays the commits of the workspace onto onto, and gives the new head. The replay starts after syncedBaseTip, or
  // after the merge base of the head and onto when that merge base is newer. When syncedBaseTip is not set, or the head
  // does not build on it, it replays the commits after the merge base.
  // onStart gets the form of the replay before the rebase runs. It does not fetch. A conflict rejects with
  // ReconcileConflictError (src/vcs/errors.ts) and the workspace is restored.
  replayOnto(
    ctx: VcsContext,
    o: { path: string; onto: string; syncedBaseTip?: string; onStart?: (start: ReplayStart) => void },
  ): Promise<string>;
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
  // The absolute path of the local copy of the remote. It only computes the path and reads nothing.
  localCopyPath(ctx: VcsContext): string;
  // The doctor checks of the repos. vcsDoctorChecks() calls it one time with all the repos of the
  // provider. Each repo of the list names its own remote and configuration. The provider that gets
  // the call comes from the first repo of the list, and the operation does not use the remote and
  // the configuration of that provider. The checks do not run until the caller runs them.
  doctorChecks(
    repos: readonly VcsDoctorRepo[],
    o: { dataRoot: string; procRoot: string; platform: NodeJS.Platform },
  ): Check[];
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

// The doctor checks of all repos. It groups the repos by vcs.provider. It calls doctorChecks() one
// time for each id, with all the repos of that id, in the order of the configuration.
// The caller passes procRoot "/proc" and platform process.platform.
// A configuration with no repo gives [].
export function vcsDoctorChecks(config: Config, o: { procRoot: string; platform: NodeJS.Platform }): Check[] {
  return reposByProvider(
    config,
    (repo) => repo.vcs.provider,
    (key, repo): VcsDoctorRepo => ({ key, repo }),
  ).flatMap(([, repos]) => createVcsProvider(repos[0].repo).doctorChecks(repos, { dataRoot: config.dataRoot, ...o }));
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
