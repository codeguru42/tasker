import { KEY_PARSERS } from "../../issue-key/resolve.js";
import type { IssueProvider } from "../provider.js";
import { authStatus } from "./auth.js";
import { readJiraBlockers } from "./blockers.js";
import { jiraDoctorChecks } from "./doctor.js";
import { readJiraIssue } from "./issue.js";
import { assignJiraIssue, jiraInProgressMarker, markJiraDone, markJiraInProgress } from "./write.js";

// Maps the neutral names of IssueProvider to the Jira functions. It adds no behavior.
// Each Jira function runs the site guard itself.
export function createJiraProvider({ site }: { site: string | undefined }): IssueProvider {
  return {
    id: "jira",
    account: undefined,
    parse: KEY_PARSERS.jira,
    fetchIssue: (ref, env) => readJiraIssue(ref, site, env),
    authStatus,
    baseBranchHint: () => undefined,
    blockingIssues: (ref, env) => readJiraBlockers(ref, site, env),
    assign: (ref, assignee, env) => assignJiraIssue(ref, assignee, site, env),
    transitionStatus: (ref, target, env) => markJiraInProgress(ref, target, site, env),
    inProgressMarker: jiraInProgressMarker,
    clearInProgress: () => Promise.reject(new Error("the jira tracker has no in-progress clear")),
    markDone: (ref, target, env) => markJiraDone(ref, target, site, env),
    doctorChecks: jiraDoctorChecks,
  };
}
