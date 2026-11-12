# Issue trackers

`src/issues/` holds the issue tracker code.

## The GitHub folder

The shared `gh` process boundary is in `src/github/` (see [GitHub process boundary](github.md)). The tracker operations
are in `src/issues/github/`. No file outside `src/issues/` imports from the tracker folder, and a command gets a
provider from the registry (see [The issue provider](#the-issue-provider)). A [boundary test](code-conventions.md#tests)
enforces both rules. The Jira tracker has its own folder, as [The Jira folder](jira.md#the-jira-folder) of jira.md says.

## The issue provider

Each member of the provider maps to one function of its tracker, GitHub or Jira, and adds no behavior.

- The caller reads `updateOnStart` and `updateOnFinish` to decide if it calls a write at all. The provider does not read
  them.
- `parse` takes the project, because one provider object serves many repos. It is the key parser itself, not a wrapper.
  [Issue keys](issue-keys.md) gives the rules.
- The Jira `baseBranchHint` gives the value of the base branch field of the issue, as
  [the base branch hint](jira.md#the-base-branch-hint) of jira.md says.

The field `comments` of `Issue` gives each comment of the issue with its author, its time and its body, from the oldest
to the newest.

### The registry

The registry is the only place that reads `issueTracker.provider`. One configuration object gives one provider for each
GitHub account. It gives the Jira provider to a Jira repo, with one provider for each site.

- Limit: a caller that changes a configuration object after the first call gets the old provider.

## runGh()

The shared executable selection, child start and output capture are in [GitHub process boundary](github.md).

An abort stops the call. It also stops the token call under the rule in [The token](#the-token). The version read makes
no token call, because the version needs no login.

A `gh api` call sends a string value with `-f` and only a number with `-F`. `-F` turns digits, `true`, `false` and
`null` into JSON types. A string such as a name of only digits, or `true`, then has the wrong type, and GitHub refuses
the variable. `-f` always sends a string.

## The token

Before the first call of an account, tasker reads its token with `gh auth token --hostname github.com --user <account>`.
With `--user`, gh 2.101.0 ignores `GH_TOKEN`.

Never call `gh auth token` with an empty user. With `--user ""`, gh 2.101.0 falls back to the active account and prints
its token.

- tasker reads the token one time for each account in one process. Concurrent calls share one read. A failed read is not
  kept, so the next call reads the token again.
- A caller with no signal never stops the read.
- A caller whose signal aborts rejects at once. The other callers keep waiting.
- When the last waiter leaves by an abort, the read stops and leaves the cache. As a result, a later caller starts a new
  read and never joins a stopped one.

The token call uses the tracker environment in [GitHub process boundary](github.md#tracker-environment).

## Tracker environment

The shared environment rules are in [GitHub process boundary](github.md#tracker-environment). Each tracker operation
that acts on a repo names the project in its arguments. As a result, `gh` does not select a repo from the git folder of
its working directory.

## The errors

Tracker errors have no `cause`. The shared credential-removal rule is in
[GitHub process boundary](github.md#results-and-errors).

## Read an issue

The project and the number come from the stored key, so the stored spelling is used. See [Issue keys](issue-keys.md).

The field `components` of `Issue` gives the component names, as the tracker gives them. The GitHub read gives `[]`. The
field `status` of `Issue` gives the name of the status, as the tracker gives it. The GitHub read gives no status.

gh 2.101.0 gives a pull request with exit code 0, and in any state. So the read finds a pull request from the path of
its `url`: `/<owner>/<repo>/issues/<N>` for an issue and `/<owner>/<repo>/pull/<N>` for a pull request.

A missing repo stays a gh error here, because `gh issue view` gives only stderr.

### The base branch hint

The hint reads only the issue, so there is no second `gh` call. The read does not check the hint as a branch name. The
base branch resolve checks it (see [workspaces.md](workspaces.md#base-branch)).

The `base:` prefix matches without regard to case, because GitHub label names are unique without regard to case. Only
the ASCII letters `A` to `Z` fold. The text after the prefix keeps its case, because branch names use case.

## Blocking issues

The read gives every issue that blocks one GitHub issue.

- Only `number` uses `-F`, because the query needs an `Int` (see [runGh()](#rungh)).
- A cursor that comes again is bad output, so a cycle stops.
- The blocker key gets the spelling of the configuration when its repo is the project of the issue. The compare uses the
  same ASCII fold as the issue key resolve.
- `gh` exits 1 for a GraphQL error and prints the JSON answer on stdout. So the read uses stdout after a failure only
  when it is a JSON object with a `data` key or an `errors` key.
- GitHub answers `issue: null` for a pull request number.
- The GraphQL answer says which part is null. So a missing repo is an issue read error here, but a gh error in the issue
  read.

## Writes

The Jira writes are in [The writes](jira.md#the-writes).

The writes read nothing before they write. They rely on these facts of the gh 2.101.0 source:

- `pkg/cmd/issue/close/close.go`: for an issue that is already closed, `gh issue close` prints
  `! Issue <owner>/<repo>#<N> (<title>) is already closed` to stderr and exits 0. It makes this check before any change.
- `pkg/cmd/pr/shared/editable.go`: `gh issue edit` builds the set of the current assignees. It replaces `@me` with the
  login of the token user, adds the new login and sends the whole set. An assignee that the issue already has gives the
  same set, so `gh` exits 0.
- `pkg/cmd/pr/shared/editable_http.go`: `gh issue edit` sends a label through the `addLabelsToLabelable` mutation. It
  does not read the labels of the issue first. So `gh` has no separate path for a label that the issue already has.
- `api/queries_repo.go`: `gh` finds the label id in the labels of the repo with `strings.EqualFold`, so case does not
  matter. A name with no match fails with `'<label>' not found`.
- `pkg/cmd/issue/edit/edit.go`: a failed update prints `failed to update <issue url>: <error>` to stderr. Then `gh`
  prints `failed to update 1 issue` and exits 1.

As a result, exit 0 is success and the code has no special case. The label must exist on GitHub. The writes do not
create it.

`tasker open-pr` adds `issueTracker.reviewLabel` with the same `gh issue edit --add-label` call after it records the PR.
If that add succeeds, tasker removes `issueTracker.inProgressLabel` when `updateOnStart` is true, the marker label is
set and the task added the marker (`tracker_marked`). If both labels have the same name, tasker leaves the review label
in place. GitHub label names are equal without regard to case, so this also applies when the names differ only in letter
case. tasker adds the review label first because the in-progress marker protects the issue from another start. If the
add fails, tasker warns and leaves the marker. If the marker removal fails, tasker warns and both labels can remain.
Neither failure changes the recorded PR or the task state.

The remove of the in-progress label uses `gh issue edit --remove-label`. The facts below come from a measure of gh
2.101.0 against a fake local HTTPS server:

- The issue has no such label, and the repo has it. `gh` exits 0, prints the issue URL and sends the `IssueByNumber`
  query, the `RepositoryLabelList` query and the `removeLabelsFromLabelable` mutation.
- The issue has the label. `gh` exits 0 and sends the same calls. So `gh` does not read the labels of the issue before
  the remove, and it has no separate path for a label that the issue does not have.
- The repo does not have the label. `gh` sends no mutation, prints `failed to update <issue url>: '<label>' not found`
  and `failed to update 1 issue`, and exits 1.

Limit: the fake server answered the mutation, so nobody measured how GitHub itself answers a remove of a label that the
issue does not have.

The assignee `@me` passes to `gh` as it is. `gh` resolves it to the user of the token, which is the account of the
tracker.

`gh issue edit` splits the value of `--add-label`, of `--remove-label` and of `--add-assignee` on commas (gh 2.101.0).

`gh project item-edit` uses `--owner` to select the board owner and `--url` to name the issue. It uses `--field` to name
the single-select field and `--value` to name its option. GitHub matches field and option names without regard to case.
Two matches make a name ambiguous.

tasker never adds a card to the configured board. The reason: a workflow of a board can add each new issue. An add by
tasker can put an issue on a board that does not track it. A missing card only warns, because the task and the clone are
correct.

Limit: nobody measured the exit code for a missing card, or the oldest gh version with `item-edit --url`.

## Auth status

The compare of the login with the account uses the ASCII-only fold of GitHub names.

`needsLogin` is true only when a new login is the fix. An HTTP 401 of `gh api user` is such a case. An HTTP 502 is not.

## Doctor checks

For the timeout and signal rules, see [doctor.md](doctor.md#the-shared-wrapper). The signal also covers the token call
of each check.

`tasker doctor` asks each tracker once for its doctor checks, with all the repos of that tracker. As a result, the
`gh version` check runs once, and the `gh auth` check runs once for each account of the github repos.

The Jira check is in [The doctor check](jira.md#the-doctor-check) of jira.md.

### Version

The minimum is 2.40.0, because `gh auth token` has the `--user` flag from that version. The source file
`pkg/cmd/auth/token/token.go` has the flag at the tag `v2.40.0`, and has no flag at `v2.39.2`. The release notes of
2.40.0 add multi-account support.

The check ignores a suffix right after the patch number, for example `-rc.1`, so `2.40.0-rc.1` counts as 2.40.0.

### Auth

[Auth status](#auth-status) says when the login remediation applies.

### Project

Only a failure of `gh repo view` itself names `issueTracker.project` in the remediation. Other failures, for example of
the token call, give no project remediation.

### Labels

- A missing in-progress label, done label or review label is a warning, because each write only warns. A missing
  in-progress label makes the in-progress write of each `tasker start` fail. A missing done label makes the done write
  of each `tasker finish` fail. A missing review label makes the review write of each `tasker open-pr` fail and only
  warns. The review label is checked even when `updateOnStart` and `updateOnFinish` are false.
- The name is URL-encoded, so `/` and a space are safe, and `{` and `}` never hit a placeholder that `gh api` fills,
  such as `{owner}`.
- GitHub gives the same 404 for a repo that does not exist, so the project check of the same repo names the real cause.

### Board

The board check reads the configured field and the options used by tasker. It uses `gh project field-list`. Each result
of the check is ok or warn, never error. The reason: a failed card move only warns.

### Read-only

The checks never change GitHub. They make only these `gh` calls: `gh --version`, `gh auth token`, `gh api user`,
`gh repo view`, a GET of `gh api repos/<project>/labels/<name>`, and `gh project field-list`. The check never creates a
label or adds a card.

## Tests

Each test file that uses the tracker token resets its modules before each test, so each test starts with an empty token
cache. The tracker token cache stays in `src/issues/github/run.ts`.

The registry test needs no reset, because each test builds its own configuration object.
