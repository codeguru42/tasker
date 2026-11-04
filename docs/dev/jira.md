# Jira

## The Jira folder

All code that starts `acli`, the command-line tool of Atlassian, is in `src/issues/jira/`. No file outside `src/issues/`
imports from it. A [boundary test](code-conventions.md#tests) enforces both rules.

tasker talks to Jira through `acli`, with one exception. If a repo sets `issueTracker.baseBranchFieldName`, tasker calls
the Jira REST API to look up the id of the field, and the doctor check of the token calls it too. The REST code is in
`src/issues/jira/rest.ts` and `src/issues/jira/field-id.ts`. It uses the global `fetch` of Node. The REST call has its
own token, because `acli` has no command that prints its token.

## runAcli

`runAcli()` is the one function that starts `acli`. It resolves with the stdout of `acli`, not trimmed.

- A call with no argument rejects.
- A call whose first argument starts with `-` rejects. The first argument is the subcommand.
- A call that the next section lists rejects with `AcliRefusedError`, and nothing starts.
- `runAcli()` reads `TASKER_ACLI_BIN` and `PATH` only from the env that the caller passes, never from `process.env`. It
  passes that env to `acli` as it is.
- An env with no `PATH`, or an empty `PATH`, rejects with `AcliNotInstalledError` before `acli` starts.
- `acli` runs in the cwd of tasker. `runAcli()` has no cwd option.
- `acli` gets no input stream. Its stdout and stderr go to pipes, never to the terminal.
- `options.signal` stops `acli` with `SIGTERM` and rejects with an `AbortError`.
- `runAcli()` writes nothing to the console or a log.

## The commands that tasker never runs

`runAcli()` refuses these calls with `AcliRefusedError`:

- `auth login`, `auth logout` and `auth switch`, at any place in the argument list.
- Each call whose first argument is `config`.

The reason: the active site of `acli` is the choice of the user, and each Jira call of tasker uses it.

## TASKER_ACLI_BIN

The variable `TASKER_ACLI_BIN` in the env of the call names the `acli` program. `resolveProgram()` in `src/process/`
holds the rule:

- If the variable is not set or is blank, the program is `acli`.
- If the value has no `/`, the value is a program name. `runAcli()` finds it on the `PATH` of the env.
- If the value has a `/`, the value is a path. A relative path resolves against the cwd of tasker. The path must name a
  file that the user can run. Otherwise, each call fails at once with `AcliBinError`, and tasker does not fall back to
  `acli` on the `PATH`.

`TASKER_ACLI_BIN` does not pass to a child process of a phase. The rule for each `TASKER_` variable in
`src/process/child-env.ts` covers it.

## The Jira API token

`jiraCredentials()` in `src/issues/jira/rest.ts` gives the token and the email of a REST call. It reads only the env
that the caller passes, never `process.env`.

- The token is `TASKER_JIRA_TOKEN` when it is set, else `issueTracker.apiToken`. An empty value or a value of only white
  space counts as not set, by the rule of `isSet()` in `src/config/path.ts`. Without both, the call fails with
  `no Jira API token: set TASKER_JIRA_TOKEN or issueTracker.apiToken`.
- The email is `TASKER_JIRA_EMAIL` when it is set, by the same rule, else `issueTracker.email`, else the email of
  `readLogin()`. Without all three, the call fails with `no Jira email: set TASKER_JIRA_EMAIL or issueTracker.email`.
- In both cases, the lookup fails. `tasker start` stops before the task exists, and `tasker plan` stops.
- The REST call uses the email and the token for basic auth.
- tasker never writes the token or the email in a log, an event, an error message, a report or the doctor output. A
  failed REST call gives the HTTP status, the site and the issue key, never the reply body.
- `TASKER_JIRA_TOKEN` and `TASKER_JIRA_EMAIL` do not pass to a child process of a phase. The rule for each `TASKER_`
  variable in `src/process/child-env.ts` covers them.

## The active site

`acli` has no flag that picks a site for one call. Each call uses the active site of `acli`, which the user picks with
`acli jira auth switch --site <site>`. `activeSite()` in `src/issues/jira/site.ts` reads the active site with
`acli jira auth status`.

`readLogin()` reads the site and the email in one `acli jira auth status` call. The email is the value of the first line
that starts with `Email:` after any leading white space, with the white space around it removed. No such line, or an
empty value, gives no email.

The active site is the value of the first line of stdout that starts with `Site:` after any leading white space. tasker
matches `Site:` with its exact case. tasker removes the white space around the value and folds it to lower case with
`asciiFold()`. A non-zero exit, stdout with no `Site:` line, or an empty value gives `JiraLoginError`. The rule of the
`Site:` line is measured only with one login. The form of the output with more than one login is not measured.

## The site guard

Each Jira call of a repo runs the site guard first. `siteGuard()` in `src/issues/jira/site.ts` compares
`issueTracker.site` of the repo with the active site. If the two sites differ, the guard fails with `JiraSiteError`. A
repo with no site accepts the active site. The reason: an issue key such as `TEST-1` names a different issue on another
site. A call on the wrong site reads or changes the wrong issue.

tasker reads the active site again for each call of the guard. It keeps no value between two calls. The reason: the user
can switch the site of `acli` while tasker runs.

tasker supports repos on more than one site through `issueTracker.site`. The fact tests cover one site and one login
only, and no test covers a switch between two sites.

## The conversion of ADF

ADF (Atlassian Document Format) is the JSON tree that Jira Cloud uses for the description of an issue. It is also the
form of the body of a comment. `adfToText()` in `src/issues/jira/adf.ts` turns an ADF document into plain text. It
starts no `acli` call. The text of `null` or `undefined` is `""`, and an issue with no description gives this input. Any
other input must be a `doc` node with a `content` array. Otherwise, `adfToText()` throws `AdfError`.

Each node is inline or block:

- The inline types are `text`, `hardBreak`, `inlineCard`, `mention`, `media`, `emoji`, `status`, `date` and
  `inlineExtension`.
- Each child of a `paragraph` or a `heading` is also inline.
- Each other node is a block.

The join rule:

- Inline nodes next to each other join with no separator.
- A block has a blank line before it and a blank line after it.
- A block that gives `""` adds no line and no blank line.
- A `listItem` joins its parts with a line end, not with a blank line.

The table of node types follows. The reason: the plan session needs the words of the issue, not its layout.

| Node                                   | Text                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `text`                                 | The value of `text`. The marks do not change it.                                     |
| `hardBreak`                            | A line end.                                                                          |
| `bulletList`                           | One line for each item, in the form `- <text of the item>`.                          |
| `orderedList`                          | One line for each item, in the form `<n>. <text of the item>`.                       |
| `codeBlock`                            | The `text` of its children, with the white space as it is.                           |
| `inlineCard`, `blockCard`, `embedCard` | `attrs.url`.                                                                         |
| `mention`                              | `attrs.text`.                                                                        |
| `media`                                | `[attachment: <alt>]`, else `[attachment: <id>]`, else `[attachment]`.               |
| `rule`                                 | `""`.                                                                                |
| Each other type                        | The join of its children. An unknown node type gives its children and does not fail. |

A value of `attrs` counts only if it is a non-empty string. An `orderedList` starts at `attrs.order` if that is a
number, else at 1. Each later line of an item has as many spaces before it as the marker is wide. An item whose text is
`""` still gives one line: the marker alone, such as `-` or `2.`. It takes a number of an `orderedList`.

A node with no `content` array has no children. A child that is not an object gives `""`. At the end, `adfToText()`
removes the white space at the end of each line and the blank lines at the end of the text.

## The read of an issue

`readJiraIssue()` in `src/issues/jira/issue.ts` reads one issue. It runs the site guard first. Then it runs
`acli jira workitem view <key> --json --fields summary,description,labels,status,components,comment`. If the repo sets
`baseBranchFieldName`, the lookup of the field id runs after the site guard and before this call, and the call adds
`,<field id>` to the list.

The call names only these fields. The reason: `--fields` replaces the default field list of `acli`, and a field that the
call does not name does not come back. As a result, a custom field comes back only for a call that names it.

The function builds the `Issue` as this table says:

| Field of `Issue`  | Value                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref`             | The `IssueRef` of the call.                                                                                                                              |
| `title`           | `fields.summary`.                                                                                                                                        |
| `body`            | `adfToText(fields.description)` of `src/issues/jira/adf.ts`.                                                                                             |
| `url`             | `https://<site>/browse/<key>`. `<site>` is the site that the site guard gives.                                                                           |
| `labels`          | Each string in `fields.labels`. The function drops a value that is not a string.                                                                         |
| `components`      | The string `name` of each entry in `fields.components`. The function drops an entry with no string `name`.                                               |
| `status`          | The string `fields.status.name`. For an issue with no such string: undefined.                                                                            |
| `state`           | For `fields.status.statusCategory.key` `"done"`: `"closed"`. For any other key, or no status: `"open"`.                                                  |
| `comments`        | One entry for each item of `fields.comment.comments`, in the order of the view. See the rule below.                                                      |
| `baseBranchField` | With a field id: `{ id, value }`, where `value` is `fields.<field id>` as the view gives it, or `undefined` for a missing key. With no field id: no key. |

Each comment has three strings. `author` is `author.displayName` when it is a non-empty string. Each other case gives
`unknown`, for example a missing, `null` or non-object `author`. `created` is the time as the view gives it. `body` is
`adfToText()` of the body. The function does not sort the comments. An issue with no comments gives `[]`.

The reason for the `state` row: each team names its own statuses, but the category key `done` is fixed. `tasker start`
refuses a closed issue.

The function does not read other parts of an issue. Examples are the content of the attachments, the sub-tasks, the
parent, the fix versions, the priority, the assignee and the issue type.

The errors of the read:

- An `AcliError` whose stderr holds `Issue does not exist` gives `IssueReadError` with the message
  `the issue <key> does not exist, or you do not have permission to see it: <stderr>`. The reason: Jira gives one text
  for an issue that does not exist and for an issue that the user cannot see.
- Bad output gives `IssueReadError` with the message `acli jira workitem view gave bad output for <key>: <reason>`. The
  reason is `the output is not JSON` or `the fields do not match`.
- `the fields do not match` covers a missing `fields` object and a `fields.summary` that is not a string. It also covers
  a `fields.labels` or `fields.components` that is there, is not `null` and is not an array. A missing or `null`
  `fields.labels` or `fields.components` gives `[]`.
- `the fields do not match` also covers a missing or `null` `fields.comment`, a missing `comments` array or `total`, and
  a `total` that is not a number. It covers an entry that is not an object, and an entry with no string `created`. It
  also covers an entry with no body or a `null` body. The reason for the `null` body: `adfToText(null)` gives `""`, and
  this hides bad output.
- If `fields.comment.comments` holds fewer entries than `fields.comment.total`, the read gives `IssueReadError` with the
  message `acli gave <n> of <total> comments for <key>`. The function keeps each entry of an array that is longer than
  `total`. The code holds no fixed limit.
- An `AdfError` for the body of a comment gives `IssueReadError` with the message
  `comment <n> of <key> is not an ADF document: <message of the AdfError>`. `<n>` counts from 1. The first bad comment
  stops the read.
- An `AdfError` for the description gives `IssueReadError` with the message
  `the description of <key> is not an ADF document: <message of the AdfError>`.
- The checks run in this order: the description, the count of the comments, the bodies of the comments. A bad
  description wins over a short list, and a short list wins over a bad body.
- Each other error passes through unchanged, for example an error of the site guard, a missing `acli` or another
  `AcliError`.

## The lookup of the base branch field

`lookupFieldId()` in `src/issues/jira/field-id.ts` calls `GET https://<site>/rest/api/3/issue/<key>?expand=names`.
`<site>` is `issueTracker.site`, or the active site of `acli` when the repo sets no site. The `names` map of the reply
maps each field id to its name. The id is the one key whose name is equal to `baseBranchFieldName`, with the same case.
No such key, or more than one, fails the lookup with an error that names the field name and the issue key. As a result,
`tasker start` stops before the task exists, and `tasker plan` stops.

The provider keeps the result of the first lookup of each repo, also a failure. As a result, the lookup runs at most one
time for each repo in one process, and a second read of the same repo after a failure gives the same error.
[The measure of a custom field](#the-measure-of-a-custom-field) gives the measured and the unmeasured facts of this
call. The tests use a fake `fetch`.

## The blockers of an issue

`readJiraBlockers()` in `src/issues/jira/blockers.ts` reads the blockers of one issue. It runs the site guard first.
Then it runs `acli jira workitem view <key> --json --fields issuelinks`.

A link counts as a blocker only when it has an `inwardIssue`, it has no `outwardIssue`, and one of these is true:

- `type.name` is `Blocks`.
- `type.inward` is `is blocked by`.

Both compares are exact, with case. The reason that a link with an `outwardIssue` does not count: a link with an
`outwardIssue` means that this issue blocks the other issue.

The function builds each `Blocker` as this list says:

- The `key` is the key of the inward issue, for example `TEST-3`. This is the stored form of a Jira key, so the blocker
  step finds the task of the blocker in the same repo.
- The `state` is `"closed"` for `inwardIssue.fields.status.statusCategory.key` `"done"`. Each other key, and a missing
  status, gives `"open"`.
- An inward issue of another project gives a `Blocker` with its key too. The blocker step finds no task for it in the
  repo, so it counts as open until it is closed.

The list keeps the order of the links that `acli` gives. Two links can name the same inward issue. Then the key comes
one time in the list, at its first place. The reason: the blocker step counts two entries of one ready blocker as two
ready blockers, and it refuses the start.

An issue with no links, or with no `fields.issuelinks`, gives `[]`.

An issue that does not exist and bad output give the messages of [The read of an issue](#the-read-of-an-issue). Here,
the reason `the fields do not match` covers these cases:

- A missing `fields` object.
- A `fields.issuelinks` that is there but is not an array.
- A link that is not an object.
- A link that counts as a blocker, whose `inwardIssue.key` is not a string of the form `<PROJECT>-<N>`.

tasker does not check the inward or the outward issue of another link. The other errors of `acli` and the site guard
pass through unchanged.

## The writes

`src/issues/jira/write.ts` writes to Jira with two `acli` commands. tasker writes nothing else to Jira.

- `assignJiraIssue()` runs `acli jira workitem assign --key <key> --assignee <assignee> --yes --json`.
- `markJiraInProgress()`, `markJiraDone()` and `markJiraAborted()` run
  `acli jira workitem transition --key <key> --status <status> --yes --json`.

Each write runs [the site guard](#the-site-guard) first, so an error of the guard is never an `IssueWriteError`.
`markJiraDone()` then makes sure that the status is set. With no status, it rejects with an `Error` that says
`issueTracker.doneStatus is not set`, and the only `acli` call is `acli jira auth status`.

Each write has the flag `--json`, because `acli` exits with 0 for a refused write.
[The measure of the writes](#the-measure-of-the-writes) shows this. tasker reads the JSON result of the write. A result
with one item in `results` and the `status` `SUCCESS` is a passed write. The code does not read `totalCount`,
`successCount` or `id`.

A failed write is an `IssueWriteError` with the key of the issue and the configuration key of the write. The message is
`could not <action>: <text>`. The action is one of these:

- `assign <key> to "<assignee>"`, with the configuration key `issueTracker.assignee`.
- `move <key> to the status "<status>" of issueTracker.inProgressStatus`.
- `move <key> to the status "<status>" of issueTracker.doneStatus`.
- `move <key> to the status "<status>" of issueTracker.abortStatus`.

The assignee and the status are in `JSON.stringify()` form. The text after `: ` has three cases:

- `acli` failed with an `AcliError`: the message of the `AcliError`.
- The `status` of the one item is not `SUCCESS`: the string `message` of the item, also when it is empty. With no string
  `message`, the text is `acli gave no message`.
- The output is bad: the text is `acli gave bad output`. Bad output is stdout that is not JSON, JSON that is not an
  object, no `results` array, a `results` array that does not hold exactly one item, an item that is not an object, or
  an item with no string `status`.

A transition to the status that the issue has now passes. So a second run of a write gives no warning.

## The in-progress check

`jiraInProgressMarker()` is true when the status of the issue and the configured in-progress status are equal after
`asciiFold()`. It is false when either one is undefined. It makes no `acli` call.

## The base branch hint

`jiraBaseBranchHint()` in `src/issues/jira/hint.ts` gives the base branch hint of a Jira issue from `baseBranchField`.
It makes no `acli` call and no REST call.

- No field id, a missing key or `null` gives no hint.
- An empty string or a string of white space only gives no hint.
- Each other string is the hint, as it is. The function removes no white space, no `origin/` and no `refs/heads/`.
- Each other value throws `BaseBranchFieldError`, a subclass of `BaseHintError`. Its message names the field id and the
  issue key. `tasker start` handles it as it handles a bad `base:` label.

The rules of [the resolve](workspaces.md#the-resolve) apply as they are: the hint must name a remote branch, the resolve
fails for a branch that is not on `origin`, and tasker does not store the hint as the learned default.

## The in-progress clear

The Jira tracker has no clear of the in-progress marker. A status has no "clear". The status after an abort depends on
the workflow of the team. The abort of a Jira task calls no clear. If `abortStatus` is set, it can move the issue, see
[The abort write](#the-abort-write). The `clearInProgress` member of [the provider](#the-provider) rejects with the
message `the jira tracker has no in-progress clear`. Nothing calls it in a run.

## The abort write

If `issueTracker.updateOnStart` is true, `issueTracker.abortStatus` is set and the task has `tracker_marked` set,
`tasker abort` calls `markAborted` of [the provider](#the-provider). The call moves the issue to `abortStatus` with
`markJiraAborted()`. The reason for the `tracker_marked` condition: another machine can work on an issue that this task
did not mark, and its mark must stay. A failed move only warns, and the task still goes to `cancelled`. If one of the
three conditions is false, the abort makes no `acli` call.

If `abortStatus` is a status of the category `done`, tasker reads the aborted issue as closed. The `state` row of
[The read of an issue](#the-read-of-an-issue) and [The blockers of an issue](#the-blockers-of-an-issue) give that rule.
[The row of `abortStatus`](../config.md#issuetracker) gives the result for a user.

## The auth status

`authStatus()` in `src/issues/jira/auth.ts` gives the state of the login of `acli`, from `activeSite()`. `login` is the
active site. `needsLogin` is true when `acli` has no Jira login. A missing `acli` or a bad `TASKER_ACLI_BIN` gives `ok`
false and `needsLogin` false.

## The doctor check

The check `acli auth` in `src/issues/jira/doctor.ts` is one required check for all the Jira repos. It makes one
read-only `acli` call, and it compares the active site with the site of each repo, with the fold of
[the site guard](#the-site-guard). [The shared wrapper](doctor.md#the-shared-wrapper) gives the timeout and signal
rules.

The status is `error` when a Jira repo names another site than the active site. The reason: each Jira call of that repo
fails at the site guard, so the repo cannot work. The detail has one line for each such repo. The remediation names only
the site of the first such repo.

The detail shows no line of the output of `acli` other than the value of the `Site:` line. It never shows the email of
the user. The reason: the output of `acli` holds the email of the user. The doctor output can go into a report.

For each Jira repo that sets `baseBranchFieldName`, the required check `jira token: <repo key>` calls
`GET https://<site>/rest/api/3/myself` with the token and the email. It reports `ok`, or `error` with the HTTP status. A
missing token or a missing email gives `error` with the names of the variable and the key. The check reads the login of
`acli` only when it needs the site or the email. It passes its signal to `fetch`. If the signal aborts, the error of
`fetch` passes to the shared wrapper, so the check gives the timeout result.

## The provider

`createJiraProvider()` in `src/issues/jira/provider.ts` gives the `IssueProvider` of a Jira repo. It passes `site` to
each Jira function that takes it. It runs no site guard itself. One provider serves all the Jira repos of one site. It
reads `baseBranchFieldName`, `apiToken` and `email` of each repo with `settingsOf`. It keeps the result of the first
lookup of the field id of each repo, also a failure.

| Member             | Jira function                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | `"jira"`                                                                                                                            |
| `account`          | `undefined`                                                                                                                         |
| `parse`            | `KEY_PARSERS.jira` of `src/issue-key/resolve.ts`                                                                                    |
| `fetchIssue`       | `readJiraIssue()` of `src/issues/jira/issue.ts`, with the kept lookup of `lookupFieldId()` when the repo sets `baseBranchFieldName` |
| `authStatus`       | `authStatus()` of `src/issues/jira/auth.ts`                                                                                         |
| `baseBranchHint`   | `jiraBaseBranchHint()` of `src/issues/jira/hint.ts`                                                                                 |
| `blockingIssues`   | `readJiraBlockers()` of `src/issues/jira/blockers.ts`                                                                               |
| `assign`           | `assignJiraIssue()` of `src/issues/jira/write.ts`                                                                                   |
| `transitionStatus` | `markJiraInProgress()` of `src/issues/jira/write.ts`                                                                                |
| `inProgressMarker` | `jiraInProgressMarker()` of `src/issues/jira/write.ts`                                                                              |
| `clearInProgress`  | A function that rejects with the `Error` `the jira tracker has no in-progress clear`                                                |
| `markDone`         | `markJiraDone()` of `src/issues/jira/write.ts`                                                                                      |
| `markAborted`      | `markJiraAborted()` of `src/issues/jira/write.ts`                                                                                   |
| `doctorChecks`     | `jiraDoctorChecks()` of `src/issues/jira/doctor.ts`                                                                                 |

## The errors

- `AcliError`: `acli` exited with a code other than 0, or a signal stopped it. It holds the subcommand, the stdout, the
  stderr and the exit code. The exit code is `null` when a signal stopped `acli`. `subcommandOf()` in
  `src/process/run-child.ts` gives the subcommand, for example `jira workitem` for `jira workitem view TEST-1`.
- `AcliNotInstalledError`: `acli` was not found. The message names the program that `runAcli()` tried to start.
- `AcliBinError`: `TASKER_ACLI_BIN` names a file that does not exist, a folder, or a file that the user cannot run.
- `AcliRefusedError`: the call is one that tasker never runs.
- `AdfError`: the input of `adfToText()` is not an object with `type` equal to `"doc"` and a `content` array.
- `JiraLoginError`: `acli` has no Jira login. `acli jira auth status` exited with a code other than 0, or its stdout has
  no `Site:` line or an empty value.
- `JiraSiteError`: the site of the repo differs from the active site.
- `JiraCredentialError`: no token or no email for a REST call. The message names the variable and the key.
- `JiraRestError`: a REST call failed. It holds the HTTP status, or no status when no answer came. The message names the
  site and the issue key or the check, never the reply body.
- `JiraFieldError`: no field, or more than one field, of the issue has the name of `baseBranchFieldName`.
- `IssueWriteError`: a write failed. [The writes](#the-writes) give the messages.
- `IssueReadError`: the read of an issue or of its blockers failed. [The read of an issue](#the-read-of-an-issue) and
  [The blockers of an issue](#the-blockers-of-an-issue) give the messages.

## The measure of a failed call

The [fact test](plan-review.md#the-fact-test) measured `acli` version `1.3.39-stable`. The command
`acli jira workitem view TEST-999999 --json` asks for an issue that does not exist. It gives:

- Exit code 1.
- An empty stdout.
- On stderr: `✗ Error: Issue does not exist or you do not have permission to see it.`

## The measure of the login

The [fact test](plan-review.md#the-fact-test) measured `acli` version `1.3.39-stable` with one login on 2026-10-25.
`acli jira auth status` gives exit code 0, an empty stderr and this stdout:

```
✓ Authenticated
  Site: codeguru42.atlassian.net
  Email: <the email of the user>
  Authentication Type: oauth_global
```

The help of `acli jira auth switch` gives `--site` as its flag for the site. Nobody measured the output with no login,
because the task subagent must not log out.

## The measure of an ADF description

The [fact test](plan-review.md#the-fact-test) measured `acli` version `1.3.39-stable`. Two commands made and read an
issue:

- `acli jira workitem create --project TEST --type Task --summary "tasker #541 ADF measure" --description-file description.json`
- `acli jira workitem view TEST-1 --json --fields description`

`--description-file` took the file as ADF, not as plain text. The `--json` output is one JSON object, and the ADF
document is the value of `fields.description`. The read gave back the nodes, marks and attrs of the file.

## The measure of an issue read

The [fact test](plan-review.md#the-fact-test) measured `acli` version `1.3.39-stable` on 2026-10-25. The task subagent
of #543 made three issues in the project `TEST`:

- `TEST-2`, with the labels `base:main` and `tasker-measure` and the component `tasker-measure`.
- `TEST-3`, with no description.
- `TEST-4`, in the status `Done`.

`acli` has no command for a component. The task subagent of #543 made `TEST-2` with
`acli jira workitem create --from-json <file>`. The field `additionalAttributes.components` of the file held
`[{"name": "tasker-measure"}]`. The project `TEST` had no component before this command. Jira made the component
`tasker-measure` (id 10000) with the issue.

The command `acli jira workitem view <key> --json --fields summary,description,labels,status,components` read each
issue. It gave:

- Exit code 0, an empty stderr and one JSON object on stdout.
- Only the five named fields in `fields`.
- For `fields.labels`, an array of strings. For `fields.components`, an array of objects with `id`, `name` and `self`.
- For an issue with no labels or no components, `[]`.
- For `fields.description` of `TEST-3`, `null`.
- For `fields.status.name`, `Backlog` for `TEST-2` and `TEST-3`, and `Done` for `TEST-4`.
- For `fields.status.statusCategory.key`, `new` for `Backlog` and `done` for `Done`.

## The measure of the blockers

The [fact test](plan-review.md#the-fact-test) measured `acli` version `1.3.39-stable` on 2026-10-30. The task subagent
of #545 made these links for the issue `TEST-9` of the project `TEST`:

- `acli jira workitem link create --out TEST-9 --in TEST-6 --type Blocks --yes`
- `acli jira workitem link create --out TEST-9 --in TEST-4 --type Blocks --yes`
- `acli jira workitem link create --out TEST-7 --in TEST-9 --type Blocks --yes`
- `acli jira workitem link create --out TEST-9 --in TEST-8 --type Relates --yes`

The command `acli jira workitem view TEST-9 --json --fields issuelinks` gave:

- Exit code 0, an empty stderr and one JSON object on stdout.
- For `fields.issuelinks`, an array with one object for each link, in the order of the creates.
- In each link, either `inwardIssue` or `outwardIssue`. The key of the other side is missing.
- For `type` of a `Blocks` link, the `name` `Blocks`, the `inward` `is blocked by` and the `outward` `blocks`. For a
  `Relates` link, the `name` `Relates`, and `relates to` for `inward` and `outward`.
- In `inwardIssue`, the `key` and `fields.status.statusCategory.key`: `new` for `TEST-6` and `TEST-8`, `done` for
  `TEST-4`.

The issue `TEST-3` has no links, and the same command gives `[]` for `fields.issuelinks`. `TEST-999999` gives the stderr
of [The measure of a failed call](#the-measure-of-a-failed-call). With no `--fields`, the output has no `issuelinks`.

`--out A --in B --type Blocks` makes the link "B blocks A", but `acli` prints `A Blocks B`. `TEST-6` and `TEST-4` are in
`inwardIssue` of `TEST-9`. The Jira search `issue in linkedIssues("TEST-9", "is blocked by")` also gave `TEST-6` and
`TEST-4`.

## The measure of the comments

The [fact test](plan-review.md#the-fact-test) measured `acli` version `1.3.39-stable` on 2026-10-31 on the issue
`TEST-11`. The call is
`acli jira workitem view TEST-11 --json --fields summary,description,labels,status,components,comment`. It gave exit
code 0, one JSON object on stdout and an empty stderr.

With 60 comments, `fields.comment` has 60 entries, `"maxResults": 60`, `"startAt": 0` and `"total": 60`. The ids are
10000 to 10059, oldest first. With 1,010 comments, it has the newest 100 entries, `"maxResults": 100`, `"startAt": 910`
and `"total": 1010`. The ids are 10910 to 11009, oldest first of those 100. The stdout of 100 comments had 320601 bytes.
`--fields '*all'` gives the same 100 entries. Without `--fields`, the view gives no `comment` field.

Nobody measured a count between 60 and 1,010. The expected limit is 100 entries, and the code does not hold it. As a
result, tasker cannot read an issue with more comments than the view gives, and `tasker start` and `tasker plan` fail
for it. The read fails for a short list, so that a plan never runs on a part of the comments without a word. The user
chose this failure, because an issue with that many comments is unlikely.

Each entry has `author`, `body`, `created`, `id`, `jsdPublic`, `self`, `updateAuthor` and `updated`. `author` is an
object, and its `displayName` is the name. `body` is a full ADF document. The `author` object also holds personal
fields. Nobody measured a comment of a deleted user. The `displayName` of such an entry can be missing.

`acli jira workitem comment list --key TEST-11 --json --paginate` gave all 1,010 comments in 22 JSON documents, one for
each page, with a last empty page. Each entry has `author` (a string), `body` (a flat string), `id` and `visibility`. It
has no `created`. The flat body of comment 3 lost its bullet list. For these reasons, tasker does not use
`comment list`.

`acli jira workitem search --jql "key = TEST-11" --fields comment --json` gives
`✗ Error: field 'comment' is not allowed`. An issue with no comments gives
`{"comments": [], "maxResults": 0, "startAt": 0, "total": 0}` for `fields.comment`.

## The measure of the writes

The [fact test](plan-review.md#the-fact-test) measured `acli` version `1.3.39-stable` on 2026-10-30. The task subagent
of #546 made the issue `TEST-10` of the project `TEST` with
`acli jira workitem create --project TEST --type Task --summary "tasker #546 assign and transition measure" --json`. Its
first status was `Backlog`. Stderr was empty in each case, and the exit code was 0 in each case.

- Assign with `acli jira workitem assign --key TEST-10 --assignee @me --yes`: the stdout is
  `✓ Work item TEST-10 has been successfully assigned to <the email of the user>`. A second assign gave the same line.
- The same command with `--json` gave
  `{"results":[{"status":"SUCCESS","message":"Work item TEST-10 has been successfully assigned to <the email of the user>","id":"TEST-10"}],"totalCount":1,"successCount":1}`.
- An allowed transition from `Backlog` with `acli jira workitem transition --key TEST-10 --status "In Progress" --yes`
  gave `✓ Work item TEST-10 has been successfully transitioned to In Progress`.
- A refused transition from `In Progress` with `--status "No Such Status"`, and the same with
  `--status "Awaiting deploy"`, gave
  `✗ Failure: TEST-10 can't be transitioned: No allowed transitions found for given status`. With `--json`, the
  `--status "No Such Status"` call gave
  `{"results":[{"status":"FAILURE","message":"No allowed transitions found for given status","id":"TEST-10"}],"totalCount":1,"successCount":0}`.
- A transition to the current status, `--status "In Progress"` while the status was `In Progress`, gave the success line
  of the allowed transition. With `--json`, it gave
  `{"results":[{"status":"SUCCESS","message":"Work item TEST-10 has been successfully transitioned to In Progress","id":"TEST-10"}],"totalCount":1,"successCount":1}`.
- A refused assign with `--assignee nobody-546@example.invalid --yes` gave
  `✗ Failure: TEST-10 can't be assigned: unexpected error, trace id: <id>`. With `--json`, it gave
  `{"results":[{"status":"FAILURE","message":"unexpected error, trace id: <id>","id":"TEST-10"}],"totalCount":1,"successCount":0}`.

More facts:

- After each refused call, the status or the assignee of `TEST-10` stayed as it was.
- `--status "in progress"` from `In Progress` also exited with 0. Its stdout repeated the lower-case text.
- `--status "Selected for Development"` from `In Progress` passed.

The limit: the refused transitions used only names that the workflow of `TEST` does not offer. The task subagent found
no status of that workflow that the workflow refuses.

## The measure of a custom field

The user measured these facts on a real Jira site on 2026-11-02, in a comment on #476:

- The id of the field "Release Branch" was `customfield_10744` on that site. The id can differ on another site.
- The value is a plain JSON string, for example a bare branch name of the form `release/<name>`.
- A field with no value gives `null`, and the key of the field stays in `fields`.
- `acli jira workitem view <key> --fields 'key,<field id>' --json` gives the value at `fields.<field id>`.
  `--fields '*all'` also gives the field.
- `acli` gives no field names. In the JSON of `workitem view`, `names` is `null` or empty, and `acli jira field` has no
  list or view command.
- `acli jira workitem search --fields 'key,<field id>'` fails with `field '<field id>' is not allowed`.
- The Atlassian MCP tool `getJiraIssue` with `expand: names` and `fields: ["*all"]` gave a `names` map from each field
  id to its name. The user read it on issues of three projects. The comment says that
  `GET /rest/api/3/issue/<key>?expand=names` gives the same data.

The task subagent of #476 measured `acli` version `1.3.39-stable` on the test site on 2026-11-03. It ran
`acli jira field create --name "Release Branch" --type "com.atlassian.jira.plugin.system.customfieldtypes:textfield"`.
The command made the field `customfield_10044`. The field did not show on `TEST-1`, `TEST-2` or `TEST-9`, also with
`--fields '*all'`. `acli jira workitem edit` has no way to set a custom field.

As a result, nobody measured the read of a value on the test site. Nobody measured the REST lookup of
[The lookup of the base branch field](#the-lookup-of-the-base-branch-field) with tasker. Nobody measured whether a
context or a screen of the field makes it show on an issue. Nobody measured whether the field `additionalAttributes` of
`acli jira workitem create --from-json` sets a custom field.
[The measure of an issue read](#the-measure-of-an-issue-read) gives that command for a component.

The field `customfield_10044` ("Release Branch") stays on the test site by the choice of the user on 2026-11-03. No
session asks the user again to delete the field. A later measure of a custom field on the test site can use the field.
