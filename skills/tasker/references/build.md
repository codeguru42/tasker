# Build commands

These commands carry out the approved plan and verify the result. [Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share. [The task of a show command](../SKILL.md#the-task-of-a-show-command) and [the number rule](../SKILL.md#the-number-rule) apply to `show-verify`. [The Build section of docs/statemachine.md](../../../docs/statemachine.md#build) gives the states.

## `tasker execute`

Carries out the pinned plan revision of a task in the state `approved` in the execute session of the assistant, one turn for each todo, and records the state of each todo: `tasker execute <issue>`. The task goes through `executing` to `executed`.

The command runs one turn for each todo that is not `done`, in the dependency order of the todos. All turns of one plan revision share one execute session. A new session gets the plan, the todos, the answered questions and the commit rules in its first turn. A later run of the same revision continues the session and skips each done todo. When the store holds a queued fix turn for the revision, the command runs it after the last todo. The command does not run the verify commands. Run `tasker verify` after it.

tasker records the state of each todo. A todo is `in_progress` when its turn starts, and `done` when the turn reports `done`. A todo with a blocked turn, a failed turn or no result stays `in_progress`. A todo that no turn reached has no state. A done todo stays done, also when a later turn fails.

All turns share one time limit: the value of `executeTimeoutMin`. Each turn gets the time that is left. The command starts no turn when no time is left.

Before the run and after each turn, the command reads the tip of the task branch on the remote. A push from the session fails the task. The error is `push detected on <branch>: the tip of the branch on the remote moved from <old> to <new>`. A push wins over every other result of the turn, a quota stop included. The command cannot see a push that moves the tip and then moves it back within one turn.

On success, the command prints these lines on stdout:

- `executed <issue key> at revision v<N>`
- `todos: <done> of <total> done`
- `fix turn: done`, only when this run did the fix turn
- `denials: <count>`, the permission denials of all turns of this run
- `transcript: <path>`, the file `transcripts/execute-v<N>.jsonl`. The runs of one revision share it.

The command stops with exit code 1 and prints the error on stderr in these cases.

These errors leave the task in its state. The command writes no event, no session and no transcript. The shared errors of no task and of the task lock belong to this group:

- The task is not in `approved`. The error is `the task of <issue key> is in <state>; tasker execute needs approved`.
- The task is approved, but no revision is pinned. The error is `the task of <issue key> is approved, but no revision is pinned`.
- The plan file of the pinned revision cannot be read. The error is `cannot read the plan file <path> of revision v<N>: <error>`.
- The todos hold a dependency cycle. The error names the todos of the cycle.
- The task has no base revision or no branch. The error is `the task of <issue key> has no base revision` or `the task of <issue key> has no branch`.
- The remote cannot be read before the run. The error is `cannot read the remote before the run: <error>`.
- The provider refuses the model of the recorded execute session. The error is `the execute session of <issue key> runs on <model>, and <provider> refuses it: <reason>`.
- The prompt cannot be archived. A prompt that tasker archived before the failure stays in the prompt archive.

These errors move the task to the state `failed`. The shared quota stop is the exception. The shared unexpected error belongs to this group:

- A turn reports `blocked` or gives no result. The error is `<turn> reported blocked: <reason>` or `<turn> reported no result: <detail>`. The turn is ``todo `<id>` (<title>)`` or `the fix turn for the verify failure`.
- The assistant fails or a turn runs out of time. The error is `executing failed: <reason>` or `executing timed out after <n> min`. When no time is left before a turn, the error is `executing <turn> timed out after <n> min`.
- The tip of the branch moved, or the remote cannot be read after a turn. The error is the push error above or `cannot read the remote after the run: <error>`.

For a task in `failed`, run `tasker retry <issue>`. No command resumes a task in `quota_blocked` yet.

## `tasker verify`

Runs the verify commands of the repo in the worktree of a task in the state `executed`, and records the run: `tasker verify <issue>`. The task goes through `verifying` to `awaiting_work_review`, or to `failed`.

The command runs the commands of `verify.commands` one at a time, in the list order, under `/bin/bash` in the worktree. The first command that fails stops the list. All commands share one time limit: the value of `verifyTimeoutMin`. Only the exit codes count. tasker never reads the output of a command to decide the result. The output of each command goes to its own log.

The worktree must be clean before and after the commands. A change is a changed file or a new file that git does not ignore. A file that git ignores does not count. If the worktree has a change before the commands, no command runs. If the commands leave a change, the run fails, also when every command passed.

Each run gets a number. The first run of a task is run 1, and a later run gets the next number. Each run writes its logs in the folder `verify-run-<N>` of the logs of the task. The file `verify-<position>.log` holds the log of the command at that position, counted from 1. A command that never started has no log. tasker records every run that reached the commands, also a failed run. `tasker show-verify` prints a run and the log of each command.

If you press Ctrl-C, the command gets the signal and stops the running command. The run ends as a failure of that command.

On success, the command prints these lines on stdout:

- `verified <issue key>: run <N>`
- `commands: <count>`
- `logs: <folder of the run>`

The command stops with exit code 1 and prints the error on stderr in these cases.

These errors leave the task in its state. The command writes no event and no verify run. The shared errors of no task and of the task lock belong to this group:

- The task is not in `executed`. The error is `the task of <issue key> is in <state>; tasker verify needs executed`.
- The task has no worktree. The error is `the task of <issue key> has no worktree`.

These errors move the task to the state `failed`. The shared unexpected error belongs to this group:

- The worktree cannot be read before the run. The error is `cannot read the uncommitted changes of the worktree before the run: <error>`. The command records no run.
- The worktree has changes before the run. The command records the run as `dirty_before` with no command. The error has two lines. The first line is `the worktree had uncommitted changes before the verify run: <list>`. The list gives the status of git and the path of each change. The second line tells you to run `tasker retry <issue key> --resume-execute`, so that the execute run finishes the changes.
- A command fails or runs out of time. The command records the run as `failed` or `timed_out`. The first line of the error is `verify command <N> failed: <command>: <outcome>. The log is <path>.` The outcome is `exit code <n>`, `stopped by signal <name>`, `timed out after <n> min` or `could not start: <error>`. The last 20 lines of the log follow. When the command wrote no output, the last line is `The command produced no output. It usually failed before it reached the tool that it runs.`
- The time limit ends before the failing command starts. The command records the run as `timed_out`. The error is `verify command <N> failed: <command>: timed out after <n> min, before the command started.` The command has no log, so the error has no log path, no tail and no no-output line.
- The commands leave changes in the worktree. The command records the run as `dirty_after`. The error has two lines. The first line is `the verify commands left uncommitted changes in the worktree: <list>`. The second line says that a plain `tasker retry` runs the commands on the same tree and fails again, and tells you to run `tasker retry <issue key> --resume-execute`, so that the fix turn ignores or removes these files.
- The worktree cannot be read after the run. The command records the run as `failed` with all commands and no failing command. The error is `cannot read the uncommitted changes of the worktree after the run: <error>`.
- The run passed, but tasker cannot record it. The error is `the verify commands passed, but the run could not be recorded: <error>`.

## `tasker show-verify`

Prints one verify run of the task of an issue: its result and the log of each command: `tasker show-verify <issue>`. The command only reads, and it works in each state.

With `--command`, the command prints only the block of the command at that position of the run, counted from 1. The header line stays.

A bad `--run` value or a bad `--command` value is an error, and the command stops before it reads the configuration. If both values are bad, the command prints one error line for each.

The command prints this output:

```
<issue key> verify run <N> of <count>: <result> (<start time>)

== command <k>: <command> (<log path>) ==
<log>
```

The result is `passed`, `failed`, `timed_out`, `dirty_before` or `dirty_after`, as the store holds it. The start time is the time when the run started. The command prints one block for each command that the run started, in order. A command that never started has no block, also when the time limit stopped the run before the failing command. If the log does not end with a line end, the command adds one. An empty log gives one empty line.

If the run ran no command, the command prints the header line, a blank line and the line `no logs: this run ran no command`.

If a log file cannot be read, its block holds the line `(log not readable: <error>)`. `<error>` is the error code, for example `EISDIR`, or else the error message. The command still prints every other block. Then it exits with code 1, and it prints nothing on stderr.

The command prints an error and exits with code 1 in these cases:

- The task has no verify run. The error is `the task of <issue key> has no verify run; run tasker verify first`. This error also comes with `--run`.
- The task has no run `N` of `--run <N>`. The error is `the task of <issue key> has no verify run <N>; it has <count>`.
- The run has no log for command `N` of `--command <N>`. The error is `verify run <N> of <issue key> has no log for command <k>; it ran <m> commands`.
