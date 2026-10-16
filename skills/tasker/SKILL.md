---
name: tasker
description: Use when you run tasker, the command-line tool that drives an AI coding assistant through an issue. Lists each tasker command that you can run, with its options.
---

# tasker

tasker takes an issue from an issue tracker and drives an AI coding assistant through plan, build, verify, review, and merge.

## Rules

- Use only the commands and options that this skill lists. If a command or an option is not in this skill, do not run it.

## Global options

- `tasker --help` (`-h`): prints the usage, the options, and the commands.
- `tasker --version` (`-V`): prints the version.

A global option counts only before the command name. `--version` prints the version only when it comes before a command. After a command, it is an option of that command.

## Configuration

tasker reads one configuration file. It reads `$TASKER_CONFIG`. If that is not set, it reads `$XDG_CONFIG_HOME/tasker/config.json`. If that is not set, it reads `$HOME/.config/tasker/config.json`.

See `docs/config.md` for the keys.

## Issue keys

An issue key names one issue in an issue tracker. The provider of the repo (`issueTracker.provider`) selects the form of the key. tasker does not guess the provider from the shape of a key.

- GitHub: `owner/repo#N`, for example `codeguru42/tasker#8`.
- Jira: `PROJ-N`, for example `PROJ-123`.
- Jira with a site: `<site>/browse/PROJ-N`, for example `example.atlassian.net/browse/PROJ-123`.

N is a positive whole number. The Jira project key (`PROJ`) is in upper case. The site is a bare host name, with no `https://` in front. tasker stores the site in lower case.

A key that does not match the form of its provider is an error. The error names the key.

## Commands

### `tasker show-config`

Prints the configuration as JSON, with the defaults filled in.

- `--repo <key>`: prints only the repo with this key.

If the key does not exist, or the configuration is missing or invalid, the command prints an error and exits with code 1.

### `tasker start`

Makes a task for an issue and takes it to the state `workspace_ready`: `tasker start <issue>`. The command reads the issue, makes the clone, resolves the base branch, makes the worktree and runs bootstrap.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.
- `--base <branch>`: the base branch of this task only. Give a branch on origin, or `refs/heads/<branch>` for a local branch of the clone.

On success, the command prints one line for each field, as `<field>: <value>`, in this order:

- `issue`
- `repo`
- `state`
- `base`
- `branch`
- `worktree`

The state is `workspace_ready`. If the issue already has an active task that is past this step, the command changes nothing. It prints `task already started` first, then the same six lines.

If a run stops before `workspace_ready`, run the same command again. The second run continues the same task. This holds for a task that failed in the steps of `tasker start`. The second run keeps the stored base. A `--base` option or a `base:` label on the issue sets a new base, and the task keeps the new one. A new base does not move a task branch that already exists.

The command picks the base branch from the first source that has one:

1. The `base:` label of the issue, for example `base: dev`.
2. The `--base` option, or the stored base of the task on a second run.
3. The default that tasker learned for the repo.
4. The `defaultBaseBranch` of the repo in the configuration.
5. A question to you. The command asks only when stdin is a terminal.

If you press Ctrl-C at the question, the command stops. The task goes to the state `failed` with the error `no answer: the question was cancelled`. Run the command again to continue it.

The question and the notes of the base step go to stderr. As a result, stdout holds only the six lines.

The command stops with exit code 1 and prints the error on stderr in these cases:

- The configuration or the issue key is not valid. Fix it, then run the command again.
- The issue does not exist, or it is closed and has no task. The error names the issue. Open the issue again or use another one.
- Another start of the same issue is running. The error says that the lock is busy. Wait until it ends.
- The base branch is not known and stdin is not a terminal. The error is `no base branch for <repo>: pass --base <branch> to tasker start, or set repos.<repo>.defaultBaseBranch`. Pass `--base <branch>` or set `defaultBaseBranch` for the repo.
- A step fails. The task goes to the state `failed` with the error. Fix the cause, then run the command again.
- Bootstrap fails. The error names the number and the text of the command, then the exit code, the timeout or the signal, and the path of the log. The last 20 lines of the log follow. Fix the cause, then run the command again.

Two starts for different issues of one repo run at the same time. They wait for each other only while one of them uses the clone or waits for your answer to the question for the base branch. A wait for the clone ends after 5 minutes with the lock error. The task then stays in the state `provisioning`, with no error. Run the command again to continue it.

### `tasker plan`

Runs the assistant in plan mode in the worktree of a task in the state `workspace_ready`, and records the first plan revision: `tasker plan <issue>`. The task goes to the state `planning`, then to `awaiting_plan_review`.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

On success, the command prints these lines:

- `planned <issue> as revision v1`
- `plan: <path>`, the path of the plan file.
- `prompt: <path>`, the path of the archived prompt.
- `todos:`, then one line `- <id>: <title>` for each todo, in the order of the plan.
- `questions: <count>`

