# Plan commands

These commands make, refine and approve the plan, and print it. [Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share. [The task of a show command](../SKILL.md#the-task-of-a-show-command) and [the number rule](../SKILL.md#the-number-rule) apply to `show-plan` and `show-questions`. [The Plan section of docs/statemachine.md](../../../docs/statemachine.md#plan) gives the states.

## `tasker plan`

Runs the assistant in plan mode in the worktree of a task in the state `workspace_ready`, and records the first plan revision: `tasker plan <issue>`. The task goes to the state `planning`, then to `awaiting_plan_review`.

On success, the command prints these lines:

- `planned <issue> as revision v1`
- `plan: <path>`, the path of the plan file.
- `prompt: <path>`, the path of the archived prompt.
- `todos:`, then one line `- <id>: <title>` for each todo, in the order of the plan.
- `questions: <count>`

After these lines, the command can print [the overlap warning](#the-overlap-warning).

The assistant reads only the issue title and body. It does not read the issue comments.

The command stops with exit code 1 and prints the error on stderr in these cases.

These errors leave the task in its state. The command writes nothing. The shared errors of [the wrong state](../SKILL.md#shared-errors), of the task lock and of the prompt archive belong to this group:

- The issue has no task. The error names the issue and the repo. Run `tasker start` first.
- The issue cannot be read. Fix the cause (for example the gh login), then run the command again.

These errors move the task to the state `failed`. The shared quota stop is the exception:

- The assistant fails or runs longer than the time limit. The error is `planning failed: <reason>` or `planning timed out after <n> min`.
- An unexpected error occurs after the run has started, for example the transcript file cannot be opened. The error is `planning failed: <error>`.
- The assistant returns a plan that tasker refuses. The error lists each problem.
- The plan file cannot be written. The error is `cannot write the plan file of revision v1: <error>`.

For a task in `failed`, run `tasker retry <issue>`. For a task in `quota_blocked`, no command continues it yet. Run `tasker abort <issue>` to leave the state. After a crash of tasker, the next command that reads the task moves it to `interrupted`. See [A dead run](../SKILL.md#a-dead-run). Run `tasker abort <issue>` for it.

If you press Ctrl-C, the assistant stops. The run ends as a failure, and the task goes to the state `failed`.

### The overlap warning

The command compares the files of the plan with the files of each other active task of the same repo. For each other task, it reads the files of its newest plan revision and the files that its task branch changes. A task in `finished` or `cancelled` does not count. When a file is shared, the command prints this warning on stderr:

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

## `tasker refine`

Continues the plan session of a task in the state `awaiting_plan_review`, `reviewed` or `failed`, and records the next plan revision: `tasker refine <issue> [<feedback>]`. The task goes to the state `refining`, then to `awaiting_plan_review`.

In `reviewed`, the open findings of the latest review go to the plan session, so that the next revision fixes them. The revision has the source `review`. The findings stay open, and the next review decides if the work fixed them.

In `failed`, the task must have a plan revision. The context gives the state that the task left when it failed and the error of the failure. Your feedback is the instruction for the fix. The revision has the source `refine`.

`[<feedback>]` is your feedback on the newest plan revision. Quote it as one argument. It is required in `awaiting_plan_review` and in `failed`. In `reviewed`, it is optional and is your guidance on the open findings.

Each revision is a complete plan. When the new revision leaves out a question of the revision before it, that question counts as answered by the feedback. `tasker show-questions` shows the answer. A promotion from `reviewed` with no feedback gives that question no answer text. `tasker show-questions` then prints `answered in v<N>`.

The session keeps the provider, model and effort that it started with, also after the configuration changed. tasker reads the plan file of the newest revision from disk and the commits of the task branch, and gives both to the assistant in the prompt.

On success, the command prints the same lines as `tasker plan`, but the first line is `refined <issue> as revision v<N>`. Then it prints [the overlap warning](#the-overlap-warning) after its lines, with the same last line.

The command stops with exit code 1 and prints the error on stderr in these cases.

These errors leave the task in its state. The command writes nothing. The shared errors of no task, of the wrong state, of the task lock and of the prompt archive belong to this group:

- The task is in `awaiting_plan_review` or `failed` and you give no feedback. The error is `the feedback is missing; tasker refine needs it unless the task is in reviewed`.
- The feedback is empty or has only spaces. The error is `the feedback is empty`.
- The task is in `reviewed`, and its latest review has no open finding or does not exist. The error is `the latest review of <issue> has no open finding; run tasker dismiss-review or tasker review`.
- The task is in `failed` and has no plan revision. The error is `the task of <issue key> failed in <origin> and has no plan revision; run tasker retry <issue key>`.
- The task has no plan revision or no plan session. The error says which one is missing.
- The provider refuses the recorded model. The error names the session, the model, the provider and the reason.
- The plan file of the newest revision cannot be read. The error is `cannot read the plan file <path> of revision v<N>: <error>`. Restore the file, then run the command again.
- The task has no base revision or no branch, or the commits of the branch cannot be read. The error says which.

A refused check leaves the task, the files and the events as they were. Fix the cause, then run the same command again.

These errors move the task to the state `failed`. The shared quota stop is the exception. The shared unexpected error belongs to this group:

- The assistant fails or runs longer than the time limit. The error is `refining failed: <reason>` or `refining timed out after <n> min`.
- The assistant returns a plan that tasker refuses. The error lists each problem.
- The plan file cannot be written. The error is `cannot write the plan file of revision v<N>: <error>`.

## `tasker approve`

Approves the newest plan revision of a task in the state `awaiting_plan_review`: `tasker approve <issue>`. The task goes to the state `approved`, and the newest revision is the one to build.

On success, the command prints the line `approved <issue> at revision v<N>` on stdout. Then it prints one of these:

- `no open questions`
- `1 open question:` or `<count> open questions:`, then one line `  <id>: <question>` for each open question, in the order of the plan.

Open questions do not stop an approval. The operator decides, and the count makes the choice visible. All questions of the newest revision are open. Only a later revision answers them, so run `tasker refine` first to answer them.

Before it writes, the command prints [the overlap warning](#the-overlap-warning) on stderr. The warning ends with two lines: `tasker approves the plan anyway.` and `To take the approval back, run: tasker unapprove <issue key>`. The warning only informs. It never stops the command.

An older approved revision stays approved. The new approval pins the newest revision, so a later command reads that one as the approved revision.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and nothing is written. The shared errors of no task, of the wrong state and of the task lock belong to this group:

- The task is already approved. The error is `<issue key> is already approved at revision v<N>`.
- The task has no plan revision. The error is `the task of <issue key> has no plan revision`.

## `tasker unapprove`

Takes back the approval of the pinned plan revision of a task in the state `approved`: `tasker unapprove <issue>`. The task goes back to the state `awaiting_plan_review`. The command works only before execute starts, because `tasker execute` moves the task out of `approved` first.

On success, the command prints the line `unapproved <issue key>: revision v<N> is no longer pinned` on stdout.

An older approved revision stays approved. The command clears only the pinned revision, so a later command reads the older one as the pinned revision again.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and nothing is written. The shared errors of no task, of the wrong state and of the task lock belong to this group:

- The task is approved, but no revision is pinned. The error is `the task of <issue key> is approved, but no revision is pinned`.

## `tasker show-plan`

Prints one plan revision of the task of an issue: `tasker show-plan <issue>`.

`--path` prints only the path of the plan file `v<N>.md` of the revision, with a final line end. The command prints the path also when the file is missing, because it does not read the file.

A bad `--version` value is an error, and the command stops before it reads the configuration.

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

- The task has no plan revision. The error is `the task of <issue key> has no plan revision; run tasker plan first`. This error also comes with `--version`.
- The task has no revision `N` of `--version <N>`. The error is `the task of <issue key> has no plan revision v<N>`.
- The plan file is missing. The error is `no plan file at <path>`. This does not apply to `--path`.
- tasker cannot read the plan file. The error is `cannot read the plan file <path>: <error>`. `<error>` is the error code, for example `EISDIR`, or else the error message. This does not apply to `--path`.

## `tasker show-questions`

Prints the questions of one plan revision of the task of an issue, each with its state: `tasker show-questions <issue>`. The command does not read the plan file.

If the revision has questions, the command prints the header line `<issue key> plan v<N>`, then [the questions block of `tasker show-plan`](#tasker-show-plan):

```
<issue key> plan v<N>
questions:
  <id>: <question>
    <context>
    <state>
```

The state is `open`, `answered in v<N+1>: <answer>`, or `answered in v<N+1>` when the next revision `v<N+1>` has no feedback. The rule is [the same as for `tasker show-plan`](#tasker-show-plan): only the next revision `v<N+1>` decides the state. If the revision has no questions, the command prints one line: `<issue key> plan v<N> has no questions`. Each line ends with a line end.

The command prints an error and exits with code 1 in these cases:

- The task has no plan revision. The error is `the task of <issue key> has no plan revision; run tasker plan first`. This error also comes with `--version`.
- The task has no revision `N` of `--version <N>`. The error is `the task of <issue key> has no plan revision v<N>`.
