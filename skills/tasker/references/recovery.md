# Recovery commands

These commands retry a failed step and cancel a task. [Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share. [The Failure and retry section of docs/statemachine.md](../../../docs/statemachine.md#failure-and-retry) gives the states.

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
- `reviewing`: the task goes to `awaiting_work_review`. The command deletes the review session of the next review number, so that the next run starts a new session. Then it runs `tasker review`.
- `verifying` with `--resume-execute`: the task goes to `approved`. The command marks every todo of the pinned revision `done` and queues one fix turn. Then it runs `tasker execute`, which continues the execute session and runs only the fix turn.

The origin of a refine is the state that the task left when the last refine started.

The deleted session matters because a run that failed before its first turn recorded a session id that names no conversation. A new run must not continue it.

The fix turn gets the error of the failure and the tail of the log of the failing verify command. The tail is the last 200 lines of the log, within 64 KiB. tasker reads the tail and gives it to the assistant, because the log is in the data root and the sandbox of the assistant reaches only the worktree. The command uses a log only when the verify run of this failure recorded it. A failure that recorded no run, a run with no failing command, a command that never started and a log that is missing or cannot be read give a fix turn with no tail. The command never uses an older log, because an older log gives the fix turn false data.

Then the command releases the task lock and runs the next command. The output starts with this line on stdout:

- `retried <issue key>: failed in <origin>, back in <target>`

For the origin `provisioning`, the target is `provisioning`, so the line is `retried <issue key>: failed in provisioning, back in provisioning`.

For a task that failed in `provisioning`, the steps of `tasker start` run with no `--base`. If they stop because no base branch is known, run `tasker start <issue> --base <branch>`. `tasker start` continues the same task.

The output of the next command follows: the output of `tasker start`, `tasker plan`, `tasker execute`, `tasker verify` or `tasker review`. The next command keeps its own errors and its own exit code. If it fails, the task goes to `failed` again with a new error, and you can run `tasker retry` again. For the origin `refining`, the command prints one line and exits with code 0. The line depends on the origin of the refine:

- `awaiting_plan_review` or `failed`: `run tasker refine <issue key> "<feedback>" again`
- `reviewed`: `run tasker refine <issue key> again to act on the findings, or tasker dismiss-review <issue key> "<reason>"`
- `awaiting_work_review`: `run tasker review <issue key> "<feedback>" again`

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and the command writes nothing. The shared errors of no task, of [the wrong state](../SKILL.md#shared-errors) and of the task lock belong to this group:

- The task failed in a state that retry has no step for. The error is `the task of <issue key> failed in <state>; tasker retry has no step for it`.
- You gave `--resume-execute` for a task that did not fail in `verifying`. The error is `--resume-execute applies only to a task that failed in verifying`.

## `tasker abort`

Removes the worktree and the local task branch of an active task, and moves the task to the state `cancelled`: `tasker abort <issue>`.

`--force` discards the uncommitted changes of the worktree before the abort.

The command prints one line for each step that ran, then `cancelled <issue>`. The steps are the discard of the uncommitted changes (only with `--force`), the removal of the worktree and the deletion of the branch. A step that has nothing to do prints no line. The files under `artifacts/` stay.

The command stops with exit code 1 and prints the error on stderr in these cases. The shared errors of the task lock and of the clone lock belong to this list:

- The task is `finished` or `cancelled`. The error names the state. A task in any other state, `failed` included, can be aborted.
- The worktree has uncommitted changes and you did not pass `--force`. The error lists each change, then says `tasker abort --force discards them`. Commit the changes or pass `--force`.
- A step fails. The task keeps its state, so run the command again. The second run finishes the steps that are left.