After these lines, the command compares the files of the plan with the files of each other active task of the same repo. For each other task, it reads the files of its newest plan revision and the files that its task branch changes. A task in `finished` or `cancelled` does not count. When a file is shared, the command prints this warning on stderr:

```text
WARNING: this plan changes files that other tasks in flight also change.
The task that lands second can get merge conflicts and redo its work.
  <issue key> (<state>):
    <file>
tasker does not refuse. Decide before you approve.
```

The warning has one part for each other task that shares a file. The parts follow the order of the issue keys by number, so `#9` comes before `#10`. The shared files of a task are sorted as plain text. When no file is shared, the command prints no warning.

If the command cannot read the files of a task branch, it prints this line before the warning: `note: cannot read the files of the task branch of <issue key>: <error>`. The files of the newest plan revision of that task still count. If the compare itself fails, the command prints the line `note: cannot compare the plan with the other tasks in flight: <error>`.

The warning and the notes only inform. They never stop the command, and they never change the exit code or the state of a task.

The assistant reads only the issue title and body. It does not read the issue comments.

The command stops with exit code 1 and prints the error on stderr in these cases. In the first five cases, the task keeps its state and nothing is written:

- The issue has no task. The error names the issue and the repo. Run `tasker start` first.
- The task is not in `workspace_ready`. The error names the state. `tasker plan` runs only on a task that `tasker start` brought to `workspace_ready`. For a task in `provisioning`, run `tasker start` again. For a task in `failed` or `quota_blocked`, see below. For a task that is past `planning`, the plan already exists.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.
- The issue cannot be read. Fix the cause (for example the gh login), then run the command again.
- The prompt cannot be archived. Fix the cause, then run the command again.
- The assistant fails or runs longer than the time limit. The task goes to the state `failed`, and the error is `planning failed: <reason>` or `planning timed out after <n> min`.
- An unexpected error occurs after the run has started, for example the transcript file cannot be opened. The task goes to the state `failed`, and the error is `planning failed: <error>`.
- The assistant returns a plan that tasker refuses. The task goes to the state `failed`. The error lists each problem.
- The plan file cannot be written. The task goes to the state `failed`, and the error is `cannot write the plan file of revision v1: <error>`.
- A quota limit stops the run. The task goes to the state `quota_blocked`. The command prints the reset time on stdout.

For a task in `failed`, run `tasker retry <issue>`. For a task in `quota_blocked`, no command continues it yet. Run `tasker abort <issue>` to leave the state. A crash of tasker leaves the task in `planning`. Run `tasker abort <issue>` for it.

If you press Ctrl-C, the assistant stops. The run ends as a failure, and the task goes to the state `failed`.

### `tasker refine`

Continues the plan session of a task in the state `awaiting_plan_review` with your feedback, and records the next plan revision: `tasker refine <issue> <feedback>`. The task goes to the state `refining`, then back to `awaiting_plan_review`.

- `<issue>`: the issue key of the task.
- `<feedback>`: your feedback on the newest plan revision. Quote it as one argument.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

Each revision is a complete plan. When the new revision leaves out a question of the revision before it, that question counts as answered by the feedback. `tasker show-questions` shows the answer.

The session keeps the provider, model and effort that it started with, also after the configuration changed. tasker reads the plan file of the newest revision from disk and the commits of the task branch, and gives both to the assistant in the prompt.

On success, the command prints the same lines as `tasker plan`, but the first line is `refined <issue> as revision v<N>`. Then it prints the overlap warning with the same text and the same last line as `tasker plan`. See the section `tasker plan`.

The command stops with exit code 1 and prints the error on stderr in these cases. In the first nine cases, the task keeps its state and nothing is written:

- The issue has no task. The error names the issue and the repo.
- The task is not in `awaiting_plan_review`. The error names the state.
- The feedback is empty or has only spaces. The error is `the feedback is empty`.
- The task has no plan revision or no plan session. The error says which one is missing.
- The provider refuses the recorded model. The error names the session, the model, the provider and the reason.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.
- The plan file of the newest revision cannot be read. The error is `cannot read the plan file <path> of revision v<N>: <error>`. Restore the file, then run the command again.
- The task has no base revision or no branch, or the commits of the branch cannot be read. The error says which.
- The prompt cannot be archived. Fix the cause, then run the command again.
- The assistant fails or runs longer than the time limit. The task goes to the state `failed`, and the error is `refining failed: <reason>` or `refining timed out after <n> min`.
- An unexpected error occurs after the run has started. The task goes to the state `failed`, and the error is `refining failed: <error>`.
- The assistant returns a plan that tasker refuses. The task goes to the state `failed`. The error lists each problem.
- The plan file cannot be written. The task goes to the state `failed`, and the error is `cannot write the plan file of revision v<N>: <error>`.
- A quota limit stops the run. The task goes to the state `quota_blocked`. The command prints the reset time on stdout.

