# Issue trackers

`src/issues/` holds the issue tracker code. No command uses this code yet. `tasker start` uses it in M4. `tasker start` uses the assign and the in-progress write in M10, and `tasker finish` uses the done write in M10. `tasker doctor` runs the doctor checks of the GitHub tracker in M19.

## The GitHub folder

All code that starts `gh` is in `src/issues/github/`. The test `test/issues/github/boundary.test.ts` enforces this rule with the source scan of `test/helpers.ts`. The test fails when a file outside `src/issues/github/` loads `child_process` or imports `src/process/run-child.ts`, and has a string literal that is `gh` or starts with `gh `. No file outside `src/issues/` imports from `src/issues/github/`. The same test enforces this rule with `filesThatBreakBoundary()` of `test/helpers.ts`. A command gets a provider from `issueProviderFor()` in `src/issues/provider.ts`. See [The issue provider](#the-issue-provider). The scan has two known gaps. It cannot find a module name that the code builds at run time. It cannot find a command name that the code builds at run time.

## The files of src/issues/

- `src/issues/provider.ts` holds `IssueTrackerId`, `AuthStatus`, `IssueDoctorRepo`, `IssueProvider`, `issueProviderFor()` and `issueDoctorChecks()`.
- `src/issues/github/provider.ts` holds `createGithubProvider()`.
- `src/issues/github/run.ts` holds `runGh()`, `readGhVersion()`, `RunGhOptions`, `GhError`, `GhNotInstalledError` and `GhLoginError`.
- `src/issues/issue.ts` holds `Issue`, `Blocker`, `IssueReadError`, `IssueWriteError`, `BaseHintError`, `baseBranchHint()` and `inProgressMarker()`.
- `src/issues/github/issue.ts` holds `readGithubIssue()` and `issueState()`.
- `src/issues/github/blockers.ts` holds `readGithubBlockers()`.
- `src/issues/github/write.ts` holds `assignGithubIssue()`, `markGithubInProgress()` and `markGithubDone()`.
- `src/issues/github/auth.ts` holds `authStatus()`.
- `src/issues/github/doctor.ts` holds `accountOf()`, `githubDoctorChecks()`, `ghVersionCheck()`, `ghAuthCheck()`, `ghProjectCheck()` and `ghLabelsCheck()`.

Later issues add their files to this list.

## The issue provider

A command gets an `IssueProvider` from `issueProviderFor(config, repoKey)` in `src/issues/provider.ts`. A command never imports from `src/issues/github/`. Each member maps to one GitHub function and adds no behavior. `createGithubProvider({ account })` in `src/issues/github/provider.ts` builds the GitHub provider.

| Member | Calls |
| --- | --- |
| `id: IssueTrackerId` | `"github"` |
| `account: string \| undefined` | the account of the pair |
| `parse(rawKey, repoKey, project): IssueRef \| undefined` | `KEY_PARSERS.github` (the same function) |
| `fetchIssue(ref, env): Promise<Issue>` | `readGithubIssue(ref, account, env)` |
| `authStatus(env, options?): Promise<AuthStatus>` | `authStatus(account, env, options)` |
| `baseBranchHint(issue): string \| undefined` | `baseBranchHint(issue)` of `src/issues/issue.ts` |
| `blockingIssues(ref, env): Promise<Blocker[]>` | `readGithubBlockers(ref, account, env)` |
| `assign(ref, assignee, env): Promise<void>` | `assignGithubIssue(ref, assignee, account, env)` |
| `transitionStatus(ref, target, env): Promise<void>` | `markGithubInProgress(ref, target, account, env)` |
| `inProgressMarker(issue, target): boolean` | `inProgressMarker(issue, target)` of `src/issues/issue.ts` |
| `markDone(ref, target, env): Promise<void>` | `markGithubDone(ref, target, account, env)` |
| `doctorChecks(repos): Check[]` | `githubDoctorChecks(repos)` |

`target` is the value of the configuration that the caller passes:

- `transitionStatus` takes `issueTracker.inProgressLabel`, a string.
- `inProgressMarker` takes `issueTracker.inProgressLabel`, which is `string | undefined`.
- `markDone` takes `issueTracker.doneLabel`, which is `string | undefined`. With a label, the provider adds the label and the issue stays open. With `undefined`, the provider closes the issue as completed.
- The caller reads `issueTracker.updateOnStart` and `issueTracker.updateOnFinish` to decide if it calls a write at all. The provider does not read them.

`baseBranchHint()` and `inProgressMarker()` make no tracker call. `blockingIssues()` gives `[]` for a provider with no blocking links. `AuthStatus` is in `src/issues/provider.ts`. `IssueReadError`, `IssueWriteError` and `BaseHintError` stay in `src/issues/issue.ts`.

`parse` takes the project, because one provider object serves many repos. It is the entry of `KEY_PARSERS` in `src/issue-key/resolve.ts`, not a wrapper. It gives the `IssueKeyError` of the parser for a key of the wrong form, `undefined` for a key of another project, and the ref with the stored spelling `<project>#<N>` for a key of the project. [Issue keys](issue-keys.md) gives the rules.

`doctorChecks(repos)` gives the checks of the provider for the repos in the list. The github provider gives `githubDoctorChecks(repos)`. `issueDoctorChecks(config)` calls `doctorChecks()` once for each tracker id, with all the repos of that id. As a result, the `gh version` check runs once, and the order of [Doctor checks](#doctor-checks) holds.

### The registry

`issueProviderFor()` is the only place that reads `issueTracker.provider`. The cache is a `WeakMap` that maps a configuration object to a map. The inner key is `JSON.stringify([id, account])`. One configuration object gives one provider object for each `(id, account)` pair. Another configuration object gets new providers. A caller that changes a configuration object after the first call gets the old provider.

- The account comes from `accountOf()` in `src/issues/github/doctor.ts`. It throws `<key>: issueTracker.account is not set` when the account is not set.
- A repo key that is not in the configuration gives `unknown repo "<key>": no repo with this key is in the configuration`. The check uses `Object.hasOwn`, so `constructor` and `__proto__` also give this error.
- A jira repo gives a `ConfigError` with the issue `repos.<key>.issueTracker.provider: the jira tracker is not available in this version`.

`issueDoctorChecks(config)` in `src/issues/provider.ts` gives the doctor checks of every repo of the configuration. It groups the repos by `issueTracker.provider`, in the order of first use. For each id, it gets the provider of the first repo of the id and calls `doctorChecks()` once with all the repos of the id, in the order of the configuration. A jira repo gives the `ConfigError` above. A configuration with no repo gives `[]`.

## runGh()

`runGh(args, { account, env })` takes the arguments of `gh` (the subcommand first) and resolves with the stdout of `gh`. The stdout is as `gh` printed it, not trimmed. `args` must not be empty, and `args[0]` must not start with `-`.

`runGh()` starts `gh` through `runChild()` in `src/process/run-child.ts`.

`gh` gets no input stream. Its output goes to pipes, never to the terminal. `runGh()` writes nothing to the console or a log. `gh` runs in the cwd of tasker. Each call that acts on a repo must name the repo (`--repo <project>`, `-R <project>`, or the full path in `gh api repos/<owner>/<repo>/...`), because `runGh()` removes `GH_REPO`, and without a repo gh reads the repo from the git folder of its cwd.

`options.signal` stops `gh` with SIGTERM, and `runGh()` rejects with an `AbortError`. A signal that already aborted rejects before any `gh` starts. The signal stops the main call, and it also stops the token call under the rule in [The token](#the-token). `runGh()` has no `cwd` option.

`readGhVersion(env, { signal })` runs `gh --version` with the environment of `runGh()` and no token. It makes no token call, because the version needs no login. It resolves with the stdout.

A `gh api` call sends a string value with `-f` and only a number with `-F`. `-F` turns digits, `true`, `false` and `null` into JSON types. A string such as a name of only digits, or `true`, then has the wrong type, and GitHub refuses the variable. `-f` always sends a string.

## The token

Before the first call of an account, `runGh()` reads its token with `gh auth token --hostname github.com --user <account>`. With `--user`, gh 2.101.0 ignores `GH_TOKEN`. tasker reads the token one time for each account in one process. Two calls at the same time for one account start one token call. A failed read is not kept, so the next call reads the token again. The environment of the token call is in [The environment](#the-environment).

A caller that waits for the token read counts as a waiter. A caller with no signal never leaves the count until the read ends, so it never stops the read. The rules for a call with a signal are:

- A caller joins the count when it starts to wait. It leaves once: when the read ends, or when its signal aborts.
- A caller whose signal aborts rejects at once with an `AbortError`. The other callers keep waiting.
- When the last waiter leaves by an abort while the read is pending, `runGh()` stops the token call. In the same step, it deletes the read from the cache, if the cache still holds it for the account. As a result, a later caller starts a new read and never joins the stopped one.
- The stopped read rejects. A read that fails by itself leaves the cache in the same way.

## The environment

- `runGh()` starts from the `env` of the caller.
- It removes exactly these names: `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GH_HOST` and `GH_REPO`.
- Then it sets `GH_TOKEN` to the token of the account, `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1` and `NO_COLOR=1`.
- All other names pass as they are, for example `GH_CONFIG_DIR`, `PATH` and `HOME`.
- The token call uses the same environment, without the new `GH_TOKEN`.

`runGh()` does not add `process.env`. `gh` is found on the `PATH` of `env`. An env with no `PATH` or an empty one rejects before `gh` starts, so Node never uses the `PATH` of tasker. The doc comment of `runGh()` holds the same list.

## The errors

The token never appears in an error. The token call never puts its stdout into an error. A main call replaces each occurrence of the token with `***` in the `stdout`, the `stderr` and the message of a `GhError`. No error has a `cause`.

- `GhError` has the fields `subcommand`, `stdout`, `stderr` and `exitCode` (`null` after a signal). The message is `gh <subcommand> failed with exit code N: <stderr>`, with no `: <stderr>` when `stderr` is empty. After a signal, it is `gh <subcommand> was stopped by signal S`.
- `GhNotInstalledError` has the message `gh is not installed: the env has no PATH` or `gh is not installed: gh was not found on PATH`.
- `GhLoginError` has the field `account`. Its message is ``gh has no login for the account <account> on github.com: run `gh auth login --hostname github.com` and log in as <account>``, plus `. gh said: <stderr>` when `gh` gave a `stderr`. The token call gives it when it exits with a non-zero code or prints an empty token. A token call that a signal stops gives a `GhError` with an empty `stdout`.

The subcommand of a `GhError` is `args[0]`, plus `args[1]` when `args[1]` exists and does not start with `-`, joined with one space. These are the examples:

- `issue view 7` gives `issue view`.
- `api graphql -f query=...` gives `api graphql`.
- `api -X PATCH repos/a/b` gives `api`.
- `api user` gives `api user`.

## Read an issue

`readGithubIssue(ref, account, env)` reads one issue and resolves with an `Issue`. `ref` is the `IssueRef` of the issue. `account` is the account of the tracker.

An `Issue` has these fields:

- `ref` is the `IssueRef` that the caller gave.
- `title` is the title.
- `body` is the body. It is `""` for a missing body.
- `url` is the url of the issue.
- `labels` holds the label names that GitHub gives.
- `state` is `"open"` or `"closed"`.

The read runs `gh issue view <N> -R <project> --json number,title,body,url,labels,state` through `runGh()`, with the account of the tracker.

The project and the number come from the stored key. `resolveIssueKey()` stores the key as `<project>#<N>`, so the project is `issueTracker.project`, or the repo key when it is not set. See [Issue keys](issue-keys.md). A key that does not split gives the `IssueKeyError` of `splitGithubKey()` before `gh` starts.

`issueState(raw)` maps the state that GitHub gives. `OPEN` gives `"open"`, `CLOSED` gives `"closed"`, and any other state gives `undefined`. `readGithubIssue()` and `readGithubBlockers()` both use it. Each of them builds its own bad output error.

The read gives these errors:

- `IssueReadError` has the field `key`. Its message is `the issue <key> does not exist: <stderr>` when `gh` says that it cannot resolve the issue. A missing repo and the other `gh` failures stay a `GhError`.
- gh 2.101.0 gives a pull request with exit code 0, and in any state. The read finds a pull request from its `url`: the path of an issue is `/<owner>/<repo>/issues/<N>`, and the path of a pull request is `/<owner>/<repo>/pull/<N>`. The message is `<key> is a pull request, not an issue`.
- The message is `gh issue view gave bad output for <key>: <reason>` for output that is not JSON, the wrong fields, a `url` of another form, the wrong number, or a state that is not `OPEN` or `CLOSED`.

### The base branch hint

`baseBranchHint(issue)` reads only the `Issue`, so the read makes no second `gh` call.

- A label that starts with `base:` gives the hint. The match uses case, so `BASE:x` gives no hint.
- The hint is the text after `base:`, without the white space that JavaScript `String.prototype.trim()` removes at the start and the end, for example spaces, tabs and line ends.
- An issue with no such label gives `undefined`.
- One such label with empty text gives a `BaseHintError` that names the label.
- Two or more such labels give a `BaseHintError` that names each label.

The `BaseHintError` has the field `labels`. Its message names each label as JSON text, and names the key of the issue. The function does not check the hint as a branch name. The base branch resolve in `src/vcs/git/` checks the hint.

### The in-progress marker

`inProgressMarker(issue, label)` gives `false` when `label` is `undefined`. Else it gives `true` when the issue has a label equal to `label` after `toLowerCase()` of both names. It does not trim the names.

## Blocking issues

`readGithubBlockers(ref, account, env)` reads every issue that blocks one GitHub issue. It resolves with a list of `Blocker`. A `Blocker` has the fields `key` (`<owner>/<repo>#<N>`) and `state` (`"open"` or `"closed"`, the same type as `Issue.state`). No command uses it yet. M13 uses it to stack a task on the branch of a blocker.

The read runs `gh api graphql` through `runGh()`, with the account of the tracker. The arguments are `-f query=<query>`, `-f owner=<owner>`, `-f name=<repo>`, `-F number=<N>`, and from the second page on `-f cursor=<cursor>`. The first page has no cursor argument. Owner, name and cursor use `-f`. Only `number` uses `-F`, because the query needs an `Int`. See [runGh()](#rungh) for the rule.

The query asks for `blockedBy(first: 100, after: $cursor)`. For each blocker it asks for `number`, `state` and `repository { nameWithOwner }`. It also asks for `pageInfo { hasNextPage endCursor }`. The code reads every page, one call after the other. A page with `hasNextPage` set to true must have an `endCursor` that no earlier page of the read gave. A cursor that comes again is bad output, so a cycle stops.

The key of a blocker is `<owner>/<repo>#<N>`. When `nameWithOwner` equals the project of the key of the issue, the blocker gets the project spelling of that key, which is the spelling of the configuration. Else it gets the `nameWithOwner` that GitHub gives. The compare uses the same ASCII fold as the issue key resolve. See [Issue keys](issue-keys.md). Each key goes through `splitGithubKey()`.

`issueState()` gives the state of each blocker. The list keeps the order that GitHub gives, page after page. An issue with no blockers gives `[]`. A null `endCursor` with `hasNextPage` set to false is normal.

`gh` exits 1 for a GraphQL error and prints the JSON answer on stdout. After a failed call, the read uses stdout only when it is a JSON object with a `data` key or an `errors` key. Any other failed call stays the `GhError`. Examples are an HTTP 401 with a JSON body such as `Bad credentials`, output that is not JSON, a signal, a login error, and an HTTP error such as 502.

The read checks the answer in this order, and gives an `IssueReadError` with the field `key`:

1. The output is not JSON, is not an object, or has `errors` that is not a list of messages. The message is `gh api graphql gave bad output for <key>: <reason>`.
2. The repo or the issue is null. The message is `the issue <key> does not exist`, plus `: <messages>` when the answer has errors. `<messages>` are the messages of `errors`, joined with `; `. A pull request number gives this error too, because GitHub answers `issue: null` for it.
3. `errors` is not empty. The message is `gh api graphql gave errors for <key>: <messages>`. This holds also when `data` has the wrong shape, for example a null `blockedBy` or a null blocker for a private repo.
4. The shape of `data`, each blocker (a key that does not form a GitHub key, an unknown state) and the cursor. A failure gives the bad output message.

A missing repo gives an `IssueReadError` here, but a `GhError` in `readGithubIssue()`. The GraphQL answer says which part is null. `gh issue view` gives only stderr.

## Writes

`src/issues/github/write.ts` holds three writes to one GitHub issue. Each write makes one `gh` call through `runGh()`, after the token call.

- `assignGithubIssue(ref, assignee, account, env)` runs `gh issue edit <N> -R <project> --add-assignee <assignee>`.
- `markGithubInProgress(ref, label, account, env)` runs `gh issue edit <N> -R <project> --add-label <label>`.
- `markGithubDone(ref, doneLabel, account, env)` runs `gh issue edit <N> -R <project> --add-label <doneLabel>` when `doneLabel` is set. The issue stays open. Without `doneLabel`, it runs `gh issue close <N> -R <project> --reason completed`.

The project and the number come from the stored key, as in [Read an issue](#read-an-issue). The functions take plain strings, not the configuration. The caller passes `issueTracker.assignee`, `issueTracker.inProgressLabel` and `issueTracker.doneLabel`.

The assignee `@me` passes to `gh` as it is. `gh` resolves it to the user of the token, which is the account of the tracker.

The writes read nothing before they write. They rely on these facts of the gh 2.101.0 source:

- `pkg/cmd/issue/close/close.go`: for an issue that is already closed, `gh issue close` prints `! Issue <owner>/<repo>#<N> (<title>) is already closed` to stderr and exits 0. It makes this check before any change.
- `pkg/cmd/pr/shared/editable.go`: `gh issue edit` builds the set of the current assignees. It replaces `@me` with the login of the token user, adds the new login and sends the whole set. An assignee that the issue already has gives the same set, so `gh` exits 0.
- `pkg/cmd/pr/shared/editable_http.go`: `gh issue edit` sends a label through the `addLabelsToLabelable` mutation. It does not read the labels of the issue first. So `gh` has no separate path for a label that the issue already has.
- `api/queries_repo.go`: `gh` finds the label id in the labels of the repo with `strings.EqualFold`, so case does not matter. A name with no match fails with `'<label>' not found`.
- `pkg/cmd/issue/edit/edit.go`: a failed update prints `failed to update <issue url>: <error>` to stderr. Then `gh` prints `failed to update 1 issue` and exits 1.

As a result, exit 0 is success and the code has no special case. The label must exist on GitHub. The writes do not create it. The code passes the label as it is.

The in-progress marker is a label only. GitHub Projects (v2) columns are not supported.

The writes give these errors:

- A label write is `markGithubInProgress()`, and `markGithubDone()` with `doneLabel`. It turns each `GhError` of its `gh issue edit` call into an `IssueWriteError`. This covers any non-zero exit code and a signal.
- `IssueWriteError` has the fields `key` and `configKey`. `configKey` is `issueTracker.inProgressLabel` or `issueTracker.doneLabel`. The message holds the message of the `GhError`, which holds the stderr of `gh` with the token hidden.
- A failure of the token call passes as it is. It is a `GhLoginError`, or a `GhError` with the subcommand `auth token` after a signal. `GhNotInstalledError` and the `IssueKeyError` of `splitGithubKey()` also pass as they are.
- The assign and the close give no `IssueWriteError`. Each failure of them stays a `GhError`, or the error of the token call.

The message of an `IssueWriteError` is `could not add the label "<label>" of <configKey> to <key>: <GhError message>`. `<label>` is JSON text. For the stderr `failed to update https://github.com/octo/repo/issues/7: 'wip' not found` and `failed to update 1 issue`, the message is:

```
could not add the label "wip" of issueTracker.inProgressLabel to octo/repo#7: gh issue edit failed with exit code 1: failed to update https://github.com/octo/repo/issues/7: 'wip' not found
failed to update 1 issue
```

## Auth status

`authStatus(account, env, { signal })` in `src/issues/github/auth.ts` tells whether `gh` is logged in as the account. It resolves with `{ ok, login?, detail, needsLogin }`. The type `AuthStatus` is in `src/issues/provider.ts`. It runs `gh api user --jq .login` through `runGh()`, so it reads the token as every call does.

- The login is the trimmed stdout. When the login is not empty and equals the account, the result is `ok`. The compare uses `asciiFold()` from `src/issue-key/github.ts` on both sides, the ASCII-only fold of GitHub names. The detail is `gh is logged in as <login>`.
- An empty login gives `ok: false` and `needsLogin: true`, with the detail `gh api user gave no login for the account <account>`.
- Another login gives `ok: false` and `needsLogin: true`, with the login and the detail `the token of the account <account> is for the login <login>`.
- A `GhLoginError`, a `GhError` or a `GhNotInstalledError` gives `ok: false`. The detail is the message of the error. These messages never hold the token.
- `needsLogin` is true only when a new login is the fix. It is true for a `GhLoginError`, an empty login, another login, and a `GhError` of the `gh api user` call with exit code 1 and `(HTTP 401)` in its stderr. It is false for every other result: `ok`, a `GhNotInstalledError`, a `GhError` after a signal, and any other `GhError`, for example an HTTP 502.
- An `AbortError` and every other error are thrown again.

## Doctor checks

`src/issues/github/doctor.ts` holds the doctor checks of the GitHub tracker. No command runs them yet. The `tasker doctor` command gets them from `issueDoctorChecks(config)`, which calls `githubDoctorChecks(repos)` through the provider. A repo is an `IssueDoctorRepo` (in `src/issues/provider.ts`): `{ key, issueTracker }`, where `issueTracker` is the merged configuration. The project is `issueTracker.project`, or the repo key when it is not set. The account is `issueTracker.account`.

Each check uses the shared wrapper `timedCheck()`. [The doctor checks](doctor.md) give its timeout rules. Each check passes its own signal to every `gh` call that it makes, the token call included.

| Check | `name` | `required` | `timeoutMs` | Runs |
| --- | --- | --- | --- | --- |
| Version | `gh version` | true | 5000 | once, first |
| Auth | `gh auth: <account>` | true | 15000 | once for each distinct account |
| Project | `gh project: <key>` | true | 15000 | once for each github repo |
| Labels | `gh labels: <key>` | true | 15000 | once for each github repo |

`githubDoctorChecks()` gives the checks in this order. The version check runs once, first, and only when at least one repo uses the github tracker. A list with no github repo gives `[]`. Then there is one auth check for each distinct account, in the order of first use. The match is exact, the same as the token cache. Then, for each github repo in the order of the configuration, there is the project check and then the labels check.

### Version

The check runs `readGhVersion()` and reads the first line, without a `\r` at its end. The line must match `gh version <major>.<minor>.<patch>`. The check compares the three numbers as numbers with 2.40.0. It ignores a suffix right after the patch number, for example `-rc.1` or `-12-gabc`, so `2.40.0-rc.1` counts as 2.40.0. The version in the detail is the whole word after `gh version `.

- `gh` is not installed: `error`, with the remediation `Install gh 2.40.0 or newer.`
- A line that does not match: `error`, with the detail `cannot read the gh version from: <line>`.
- A version older than 2.40.0: `error`, with the same remediation.
- Otherwise: `ok`, with the detail `gh <version> (minimum 2.40.0)`.

The minimum is 2.40.0 because `gh auth token` has the `--user` flag from that version. The source file `pkg/cmd/auth/token/token.go` has the flag at the tag `v2.40.0`, and has no flag at `v2.39.2`. The release notes of 2.40.0 add multi-account support.

### Auth

The check runs `authStatus()`. A status that is `ok` gives `ok`. A status that is not `ok` gives `error` with the detail of the status. Only a status with `needsLogin` also gets the remediation ``Run `gh auth login --hostname github.com` and log in as <account>.`` [Auth status](#auth-status) gives the rule for `needsLogin`.

### Project

The check runs `gh repo view <project> --json nameWithOwner` through `runGh()`. Success gives `ok`. Only a `GhError` of the `gh repo view` call itself, with an exit code, gives `error` with the project detail and a remediation that names `issueTracker.project` of the repo. Every other error gives `error` with its message and no remediation, or the timeout result after an abort. Examples are a failed token call, `gh` not installed, and a stop by a signal.

### Labels

The check reads only the labels that tasker writes:

1. `issueTracker.inProgressLabel`, when `updateOnStart` is true and the label is set. A missing label gives `error`, because `tasker start` fails.
2. `issueTracker.doneLabel`, when `updateOnFinish` is true and the label is set. A missing label gives `warn`, because `tasker finish` only warns.

When no label applies, the check gives `ok` with the detail `<key>: no label to check`, and makes no `gh` call. Else it reads each label, one after the other, with `gh api repos/<project>/labels/<name>`. This is a GET with no fields. The name goes through `encodeURIComponent()`, so a space becomes `%20` and `/` becomes `%2F`. A `+` is not a space in a path. The encode also changes `{` and `}`, so a label name never hits a placeholder that `gh api` fills, such as `{owner}`.

A label that exists gives the line `the label "<name>" of <configKey> exists`. A missing label gives exit code 1 and `(HTTP 404)` in stderr. GitHub gives the same 404 for a repo that does not exist, so the project check of the same repo names the real cause. A missing label gives the line `the label "<name>" of <configKey> does not exist in <project>: <reason>`. Any other error is thrown again, so it becomes the `error` of the check, with its message.

The status is the worst status of the labels. The detail is `<key>:` and then one line for each label, joined with line ends. When a label is missing, the remediation is `Create each missing label in <project> on GitHub, or change <configKey>.` It names both keys when both labels are missing.

### Read-only

The checks never change GitHub. They make only these `gh` calls: `gh --version`, `gh auth token`, `gh api user`, `gh repo view` and a GET of `gh api repos/<project>/labels/<name>`. The check never creates a label.

## Tests

The fake `gh` is in `test/helpers.ts`. It uses shell builtins, and the real `sleep` only for a delay, so the real `gh` can never run.

- `fakeGh(dir, baseEnv, answers, { logEnv })` writes the fake into `<dir>/bin` and returns an env with that folder as the only `PATH` folder. It also returns `calls()`, `unanswered()` and `assertAnswered()`.
- `writeFakeGh()` writes the fake without vitest hooks, so a child process can use it.
- `ghTokenAnswer(account, token)` is the answer of the token call.

Each answer names the whole argument list. It must match exactly, in order. The first matching answer wins. An answer can set `stdout`, `stderr`, `exitCode`, `killWith` and `delaySeconds`. `killWith` is a signal name: the fake prints its output, then stops itself with that signal. `delaySeconds` makes the fake run the real `sleep` by its absolute path for that many seconds before it prints.

A call with no answer exits with 99 and goes into `unanswered()`. It fails the test, also when the code under test catches the error.

`test/issues/github/run.test.ts` calls `vi.resetModules()` and imports `run.ts` again before each test, so each test starts with an empty token cache. `test/issues/github/write.test.ts`, `test/issues/github/auth.test.ts`, `test/issues/github/doctor.test.ts` and `test/issues/github/provider.test.ts` do the same. The token cache of `runGh()` stays the one home of the token read. `auth.test.ts` tests `auth.ts`, and `doctor.test.ts` tests `doctor.ts`. `test/doctor/timed-check.test.ts` tests the shared wrapper.

`test/issues/issue.test.ts`, `test/issues/github/issue.test.ts` and `test/issues/github/blockers.test.ts` test the new files. `test/issues/github/write.test.ts` tests `write.ts`.

`test/issues/github/provider.test.ts` tests `createGithubProvider()`. It compares each member with a direct call of its GitHub function. `test/issues/provider.test.ts` tests `issueProviderFor()` and `issueDoctorChecks()`. It needs no reset hook, because each test builds its own configuration object with `parseConfig()`, so no provider leaks between tests.
