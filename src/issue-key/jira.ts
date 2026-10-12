import { ISSUE_NUMBER } from "./github.js";
import { pathSlug } from "./path-slug.js";
import { IssueKeyError, type IssueRef } from "./ref.js";

// The project of a Jira issue and one label of a Jira site, as pattern sources.
export const JIRA_PROJECT = "[A-Z][A-Z0-9_]*";
export const SITE_LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";

const JIRA_KEY = new RegExp(
  `^(?:(${SITE_LABEL}(?:\\.${SITE_LABEL})*)\\/browse\\/)?(${JIRA_PROJECT}-${ISSUE_NUMBER})$`,
);

export function parseJiraKey(rawKey: string, repoKey: string): IssueRef {
  const match = JIRA_KEY.exec(rawKey);
  if (!match) {
    throw new IssueKeyError(
      rawKey,
      `not a Jira issue key: ${JSON.stringify(rawKey)} (expected PROJ-N or <site>/browse/PROJ-N)`,
    );
  }
  const [, site, issue] = match;
  const key = site === undefined ? rawKey : `${site.toLowerCase()}/browse/${issue}`;
  return { key, repoKey, shortRef: pathSlug(key) };
}
