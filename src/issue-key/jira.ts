import { pathSlug } from "./path-slug.js";
import { IssueKeyError, type IssueRef } from "./ref.js";

const JIRA_KEY = /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/;

export function parseJiraKey(rawKey: string, repoKey: string): IssueRef {
  if (!JIRA_KEY.test(rawKey)) {
    throw new IssueKeyError(
      rawKey,
      `not a Jira issue key: ${JSON.stringify(rawKey)} (expected PROJ-N or <site>/browse/PROJ-N)`,
    );
  }
  return { key: rawKey, repoKey, shortRef: pathSlug(rawKey) };
}