A refused check leaves the task, the files and the events as they were. Fix the cause, then run the same command again.

### `tasker approve`

Approves the newest plan revision of a task in the state `awaiting_plan_review`: `tasker approve <issue>`. The task goes to the state `approved`, and the newest revision is the one to build.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

On success, the command prints the line `approved <issue> at revision v<N>` on stdout. Then it prints one of these:

- `no open questions`
- `1 open question:` or `<count> open questions:`, then one line `  <id>: <question>` for each open question, in the order of the plan.

Open questions do not stop an approval. The operator decides, and the count makes the choice visible. All questions of the newest revision are open. Only a later revision answers them, so run `tasker refine` first to answer them.

Before it writes, the command prints the overlap warning on stderr, with the same text as `tasker plan`. The warning ends with two lines: `tasker approves the plan anyway.` and `To take the approval back, run: tasker unapprove <issue key>`. See the section `tasker plan`. The warning only informs. It never stops the command.

An older approved revision stays approved. The new approval pins the newest revision, so a later command reads that one as the approved revision.

The command writes one event of the type `approved` with the data `{ version, openQuestions, from, to }`. It writes no `transition` event.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and nothing is written:

- The issue has no task. The error names the issue and the repo.
- The task is already approved. The error is `<issue key> is already approved at revision v<N>`.
- The task is in another state. The error names the state.
- The task has no plan revision. The error is `the task of <issue key> has no plan revision`.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.

### `tasker unapprove`

Takes back the approval of the pinned plan revision of a task in the state `approved`: `tasker unapprove <issue>`. The task goes back to the state `awaiting_plan_review`. The command works only before execute starts, because `tasker execute` moves the task out of `approved` first.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

On success, the command prints the line `unapproved <issue key>: revision v<N> is no longer pinned` on stdout.

An older approved revision stays approved. The command clears only the pinned revision, so a later command reads the older one as the pinned revision again.

The command writes one event of the type `unapproved` with the data `{ version, from, to }`. It writes no `transition` event.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and nothing is written:

- The issue has no task. The error names the issue and the repo.
- The task is in another state. The error is `the task of <issue key> is in <state>; tasker unapprove needs approved`.
- The task is approved, but no revision is pinned. The error is `the task of <issue key> is approved, but no revision is pinned`.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.

### `tasker execute`

Carries out the pinned plan revision of a task in the state `approved` in the execute session of the assistant, one turn for each todo, and records the state of each todo: `tasker execute <issue>`. The task goes through `executing` to `executed`.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

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

The command stops with exit code 1 and prints the error on stderr in these cases. In the first ten cases, the task keeps its state. The command writes no event, no session and no transcript:

- The issue has no task. The error names the issue and the repo.
- The task is not in `approved`. The error is `the task of <issue key> is in <state>; tasker execute needs approved`.
- The task is approved, but no revision is pinned. The error is `the task of <issue key> is approved, but no revision is pinned`.
- The plan file of the pinned revision cannot be read. The error is `cannot read the plan file <path> of revision v<N>: <error>`.
- The todos hold a dependency cycle. The error names the todos of the cycle.
- The task has no base revision or no branch. The error is `the task of <issue key> has no base revision` or `the task of <issue key> has no branch`.
- The remote cannot be read before the run. The error is `cannot read the remote before the run: <error>`.
- The provider refuses the model of the recorded execute session. The error is `the execute session of <issue key> runs on <model>, and <provider> refuses it: <reason>`.
- The prompt cannot be archived. Fix the cause, then run the command again. A prompt that tasker archived before the failure stays in the prompt archive.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.
- A turn reports `blocked` or gives no result. The task goes to the state `failed`, and the error is `<turn> reported blocked: <reason>` or `<turn> reported no result: <detail>`. The turn is ``todo `<id>` (<title>)`` or `the fix turn for the verify failure`.
- The assistant fails or a turn runs out of time. The task goes to the state `failed`, and the error is `executing failed: <reason>` or `executing timed out after <n> min`. When no time is left before a turn, the error is `executing <turn> timed out after <n> min`.
- The tip of the branch moved, or the remote cannot be read after a turn. The task goes to the state `failed`, and the error is the push error above or `cannot read the remote after the run: <error>`.
- An unexpected error occurs after the run has started. The task goes to the state `failed`, and the error is `executing failed: <error>`.
- A quota limit stops the run. The task goes to the state `quota_blocked`. The command prints the reset time on stdout.

The command writes the events `todo_started` and `todo_done` with the data `{ id }`, `fix_turn_started` and `fix_turn_done` with no data, one `permission_denials` event with `{ denials }`, one `sandbox_cleanup` event for each turn that has one, and one `usage` event for each turn. At the end, it writes one `executed` event with `{ version, prompts, from, to }` in place of the `transition` event. For a task in `failed`, run `tasker retry <issue>`. No command resumes a task in `quota_blocked` yet.

