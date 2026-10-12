import { IssueKeyError, type IssueRef } from "./ref.js";
import { githubShortRef, ISSUE_NUMBER } from "./short-ref.js";

const GITHUB_KEY = new RegExp(
  `^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\\/([A-Za-z0-9._-]+)#(${ISSUE_NUMBER})$`,
);

// The parts of a GitHub key: project is owner/repo, number is N.
export interface GithubKeyParts {
  project: string;
  number: string;
}

export function splitGithubKey(rawKey: string): GithubKeyParts {
  const match = GITHUB_KEY.exec(rawKey);
  if (!match || match[2] === "." || match[2] === "..") {
    throw new IssueKeyError(
      rawKey,
      `not a GitHub issue key: ${JSON.stringify(rawKey)} (expected owner/repo#N)`,
    );
  }
  return { project: `${match[1]}/${match[2]}`, number: match[3] };
}

// GitHub names are ASCII and have no case. The fold changes only A to Z, so a match
// means that the project has the same ASCII characters as the key, and the stored key
// is a GitHub key. toLowerCase() is not safe: the Kelvin sign U+212A lowers to "k".
export function asciiFold(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function parseGithubKey(rawKey: string, repoKey: string): IssueRef {
  const { number } = splitGithubKey(rawKey);
  return { key: rawKey, repoKey, shortRef: githubShortRef(number) };
}
