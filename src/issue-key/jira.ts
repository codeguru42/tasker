import { IssueKeyError, type IssueRef } from "./ref.js";
import { ISSUE_NUMBER, JIRA_PROJECT, jiraShortRef, SITE_LABEL } from "./short-ref.js";

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
  return { key, repoKey, shortRef: jiraShortRef(key) };
}
