import { isSet } from "../../config/path.js";
import type { Check } from "../../doctor/check.js";
import { timedCheck } from "../../doctor/timed-check.js";
import type { IssueDoctorRepo } from "../provider.js";
import { authStatus } from "./auth.js";
import { jiraCredentials, JiraCredentialError, jiraGet, JiraRestError } from "./rest.js";
import { foldSite, readLogin } from "./site.js";

// One required check for all the Jira repos. It makes one acli call. It compares the active site
// with the site of each repo, with the fold of the site guard. The detail never shows the email
// of the user, because the output of acli holds it.
export function jiraAuthCheck(repos: readonly IssueDoctorRepo[], timeoutMs = 15000): Check {
  return timedCheck({ name: "acli auth", required: true, timeoutMs }, async (env, { signal }) => {
    const status = await authStatus(env, { signal });
    if (!status.ok) {
      return {
        status: "error",
        detail: status.detail,
        remediation: status.needsLogin ? "Run acli jira auth login." : "Install acli, or fix TASKER_ACLI_BIN.",
      };
    }
    // ok true always has a login.
    const active = status.login!;
    const wrong = repos.flatMap((repo) => {
      const site = repo.issueTracker.site;
      if (site === undefined) return [];
      const wanted = foldSite(site);
      return wanted === active ? [] : [{ key: repo.key, site: wanted }];
    });
    if (wrong.length === 0) {
      return { status: "ok", detail: status.detail };
    }
    return {
      status: "error",
      detail: wrong.map(({ key, site }) => `repo ${key} names the site ${site}, but acli uses ${active}`).join("\n"),
      remediation: `Run acli jira auth switch --site ${wrong[0].site}.`,
    };
  });
}

// One required check for a Jira repo that sets baseBranchFieldName. It calls GET /rest/api/3/myself with the token and
// the email, and passes its signal to fetch. It reads the login of acli only when the repo sets no site, or when
// neither TASKER_JIRA_EMAIL nor issueTracker.email gives the email. The detail never shows the token or the email.
export function jiraTokenCheck(repo: IssueDoctorRepo, fetchFn: typeof fetch, timeoutMs = 15000): Check {
  return timedCheck({ name: `jira token: ${repo.key}`, required: true, timeoutMs }, async (env, { signal }) => {
    const { site: repoSite, email, apiToken } = repo.issueTracker;
    const emailKnown = isSet(env.TASKER_JIRA_EMAIL) || email !== undefined;
    const login = repoSite === undefined || !emailKnown ? await readLogin(env, { signal }) : undefined;
    const site = repoSite === undefined ? login!.site : foldSite(repoSite);
    try {
      const credentials = jiraCredentials({ apiToken, email }, env, login?.email);
      await jiraGet(site, "/rest/api/3/myself", credentials, { fetch: fetchFn, what: "the token check", signal });
      return { status: "ok", detail: `the Jira API token works on ${site}` };
    } catch (error) {
      if (error instanceof JiraCredentialError) {
        const remediation =
          error.missing === "email"
            ? "Set TASKER_JIRA_EMAIL or issueTracker.email."
            : "Set TASKER_JIRA_TOKEN or issueTracker.apiToken.";
        return { status: "error", detail: error.message, remediation };
      }
      if (error instanceof JiraRestError) {
        return error.status === 401
          ? {
              status: "error",
              detail: error.message,
              remediation:
                "Set TASKER_JIRA_TOKEN or issueTracker.apiToken to an API token of the account of the email.",
            }
          : { status: "error", detail: error.message };
      }
      throw error;
    }
  });
}

export function jiraDoctorChecks(repos: readonly IssueDoctorRepo[], fetchFn: typeof fetch = globalThis.fetch): Check[] {
  if (repos.length === 0) return [];
  const tokenChecks = repos
    .filter((repo) => repo.issueTracker.baseBranchFieldName !== undefined)
    .map((repo) => jiraTokenCheck(repo, fetchFn));
  return [jiraAuthCheck(repos), ...tokenChecks];
}
