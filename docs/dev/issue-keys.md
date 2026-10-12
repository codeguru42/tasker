# Issue keys

An issue key names one issue in an issue tracker. This doc gives the forms of a key, the short ref of a key, and the rules that resolve a key to one repo. `src/issue-key/` holds the code.

## Key forms

- GitHub: `owner/repo#N`.
- Jira: `PROJ-N`.
- Jira with a site: `<site>/browse/PROJ-N`.

`N` is a number with no leading zero. `PROJ` is in upper case. tasker stores the site in lower case.

`skills/tasker/SKILL.md` gives the same forms to users in its "Issue keys" section. A change to the forms must change both files.

## Short refs

The short ref is the one that the issue key parsers make. `src/issue-key/short-ref.ts` holds these forms:

- `issue-<N>` for a GitHub key. `<N>` is a number with no leading zero.
- `<PROJ>-<N>` for a Jira key with no site. `<PROJ>` starts with an upper-case letter, then has upper-case letters, digits or `_`.
- `<site>-browse-<PROJ>-<N>` for a Jira key with a site. The site is in lower case.

## The repo of a key

`resolveIssueKey(rawKey, config, { repo? })` gives the `IssueRef` (`key`, `repoKey`, `shortRef`) of the one configured repo that owns the key. It runs with no network. It throws an `IssueKeyError` when it cannot give one repo. The `key` of the error is the raw key.

The project of a repo is its `issueTracker.project`. The [`project` row of the configuration](../config.md#issuetracker) gives the default.

tasker does not guess the provider from the shape of a key. It tries the key against each repo, with the matcher of the provider of that repo. The matcher is the key parser of the provider in `KEY_PARSERS`. The `parse` of the issue provider is the same function. It takes the project, because one provider object serves many repos. The resolve uses `KEY_PARSERS`, not the registry `issueProviderFor()`. As a result, a jira repo still gives the parser error, and not the error of the registry.

No file in `src/issue-key/` imports from `src/issues/`. The test `test/issue-key/boundary.test.ts` enforces this rule. An import of `src/issues/provider.ts` from the key resolve pulls in the registry and the gh code.

- A github repo matches when `splitGithubKey()` accepts the key and the `owner/repo` part equals the project. The compare folds only the ASCII letters `A` to `Z` to lower case. `toLowerCase()` is not safe, because the Kelvin sign U+212A lowers to `k`. With the ASCII fold, a match means that the project has the same ASCII characters as the key. As a result, the stored key is always a GitHub key.
- A jira repo never matches until M14 adds the Jira project match. Its parser runs only to give the parser error.

If no parser accepts the key and at least one parser rejects it, the resolve throws the first parser error, in the order of the repos in the configuration. If a parser accepts the key but no repo matches, or the configuration has no repo, the resolve throws the no-match error. If two or more repos match, it throws the shared-project error.

## Stored spelling

The stored key is `<project>#<N>`, with the spelling of the configuration. For example, `CodeGuru42/Tasker#5` and `codeguru42/tasker#5` give one task. The short ref comes from the same number.

## The --repo option

`--repo` names a repo key. The checks run in this order:

1. An unknown repo key fails first, before any parse. The check uses `Object.hasOwn`, so `constructor` and `__proto__` are unknown keys.
2. The resolve computes the matches of all repos.
3. The parser error rule applies.
4. The repo that `--repo` names must be one of the matches.

## Errors

Each error is an `IssueKeyError`. `<JSON text of the key>` is the raw key, and `<JSON text of the repo key>` is a repo key.

- `not a GitHub issue key: <JSON text of the key> (expected owner/repo#N)`
- `not a Jira issue key: <JSON text of the key> (expected PROJ-N or <site>/browse/PROJ-N)`
- `no configured repo has the project of issue key <JSON text of the key>`
- `issue key <JSON text of the key> matches more than one repo (<JSON text of each repo key, joined with ", ">): pass --repo <key> to pick one`
- `unknown repo <JSON text of the repo key>: no repo with this key is in the configuration`
- `repo <JSON text of the repo key> does not have the project of issue key <JSON text of the key>`

## Files

- `src/issue-key/resolve.ts` holds `resolveIssueKey()`, `ResolveOptions`, `KeyParser` and `KEY_PARSERS`, the key parser of each provider. A new provider must add its entry to `KEY_PARSERS`, and the compiler makes sure of it.
- `src/issue-key/github.ts` holds `splitGithubKey()`, `GithubKeyParts` and `parseGithubKey()`.
