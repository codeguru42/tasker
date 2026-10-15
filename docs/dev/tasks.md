# The task commands

This page gives the reasons and the limits of the task commands start, abort, plan, refine, approve and unapprove, and of the result of an assistant run. The user doc [SKILL.md](../../skills/tasker/SKILL.md) shows the output.

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

## The result of an assistant run

One shared step maps the outcome of an assistant run to the next state of the task. Each command that runs the assistant (plan, refine, execute and review) must use it. As a result, each command moves the task and prints in the same way, and the rule has one home.

The step records the usage of the run first, for every outcome. Then it acts on the outcome:

- A success causes no move. The command that ran the assistant makes its own checks and its own move.
- A failure and a timeout move the task to `failed`. The error goes to the event and to stderr, and the exit code is 1.
- A quota stop moves the task to `quota_blocked`. The event holds the cause and the reset time when it is known. The command prints the reset time on stdout, or says that it is unknown, and the exit code is 1.

A failed run also spends tokens, so the usage is recorded for a failure too. The record of usage must be complete.

A quota stop is not a failure. The run can continue after the reset, and the task keeps its session for that. Until the resume command exists (M9), `tasker abort` is the only way out of `quota_blocked`.

The usage event and the move are two writes, not one. A crash between them leaves the usage event and a task that is still in its spawning state. The run marker of the task stays, so tasker can find that the run died.

## Plan

`tasker plan` runs the assistant in plan mode in the worktree of a task in `workspace_ready`, and records the first plan revision. The task goes to `planning`, then to `awaiting_plan_review`.

The steps run in this order, under the task lock. The command does not wait for the lock.

1. The command makes all its checks and reads before the first write. A failure in this part changes no state, so the task stays in `workspace_ready`.
2. The command records the session of the plan before it starts the assistant. [The session id](assistants.md#the-session-id) gives the reason. A task that already has a plan session continues it.
3. The command moves the task to `planning` and runs the assistant. It appends each event of the run to the transcript of the revision.
4. The command acts on the outcome as [The result of an assistant run](#the-result-of-an-assistant-run) says. A plan that tasker refuses also moves the task to `failed`, and the error lists each problem.
5. The command writes the plan file before it adds the row. [Plan files](data-root.md#plan-files) gives the reason.
6. The row, its event and the move to `awaiting_plan_review` share one transaction. [The plan_revisions table](data-root.md#plan_revisions-table) gives the rule.

An error after the start of the run also moves the task to `failed`, with the prefix `planning failed:`. A failed write of the plan file moves it to `failed` too, with its own message. A crash of tasker leaves the task in `planning`, with its run marker. Until M9, `tasker abort` is the way out.

After a successful plan, the command warns when the plan changes files that another active task of the same repo also changes. [What the plan prompt asks for](assistants.md#what-the-plan-prompt-asks-for) says that tasker compares `files_changed` with the other tasks in flight. The purpose of the warning is to let an operator order the landings before the approve, because the task that lands second can get merge conflicts and redo its work.

The warning reads the files of the newest plan of the other task and the files that its task branch changes. A task that already executed has files that its plan did not list, so the plan alone is not enough.

The warning never refuses. Only a person can decide if an overlap is harmless and which task lands first. A failure inside the compare prints one note line on stderr and changes neither the exit code nor a state.

The read takes no repo lock. It changes nothing in the clone, and a wait for the repo lock can hold the end of the command.

`tasker refine` prints the same warning with the same last line as `tasker plan`. `tasker approve` prints the same warning before its write, with two last lines: `tasker approves the plan anyway.` and `To take the approval back, run: tasker unapprove <issue key>`.

## Refine

`tasker refine` continues the plan session of a task in `awaiting_plan_review` with the feedback of the operator, and records the next plan revision. The task goes to `refining`, then back to `awaiting_plan_review`.

The steps run in this order, under the task lock. The command does not wait for the lock.

1. The command checks the state, the feedback, the plan revision, the plan session and the recorded model. It makes these checks before any read of a file and before any write. A refused refine leaves the task, the files and the events as they were, so the operator can fix the cause and run the same command again.
2. The command reads the plan file of the newest revision from disk, so an edit by hand counts. It reads the base revision and the commits of the task branch.
3. The command fills the prompt, archives the template and continues the plan session. [New and continued sessions](assistants.md#new-and-continued-sessions) gives the rule for the recorded model. The session is already recorded, so refine records no session.
4. The command moves the task to `refining` and runs the assistant. The run step is the one that `tasker plan` uses, with the prefix `refining failed:` for an error.

[The refine prompt](assistants.md#the-refine-prompt) says what the prompt asks for. The new revision is a complete plan. A question that it leaves out counts as answered by the feedback, and the store computes this. The next revision goes to the next free version, and its transcript goes to the file of that version.

## Approve

`tasker approve` approves the newest plan revision of a task in `awaiting_plan_review`. The task goes to `approved`.

The command runs under the task lock and does not wait for the lock. It makes all checks before any write: the task, the state, the pinned revision and the newest plan revision. A refused approve leaves the task, the revisions and the events as they were. The overlap warning comes after the checks and before the write.

The write is one transaction. It sets the approval time of the revision, appends one `approved` event with the data `{ version, openQuestions, from, to }`, and moves the task to `approved`. The `approved` event takes the place of the `transition` event for this move. The state machine checks the edge in the same transaction, so an illegal edge writes nothing.

Open questions do not stop an approval. The operator decides, and the count in the event and in the output makes the choice visible.

The approval lives on the revision, not on the task. A task has one approved revision for each cycle, and an older approval stays when a newer revision is approved.

`tasker unapprove` takes back the approval of a task in `approved`. The task goes back to `awaiting_plan_review`. The command runs under the task lock and does not wait for the lock. It makes all checks before any write: the task, the state and the pinned revision. A refused unapprove leaves the task, the revisions and the events as they were.

The write is one transaction. It clears the approval time of the pinned revision, appends one `unapproved` event with the data `{ version, from, to }`, and moves the task to `awaiting_plan_review`. The `unapproved` event takes the place of the `transition` event for this move. The state machine checks the edge in the same transaction, so an illegal edge writes nothing. An older approved revision stays approved, because the command clears only the pinned one.

The command works only in `approved`. The state alone sets the limit "before execute starts", because `tasker execute` moves the task out of `approved` before it spends anything.

## Limits

- A new base on a second run does not move a task branch that already exists. The stored base can differ from the real start point of the branch.
- An issue that closes after its task exists does not stop a second run. The closed check runs only when no task exists.
- A person who does not answer the question for the base branch holds the repo lock. Another start of the same repo then waits, and it stops with the lock error at the end of its wait.
- The start does not assign the issue and does not mark it in progress. It has no option to take over a lock of a live process, and no stacked base.
- The abort does not delete the task branch on `origin`. No command publishes a task branch before M10.
- A worktree or a branch that start made but did not store stays after an abort. The abort works only on what the task stores.
- The plan reads the title and the body of the issue. It does not read the comments.
- No command resumes a task that is in `failed` or `quota_blocked` before M9. A second `tasker plan` works only on a task in `workspace_ready`.
