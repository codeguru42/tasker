# Jira

## The Jira folder

All code that starts `acli`, the command-line tool of Atlassian, is in `src/issues/jira/`. No file outside `src/issues/`
imports from it. A [boundary test](code-conventions.md#tests) enforces both rules.

tasker talks to Jira only through `acli`. It does not call the Jira REST API, and it stores no Jira credential.

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

## The active site

`acli` has no flag that picks a site for one call. Each call uses the active site of `acli`, which the user picks with
`acli jira auth switch --site <site>`. `activeSite()` in `src/issues/jira/site.ts` reads the active site with
`acli jira auth status`.

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

ADF (Atlassian Document Format) is the JSON tree that Jira Cloud uses for the description of an issue. `adfToText()` in
`src/issues/jira/adf.ts` turns an ADF document into plain text. It starts no `acli` call. The text of `null` or
`undefined` is `""`, and an issue with no description gives this input. Any other input must be a `doc` node with a
`content` array. Otherwise, `adfToText()` throws `AdfError`.

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
`acli jira workitem view <key> --json --fields summary,description,labels,status,components`.

The call names these five fields and no other field. The reason: `--fields` replaces the default field list of `acli`,
and a field that the call does not name does not come back.

The function builds the `Issue` as this table says:

| Field of `Issue` | Value                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `ref`            | The `IssueRef` of the call.                                                                                |
| `title`          | `fields.summary`.                                                                                          |
| `body`           | `adfToText(fields.description)` of `src/issues/jira/adf.ts`.                                               |
| `url`            | `https://<site>/browse/<key>`. `<site>` is the site that the site guard gives.                             |
| `labels`         | Each string in `fields.labels`. The function drops a value that is not a string.                           |
| `components`     | The string `name` of each entry in `fields.components`. The function drops an entry with no string `name`. |
| `status`         | The string `fields.status.name`. For an issue with no such string: undefined.                              |
| `state`          | For `fields.status.statusCategory.key` `"done"`: `"closed"`. For any other key, or no status: `"open"`.    |
| `comments`       | `[]`. A later ticket reads the comments.                                                                   |

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
- An `AdfError` for the description gives `IssueReadError` with the message
  `the description of <key> is not an ADF document: <message of the AdfError>`.
- Each other error passes through unchanged, for example an error of the site guard, a missing `acli` or another
  `AcliError`.

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
because the agent must not log out.

## The measure of an ADF description

The [fact test](plan-review.md#the-fact-test) measured `acli` version `1.3.39-stable`. Two commands made and read an
issue:

- `acli jira workitem create --project TEST --type Task --summary "tasker #541 ADF measure" --description-file description.json`
- `acli jira workitem view TEST-1 --json --fields description`

`--description-file` took the file as ADF, not as plain text. The `--json` output is one JSON object, and the ADF
document is the value of `fields.description`. The read gave back the nodes, marks and attrs of the file.

## The measure of an issue read

The [fact test](plan-review.md#the-fact-test) measured `acli` version `1.3.39-stable` on 2026-10-25. The agent of #543
made three issues in the project `TEST`:

- `TEST-2`, with the labels `base:main` and `tasker-measure` and the component `tasker-measure`.
- `TEST-3`, with no description.
- `TEST-4`, in the status `Done`.

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

The [fact test](plan-review.md#the-fact-test) measured `acli` version `1.3.39-stable` on 2026-10-30. The agent of #545
made these links for the issue `TEST-9` of the project `TEST`:

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
