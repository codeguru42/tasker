# The task commands

This page gives the reasons and the limits of the task commands. The code shows the steps. The user doc [SKILL.md](../../skills/tasker/SKILL.md) shows the output.

## The purpose of start

`tasker start` makes a task for an issue and takes it to `workspace_ready`. The steps live in `src/tasks/`, not in the command file, because other commands run the same steps. The command file only parses the options, prints the output and maps the errors to exit codes.

## The order of the steps

The order follows what each step needs and what a failure can leave.

- The issue is read, and the closed check runs, before a task exists. As a result, a bad key, a missing issue or a closed issue leaves no task.
- The base comes before the workspace, because the workspace starts from the base.
- Bootstrap runs after the repo lock is free. A bootstrap can run for a long time, and it does not use the clone. If it held the lock, one slow bootstrap would stop the start of every other task in the repo.

## The locks

Each start takes the task lock first and the repo lock second. No code takes a task lock while it holds a repo lock. As a result, two starts cannot wait for each other in a circle, so they cannot deadlock.

The task lock does not wait. A second start of the same issue stops at once, because it would repeat the work of the first one. The repo lock waits, because another task of the same repo holds it only while it changes the clone. The wait is long enough for a first fetch of a large repo. It covers only the steps that change the clone.

The rule that each command that changes a task takes the task lock has one home: [the locks table](data-root.md#locks-table).

## A second run

A second run continues a task that did not reach `workspace_ready`. It does not make a second task.

- A failure before the clone steps changes no task. A busy repo lock is one such failure: the task stays as it was, and nothing is recorded.
- A failure in a clone step or in bootstrap moves the task to `failed` with the error. The next run moves it back and continues.
- A task that is past this step is not changed. The command only prints it.
- The stored base stays on a second run. A `--base` option or a `base:` label wins and is stored as the new base.

## Why the events are separate

Each learned value has its own event: the base, the workspace and the bootstrap result. A value is not part of the next transition. As a result, a failure in a later step still keeps the earlier values on record.

## Why stderr holds the question and the notes

An agent reads stdout. It holds only the fields of the task, so the agent can parse it. The question for the base branch and the notes of the base step go to stderr.

## Limits

- A new base on a second run does not move a task branch that already exists. The stored base can differ from the real start point of the branch.
- An issue that closes after its task exists does not stop a second run. The closed check runs only when no task exists.
- The start has no option to update the clone first, no option to take over a lock of a live process, and no stacked base.
