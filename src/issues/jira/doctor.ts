import type { Check } from "../../doctor/check.js";
import { timedCheck } from "../../doctor/timed-check.js";
import type { IssueDoctorRepo } from "../provider.js";
import { authStatus } from "./auth.js";
import { foldSite } from "./site.js";

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

export function jiraDoctorChecks(repos: readonly IssueDoctorRepo[]): Check[] {
  return repos.length === 0 ? [] : [jiraAuthCheck(repos)];
}
