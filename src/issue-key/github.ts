import { IssueKeyError, type IssueRef } from "./ref.js";
import { githubShortRef, ISSUE_NUMBER } from "./short-ref.js";

const GITHUB_KEY = new RegExp(`^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\\/([A-Za-z0-9._-]+)#(${ISSUE_NUMBER})$`);

// The parts of a GitHub key: project is owner/repo, number is N.
export interface GithubKeyParts {
  project: string;
  number: string;
}

export function splitGithubKey(rawKey: string): GithubKeyParts {
  const match = GITHUB_KEY.exec(rawKey);
  if (!match || match[2] === "." || match[2] === "..") {
    throw new IssueKeyError(rawKey, `not a GitHub issue key: ${JSON.stringify(rawKey)} (expected owner/repo#N)`);
  }
  return { project: `${match[1]}/${match[2]}`, number: match[3] };
}

export function parseGithubKey(rawKey: string, repoKey: string): IssueRef {
  const { number } = splitGithubKey(rawKey);
  return { key: rawKey, repoKey, shortRef: githubShortRef(number) };
}