### `tasker verify`

Runs the verify commands of the repo in the worktree of a task in the state `executed`, and records the run: `tasker verify <issue>`. The task goes through `verifying` to `awaiting_work_review`, or to `failed`.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

The command runs the commands of `verify.commands` one at a time, in the list order, under `/bin/bash` in the worktree. The first command that fails stops the list. All commands share one time limit: the value of `verifyTimeoutMin`. Only the exit codes count. tasker never reads the output of a command to decide the result. The output of each command goes to its own log.

The worktree must be clean before and after the commands. A change is a changed file or a new file that git does not ignore. A file that git ignores does not count. If the worktree has a change before the commands, no command runs. If the commands leave a change, the run fails, also when every command passed.

Each run gets a number. The first run of a task is run 1, and a later run gets the next number. Each run writes its logs in the folder `verify-run-<N>` of the logs of the task. The file `verify-<position>.log` holds the log of the command at that position, counted from 1. A command that never started has no log. tasker records every run that reached the commands, also a failed run. `tasker show-verify` prints a run and the log of each command.

If you press Ctrl-C, the command gets the signal and stops the running command. The run ends as a failure of that command.

On success, the command prints these lines on stdout:

- `verified <issue key>: run <N>`
- `commands: <count>`
- `logs: <folder of the run>`

The command stops with exit code 1 and prints the error on stderr in these cases. In the first four cases, the task keeps its state. The command writes no event and no verify run:

- The issue has no task. The error names the issue and the repo.
- The task is not in `executed`. The error is `the task of <issue key> is in <state>; tasker verify needs executed`.
- The task has no worktree. The error is `the task of <issue key> has no worktree`.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.
- The worktree cannot be read before the run. The task goes to the state `failed`, and the error is `cannot read the uncommitted changes of the worktree before the run: <error>`. The command records no run.
- The worktree has changes before the run. The task goes to the state `failed`, and the command records the run as `dirty_before` with no command. The error has two lines. The first line is `the worktree had uncommitted changes before the verify run: <list>`. The list gives the status of git and the path of each change. The second line tells you to run `tasker retry <issue key> --resume-execute`, so that the execute run finishes the changes.
- A command fails or runs out of time. The task goes to the state `failed`, and the command records the run as `failed` or `timed_out`. The first line of the error is `verify command <N> failed: <command>: <outcome>. The log is <path>.` The outcome is `exit code <n>`, `stopped by signal <name>`, `timed out after <n> min` or `could not start: <error>`. The last 20 lines of the log follow. When the command wrote no output, the last line is `The command produced no output. It usually failed before it reached the tool that it runs.`
- The time limit ends before the failing command starts. The task goes to the state `failed`, and the command records the run as `timed_out`. The error is `verify command <N> failed: <command>: timed out after <n> min, before the command started.` The command has no log, so the error has no log path, no tail and no no-output line.
- The commands leave changes in the worktree. The task goes to the state `failed`, and the command records the run as `dirty_after`. The error has two lines. The first line is `the verify commands left uncommitted changes in the worktree: <list>`. The second line says that a plain `tasker retry` runs the commands on the same tree and fails again, and tells you to run `tasker retry <issue key> --resume-execute`, so that the fix turn ignores or removes these files.
- The worktree cannot be read after the run. The task goes to the state `failed`, and the command records the run as `failed` with all commands and no failing command. The error is `cannot read the uncommitted changes of the worktree after the run: <error>`.
- The run passed, but tasker cannot record it. The task goes to the state `failed`, and the error is `the verify commands passed, but the run could not be recorded: <error>`.
- An unexpected error occurs after the run has started. The task goes to the state `failed`, and the error is `verifying failed: <error>`.

### `tasker review`

Reviews the committed work of a task in the state `awaiting_work_review` in a new session of the assistant, and records the findings: `tasker review <issue>`. The task goes through `reviewing` to `reviewed`. When the review has no findings, the task goes back to `awaiting_work_review`.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

Each review runs in a new session with the model of the review role. The review is an independent pass, and the conversation of the plan does not bias it. The assistant runs in plan mode in the worktree of the task. The time limit is the value of `planTimeoutMin`.

The prompt holds the commits of the task branch and the text of the earlier reviews. Each earlier review shows its findings with their status, and the operator feedback of each plan revision that followed it.

The findings wait in `reviewed`, because the operator reads them first. The command records the tip of the task branch as the revision of the review, because the findings describe one tree. An uncommitted change or a commit that is not on the task branch does not count, as for `tasker accept`.

Each review gets a number. The first review of a task is review 1, and a later review gets the next number. tasker records the session of each review. No command continues it yet.

