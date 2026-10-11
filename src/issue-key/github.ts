import { pathSlug } from "./path-slug.js";
import { IssueKeyError, type IssueRef } from "./ref.js";

const GITHUB_KEY =
  /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)#([1-9][0-9]*)$/;

export function parseGithubKey(rawKey: string, repoKey: string): IssueRef {
  const match = GITHUB_KEY.exec(rawKey);
  if (!match || match[2] === "." || match[2] === "..") {
    throw new IssueKeyError(
      rawKey,
      `not a GitHub issue key: ${JSON.stringify(rawKey)} (expected owner/repo#N)`,
    );
  }
  return {
    key: rawKey,
    repoKey,
    shortRef: pathSlug(`issue-${match[3]}`),
  };
}
