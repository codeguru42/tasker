# Issue keys

An issue key names one issue in an issue tracker. This doc gives the forms of a key, the purpose of the short ref, and
the rules that resolve a key to one repo.

## Key forms

- GitHub: `owner/repo#N`.
- Jira: `PROJ-N`.
- Jira with a site: `<site>/browse/PROJ-N`.

`N` is a number with no leading zero. `PROJ` is in upper case. tasker stores the site in lower case.

`skills/tasker/SKILL.md` gives the same forms to users in its "Issue keys" section. A change to the forms must change
both files.

## Short refs

The short ref comes from the issue key. It names the worktree folder of the task, and it starts the branch name.

## The repo of a key

The resolve gives the one configured repo that owns the key. It runs with no network.

The project of a repo is its `issueTracker.project`. The [`project` row of the configuration](../config.md#issuetracker)
gives the default.

tasker does not guess the provider from the shape of a key. It tries the key against each repo, with the key parser of
the provider of that repo. One provider object serves many repos, so the parser takes the project. The resolve uses the
key parsers directly, not the provider registry.

A github repo matches when the `owner/repo` part of the key equals the project. The compare folds only the ASCII letters
`A` to `Z` to lower case. `toLowerCase()` is not safe, because the Kelvin sign U+212A lowers to `k`. With the ASCII
fold, a match means that the project has the same ASCII characters as the key. As a result, the stored key is always a
GitHub key.

A jira repo never matches, because the Jira project match does not exist yet. Its parser runs only to give the parser
error, and the resolve gives that error and not the error of the registry.

No file in `src/issue-key/` imports from `src/issues/`, because that import pulls in the registry and the gh code. A
[boundary test](code-conventions.md#tests) enforces this rule.

The unknown repo check of `--repo` uses the own keys of the configuration only, so `constructor` and `__proto__` are
unknown repo keys.

## Stored spelling

The stored key is `<project>#<N>`, with the spelling of the configuration. For example, `CodeGuru42/Tasker#5` and
`codeguru42/tasker#5` give one task. The short ref comes from the same number.