On success, the command prints these lines on stdout:

- `reviewed <issue key>: review <N>, <count>`. The count is `no findings`, `1 finding` or `<n> findings`.
- The findings. Each finding has three lines: `- [<position>] <file>:<line> (<category>): <summary>`, `failure scenario: <text>` and `status: open`. With no findings, the line is `no findings`.
- `prompt: <path>`, the archived prompt.
- `transcript: <path>`, the file `transcripts/review-<N>.jsonl`.

The command stops with exit code 1 and prints the error on stderr in these cases. In the first seven cases, the task keeps its state. The command writes no event, no session and no transcript:

- The issue has no task. The error names the issue and the repo.
- The task is not in `awaiting_work_review`. The error is `the task of <issue key> is in <state>; tasker review needs awaiting_work_review`.
- The task has no worktree, no branch or no base revision. The error is `the task of <issue key> has no worktree`, `the task of <issue key> has no branch` or `the task of <issue key> has no base revision`.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.
- The clone has no such task branch, or git cannot read the tip of the branch. The error is `cannot resolve the task branch: <branch>` or the error of git.
- The commits of the branch cannot be read. The error is the error of git.
- The prompt cannot be archived. Fix the cause, then run the command again. A prompt that tasker archived before the failure stays in the prompt archive.
- The assistant fails or runs out of time. The task goes to the state `failed`, and the error is `reviewing failed: <reason>` or `reviewing timed out after <n> min`.
- The answer is not valid. The task goes to the state `failed`, and the error is `the assistant returned findings that tasker refuses:`, then one line for each problem.
- An unexpected error occurs after the run has started. The task goes to the state `failed`, and the error is `reviewing failed: <error>`.
- A quota limit stops the run. The task goes to the state `quota_blocked`. The command prints the reset time on stdout.

The command writes one `transition` event into `reviewing`, one `usage` event, one `review` event with the data `{ number, revision, findings }`, and one `transition` event out of `reviewing`. A failed run writes the `usage` event and no `review` event. No command resumes a failed or stopped review yet.

### `tasker retry`

Moves a task in the state `failed` back to the state before the step that failed, and runs that step again: `tasker retry <issue>`.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.
- `--resume-execute`: works only for a task that failed in `verifying`. The command marks every todo `done` and queues one fix turn for the failure, in place of a new verify run. See below.

The command reads the origin. The origin is the state that the task left when it failed. `tasker show` prints it as `failed in`. The command looks up the origin in this table:

- `provisioning`: the command does not move the task. `tasker start` moves it from `failed` to `provisioning`, and the command runs it.
- `planning`: the task goes to `workspace_ready`. The command deletes the plan session, so that the next run starts a new session. Then it runs `tasker plan`.
- `refining`: the task goes to `awaiting_plan_review`. Nothing runs. The command prints a hint, because a refine needs new feedback from you.
- `executing`: the task goes to `approved`. The command deletes the execute session of the pinned revision, so that the next run starts a new session. Then it runs `tasker execute`. A todo that is `done` gets no new turn.
- `verifying`: the task goes to `executed`, and the command runs `tasker verify`.
- `verifying` with `--resume-execute`: the task goes to `approved`. The command marks every todo of the pinned revision `done` and queues one fix turn. Then it runs `tasker execute`, which continues the execute session and runs only the fix turn.

The deleted session matters because a run that failed before its first turn recorded a session id that names no conversation. A new run must not continue it.

The fix turn gets the error of the failure and the tail of the log of the failing verify command. The tail is the last 200 lines of the log, within 64 KiB. tasker reads the tail and gives it to the assistant, because the log is in the data root and the sandbox of the assistant reaches only the worktree. The command uses a log only when the verify run of this failure recorded it. A failure that recorded no run, a run with no failing command, a command that never started and a log that is missing or cannot be read give a fix turn with no tail. The command never uses an older log, because an older log gives the fix turn false data.

The move, the deletes, the todo marks, the fix turn and one `retry` event happen in one transaction. The `retry` event holds `{ origin, target, resumeExecute, from, to }` in place of the `transition` event. For a task that failed in `provisioning`, the command writes the event alone, with `{ origin, target, resumeExecute }` and no move.

Then the command releases the task lock and runs the next command. The output starts with this line on stdout:

- `retried <issue key>: failed in <origin>, back in <target>`

For the origin `provisioning`, the target is `provisioning`, so the line is `retried <issue key>: failed in provisioning, back in provisioning`.

For a task that failed in `provisioning`, the steps of `tasker start` run with no `--base`. If they stop because no base branch is known, run `tasker start <issue> --base <branch>`. `tasker start` continues the same task.

