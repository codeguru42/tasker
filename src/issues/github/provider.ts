import { KEY_PARSERS } from "../../issue-key/resolve.js";
import { baseBranchHint, inProgressMarker } from "../issue.js";
import type { IssueProvider } from "../provider.js";
import { authStatus } from "./auth.js";
import { readGithubBlockers } from "./blockers.js";
import { githubDoctorChecks } from "./doctor.js";
import { readGithubIssue } from "./issue.js";
import { assignGithubIssue, markGithubDone, markGithubInProgress } from "./write.js";

// Maps the neutral names of IssueProvider to the GitHub functions. It adds no behavior.
export function createGithubProvider({ account }: { account: string }): IssueProvider {
  return {
    id: "github",
    account,
    parse: KEY_PARSERS.github,
    fetchIssue: (ref, env) => readGithubIssue(ref, account, env),
    authStatus: (env, options) => authStatus(account, env, options),
    baseBranchHint,
    blockingIssues: (ref, env) => readGithubBlockers(ref, account, env),
    assign: (ref, assignee, env) => assignGithubIssue(ref, assignee, account, env),
    transitionStatus: (ref, target, env) => markGithubInProgress(ref, target, account, env),
    inProgressMarker,
    markDone: (ref, target, env) => markGithubDone(ref, target, account, env),
    doctorChecks: githubDoctorChecks,
  };
}
