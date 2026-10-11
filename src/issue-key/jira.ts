import { pathSlug } from "./path-slug.js";
import { IssueKeyError, type IssueRef } from "./ref.js";

const JIRA_KEY =
  /^(?:([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*)\/browse\/)?([A-Z][A-Z0-9_]*-[1-9][0-9]*)$/;

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
