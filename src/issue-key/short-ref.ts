import { pathSlug } from "./path-slug.js";

// The number of an issue, as a pattern source.
export const ISSUE_NUMBER = "[1-9][0-9]*";
// The project of a Jira issue, as a pattern source.
export const JIRA_PROJECT = "[A-Z][A-Z0-9_]*";
// One label of a Jira site in an issue key, as a pattern source. The key can have any case.
export const SITE_LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";

// One label of the site in a short ref. jiraShortRef() gets the site in lower case.
const SHORT_REF_SITE_LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";

// The short ref forms, as a pattern source: issue-<N>, <PROJ>-<N> and <site>-browse-<PROJ>-<N>.
export const SHORT_REF = `(?:issue-${ISSUE_NUMBER}|(?:${SHORT_REF_SITE_LABEL}(?:\\.${SHORT_REF_SITE_LABEL})*-browse-)?${JIRA_PROJECT}-${ISSUE_NUMBER})`;

const SHORT_REF_PATTERN = new RegExp(`^${SHORT_REF}$`);

// True when value is a short ref that the issue key parsers make.
export function isShortRef(value: string): boolean {
  return SHORT_REF_PATTERN.test(value);
}

// The short ref of a GitHub issue number.
export function githubShortRef(number: string): string {
  return `issue-${number}`;
}

// The short ref of a Jira key. The parser passes the key with the site in lower case.
export function jiraShortRef(key: string): string {
  return pathSlug(key);
}
