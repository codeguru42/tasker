import { pathSlug } from "./path-slug.js";

// The number of an issue, as a pattern source.
export const ISSUE_NUMBER = "[1-9][0-9]*";
// The project of a Jira issue, as a pattern source.
export const JIRA_PROJECT = "[A-Z][A-Z0-9_]*";
// One label of a Jira site in an issue key, as a pattern source. The key can have any case.
export const SITE_LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";

// The form that pathSlug() makes, as a pattern source: runs of chars, with one "-" between runs.
function slugPattern(chars: string): string {
  return `${chars}+(?:-${chars}+)*`;
}

// A lower-case path slug, as a pattern source.
export const LOWER_SLUG = slugPattern("[a-z0-9]");

// The project of a Jira short ref. pathSlug() turns each "_" into "-". It starts with A-Z.
const SHORT_REF_PROJECT = `(?=[A-Z])${slugPattern("[A-Z0-9]")}`;

// The short ref forms, as a pattern source: issue-<N>, <PROJ>-<N> and <site>-browse-<PROJ>-<N>.
// jiraShortRef() gets the site in lower case, and pathSlug() turns each "." of it into "-".
export const SHORT_REF = `(?:issue-${ISSUE_NUMBER}|(?:${LOWER_SLUG}-browse-)?${SHORT_REF_PROJECT}-${ISSUE_NUMBER})`;

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
