import { ConfigError, type Config, type RepoConfig } from "../config/schema.js";
import { reposByProvider } from "../config/repo-groups.js";
import type { Check } from "../doctor/check.js";
import type { IssueRef } from "../issue-key/ref.js";
import { accountOf } from "./github/doctor.js";
import { createGithubProvider } from "./github/provider.js";
import type { Blocker, Issue } from "./issue.js";

// The id of an issue tracker: the value of issueTracker.provider.
export type IssueTrackerId = RepoConfig["issueTracker"]["provider"];

// A repo that the doctor checks of a provider check: its repo key and its merged issueTracker.
export interface IssueDoctorRepo {
  key: string;
  issueTracker: RepoConfig["issueTracker"];
}

// The result of authStatus(). login is the login that the token of the account belongs to.
// needsLogin is true only when a new login is the fix: a failed token call, an empty login,
// another login, or a 401 of gh api user.
export interface AuthStatus {
  ok: boolean;
  login?: string;
  detail: string;
  needsLogin: boolean;
}

/**
 * The issue tracker operations of tasker. A command gets a provider from issueProviderFor()
 * and never imports from src/issues/github/. Each operation has the errors and the side effects
 * of its GitHub function, and no others.
 */
export interface IssueProvider {
  // "github". Later also "jira".
  readonly id: IssueTrackerId;
  // The pinned identity of the tracker, if it has one. For github, issueTracker.account.
  readonly account: string | undefined;
  // The IssueRef of rawKey in a repo with this project, with the stored spelling <project>#<N>,
  // or undefined for a key of another project. It throws the IssueKeyError of the parser for a
  // key of the wrong form. It takes the project and the site because one provider serves many repos.
  // The site is the issueTracker.site of the repo. It is the entry of KEY_PARSERS in
  // src/issue-key/resolve.ts.
  parse: (rawKey: string, repoKey: string, project: string, site: string | undefined) => IssueRef | undefined;
  // Reads the issue.
  fetchIssue(ref: IssueRef, env: NodeJS.ProcessEnv): Promise<Issue>;
  // Whether the credentials work, and as which account. signal stops the call.
  authStatus(env: NodeJS.ProcessEnv, options?: { signal?: AbortSignal }): Promise<AuthStatus>;
  // A base branch named on the issue, or undefined. No tracker call.
  baseBranchHint: (issue: Issue) => string | undefined;
  // Every blocker with its state. A provider with no blocking links gives [].
  blockingIssues(ref: IssueRef, env: NodeJS.ProcessEnv): Promise<Blocker[]>;
  // Adds an assignee. The caller passes issueTracker.assignee.
  assign(ref: IssueRef, assignee: string, env: NodeJS.ProcessEnv): Promise<void>;
  // Marks the issue in progress. target is issueTracker.inProgressLabel. The caller reads
  // issueTracker.updateOnStart to decide if it calls this write at all.
  transitionStatus(ref: IssueRef, target: string, env: NodeJS.ProcessEnv): Promise<void>;
  // Whether the issue has the in-progress marker. target is issueTracker.inProgressLabel.
  // No tracker call.
  inProgressMarker: (issue: Issue, target: string | undefined) => boolean;
  // Removes the in-progress marker of the issue. target is issueTracker.inProgressLabel. A marker
  // that the issue does not have counts as success. The caller reads issueTracker.updateOnStart to
  // decide if it calls this write at all.
  clearInProgress(ref: IssueRef, target: string, env: NodeJS.ProcessEnv): Promise<void>;
  // Marks the issue done. target is issueTracker.doneLabel. With a label, the label is added and
  // the issue stays open. With undefined, the issue closes as completed. The caller reads
  // issueTracker.updateOnFinish to decide if it calls this write at all.
  markDone(ref: IssueRef, target: string | undefined, env: NodeJS.ProcessEnv): Promise<void>;
  // The doctor checks of the provider for the repos in the list. Each repo names its own
  // account. issueDoctorChecks() calls it once with all the repos of the id, so a check
  // that runs once runs once. The checks do not run until the caller runs them.
  doctorChecks(repos: readonly IssueDoctorRepo[]): Check[];
}

const providers = new WeakMap<Config, Map<string, IssueProvider>>();

// The only place that picks an issue provider. It reads issueTracker.provider. One configuration
// object gives one provider object for each (id, account) pair. Another configuration object gets
// new providers.
export function issueProviderFor(config: Config, repoKey: string): IssueProvider {
  if (!Object.hasOwn(config.repos, repoKey)) {
    throw new Error(`unknown repo ${JSON.stringify(repoKey)}: no repo with this key is in the configuration`);
  }
  const { issueTracker } = config.repos[repoKey];
  switch (issueTracker.provider) {
    case "github": {
      const account = accountOf({ key: repoKey, issueTracker });
      const cacheKey = JSON.stringify([issueTracker.provider, account]);
      let cache = providers.get(config);
      if (cache === undefined) {
        cache = new Map();
        providers.set(config, cache);
      }
      let provider = cache.get(cacheKey);
      if (provider === undefined) {
        provider = createGithubProvider({ account });
        cache.set(cacheKey, provider);
      }
      return provider;
    }
    case "jira":
      throw new ConfigError([
        `repos.${repoKey}.issueTracker.provider: the jira tracker is not available in this version`,
      ]);
  }
}

// The doctor checks of every repo of the configuration. It groups the repos by
// issueTracker.provider with reposByProvider(), and calls doctorChecks() once for each id
// with all the repos of that id, in the order of the configuration. As a result, a check that
// a provider gives once, such as gh version, runs once. A jira repo gives the ConfigError of
// issueProviderFor(). A configuration with no repo gives [].
export function issueDoctorChecks(config: Config): Check[] {
  return reposByProvider(
    config,
    (repo) => repo.issueTracker.provider,
    (key, repo): IssueDoctorRepo => ({ key, issueTracker: repo.issueTracker }),
  ).flatMap(([, repos]) => issueProviderFor(config, repos[0].key).doctorChecks(repos));
}
