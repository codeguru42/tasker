import type { Config, RepoConfig } from "../config/schema.js";
import { splitGithubKey } from "./github.js";
import { IssueKeyError, type IssueRef } from "./ref.js";
import { githubShortRef } from "./short-ref.js";

export interface ResolveOptions {
  // The repo key that --repo names.
  repo?: string;
}

type Provider = RepoConfig["issueTracker"]["provider"];

// The IssueRef of rawKey in a repo with this project, or undefined when the repo does
// not own the key. The parser of the provider throws an IssueKeyError when it rejects the key.
type Matcher = (rawKey: string, repoKey: string, project: string) => IssueRef | undefined;

// GitHub names are ASCII and have no case. The fold changes only A to Z, so a match
// means that the project has the same ASCII characters as the key, and the stored key
// is a GitHub key. toLowerCase() is not safe: the Kelvin sign U+212A lowers to "k".
function asciiFold(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

// One matcher for each provider. A new provider in the schema fails to compile until it has one.
const MATCHERS: Record<Provider, Matcher> = {
  github: (rawKey, repoKey, project) => {
    const parts = splitGithubKey(rawKey);
    if (asciiFold(parts.project) !== asciiFold(project)) return undefined;
    return { key: `${project}#${parts.number}`, repoKey, shortRef: githubShortRef(parts.number) };
  },
  // M14 adds the Jira project match.
  jira: () => undefined,
};

// The project of a repo: issueTracker.project, or the repo key when it is not set.
function projectOf(repoKey: string, repo: RepoConfig): string {
  return repo.issueTracker.project ?? repoKey;
}

export function resolveIssueKey(
  rawKey: string,
  config: Config,
  // The next change reads the options.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options: ResolveOptions = {},
): IssueRef {
  for (const [repoKey, repoConfig] of Object.entries(config.repos)) {
    const ref = MATCHERS[repoConfig.issueTracker.provider](
      rawKey,
      repoKey,
      projectOf(repoKey, repoConfig),
    );
    if (ref !== undefined) return ref;
  }
  throw new IssueKeyError(
    rawKey,
    `no configured repo has the project of issue key ${JSON.stringify(rawKey)}`,
  );
}