The output of the next command follows: the output of `tasker start`, `tasker plan`, `tasker execute` or `tasker verify`. The next command keeps its own errors and its own exit code. If it fails, the task goes to `failed` again with a new error, and you can run `tasker retry` again. For the origin `refining`, the command prints `run tasker refine <issue key> "<feedback>" again` and exits with code 0.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and the command writes nothing:

- The issue has no task. The error names the issue and the repo.
- The task is not in `failed`. The error is `the task of <issue key> is in <state>; tasker retry needs failed`.
- The task failed in a state that retry has no step for. The error is `the task of <issue key> failed in <state>; tasker retry has no step for it`.
- You gave `--resume-execute` for a task that did not fail in `verifying`. The error is `--resume-execute applies only to a task that failed in verifying`.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.

### `tasker accept`

Accepts the work of a task in the state `awaiting_work_review`: `tasker accept <issue>`. The task goes to the state `accepted`.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

The command fetches `origin`. Then it makes sure that the branch of the task contains the tip of the base on `origin`. For a local base, the tip is the tip of the local branch in the clone. The command reads the tip of the task branch in the clone, so an uncommitted change or a commit that is not on the task branch does not count. No command brings the branch current yet.

On success, the command prints the line `accepted <issue key> at <revision>` on stdout. The revision is the tip of the task branch.

The command writes one event of the type `accepted` with the data `{ revision, baseTip, from, to }`. It writes no `transition` event.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and nothing is written:

- The issue has no task. The error names the issue and the repo.
- The task is in another state. The error is `the task of <issue key> is in <state>; tasker accept needs awaiting_work_review`.
- The task has no worktree. The error is `the task of <issue key> has no worktree`.
- The task has no branch. The error is `the task of <issue key> has no branch`.
- The task has no base revision. The error is `the task of <issue key> has no base revision`.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.
- Another command holds the clone for more than 5 minutes. The error says that the lock is busy. Run the command again.
- The fetch or the read of the base fails, for example because `origin` has no such base. The error is `cannot read the base tip: <error>`.
- The branch does not contain the tip of the base. The error is `the branch <branch> (<revision>) does not contain the tip of the base <base> (<base tip>)`.

A fetch that ran still moves the refs of `origin` in the clone, also when the command stops with an error.

### `tasker abort`

Removes the worktree and the local task branch of an active task, and moves the task to the state `cancelled`: `tasker abort <issue>`.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.
- `--force`: discards the uncommitted changes of the worktree before the abort.

The command prints one line for each step that ran, then `cancelled <issue>`. The steps are the discard of the uncommitted changes (only with `--force`), the removal of the worktree and the deletion of the branch. A step that has nothing to do prints no line. The files under `artifacts/` stay.

The command stops with exit code 1 and prints the error on stderr in these cases:

- The task is `finished` or `cancelled`. The error names the state. A task in any other state, `failed` included, can be aborted.
- The worktree has uncommitted changes and you did not pass `--force`. The error lists each change, then says `tasker abort --force discards them`. Commit the changes or pass `--force`.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.
- Another command holds the clone for more than 5 minutes. The error says that the lock is busy. Run the command again.
- A step fails. The task keeps its state, so run the command again. The second run finishes the steps that are left.

### `tasker show`

Prints the details of the task of an issue: `tasker show <issue>`. The command shows the active task. If the issue has no active task, it shows the newest task.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

The command prints one line for each field, as `<field>: <value>`, in this order:

- `issue`
- `repo`
- `title`
- `state`
- `attempt`
- `base`
- `branch`
- `worktree`
- `created`
- `updated`
- `last event`

A field with no value prints `-`. The `last event` line holds the time, the type and the data of the last event of the task, as one line of JSON text: `last event: <time> <type> <data>`. An event with no data prints `null`.

If the task is in the state `failed`, the command prints two more lines. `failed in` gives the state that the task left when it failed. `error` gives the error of the failure.

If the pinned plan revision has at least one todo with a recorded state, the command prints a todo block after all other lines. The pinned revision is the approved revision with the highest version. The block starts with the line `todos (approved v<N>):`. Then it prints one line for each todo of the revision, in the order of the plan: `<state>  <id>  <title>`. The state is `done`, `in progress` or `not started`. The command pads the state and the id to the longest value of the revision, and two spaces separate the columns.

If the revision has a fix turn, the line `fix turn: queued` or `fix turn: done` follows the block. If the task has no pinned revision, or no todo has a recorded state, the command prints no block and no fix turn line.

Each field and each todo title stays on one line. A line end in a value prints as the two characters `\n`.

The command prints an error and exits with code 1 in these cases:

- The issue key does not resolve.
- The issue has no task. The error names the issue and the repo.
- The configuration is missing or invalid.

### `tasker show-bootstrap`

Prints the bootstrap log of the task of an issue: `tasker show-bootstrap <issue>`. The command uses the same task as `tasker show`: the active task, else the newest task.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

