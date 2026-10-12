# Issue trackers

`src/issues/` holds the issue tracker code. No command uses this code yet. `tasker start` uses it in M4.

## The GitHub folder

All code that starts `gh` is in `src/issues/github/`. The test `test/issues/github/boundary.test.ts` enforces this rule with the source scan of `test/helpers.ts`. The test fails when a file outside `src/issues/github/` loads `child_process` or imports `src/process/run-child.ts`, and has a string literal that is `gh` or starts with `gh `. The scan has two known gaps. It cannot find a module name that the code builds at run time. It cannot find a command name that the code builds at run time.

## The files of src/issues/

- `src/issues/github/run.ts` holds `runGh()`, `RunGhOptions`, `GhError`, `GhNotInstalledError` and `GhLoginError`.
- `src/issues/issue.ts` holds `Issue`, `Blocker`, `IssueReadError`, `BaseHintError`, `baseBranchHint()` and `inProgressMarker()`.
- `src/issues/github/issue.ts` holds `readGithubIssue()` and `issueState()`.
- `src/issues/github/blockers.ts` holds `readGithubBlockers()`.

Later issues add their files to this list.

## runGh()

`runGh(args, { account, env })` takes the arguments of `gh` (the subcommand first) and resolves with the stdout of `gh`. The stdout is as `gh` printed it, not trimmed. `args` must not be empty, and `args[0]` must not start with `-`.

`runGh()` starts `gh` through `runChild()` in `src/process/run-child.ts`.

`gh` gets no input stream. Its output goes to pipes, never to the terminal. `runGh()` writes nothing to the console or a log. `gh` runs in the cwd of tasker. Each call that acts on a repo must name the repo (`--repo <project>`, `-R <project>`, or the full path in `gh api repos/<owner>/<repo>/...`), because `runGh()` removes `GH_REPO`, and without a repo gh reads the repo from the git folder of its cwd.

`runGh()` has no `signal` option and no `cwd` option.

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

The read runs `gh api graphql` through `runGh()`, with the account of the tracker. The arguments are `-f query=<query>`, `-f owner=<owner>`, `-f name=<repo>`, `-F number=<N>`, and from the second page on `-f cursor=<cursor>`. The first page has no cursor argument. `-f` always sends a string. `-F` sends `123` as a number and `true` as a Boolean, and GitHub then refuses the variable. A name of only digits, or `true`, is a valid GitHub name, so owner, name and cursor use `-f`. Only `number` uses `-F`, because the query needs an `Int`.

The query asks for `blockedBy(first: 100, after: $cursor)`. For each blocker it asks for `number`, `state` and `repository { nameWithOwner }`. It also asks for `pageInfo { hasNextPage endCursor }`. The code reads every page, one call after the other. A page with `hasNextPage` set to true must have a new `endCursor`.

The key of a blocker is `<owner>/<repo>#<N>`. When `nameWithOwner` equals the project of the key of the issue, the blocker gets the project spelling of that key, which is the spelling of the configuration. Else it gets the `nameWithOwner` that GitHub gives. The compare uses the same ASCII fold as the issue key resolve. See [Issue keys](issue-keys.md). Each key goes through `splitGithubKey()`.

`issueState()` gives the state of each blocker. The list keeps the order that GitHub gives, page after page. An issue with no blockers gives `[]`. A null `endCursor` with `hasNextPage` set to false is normal.

`gh` exits with code 1 for a GraphQL error and prints the JSON answer on stdout. The read uses that JSON when the exit code is a number and stdout is JSON. Any other `gh` failure stays a `GhError`: output that is not JSON, a signal, a login error, or an HTTP error such as 502.

The read checks the answer in this order, and gives an `IssueReadError` with the field `key`:

- The repo or the issue is null. The message is `the issue <key> does not exist`, plus `: <messages>` when the answer has errors. `<messages>` are the messages of `errors`, joined with `; `. A pull request number gives this error too, because GitHub answers `issue: null` for it.
- `errors` is not empty. The message is `gh api graphql gave errors for <key>: <messages>`. This holds also when the answer has data.
- The message is `gh api graphql gave bad output for <key>: <reason>` for output that is not JSON, the wrong fields, a missing `data`, a blocker whose key does not form a GitHub key, an unknown state, or a page that has no new cursor.

A missing repo gives an `IssueReadError` here, but a `GhError` in `readGithubIssue()`. The GraphQL answer says which part is null. `gh issue view` gives only stderr.

## Tests

The fake `gh` is in `test/helpers.ts`. It uses shell builtins only, so the real `gh` can never run.

- `fakeGh(dir, baseEnv, answers, { logEnv })` writes the fake into `<dir>/bin` and returns an env with that folder as the only `PATH` folder. It also returns `calls()`, `unanswered()` and `assertAnswered()`.
- `writeFakeGh()` writes the fake without vitest hooks, so a child process can use it.
- `ghTokenAnswer(account, token)` is the answer of the token call.

Each answer names the whole argument list. It must match exactly, in order. The first matching answer wins. An answer can set `stdout`, `stderr`, `exitCode` and `killWith` (a signal name: the fake prints its output, then stops itself with that signal).

A call with no answer exits with 99 and goes into `unanswered()`. It fails the test, also when the code under test catches the error.

`test/issues/github/run.test.ts` calls `vi.resetModules()` and imports `run.ts` again before each test, so each test starts with an empty token cache.

`test/issues/issue.test.ts`, `test/issues/github/issue.test.ts` and `test/issues/github/blockers.test.ts` test the new files.
