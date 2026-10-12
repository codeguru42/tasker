# Issue trackers

`src/issues/` holds the issue tracker code. No command uses this code yet. `tasker start` uses it in M4. `tasker start` uses the assign and the in-progress write in M10, and `tasker finish` uses the done write in M10.

## The GitHub folder

All code that starts `gh` is in `src/issues/github/`. The test `test/issues/github/boundary.test.ts` enforces this rule with the source scan of `test/helpers.ts`. The test fails when a file outside `src/issues/github/` loads `child_process` or imports `src/process/run-child.ts`, and has a string literal that is `gh` or starts with `gh `. The scan has two known gaps. It cannot find a module name that the code builds at run time. It cannot find a command name that the code builds at run time.

## The files of src/issues/

- `src/issues/github/run.ts` holds `runGh()`, `RunGhOptions`, `GhError`, `GhNotInstalledError` and `GhLoginError`.
- `src/issues/issue.ts` holds `Issue`, `Blocker`, `IssueReadError`, `IssueWriteError`, `BaseHintError`, `baseBranchHint()` and `inProgressMarker()`.
- `src/issues/github/issue.ts` holds `readGithubIssue()` and `issueState()`.
- `src/issues/github/blockers.ts` holds `readGithubBlockers()`.
- `src/issues/github/write.ts` holds `assignGithubIssue()`, `markGithubInProgress()` and `markGithubDone()`.

Later issues add their files to this list.

## runGh()

`runGh(args, { account, env })` takes the arguments of `gh` (the subcommand first) and resolves with the stdout of `gh`. The stdout is as `gh` printed it, not trimmed. `args` must not be empty, and `args[0]` must not start with `-`.

`runGh()` starts `gh` through `runChild()` in `src/process/run-child.ts`.

`gh` gets no input stream. Its output goes to pipes, never to the terminal. `runGh()` writes nothing to the console or a log. `gh` runs in the cwd of tasker. Each call that acts on a repo must name the repo (`--repo <project>`, `-R <project>`, or the full path in `gh api repos/<owner>/<repo>/...`), because `runGh()` removes `GH_REPO`, and without a repo gh reads the repo from the git folder of its cwd.

`runGh()` has no `signal` option and no `cwd` option.

A `gh api` call sends a string value with `-f` and only a number with `-F`. `-F` turns digits, `true`, `false` and `null` into JSON types. A string such as a name of only digits, or `true`, then has the wrong type, and GitHub refuses the variable. `-f` always sends a string.

## The token

Before the first call of an account, `runGh()` reads its token with `gh auth token --hostname github.com --user <account>`. With `--user`, gh 2.101.0 ignores `GH_TOKEN`. tasker reads the token one time for each account in one process. Two calls at the same time for one account start one token call. A failed read is not kept, so the next call reads the token again. The environment of the token call is in [The environment](#the-environment).

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

## Tests

The fake `gh` is in `test/helpers.ts`. It uses shell builtins only, so the real `gh` can never run.

- `fakeGh(dir, baseEnv, answers, { logEnv })` writes the fake into `<dir>/bin` and returns an env with that folder as the only `PATH` folder. It also returns `calls()`, `unanswered()` and `assertAnswered()`.
- `writeFakeGh()` writes the fake without vitest hooks, so a child process can use it.
- `ghTokenAnswer(account, token)` is the answer of the token call.

Each answer names the whole argument list. It must match exactly, in order. The first matching answer wins. An answer can set `stdout`, `stderr`, `exitCode` and `killWith` (a signal name: the fake prints its output, then stops itself with that signal).

A call with no answer exits with 99 and goes into `unanswered()`. It fails the test, also when the code under test catches the error.

`test/issues/github/run.test.ts` calls `vi.resetModules()` and imports `run.ts` again before each test, so each test starts with an empty token cache. `test/issues/github/write.test.ts` does the same.

`test/issues/issue.test.ts`, `test/issues/github/issue.test.ts` and `test/issues/github/blockers.test.ts` test the new files. `test/issues/github/write.test.ts` tests `write.ts`.
