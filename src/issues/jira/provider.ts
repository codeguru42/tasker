import type { RepoConfig } from "../../config/schema.js";
import type { IssueRef } from "../../issue-key/ref.js";
import { KEY_PARSERS } from "../../issue-key/resolve.js";
import type { IssueProvider } from "../provider.js";
import { authStatus } from "./auth.js";
import { readJiraBlockers } from "./blockers.js";
import { jiraDoctorChecks } from "./doctor.js";
import { jiraBaseBranchHint } from "./hint.js";
import { readJiraIssue } from "./issue.js";
import { lookupFieldId } from "./field-id.js";
import { jiraCredentials } from "./rest.js";
import type { JiraLogin } from "./site.js";
import {
  assignJiraIssue,
  jiraInProgressMarker,
  markJiraAborted,
  markJiraDone,
  markJiraInProgress,
  markJiraReview,
} from "./write.js";

// The keys of the issueTracker of one repo that the lookup of the base branch field reads.
export type JiraRepoSettings = Pick<RepoConfig["issueTracker"], "baseBranchFieldName" | "apiToken" | "email">;

// Maps the neutral names of IssueProvider to the Jira functions. Each Jira function runs the site guard itself.
// One provider serves all the Jira repos of one site. It keeps the result of the first lookup of the field id of
// each repo, also a failure, so the lookup runs at most one time for each repo in one process.
// Without `fetch`, each call uses globalThis.fetch at the time of the call.
export function createJiraProvider({
  site,
  settingsOf,
  fetch: fetchFn,
}: {
  site: string | undefined;
  settingsOf: (repoKey: string) => JiraRepoSettings;
  fetch?: typeof fetch;
}): IssueProvider {
  const lookups = new Map<string, Promise<string>>();

  function fieldIdOf(ref: IssueRef, env: NodeJS.ProcessEnv): ((login: JiraLogin) => Promise<string>) | undefined {
    const settings = settingsOf(ref.repoKey);
    const name = settings.baseBranchFieldName;
    if (name === undefined) return undefined;
    return (login) => {
      const kept = lookups.get(ref.repoKey);
      if (kept !== undefined) return kept;
      const lookup = (async () => {
        const credentials = jiraCredentials(settings, env, login.email);
        return lookupFieldId(ref.key, login.site, name, credentials, { fetch: fetchFn ?? globalThis.fetch });
      })();
      lookups.set(ref.repoKey, lookup);
      return lookup;
    };
  }

  return {
    id: "jira",
    account: undefined,
    parse: KEY_PARSERS.jira,
    fetchIssue: (ref, env) => readJiraIssue(ref, site, env, fieldIdOf(ref, env)),
    authStatus,
    baseBranchHint: jiraBaseBranchHint,
    blockingIssues: (ref, env) => readJiraBlockers(ref, site, env),
    assign: (ref, assignee, env) => assignJiraIssue(ref, assignee, site, env),
    moveCard: () => Promise.reject(new Error("the jira tracker has no board move")),
    transitionStatus: (ref, target, env) => markJiraInProgress(ref, target, site, env),
    inProgressMarker: jiraInProgressMarker,
    clearInProgress: () => Promise.reject(new Error("the jira tracker has no in-progress clear")),
    markDone: (ref, target, env) => markJiraDone(ref, target, site, env),
    markReview: (ref, target, env) => markJiraReview(ref, target, site, env),
    markAborted: (ref, status, env) => markJiraAborted(ref, status, site, env),
    doctorChecks: jiraDoctorChecks,
  };
}
