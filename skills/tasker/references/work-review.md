# Work review commands

These commands review the work, dismiss findings, accept the work and print a review. [Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share. [The task of a show command](../SKILL.md#the-task-of-a-show-command) and [the number rule](../SKILL.md#the-number-rule) apply to `show-review`. [The Work review section of docs/statemachine.md](../../../docs/statemachine.md#work-review) gives the states.

## `tasker review`

Reviews the committed work of a task in the state `awaiting_work_review` in a new session of the assistant, and records the findings: `tasker review <issue>`. The task goes through `reviewing` to `reviewed`. When the review has no findings, the task goes back to `awaiting_work_review`.

Each review runs in a new session with the model of the review role. The review is an independent pass, and the conversation of the plan does not bias it. The assistant runs in plan mode in the worktree of the task. The time limit is the value of `planTimeoutMin`.

The prompt holds the commits of the task branch and the text of the earlier reviews. Each earlier review shows its findings with their status, and the operator feedback of each plan revision that followed it.

The findings wait in `reviewed`, because the operator reads them first. The command records the tip of the task branch as the revision of the review, because the findings describe one tree. An uncommitted change or a commit that is not on the task branch does not count, as for [`tasker accept`](#tasker-accept).

Each review gets a number. The first review of a task is review 1, and a later review gets the next number. tasker records the session of each review. No command continues it yet.

On success, the command prints these lines on stdout:

- `reviewed <issue key>: review <N>, <count>`. The count is `no findings`, `1 finding` or `<n> findings`.
- The findings. Each finding has three lines: `- [<position>] <file>:<line> (<category>): <summary>`, `failure scenario: <text>` and `status: open`. With no findings, the line is `no findings`.
- `prompt: <path>`, the archived prompt.
- `transcript: <path>`, the file `transcripts/review-<N>.jsonl`.

The command stops with exit code 1 and prints the error on stderr in these cases.

These errors leave the task in its state. The command writes no event, no session and no transcript. The shared errors of no task, of [the wrong state](../SKILL.md#shared-errors) and of the task lock belong to this group:

- The task has no worktree, no branch or no base revision. The error is `the task of <issue key> has no worktree`, `the task of <issue key> has no branch` or `the task of <issue key> has no base revision`.
- The clone has no such task branch, or git cannot read the tip of the branch. The error is `cannot resolve the task branch: <branch>` or the error of git.
- The commits of the branch cannot be read. The error is the error of git.
- The prompt cannot be archived. A prompt that tasker archived before the failure stays in the prompt archive.

These errors move the task to the state `failed`. The shared quota stop is the exception. The shared unexpected error belongs to this group:

- The assistant fails or runs out of time. The error is `reviewing failed: <reason>` or `reviewing timed out after <n> min`.
- The answer is not valid. The error is `the assistant returned findings that tasker refuses:`, then one line for each problem.

No command resumes a failed or stopped review yet.

## `tasker dismiss-review`

Dismisses open findings of the latest review of a task in the state `reviewed`, with one reason: `tasker dismiss-review <issue> <reason> [--finding <ids>]`. The task goes back to `awaiting_work_review` only when no finding of the review is open after the command.

`<reason>` is why you dismiss the findings. Quote it as one argument. It must not be empty or only spaces. tasker stores it as you typed it.

`--finding <ids>` dismisses only the findings at these positions. Write whole numbers of 1 or more, separated by commas, for example `1,3`. Use no sign and no leading zero. Spaces around an item are permitted. Without the option, the command dismisses every open finding.

On success, the command prints two lines on stdout. The first line is `dismissed findings <positions> of review <number> of <issue key>`. The positions are in ascending order, separated by `, `. The second line is `open findings: <positions>`. When no finding is open, the second line is `no open findings; the task is in awaiting_work_review`.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, nothing is written. The shared errors of no task, of the wrong state and of the task lock belong to this group. The errors of `--finding` come before tasker reads the configuration.

- `--finding` has an item that is not a whole number of 1 or more. The error is `--finding must be a list of whole numbers of 1 or more, separated by commas: <value>`.
- `--finding` names a position twice. The error is `--finding names <n> more than once`, one line for each such position.
- The reason is empty. The error is `the reason is empty`.
- The task has no review. The error is `the task of <issue key> is in reviewed and has no review`.
- A position is not in the latest review, or is already dismissed. The error has one line for each such position: `the latest review of <issue key> has no finding <n>; it has <total>` or `finding <n> of <issue key> is already dismissed: <reason>`.
- No finding is open and `--finding` is absent. The error is `the latest review of <issue key> has no open finding`.

## `tasker accept`

Accepts the work of a task in the state `awaiting_work_review`: `tasker accept <issue>`. The task goes to the state `accepted`.

The command fetches `origin`. Then it makes sure that the branch of the task contains the tip of the base on `origin`. For a local base, the tip is the tip of the local branch in the clone. The command reads the tip of the task branch in the clone, so an uncommitted change or a commit that is not on the task branch does not count. No command brings the branch current yet.

On success, the command prints the line `accepted <issue key> at <revision>` on stdout. The revision is the tip of the task branch.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and nothing is written. The shared errors of no task, of the wrong state, of the task lock and of the clone lock belong to this group:

- The task has no worktree. The error is `the task of <issue key> has no worktree`.
- The task has no branch. The error is `the task of <issue key> has no branch`.
- The task has no base revision. The error is `the task of <issue key> has no base revision`.
- The fetch or the read of the base fails, for example because `origin` has no such base. The error is `cannot read the base tip: <error>`.
- The branch does not contain the tip of the base. The error is `the branch <branch> (<revision>) does not contain the tip of the base <base> (<base tip>)`.

A fetch that ran still moves the refs of `origin` in the clone, also when the command stops with an error.

## `tasker show-review`

Prints one review of the task of an issue: its findings with their status: `tasker show-review <issue>`. The command only reads, and it works in each state.

A bad `--review` value is an error, and the command stops before it reads the configuration.

The command prints this output:

```
<issue key> review <n> of <total>: <count> (at <revision>, <ended at>)
<findings>
```

The count is `no findings`, `1 finding` or `<n> findings`. It counts all findings, open and dismissed. The revision is the tip of the task branch that the review read. The time is the time when the review ended. The findings use the text form of [`tasker review`](#tasker-review), with the status `open` or `dismissed: <reason>`. If the review has no findings, the line `no findings` follows the header line. Each line ends with a line end.

The command prints an error and exits with code 1 in these cases:

- The task has no review. The error is `the task of <issue key> has no review; run tasker review first`. This error also comes with `--review`.
- The task has no review `N` of `--review <N>`. The error is `the task of <issue key> has no review <N>; it has <total>`.
