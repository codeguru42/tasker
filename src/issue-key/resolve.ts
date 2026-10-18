import type { Config, RepoConfig } from "../config/schema.js";
import { asciiFold } from "../ascii-fold.js";
import { splitGithubKey } from "./github.js";
import { parseJiraKey } from "./jira.js";
import { IssueKeyError, type IssueRef } from "./ref.js";
import { githubShortRef } from "./short-ref.js";

export interface ResolveOptions {
  // The repo key that --repo names.
  repo?: string;
}

type Provider = RepoConfig["issueTracker"]["provider"];

// The IssueRef of rawKey in a repo with this project, or undefined when the repo does
// not own the key. The parser of the provider throws an IssueKeyError when it rejects the key.
export type KeyParser = (rawKey: string, repoKey: string, project: string) => IssueRef | undefined;

// One key parser for each provider. A new provider in the schema fails to compile until it has one.
export const KEY_PARSERS: Record<Provider, KeyParser> = {
  github: (rawKey, repoKey, project) => {
    const parts = splitGithubKey(rawKey);
    // GitHub names are ASCII and have no case. A match means that the project has the same
    // ASCII characters as the key, and the stored key is a GitHub key.
    if (asciiFold(parts.project) !== asciiFold(project)) return undefined;
    return { key: `${project}#${parts.number}`, repoKey, shortRef: githubShortRef(parts.number) };
  },
  jira: (rawKey, repoKey) => {
    // A jira repo never matches until M14 adds the Jira project match. The parser runs
    // so that a key that no parser accepts gives the parser error.
    parseJiraKey(rawKey, repoKey);
    return undefined;
  },
};

// The project of a repo: issueTracker.project, or the repo key when it is not set.
export function projectOf(repoKey: string, issueTracker: { project?: string }): string {
  return issueTracker.project ?? repoKey;
}

// The IssueRef of each repo that has the project of rawKey, in the order of the configuration.
// It gives no ref when the parsers accept the key but no project matches. It throws the first
// parser IssueKeyError when no parser accepts the key.
export function issueKeyMatches(rawKey: string, config: Config): IssueRef[] {
  const matches: IssueRef[] = [];
  let accepted = false;
  let rejection: IssueKeyError | undefined;
  for (const [repoKey, repoConfig] of Object.entries(config.repos)) {
    let ref: IssueRef | undefined;
    try {
      ref = KEY_PARSERS[repoConfig.issueTracker.provider](rawKey, repoKey, projectOf(repoKey, repoConfig.issueTracker));
    } catch (error) {
      if (!(error instanceof IssueKeyError)) throw error;
      rejection ??= error;
      continue;
    }
    accepted = true;
    if (ref !== undefined) matches.push(ref);
  }
  if (!accepted && rejection !== undefined) throw rejection;
  return matches;
}

export function resolveIssueKey(rawKey: string, config: Config, options: ResolveOptions = {}): IssueRef {
  const { repo } = options;
  if (repo !== undefined && !Object.hasOwn(config.repos, repo)) {
    throw new IssueKeyError(
      rawKey,
      `unknown repo ${JSON.stringify(repo)}: no repo with this key is in the configuration`,
    );
  }
  const matches = issueKeyMatches(rawKey, config);
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
    throw new IssueKeyError(rawKey, `no configured repo has the project of issue key ${JSON.stringify(rawKey)}`);
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
