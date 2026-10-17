# Recovery commands

These commands retry a failed step, resume a paused task and cancel a task. [Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share. [The Failure and retry section of docs/statemachine.md](../../../docs/statemachine.md#failure-and-retry) gives the states. [The Pauses section](../../../docs/statemachine.md#pauses) gives the pauses.

## `tasker retry`

Moves a task in the state `failed` back to the state before the step that failed, and runs that step again: `tasker retry <issue>`.

`--resume-execute` works only for a task that failed in `verifying`. The command marks every todo `done` and queues one fix turn for the failure, in place of a new verify run.

The command reads the origin. The origin is the state that the task left when it failed. `tasker show` prints it as `failed in`. The command looks up the origin in this table:

- `provisioning`: the command does not move the task. `tasker start` moves it from `failed` to `provisioning`, and the command runs it.
- `planning`: the task goes to `workspace_ready`. The command deletes the plan session, so that the next run starts a new session. Then it runs `tasker plan`.
- `refining`, when the origin of the refine is `awaiting_plan_review` or `failed`: the task goes to `awaiting_plan_review`. Nothing runs. The command prints a hint, because a refine needs new feedback from you.
- `refining`, when the origin of the refine is `reviewed`: the task goes to `reviewed`. Nothing runs. The command prints a hint, because the findings can change what you want.
- `refining`, when the origin of the refine is `awaiting_work_review`: the task goes to `awaiting_work_review`. Nothing runs. The command prints a hint, because the feedback can change what you want.
- `executing`: the task goes to `approved`. The command deletes the execute session of the pinned revision, so that the next run starts a new session. Then it runs `tasker execute`. A todo that is `done` gets no new turn.
- `verifying`: the task goes to `executed`, and the command runs `tasker verify`.
- `verifying` with `--resume-execute`: the task goes to `approved`. The command marks every todo of the pinned revision `done` and queues one fix turn. Then it runs `tasker execute`, which continues the execute session and runs only the fix turn.
- `reviewing`: the task goes to `awaiting_work_review`. The command deletes the review session of the next review number, so that the next run starts a new session. Then it runs `tasker review`.
- `merging`, when the state before the merge is `accepted`: the task goes to `accepted`, and the command runs `tasker merge`. If the work is already on the base branch of `origin`, the merge pushes nothing and moves the task to `landed`.

The origin of a refine is the state that the task left when the last refine started. The state before the merge is the state that the task left when the last merge started.

The deleted session matters because a run that failed before its first turn recorded a session id that names no conversation. A new run must not continue it.

The fix turn gets the error of the failure and the tail of the log of the failing verify command. The tail is the last 200 lines of the log, within 64 KiB. tasker reads the tail and gives it to the assistant, because the log is in the data root and the sandbox of the assistant reaches only the worktree. The command uses a log only when the verify run of this failure recorded it. A failure that recorded no run, a run with no failing command, a command that never started and a log that is missing or cannot be read give a fix turn with no tail. The command never uses an older log, because an older log gives the fix turn false data.

Then the command releases the task lock and runs the next command. The output starts with this line on stdout:

- `retried <issue key>: failed in <origin>, back in <target>`

For the origin `provisioning`, the target is `provisioning`, so the line is `retried <issue key>: failed in provisioning, back in provisioning`.

For a task that failed in `provisioning`, the steps of `tasker start` run with no `--base`. If they stop because no base branch is known, run `tasker start <issue> --base <branch>`. `tasker start` continues the same task.

The output of the next command follows: the output of `tasker start`, `tasker plan`, `tasker execute`, `tasker verify`, `tasker review` or `tasker merge`. The next command keeps its own errors and its own exit code. If it fails, the task goes to `failed` again with a new error, and you can run `tasker retry` again. For the origin `refining`, the command prints one line and exits with code 0. The line depends on the origin of the refine:

- `awaiting_plan_review` or `failed`: `run tasker refine <issue key> "<feedback>" again`
- `reviewed`: `run tasker refine <issue key> again to act on the findings, or tasker dismiss-review <issue key> "<reason>"`
- `awaiting_work_review`: `run tasker review <issue key> "<feedback>" again`

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and the command writes nothing. The shared errors of no task, of [the wrong state](../SKILL.md#shared-errors) and of the task lock belong to this group:

- The task failed in a state that retry has no step for. The error is `the task of <issue key> failed in <state>; tasker retry has no step for it`. A task that failed in `merging` after a move from a state other than `accepted` gets this error too.
- You gave `--resume-execute` for a task that did not fail in `verifying`. The error is `--resume-execute applies only to a task that failed in verifying`.

## `tasker resume`

Moves a task in `quota_blocked` or `interrupted` back to the state before the run that stopped, and runs the same command again: `tasker resume <issue>`.

The command reads the origin. The origin is the state that the task left when the run stopped. The command looks up the origin in this table:

- `planning`: the task goes to `workspace_ready`, and the command runs `tasker plan`. The plan session continues.
- `refining`, when the origin of the refine is `awaiting_plan_review` or `failed`: the task goes to `awaiting_plan_review`, and the command runs `tasker refine` with the feedback that the move into `refining` recorded.
- `refining`, when the origin of the refine is `reviewed`: the task goes to `reviewed`, and the command runs `tasker refine` with the recorded feedback, or with none if you gave none.
- `refining`, when the origin of the refine is `awaiting_work_review`: the task goes to `awaiting_work_review`, and the command runs `tasker review` with the recorded feedback.
- `executing`: the task goes to `approved`, and the command runs `tasker execute`. The execute session continues, and a todo that is `done` gets no new turn.
- `verifying`: only a task in `interrupted` has this origin. The task goes to `executed`, and the command runs `tasker verify`. The verify run starts again from the first command, because a verify run has no session.
- `reviewing`: the task goes to `awaiting_work_review`. The command deletes the review session of the next review number, and then runs `tasker review`, which starts a new session.
- `merging`, when the state before the merge is `accepted`: the task goes to `accepted`, and the command runs `tasker merge`. If the work is already on the base branch of `origin`, the merge pushes nothing and moves the task to `landed`.
- `finishing`: the task goes to `landed`, and the command runs `tasker finish`. The target is `landed` also when the task came to `finishing` from `cleanup_failed`. Each cleanup step skips what is already done.

The command prints this line on stdout, then releases the task lock and runs the next command:

- `resumed <issue key>: paused in <origin>, back in <target>`

The next command keeps its own output, its own errors and its own exit code. The reference section of the next command gives them. If the assistant never created the session that the next command continues, the next command fails. Then `tasker retry` starts a new session.

The command does not wait for the reset time of a quota limit. You decide when to run it. If the run of the task is dead, the note of the dead run comes on stderr first. See [A dead run](../SKILL.md#a-dead-run).

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and the command writes nothing. If the run of the task is dead, the task moves to `interrupted` before the checks (see [A dead run](../SKILL.md#a-dead-run)). The shared errors of no task, of [the wrong state](../SKILL.md#shared-errors) and of the task lock belong to this group:

- The task is in a state other than `quota_blocked` or `interrupted`. The error is `the task of <issue key> is in <state>; tasker resume needs quota_blocked or interrupted`, then the commands that the state accepts. For a task in `awaiting_quota_approval`, run [`tasker approve-credits`](#tasker-approve-credits).
- The task paused from a state that resume has no step for. The error is `the task of <issue key> was paused from <state>; tasker resume has no step for it`. A task that paused in `merging` after a move from a state other than `accepted` gets this error too.

## `tasker approve-credits`

Continues a task in `awaiting_quota_approval`, or in `quota_blocked` at the overage boundary, approves paid usage in the quota window of the pause, and runs the same command again: `tasker approve-credits <issue>`.

The command moves the task like [`tasker resume`](#tasker-resume). It reads the origin, moves the task to the state before the run that stopped, and runs the next command. The table of `tasker resume` gives the target and the next command.

The approval belongs to one task and one quota window. The command records the reset time of that window from the pause record. The record and the move happen in one transaction. A later approval replaces an earlier one. The next command then does not pause again for a warning of that window, and does not stop at the overage boundary of that window. A new window needs a new approval.

The command prints one of these lines on stdout. Then it prints the resumed line of `tasker resume` and runs the next command:

- `approved credits for <issue key>: the quota window that resets at <ISO time>`, when the pause record names a window
- `approved credits for <issue key>: the pause named no window, so the next warning pauses again`, when a warning pause named no reset time. The command records no approval in this case.

The next command keeps its own output, its own errors and its own exit code.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and the command writes nothing. If the run of the task is dead, the task moves to `interrupted` before the checks (see [A dead run](../SKILL.md#a-dead-run)). The shared errors of no task, of [the wrong state](../SKILL.md#shared-errors) and of the task lock belong to this group:

- The task is in a state other than `quota_blocked` or `awaiting_quota_approval`. The error is `the task of <issue key> is in <state>; tasker approve-credits needs quota_blocked or awaiting_quota_approval`, then the commands that the state accepts.
- The task is in `quota_blocked` because of a subscription limit. Paid usage cannot continue it. The error is `the task of <issue key> stopped at a subscription limit, and paid usage cannot continue it; run tasker resume <issue key> after the reset`.
- The task is in `quota_blocked` because of the overage boundary, but the stop named no window. An approval cannot hold. The error is `the task of <issue key> stopped at the overage boundary, but the stop named no window, so an approval cannot hold; run tasker resume <issue key> after the reset`.
- The task paused from a state that this command has no step for. The error is `the task of <issue key> was paused from <state>; tasker approve-credits has no step for it`. A task that paused in `refining` after a refine from `accepted` gets this error.

## `tasker abort`

Removes the worktree and the local task branch of an active task, and moves the task to the state `cancelled`: `tasker abort <issue>`.

`--force` discards the uncommitted changes of the worktree before the abort.

The command prints one line for each step that ran, then `cancelled <issue>`. If the run of the task is dead, the notes of the dead run come on stderr before the steps. See [A dead run](../SKILL.md#a-dead-run). The steps are the discard of the uncommitted changes (only with `--force`), the removal of the worktree and the deletion of the branch. A step that has nothing to do prints no line. The files under `artifacts/` stay.

The command stops with exit code 1 and prints the error on stderr in these cases. The shared errors of the task lock and of the clone lock belong to this list:

- The task is `finished` or `cancelled`. The error names the state. A task in any other state, `failed` included, can be aborted.
- The task has a run in progress. The error is `the task of <issue> has a run in progress in <state> (tasker process <pid>); wait for it, or stop that process`. The command changes nothing.
- The worktree has uncommitted changes and you did not pass `--force`. The error lists each change, then says `tasker abort --force discards them`. Commit the changes or pass `--force`.
- A step fails. The task keeps its state, so run the command again. The second run finishes the steps that are left.
