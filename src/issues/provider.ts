import { ConfigError, type Config, type RepoConfig } from "../config/schema.js";
import type { Check } from "../doctor/check.js";
import type { IssueRef } from "../issue-key/ref.js";
import { accountOf } from "./github/doctor.js";
import { createGithubProvider } from "./github/provider.js";
import type { Blocker, Issue } from "./issue.js";

// The id of an issue tracker: the value of issueTracker.provider.
export type IssueTrackerId = RepoConfig["issueTracker"]["provider"];

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
  // key of the wrong form. It takes the project because one provider serves many repos. It is the
  // entry of KEY_PARSERS in src/issue-key/resolve.ts.
  parse(rawKey: string, repoKey: string, project: string): IssueRef | undefined;
  // Reads the issue.
  fetchIssue(ref: IssueRef, env: NodeJS.ProcessEnv): Promise<Issue>;
  // Whether the credentials work, and as which account. signal stops the call.
  authStatus(env: NodeJS.ProcessEnv, options?: { signal?: AbortSignal }): Promise<AuthStatus>;
  // A base branch named on the issue, or undefined. No tracker call.
  baseBranchHint(issue: Issue): string | undefined;
  // Every blocker with its state. A provider with no blocking links gives [].
  blockingIssues(ref: IssueRef, env: NodeJS.ProcessEnv): Promise<Blocker[]>;
  // Adds an assignee. The caller passes issueTracker.assignee.
  assign(ref: IssueRef, assignee: string, env: NodeJS.ProcessEnv): Promise<void>;
  // Marks the issue in progress. target is issueTracker.inProgressLabel. The caller reads
  // issueTracker.updateOnStart to decide if it calls this write at all.
  transitionStatus(ref: IssueRef, target: string, env: NodeJS.ProcessEnv): Promise<void>;
  // Whether the issue has the in-progress marker. target is issueTracker.inProgressLabel.
  // No tracker call.
  inProgressMarker(issue: Issue, target: string | undefined): boolean;
  // Marks the issue done. target is issueTracker.doneLabel. With a label, the label is added and
  // the issue stays open. With undefined, the issue closes as completed. The caller reads
  // issueTracker.updateOnFinish to decide if it calls this write at all.
  markDone(ref: IssueRef, target: string | undefined, env: NodeJS.ProcessEnv): Promise<void>;
  // The doctor checks of the provider. The checks do not run until the caller runs them.
  readonly doctorChecks: Check[];
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
        const repos = Object.entries(config.repos)
          .filter(([, repo]) => repo.issueTracker.provider === "github" && repo.issueTracker.account === account)
          .map(([key, repo]) => ({ key, issueTracker: repo.issueTracker }));
        provider = createGithubProvider({ account, repos });
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
