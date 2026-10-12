import { IssueKeyError, type IssueRef } from "./ref.js";

// The number of an issue, as a pattern source.
export const ISSUE_NUMBER = "[1-9][0-9]*";

const GITHUB_KEY = new RegExp(
  `^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\\/([A-Za-z0-9._-]+)#(${ISSUE_NUMBER})$`,
);

export function parseGithubKey(rawKey: string, repoKey: string): IssueRef {
  const match = GITHUB_KEY.exec(rawKey);
  if (!match || match[2] === "." || match[2] === "..") {
    throw new IssueKeyError(
      rawKey,
      `not a GitHub issue key: ${JSON.stringify(rawKey)} (expected owner/repo#N)`,
    );
  }
  return { key: rawKey, repoKey, shortRef: `issue-${match[3]}` };
}
