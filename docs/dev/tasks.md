# The task commands

This page gives the reasons and the limits of the task commands start and abort. The user doc [SKILL.md](../../skills/tasker/SKILL.md) shows the output.

## The purpose of start

`tasker start` makes a task for an issue and takes it to `workspace_ready`.

## The order of the steps

The order follows what each step needs and what a failure can leave.

- The issue is read, and the closed check runs, before a task exists. As a result, a bad key, a missing issue or a closed issue leaves no task.
- The base comes before the workspace, because the workspace starts from the base.
- Bootstrap runs after the repo lock is free. A bootstrap can run for a long time, and it does not use the clone. If it held the lock, one slow bootstrap would stop the start of every other task in the repo.

## The locks

Each start and each abort takes the task lock first and the repo lock second. No code takes a task lock while it holds a repo lock. As a result, two commands cannot wait for each other in a circle, so they cannot deadlock.

The task lock does not wait. A second command for the same issue stops at once, because it would repeat the work of the first one. The repo lock covers the steps that change the clone and the question for the base branch. The base step fetches first and asks only after the fetch, so the question falls inside the lock. The repo lock waits, because another task of the same repo usually holds it only for these short steps. The wait is long enough for a first fetch of a large repo.

The rule that each command that changes a task takes the task lock has one home: [the locks table](data-root.md#locks-table).

## A second run

A second run continues a task that did not reach `workspace_ready`. It does not make a second task.

- A failure before the clone steps changes no state and records no error. A busy repo lock is one such failure. The task stays in `provisioning`.
- A second run of a failed task first moves the task from `failed` to `provisioning`, and this move is on record. If the repo lock is then busy, the task stays in `provisioning` with no error on record. The next start continues it.
- A failure in a clone step or in bootstrap moves the task to `failed` with the error. The next run moves it back and continues.
- A task that is past this step is not changed. The command only prints it.
- The stored base stays on a second run. A `--base` option or a `base:` label wins and is stored as the new base.

## Abort

A dirty worktree needs `--force`, because the abort cannot bring the work back. The check runs before any change, so a refused abort changes nothing.

A task that is `finished` or `cancelled` is an error, because it has nothing to abort.

An abort can stop between two steps, for example after a crash. A second run must finish it. As a result, each step first checks that its target still exists, and a step with no target does nothing.

The compare of the stored worktree path uses the real path. The data root can go through a symlink, and git lists real paths.

The abort removes its own worktree entry. It never prunes, because a prune drops the entries of other tasks too.

The worktree goes before the branch. Git refuses to delete a branch that a worktree entry holds, also when the folder of the entry is gone.

## Why the events are separate

Each learned value has its own event: the base, the workspace and the bootstrap result. A value is not part of the next transition. As a result, a failure in a later step still keeps the earlier values on record.

## Why stderr holds the question and the notes

An agent reads stdout. It holds only the fields of the task, so the agent can parse it. The question for the base branch and the notes of the base step go to stderr.

## Limits

- A new base on a second run does not move a task branch that already exists. The stored base can differ from the real start point of the branch.
- An issue that closes after its task exists does not stop a second run. The closed check runs only when no task exists.
- A person who does not answer the question for the base branch holds the repo lock. Another start of the same repo then waits, and it stops with the lock error at the end of its wait.
- The start does not assign the issue and does not mark it in progress. It has no option to take over a lock of a live process, and no stacked base.
- The abort does not delete the task branch on `origin`. No command publishes a task branch before M10.
- A worktree or a branch that start made but did not store stays after an abort. The abort works only on what the task stores.