The command prints the log as it is, with no change. The log holds every bootstrap run of the attempt of the task, in order. Each run starts with a line `=== bootstrap run <time> ===`. An empty log prints nothing.

The command prints an error and exits with code 1 in these cases:

- The issue key does not resolve.
- The issue has no task. The error names the issue and the repo.
- The task has no bootstrap log. The error is `no bootstrap log for <issue key>`.
- tasker cannot read the bootstrap log. The error is `cannot read the bootstrap log for <issue key>: <error>`. `<error>` is the error code, for example `EISDIR`, or else the error message.
- The configuration is missing or invalid.

### `tasker show-plan`

Prints one plan revision of the task of an issue: `tasker show-plan <issue>`. The command uses the same task as `tasker show`: the active task, else the newest task.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.
- `--version <N>`: prints revision `N`. `N` must be a whole number of 1 or more, with no sign and no leading zero. With no `--version`, the command prints the newest revision. A bad value is an error, and the command stops before it reads the configuration.
- `--path`: prints only the path of the plan file `v<N>.md` of the revision, with a final line end. The command prints the path also when the file is missing, because it does not read the file.

The command prints this output:

```
<issue key> plan v<N>
<approval line>

<plan text>
todos:
  <id>: <title>
    <description>
    depends on: <ids>
questions:
  <id>: <question>
    <context>
    <state>
```

- The approval line is `not approved` when no revision of the task is approved. It is `approved` when the printed revision is the approved revision. Otherwise it is `approved revision is v<K>`, where `v<K>` is the approved revision.
- The plan text comes from the file `v<N>.md` and prints as it is. If it does not end with a line end, the command adds one.
- The todos and the questions come from the stored revision, not from the file.
- `depends on` lists the ids of the todos that come first, joined with `, `. A todo with none prints `depends on: none`.
- The state of a question of revision `v<N>` comes only from the next revision `v<N+1>`. If `v<N+1>` has no question with the same id, the state is `answered in v<N+1>: <answer>`. The answer is the feedback of `v<N+1>`. If `v<N+1>` has no feedback, the state is `answered in v<N+1>`. Else the state is `open`. A revision after `v<N+1>` does not change the state, and a question of the newest revision is always `open`.
- A revision with no questions prints `  none` under `questions:`.
- A line end inside a title, a description, a context, a question or an answer starts a new line with the indent of its block.
- Each line of the output, the last one too, ends with a line end.

The command prints an error and exits with code 1 in these cases:

- The issue key does not resolve.
- The issue has no task. The error names the issue and the repo.
- The `--version` value is bad. The error is `--version must be a whole number of 1 or more: <value>`.
- The task has no plan revision. The error is `the task of <issue key> has no plan revision; run tasker plan first`. This error also comes with `--version`.
- The task has no revision `N`. The error is `the task of <issue key> has no plan revision v<N>`.
- The plan file is missing. The error is `no plan file at <path>`. This does not apply to `--path`.
- tasker cannot read the plan file. The error is `cannot read the plan file <path>: <error>`. `<error>` is the error code, for example `EISDIR`, or else the error message. This does not apply to `--path`.
- The configuration is missing or invalid.

### `tasker show-questions`

Prints the questions of one plan revision of the task of an issue, each with its state: `tasker show-questions <issue>`. The command uses the same task as `tasker show`: the active task, else the newest task. The command does not read the plan file.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.
- `--version <N>`: prints the questions of revision `N`. The rule is the same as for `tasker show-plan`: `N` must be a whole number of 1 or more, with no sign and no leading zero. With no `--version`, the command uses the newest revision.

If the revision has questions, the command prints the header line `<issue key> plan v<N>`, then the questions block of `tasker show-plan`:

```
<issue key> plan v<N>
questions:
  <id>: <question>
    <context>
    <state>
```

The state is `open`, `answered in v<N+1>: <answer>`, or `answered in v<N+1>` when the next revision `v<N+1>` has no feedback. The rule is the same as for `tasker show-plan`: only the next revision `v<N+1>` decides the state. If the revision has no questions, the command prints one line: `<issue key> plan v<N> has no questions`. Each line ends with a line end.

The command prints an error and exits with code 1 in these cases:

- The issue key does not resolve.
- The issue has no task. The error names the issue and the repo.
- The `--version` value is bad. The error is `--version must be a whole number of 1 or more: <value>`.
- The task has no plan revision. The error is `the task of <issue key> has no plan revision; run tasker plan first`. This error also comes with `--version`.
- The task has no revision `N`. The error is `the task of <issue key> has no plan revision v<N>`.
- The configuration is missing or invalid.

### `tasker show-verify`

