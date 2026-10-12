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
  options: ResolveOptions = {},
): IssueRef {
  const { repo } = options;
  if (repo !== undefined && !Object.hasOwn(config.repos, repo)) {
    throw new IssueKeyError(
      rawKey,
      `unknown repo ${JSON.stringify(repo)}: no repo with this key is in the configuration`,
    );
  }
  const matches: IssueRef[] = [];
  for (const [repoKey, repoConfig] of Object.entries(config.repos)) {
    const ref = MATCHERS[repoConfig.issueTracker.provider](
      rawKey,
      repoKey,
      projectOf(repoKey, repoConfig),
    );
    if (ref !== undefined) matches.push(ref);
  }
  if (repo !== undefined) {
    const chosen = matches.find((ref) => ref.repoKey === repo);
    if (chosen === undefined) {
      throw new IssueKeyError(
        rawKey,
        `repo ${JSON.stringify(repo)} does not have the project of issue key ${JSON.stringify(rawKey)}`,
      );
    }
    return chosen;
  }
  const [only, ...others] = matches;
  if (only === undefined) {
    throw new IssueKeyError(
      rawKey,
      `no configured repo has the project of issue key ${JSON.stringify(rawKey)}`,
    );
  }
  if (others.length > 0) {
    const keys = matches.map((ref) => JSON.stringify(ref.repoKey)).join(", ");
    throw new IssueKeyError(
      rawKey,
      `issue key ${JSON.stringify(rawKey)} matches more than one repo (${keys}): pass --repo <key> to pick one`,
    );
  }
  return only;
}
