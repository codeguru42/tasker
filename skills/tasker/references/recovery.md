# Recovery commands

These commands retry a failed step, resume a paused task and cancel a task. [Shared errors](../SKILL.md#shared-errors)
lists the errors that many commands share.
[The Failure and retry section of docs/statemachine.md](../../../docs/statemachine.md#failure-and-retry) gives the
states. [The Pauses section](../../../docs/statemachine.md#pauses) gives the pauses.

## `tasker retry`

Moves a task in the state `failed` back to the state before the step that failed, and runs that step again:
`tasker retry <issue>`.

`--resume-execute` works only for a task that failed in `verifying`. The command marks every todo `done` and queues one
fix turn for the failure, in place of a new verify run.

The command reads the origin. The origin is the state that the task left when it failed. `tasker show` prints it as
`failed in`. The command looks up the origin in this table:

- `provisioning`: the command does not move the task. `tasker start` moves it from `failed` to `provisioning`, and the
  command runs it.
- `planning`: the task goes to `workspace_ready`. The command deletes the plan session, so that the next run starts a
  new session. Then it runs `tasker plan`.
- `refining`, when the origin of the refine is `awaiting_plan_review` or `failed`: the task goes to
  `awaiting_plan_review`. Nothing runs. The command prints a hint, because a refine needs new feedback from you.
- `refining`, when the origin of the refine is `reviewed`: the task goes to `reviewed`. Nothing runs. The command prints
  a hint, because the findings can change what you want.
- `refining`, when the origin of the refine is `awaiting_work_review`: the task goes to `awaiting_work_review`. Nothing
  runs. The command prints a hint, because the feedback can change what you want.
- `executing`: the task goes to `approved`. The command deletes the execute session of the pinned revision, so that the
  next run starts a new session. Then it runs `tasker execute`. A todo that is `done` gets no new turn.
- `verifying`: the task goes to `executed`, and the command runs `tasker verify`.
- `verifying` with `--resume-execute`: the task goes to `approved`. The command marks every todo of the pinned revision
  `done` and queues one fix turn. Then it runs `tasker execute`, which continues the execute session and runs only the
  fix turn.
- `reviewing`: the task goes to `awaiting_work_review`. The command deletes the review session of the next review
  number, so that the next run starts a new session. Then it runs `tasker review`.
- `merging`, when the stored merge origin is `accepted` or `in_peer_review`: the task returns to that state, and the
  command runs `tasker merge`. The saved origin selects the recovery path. The first PR query detects a completed merge
  and prevents another request. See [`tasker merge`](landing.md#tasker-merge) for operation details and results.
- `accepted`: the task goes to `accepted`, and the command runs `tasker push`.
- `opening_pr`: the task goes to `pushed`, and the command runs `tasker open-pr`. This row also covers a failed record
  after tasker created the pull request. `tasker open-pr` looks for a matching open pull request and adopts it before it
  creates another one.
- `pushing`, when the state before the push is `accepted`: the task goes to `accepted`, and the command runs
  `tasker push`.
- `quota_blocked`, `awaiting_quota_approval` or `interrupted`: the command uses the row of the state that the task left
  when it moved into the pause, but only when that state is `planning`, `executing`, `verifying` or `reviewing`. For
  example, a task that failed in `interrupted` after a move from `executing` goes to `approved`, and the command runs
  `tasker execute`. The first line is then `retried <issue key>: failed in interrupted, back in approved`. A task that
  failed in `interrupted` after a push has no retry step. Retry uses the direct row for `interrupted`, which has no
  entry for a push.

When a reopen fails while refining from `accepted` or `pushed`, retry returns the task to that same state. It prints the
retry line, then the hint for that origin from the list below.

Retry prints only a hint. It starts no assistant and does not print the saved feedback. Run the command with new
feedback.

A failed reopen can stop while tasker resyncs the branch to its base. If `reopen_start_head` has a value, retry restores
the worktree to that head under the repo lock. Retry clears the saved head in the same database transaction as the state
move and retry event. The restore ends any unfinished resync and removes uncommitted changes and untracked files,
including edits made after the failure. If `reopen_start_head` is NULL, resync finished. Retry keeps the branch movement
and makes no Git call.

The origin of a refine is the state that the task left when the last refine started. Retry reads a merge origin from the
task's stored `merge_origin` value. It accepts only `accepted` and `in_peer_review`.

The deleted session matters because a run that failed before its first turn recorded a session id that names no
conversation. A new run must not continue it.

The fix turn gets the error of the failure and the tail of the log of the failing verify command. The tail is the last
200 lines of the log, within 64 KiB. tasker reads the tail and gives it to the assistant, because the log is in the data
root and the sandbox of the assistant reaches only the worktree. The command uses a log only when the verify run of this
failure recorded it. A failure that recorded no run, a run with no failing command, a command that never started and a
log that is missing or cannot be read give a fix turn with no tail. The command never uses an older log, because an
older log gives the fix turn false data.

Then the command releases the task lock and runs the next command. The output starts with this line on stdout:

- `retried <issue key>: failed in <origin>, back in <target>`

For the origin `provisioning`, the target is `provisioning`, so the line is
`retried <issue key>: failed in provisioning, back in provisioning`.

For a task that failed in `provisioning`, the steps of `tasker start` run with no `--base`. If they stop because no base
branch is known, run `tasker start <issue> --base <branch>`. `tasker start` continues the same task.

The next command prints its output after the retry line. It keeps its own errors and exit code. It can be
`tasker start`, `tasker plan`, `tasker execute`, `tasker verify`, `tasker review`, `tasker merge`, `tasker push` or
`tasker open-pr`. If it fails, the task goes to `failed` again with a new error. You can run `tasker retry` again. For
the origin `refining`, the command prints one hint line and exits with code 0. The line depends on the origin of the
refine:

- `awaiting_plan_review` or `failed`: `run tasker refine <issue key> "<feedback>" again`
- `reviewed`:
  `run tasker refine <issue key> again to act on the findings, or tasker dismiss-review <issue key> "<reason>"`
- `awaiting_work_review`: `run tasker review <issue key> "<feedback>" again`
- `accepted` or `pushed`: `run tasker reopen <issue key> "<feedback>" again`

The command makes its move before it runs the next command. If the guard of a stacked task refuses the next command, the
task stays in the target state. The refusal is the error of that command. Run `tasker update-branch <issue key>`. Then
read the state and the `next:` or `commands:` line that it prints. Run a command that the state allows.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state
and the command writes no task data or event. The shared errors of no task, of
[the wrong state](../SKILL.md#shared-errors) and of the task lock belong to this group:

- The task failed in a state that retry has no step for. The error is
  `the task of <issue key> failed in <state>; tasker retry has no step for it`. A task that failed in a pause after a
  move from a state with no retry row gets this error too. The error then names the pause as the state. A failure from
  `interrupted` after a push remains refused.
- The task failed in `merging`, but `merge_origin` is NULL or is not `accepted` or `in_peer_review`. Retry makes no move
  and reports
  `the task of <issue key> has no valid stored merge origin; use tasker mark-landed to record an external landing`. The
  hint names [`tasker mark-landed`](landing.md#tasker-mark-landed), but that command accepts only `accepted`, `pushed`
  or `in_peer_review`, so it cannot run directly from `failed`.
- You gave `--resume-execute` for a task that did not fail in `verifying`. The error is
  `--resume-execute applies only to a task that failed in verifying`.
- The repo lock is busy, or Git cannot restore the saved reopen head. Retry leaves the task in `failed` and keeps
  `reopen_start_head`. It prints no retry line or hint. The error names the lock or gives Git's restore error and
  recovery commands. A failed restore can leave the worktree partly changed.
- The restore worked, but the database could not write the retry move or event. Retry reports the database error and the
  restored branch head. It leaves the task in `failed` and keeps `reopen_start_head`, so the next retry restores the
  same head again.

## `tasker resume`

Moves a task in `quota_blocked` or `interrupted` back to the state before the run that stopped, and runs the same
command again, except for a task that stopped in `updating_branch`: `tasker resume <issue>`. For that task, the command
first puts the worktree back at the head from before the update, and then it runs nothing.

The command reads the origin. The origin is the state that the task left when the run stopped. The command looks up the
origin in this table:

- `planning`: the task goes to `workspace_ready`, and the command runs `tasker plan`. The plan session continues.
- `refining`, when the origin of the refine is `awaiting_plan_review` or `failed`: the task goes to
  `awaiting_plan_review`, and the command runs `tasker refine` with the feedback that the move into `refining` recorded.
- `refining`, when the origin of the refine is `accepted`: the task goes to `accepted`, and the command runs
  `tasker reopen` with the recorded feedback.
- `refining`, when the origin of the refine is `pushed`: the task goes to `pushed`, and the command runs `tasker reopen`
  with the recorded feedback.
- `refining`, when the origin of the refine is `reviewed`: the task goes to `reviewed`, and the command runs
  `tasker refine` with the recorded feedback, or with none if you gave none.
- `refining`, when the origin of the refine is `awaiting_work_review`: the task goes to `awaiting_work_review`, and the
  command runs `tasker review` with the recorded feedback.
- `executing`: the task goes to `approved`, and the command runs `tasker execute`. The execute session continues, and a
  todo that is `done` gets no new turn.
- `verifying`: only a task in `interrupted` has this origin. The task goes to `executed`, and the command runs
  `tasker verify`. The verify run starts again from the first command, because a verify run has no session.
- `reviewing`: the task goes to `awaiting_work_review`. The command deletes the review session of the next review
  number, and then runs `tasker review`, which starts a new session.
- `merging`, when the stored merge origin is `accepted` or `in_peer_review`: the task returns to that state, and the
  command runs `tasker merge`. The saved origin selects the recovery path. The first PR query detects a completed merge
  and prevents another request. See [`tasker merge`](landing.md#tasker-merge) for operation details and results.
- `pushing`: the task goes to `accepted`, and the command runs `tasker push`.
- `opening_pr`: only a task in `interrupted` can have this origin. The task goes to `pushed`, and the command runs
  `tasker open-pr`. If tasker created the pull request before it stored its number, `tasker open-pr` finds and adopts
  it.
- `finishing`: the task goes to `landed`, and the command runs `tasker finish`. The target is `landed` also when the
  task came to `finishing` from `cleanup_failed`. The repeated cleanup skips local resources that are already gone and
  treats a remote branch that finish already deleted as already gone.
- `updating_branch`: only a task in `interrupted` has this origin. The task goes back to the origin of the update, which
  is the state that it left when `tasker update-branch` started. The command first puts the worktree back at the head
  from before the update. It ends a rebase or a merge in progress, puts the task branch and the worktree at that head,
  and removes the uncommitted changes and the untracked files. Then it moves the task and runs nothing. The restore
  discards changes and untracked files, so an edit that you made after the crash is lost.

The command prints this line on stdout, then releases the task lock and runs the next command:

- `resumed <issue key>: paused in <origin>, back in <target>`

For a task that stopped in `updating_branch`, the command prints two more lines on stdout after the move is written, and
then stops with exit code 0:

- `restored the worktree of <issue key> to <head>`
- `run tasker update-branch <issue key> again`

For the other origins, the next command keeps its own output, its own errors and its own exit code. The reference
section of the next command gives them. If the assistant never created the session that the next command continues, the
next command fails. Then `tasker retry` starts a new session.

If reopen stopped before it recorded the resync, resume restores the saved start head under the repo lock before it
moves the task to `accepted` or `pushed`. The move clears the recovery head in the same transaction. If resync was
already recorded, the recovery head is NULL and resume keeps the resynced worktree. A failed restore leaves the task in
its pause with the recovery head still set, and starts no assistant. Resume releases the repo lock before it runs
`tasker reopen` again with the recorded feedback.

The command makes its move before it runs the next command. If the guard of a stacked task refuses the next command, the
task stays in the target state. The refusal is the error of that command. Run `tasker update-branch <issue key>`. Then
read the state and the `next:` or `commands:` line that it prints. Run a command that the state allows.

For a merge recovery, resume reads the task's stored `merge_origin` value. It accepts only `accepted` and
`in_peer_review`. A NULL value or any other value makes resume stop without a move. It reports
`the task of <issue key> has no valid stored merge origin; use tasker mark-landed to record an external landing`. The
hint names [`tasker mark-landed`](landing.md#tasker-mark-landed), but that command accepts only `accepted`, `pushed` or
`in_peer_review`, so it cannot run directly from `interrupted`.

The first PR status check detects a merge that completed before the stop, so resume does not request it again. See
[`tasker merge`](landing.md#tasker-merge) for the PR merge checks and results.

The command does not wait for the reset time of a quota limit. You decide when to run it. If the run of the task is
dead, the note of the dead run comes on stderr first. See [A dead run](../SKILL.md#a-dead-run).

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state
and the command writes nothing. If the run of the task is dead, the task moves to `interrupted` before the checks (see
[A dead run](../SKILL.md#a-dead-run)). The shared errors of no task, of [the wrong state](../SKILL.md#shared-errors) and
of the task lock belong to this group:

- The task is in a state other than `quota_blocked` or `interrupted`. The error is
  `the task of <issue key> is in <state>; tasker resume needs quota_blocked or interrupted`, then the commands that the
  state accepts. For a task in `awaiting_quota_approval`, run [`tasker approve-credits`](#tasker-approve-credits).
- The task paused from a state that resume has no step for. The error is
  `the task of <issue key> was paused from <state>; tasker resume has no step for it`. A task in `quota_blocked` that
  paused from `updating_branch` gets this error, and so does an update whose origin has no record. Resume refuses a
  quota pause from `opening_pr`; only an interrupted task can resume from that state. A refine pause from `accepted` or
  `pushed` with no recorded feedback has no resume row.
- The task paused in `merging`, but `merge_origin` is NULL or is not `accepted` or `in_peer_review`. Resume makes no
  recovery move and reports
  `the task of <issue key> has no valid stored merge origin; use tasker mark-landed to record an external landing`.
- The move into `updating_branch` recorded no start head. The error is
  `the update of <issue key> recorded no start head; tasker resume cannot restore the worktree`. The task stays in
  `interrupted` and the command writes nothing.
- The restore of the worktree fails. The error starts with `cannot restore the worktree:` and names the git commands
  that put the worktree back. The task stays in `interrupted` and the command writes nothing, so you can run
  `tasker resume` again.
- The restore of a pending reopen resync fails. The task stays in its pause with `reopen_start_head` intact. The error
  names the restore failure, and the command starts no assistant, so you can run `tasker resume` or eligible
  `tasker approve-credits` again.

A resume to `failed` writes a move from `interrupted` to `failed`. The last move into `failed` then comes from
`interrupted`, so `tasker retry` has no step for the task.

## `tasker approve-credits`

Continues a task in `awaiting_quota_approval`, or in `quota_blocked` at the overage boundary, approves paid usage in the
quota window of the pause, and runs the same command again: `tasker approve-credits <issue>`.

The command moves the task like [`tasker resume`](#tasker-resume). It reads the origin, moves the task to the state
before the run that stopped, and runs the next command. The table of `tasker resume` gives the target and the next
command. For a stopped reopen from `accepted` or `pushed`, it returns the task to that same state and runs
`tasker reopen` with the recorded feedback. It uses the same pending-resync restore as `tasker resume`; the restore lock
is free before reopen runs again.

The approval belongs to one task and one quota window. The command records the reset time of that window from the pause
record. The record and the move happen in one transaction. A later approval replaces an earlier one. The next command
then does not pause again for a warning of that window, and does not stop at the overage boundary of that window. A new
window needs a new approval.

The command prints one of these lines on stdout. Then it prints the resumed line of `tasker resume` and runs the next
command:

- `approved credits for <issue key>: the quota window that resets at <ISO time>`, when the pause record names a window
- `approved credits for <issue key>: the pause named no window, so the next warning pauses again`, when a warning pause
  named no reset time. The command records no approval in this case.

The next command keeps its own output, its own errors and its own exit code.

The command makes its move before it runs the next command. If the guard of a stacked task refuses the next command, the
task stays in the target state. The refusal is the error of that command. Run `tasker update-branch <issue key>`. Then
read the state and the `next:` or `commands:` line that it prints. Run a command that the state allows.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state
and the command writes nothing. If the run of the task is dead, the task moves to `interrupted` before the checks (see
[A dead run](../SKILL.md#a-dead-run)). The shared errors of no task, of [the wrong state](../SKILL.md#shared-errors) and
of the task lock belong to this group:

- The task is in a state other than `quota_blocked` or `awaiting_quota_approval`. The error is
  `the task of <issue key> is in <state>; tasker approve-credits needs quota_blocked or awaiting_quota_approval`, then
  the commands that the state accepts.
- The task is in `quota_blocked` because of a subscription limit. Paid usage cannot continue it. The error is
  `the task of <issue key> stopped at a subscription limit, and paid usage cannot continue it; run tasker resume <issue key> after the reset`.
- The task is in `quota_blocked` because of the overage boundary, but the stop named no window. An approval cannot hold.
  The error is
  `the task of <issue key> stopped at the overage boundary, but the stop named no window, so an approval cannot hold; run tasker resume <issue key> after the reset`.
- The task paused from a state that this command has no step for. The error is
  `the task of <issue key> was paused from <state>; tasker approve-credits has no step for it`. A refine pause from
  `accepted` or `pushed` has a route when the refine transition recorded feedback.

## `tasker abort`

Cancels an active task and removes its worktree and local task branch: `tasker abort <issue>`. After
[dead-run collection](../SKILL.md#a-dead-run), abort refuses a terminal task, a live run, or dirty work without
`--force`. `--force` allows it to discard uncommitted work.

After the guards pass, the command takes the repo lock. It deletes the published task branch on origin before it changes
local work, the tracker or the task row. The command uses the stored published revision for this deletion. It then
discards uncommitted work when you pass `--force`, removes the worktree and local branch, runs the tracker step, and
moves the task to `cancelled`.

When the command deletes the remote branch, it prints `deleted <branch> on origin`. It prints no deletion line when the
branch is already gone. When the task has no stored branch or no stored publication revision, it skips remote deletion.
If you pass `--keep-remote`, the command skips remote deletion and prints
`kept <branch> on origin; to delete it: git push origin --delete <branch>` when the task has a stored branch. It prints
no keep hint when the task has no stored branch. After the steps, it prints `cancelled <issue>`.

Deleting a remote branch can remove the head branch of an open or queued PR. Use `--keep-remote` to preserve it.

If remote deletion fails, the command exits with code 1 and writes an error to stderr. A moved branch gives this exact
error:

`cannot abort <issue key>: the task branch <branch> moved on origin: tasker published <published>, origin has <actual>; someone else pushed to it; use --keep-remote to keep that branch`

Any other remote deletion error gives this exact form:

`cannot abort <issue key>: cannot delete the task branch <branch> on origin: <reason>; run tasker abort <issue key> again, or delete the branch from a clone of your own`

For either error, the abort steps after that collection leave the task row, publication, events, run marker, worktree,
local branch and tracker state unchanged. Use `--keep-remote` to cancel while keeping the remote branch.

If remote deletion succeeds but a later local step fails, the command keeps the `deleted <branch> on origin` line on
stdout and writes the later error to stderr. The task stays active. Run `tasker abort <issue>` again to finish cleanup.
The second run accepts that the remote branch is already gone and continues with the local steps.

After dead-run collection, the command exits with code 1 and changes nothing on these refusals. The shared errors of the
task lock and clone lock belong to this list:

- The task is `finished` or `cancelled`. The error names the state. A task in any other state, including `failed`, can
  be aborted.
- The task has a run in progress. The error is
  `the task of <issue> has a run in progress in <state> (tasker process <pid>); wait for it, or stop that process`.
- The worktree has uncommitted changes and you did not pass `--force`. The error lists each change, then says
  `tasker abort --force discards them`.

If you pass `--force`, abort discards the changes before it removes the worktree. If a tracker write fails, the command
prints its warning, still moves the task to `cancelled` and exits with code 0.

For a GitHub repo, the tracker step runs only when `issueTracker.updateOnStart` is `true` and the repo sets
`inProgressLabel`. It removes the in-progress label and prints
`cleared the in-progress marker of <issue> on the tracker`. If this write fails, stderr gets
`warning: cannot clear the in-progress marker of <issue> on the tracker: <error>`.

For a Jira repo, the step runs only when `issueTracker.updateOnStart` is `true` and the repo sets `abortStatus`. This
task must also have marked the issue in progress. The command moves the issue to that status and prints
`moved <issue> to the status "<status>" on the tracker`. If this write fails, stderr gets
`warning: cannot move <issue> to the status "<status>" on the tracker: <error>`.

In each other case, the step makes no call and prints no line. The assignee stays. A step that has nothing to do prints
no line. The files under `artifacts/` stay.

If the run of the task is dead, the notes of the dead run come on stderr before the steps. See
[A dead run](../SKILL.md#a-dead-run).