Prints one verify run of the task of an issue: its result and the log of each command: `tasker show-verify <issue>`. The command uses the same task as `tasker show`: the active task, else the newest task. The command only reads, and it works in each state.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.
- `--run <N>`: prints run `N`. `N` must be a whole number of 1 or more, with no sign and no leading zero. With no `--run`, the command prints the newest run.
- `--command <N>`: prints only the block of the command at position `N` of the run, counted from 1. The rule for `N` is the same as for `--run`. The header line stays.

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

- The issue key does not resolve.
- The issue has no task. The error names the issue and the repo.
- The `--run` value or the `--command` value is bad. The error is `--run must be a whole number of 1 or more: <value>` or `--command must be a whole number of 1 or more: <value>`.
- The task has no verify run. The error is `the task of <issue key> has no verify run; run tasker verify first`. This error also comes with `--run`.
- The task has no run `N`. The error is `the task of <issue key> has no verify run <N>; it has <count>`.
- The run has no log for command `N`. The error is `verify run <N> of <issue key> has no log for command <k>; it ran <m> commands`.
- The configuration is missing or invalid.

### `tasker status`

Lists the tasks by issue key and state. With no option, it lists the active tasks of all repos. A task is active when its state is not `finished` and not `cancelled`.

- `--repo <key>`: lists only the tasks of the repo with this key.
- `--issue <issue>`: lists only the tasks of this issue key.
- `--state <state>`: lists only the tasks in this state. If you name `finished` or `cancelled`, the command lists those tasks too.

If you give more than one option, a task must match all of them.

The command prints one table with the columns `ISSUE`, `REPO`, `STATE` and `UPDATED`. `UPDATED` is the time of the last change of the task. The task with the newest change comes first.

If no task matches, the command prints `no tasks` and exits with code 0.

The command prints an error and exits with code 1 in these cases:

- The repo key does not exist. The error names the key.
- The state does not exist. The error lists the states.
- The issue key does not resolve.
- The configuration is missing or invalid.

### `tasker doctor`

Makes sure that the configuration, the data root, git, `gh`, `claude` and the accounts work before you start a task. The command has no options.

The command runs these checks one at a time, in this order:

- `data root`: makes the missing folders of `dataRoot`, then writes one temporary file there and deletes it.
- `free space`: warns when the free space of the file system of `dataRoot` is below `dataRootMinFreeBytes`.
- For each repo, in the order of the configuration: the git checks.
- Once for each issue tracker that the configuration uses, in the order of first use: the checks of the tracker. For `github`, `gh version` runs once, `gh auth` runs once for each account, and the project and label checks run for each repo.
- Once for each assistant provider that the configuration uses, in the order of first use: the checks of the provider. For `claude-code`, this is `claude version`, and on Linux also `sandbox: bwrap` and `sandbox: socat`.

The command prints one line for each check, with the status (`ok`, `warn` or `error`), the name and the first line of the detail. The other lines of the detail and the remediation follow with an indent. The command prints the lines of a check before the next check starts.

The command exits with these codes:

- 1 when the configuration does not load or the list of checks cannot be built. No check runs.
- 1 when a required check gives `error`. The later checks still run.
- 0 in all other cases. A `warn` never changes the exit code.

The checks never change the remote, GitHub or the clone. The only write is one temporary file in `dataRoot`, which the check deletes.

### `tasker model`

Prints or sets the model and the effort of each assistant role for the repo of an issue: `tasker model <issue> [<model>] [--role <role>] [--repo <key>] [--effort <effort>]`. The command needs no task and changes no task. For the configuration file, see the Configuration section.

- `<issue>`: the issue key. The command uses the repo of the issue.
- `[<model>]`: the new model of the role. The command sets it only with `--role`.
- `--role <role>`: the role to print or to set. The roles are `plan`, `execute` and `review`.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.
- `--effort <effort>`: the new effort of the role: `low`, `medium` or `high`.

If the key fits more than one repo and you do not give `--repo`, the active task of the issue picks the repo. If no repo, or more than one repo, has an active task for the issue, the command prints an error.

Without `<model>` and `--effort`, the command prints one line for each role, in the order plan, execute, review, as `<role>: <model> (effort <effort>)`, for example `plan: opus (effort high)`. With `--role`, it prints only that role.

With `<model>`, `--effort` or both, the command changes the model, the effort or both of the role that `--role` names. The command makes sure that the new configuration is valid, with the model check of the provider, before it writes. If the new configuration is not valid, the command prints the errors and changes nothing. Then the command writes the new file in one step: a temporary file and a rename. It prints the new line of the role on stdout. It prints this note on stderr: `note: the new model and effort apply only to new sessions. A continued session keeps the model and the effort that it started with.`

The command prints an error and exits with code 1 in these cases:

- The issue key does not resolve.
- The configuration is missing or invalid.
- You give `<model>` or `--effort` without `--role`. The error is `name the role with --role`. The command stops before it reads the configuration.
- The new configuration is not valid, for example when the model fails the model check of the provider. The error lists the problems, and the file does not change.
