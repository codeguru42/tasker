# Landing commands

These commands land the work on the base branch, record a landing that happened outside tasker, and clean up.
[Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share.
[The Landing section of docs/statemachine.md](../../../docs/statemachine.md#landing) gives the states.

## `tasker reopen`

Starts a new plan for a task in `accepted` or `pushed`: `tasker reopen <issue> <feedback> [--repo <key>]`. The feedback
is required and must not be blank. Use it to say what bug was found after acceptance and what the new complete plan must
do. The command continues the recorded plan session.

Before it starts, the task must have a branch, worktree, stored base, latest complete plan revision and recorded plan
session. The base guard must pass. The worktree must be clean, on the stored task branch, and at the same HEAD as that
branch. The command refuses a detached worktree or another branch. It fetches the stored base and resyncs the worktree
to its tip with the configured update strategy before the assistant runs.

The command records the worktree HEAD and feedback as it enters `refining`. On success, it records a complete,
unapproved plan revision and moves the task to `awaiting_plan_review`. It prints this form on stdout, with the plan's
todo lines between `todos:` and `questions:`:

```text
reopened <issue key> as revision v<N>
plan: <plan path>
prompt: <prompt path>
todos:
- <todo id>: <todo title>
questions: <count>
state: awaiting_plan_review
```

The revision does not approve or publish the changed work. Approve it, execute it, verify it, review it and accept it
before another push or other publication. Reopen keeps the accepted revision, published revision and any PR record.

Before the task enters `refining`, a refusal exits with code 1 and writes no task or worktree changes. The error names
the failed guard. It can report blank feedback, a missing branch, worktree, base, plan revision or plan session, a dirty
worktree, a detached worktree, another branch, or a task branch HEAD that differs from the worktree HEAD. A task lock or
repo lock refusal also happens before the start write.

After the task enters `refining`, a fetch, resync or completion-record failure moves it to `failed`, starts no
assistant, and prints `reopening failed: <reason>` on stderr. If Git moved the task branch but the completion record
failed, the error also gives the resulting HEAD. An assistant or plan failure moves the task to `failed` and reports the
refining error. A stopped run can continue through `tasker resume` or eligible `tasker approve-credits`; both restore an
unfinished resync before they run reopen again with the recorded feedback. See [tasker retry](recovery.md#tasker-retry)
for recovery after a failed reopen.

## `tasker push`

Publishes the work of a task in `accepted` to its branch on `origin`: `tasker push <issue>`. Publication and landing are
separate choices. The task goes through `pushing` to `pushed`. The command does not need a base branch, an assistant or
a forge.

Before it writes anything, the command reads the exact local task branch tip and compares it with the accepted revision.
It publishes only that task branch. It uses the last published revision as the lease for an update. If tasker has not
published the branch, it uses an empty lease. It does not change the base branch.

On success, the command prints one of these forms on stdout:

- After a push:

  ```text
  pushed <branch> at <revision>
  state: pushed
  ```

- When origin already has that revision:

  ```text
  <branch> is already on origin at <revision>
  state: pushed
  ```

The command stops with exit code 1 and prints the error on stderr in these cases. Before the move to `pushing`, the task
keeps its state and no event or run marker is written. The shared errors of no task, of
[the wrong state](../SKILL.md#shared-errors), of the task lock and of the clone lock belong to this group:

- The task has no branch. The error is `the task of <issue key> has no branch`.
- The task has no accepted revision. The error is `the task of <issue key> has no accepted revision`.
- The local tip differs from the accepted revision. The error names both revisions and says to run
  `tasker update-branch` and review the work again. The command makes this check before it moves the task to `pushing`.

The task goes to `failed` when a step fails after the move to `pushing`. The command prints the error on stderr and
exits with code 1. The error starts with `pushing failed: <reason>`. The provider refuses publication when the task
branch on origin moved from the last published revision. A remote move between the provider's read and push also makes
its lease fail, so the provider does not replace that remote tip.

If the remote push succeeds but tasker cannot record the result, the reason is
`pushed <revision> to origin/<branch>, but tasker cannot record the result: <error>`. If origin already had the
revision, the reason is the store error. Retry the failed task with `tasker retry`. When origin already has the
revision, the provider reports that fact and tasker records it without another push.

A crash during publication leaves the task in `pushing` with its run marker. The next command that reads the task moves
it to `interrupted`. Run `tasker resume` to continue publication. See [tasker resume](recovery.md#tasker-resume).

Do not change tasker-owned worktrees or branch refs outside tasker. Tasker does not protect publication against those
concurrent changes.

## `tasker merge`

Lands the work of a task in the state `accepted` on the base branch of `origin`: `tasker merge <issue>`. The task goes
through the state `merging` to the state `landed`. tasker does not wait for CI.

The command fetches `origin`. Then it reads the tip of the task branch in the clone and the tip of the base on `origin`.
If the tip of the base contains the task branch, the work is on the base already, and the command pushes nothing. If
not, the command pushes the tip of the task branch to the base on `origin` with one publish token. The command moves the
task to `merging` before the fetch, and to `landed` after the push.

On success, the command prints the line `merged <issue key>` on stdout. Then it prints one of these lines:

- `landed: <revision> on origin/<base>` after a push.
- `already on origin/<base>: <revision>. Nothing pushed.` when the work was on the base already.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state
and nothing is written. The shared errors of no task, of [the wrong state](../SKILL.md#shared-errors), of the task lock
and of the clone lock belong to this group:

- The task is stacked, so it has a parent task. The error depends on the parent:
  - The parent landed. The error is
    `the parent <parent key> of <issue key> has landed; run tasker update-branch <issue key> to move the task onto <base that the walk ends on> first`.
    Run `tasker update-branch <issue key>`.
  - The chain of parents has a loop. The error is the loop error of [`tasker update-branch`](keeping-current.md#errors).
  - The end task of the walk has a local base and no parent. The error is the local-base error of
    [`tasker update-branch`](keeping-current.md#errors).
  - The parent is cancelled. The error is
    `the parent <parent key> of <issue key> is cancelled; <issue key> cannot land on it`.
  - The parent is in any other state. The error is
    `the parent <parent key> of <issue key> has not landed; land the parent first, then run tasker update-branch <issue key>`.
- The task has no branch. The error is `the task of <issue key> has no branch`.
- The task has no base. The error is `the task of <issue key> has no base`.
- The task has no parent, and the base is a local branch of the clone. The error is
  `the base of <issue key> is a local branch of the clone: <base>; tasker merge pushes only to a branch on origin`.
- The task has no accepted revision. The error is `the task of <issue key> has no accepted revision`.
  `tasker update-branch` recovers this task, as the paragraph after this list says.
- The tip of the task branch is not the accepted revision. The error is
  `the tip of <branch> (<tip>) is not the accepted revision (<accepted revision>); run tasker update-branch and review the work again`.
  The accepted revision is the revision that the last `tasker accept` stored.

The command makes this compare before the move to `merging`. It reads the exact ref `refs/heads/<branch>` of the clone,
with no fetch. The task keeps its state. A commit after `tasker accept` has no review, so the command lands only the
accepted revision. To recover, run `tasker update-branch`. It moves the task to `executed`, as
[the demotion table](keeping-current.md#the-state-after-the-command) says. Then run `tasker verify`, `tasker review`,
`tasker accept` and `tasker merge` again.

The task goes to `failed` with the error `merging failed: <reason>` when one of these steps fails after the move to
`merging`. The command prints the same error on stderr and stops with exit code 1:

- The fetch or the read of a ref.
- The compare of the tip with the accepted revision, which the command makes again after the fetch, because no lock
  covers a commit in the worktree. The reason is the same error as above. The full error is
  `merging failed: the tip of <branch> (<tip>) is not the accepted revision (<accepted revision>); run tasker update-branch and review the work again`.
  `tasker update-branch` recovers this task. `tasker retry` does not, because it gives the same refusal.
- The land. The reason is the error of the land.
- The record of the result after a push. The reason is
  `pushed <revision> to origin/<base>, but tasker cannot record the result: <error>`. The push happened, so the work is
  on `origin`.

The base can move on `origin` after `tasker accept`. Then the land fails, nothing moves on `origin`, and the task goes
to `failed` from `merging`.

A crash during the command leaves the task in `merging` with its run marker. The next command that reads the task moves
it to `interrupted`.

## `tasker mark-landed`

Declares that work in `accepted`, `pushed` or `in_peer_review` landed: `tasker mark-landed <issue>`. The task moves to
`landed`. The command makes no Git or forge calls and takes no clone lock.

On success, the command prints `marked <issue key> landed\n` on stdout. The command records the declaration and moves
the task in one transaction.

The command stops with exit code 1 and prints the error on stderr when the task does not exist, its state is not one of
the three states above, or another process holds the task lock. In each case, the task and its events stay unchanged.

## `tasker finish`

Cleans up a task in the state `landed` or `cleanup_failed`: `tasker finish <issue>`. The command moves the task to
`finishing` while it cleans up. It moves the task to `finished` when completion succeeds.

The command removes the worktree of the task. Then it deletes the local task branch. If the task has a published
revision, it then deletes the task branch on `origin`. The delete uses a lease on the stored published revision, so it
cannot delete a branch that moved after tasker published it.

The command prints one line on stdout for each step that ran: `removed the worktree <path>` and
`deleted the branch <branch>`. A step with nothing to do prints no line. The remote delete has no success line. After
remote cleanup, if `issueTracker.updateOnFinish` is `true`, the command marks the issue done on the tracker and prints
`marked <issue key> done on the tracker`. At the end, the command prints `finished <issue key>`.

If the remote branch moved from the stored published revision, the command stops before the tracker update. It moves the
task to `cleanup_failed`, exits with code 1, and prints this form on stderr:
`finishing failed: the task branch <branch> moved on origin: tasker published <published>, origin has <actual>; local cleanup already occurred; decide what to do with the extra commits, then run tasker finish <issue key> again`.
The local worktree and branch can already be gone. Inspect the branch on `origin`. If you resolve or remove it, run
`tasker finish` again.

If another remote deletion error occurs, the command records a `remote_cleanup_warning` event, prints a warning on
stderr, and continues to the tracker update and completion. The warning is
`warning: cannot delete the task branch <branch> on origin: <reason>`. This includes a failed read of the remote branch.
The task can finish while its remote branch remains on `origin`.

If the write to the tracker fails, the exit code stays 0 and the task still goes to `finished`. The command prints the
warning `warning: cannot mark <issue key> done on the tracker: <error>` on stderr. The error can span two lines. To
finish the write, mark the issue done on the tracker yourself.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state
and nothing is written. The shared errors of no task, of the wrong state, of the task lock and of the clone lock apply
to this command.

The task goes to `cleanup_failed` when local cleanup fails after the move to `finishing`. The error is
`finishing failed: <reason>`. The command prints the same error on stderr and stops with exit code 1. For example, git
refuses to remove a worktree with uncommitted changes. If the completion record fails after a remote deletion warning,
the error names the successful local cleanup, the failed remote deletion and reason, and the failed completion record.
It does not say that external cleanup succeeded. After successful remote cleanup, the error names that outcome and the
failed completion record.

To recover from an interrupted finish, run `tasker resume`. Resume returns the task to `landed` and runs finish again.
To recover from a cleanup failure, fix the cause and run `tasker finish` again. A second run skips local or remote
resources that are already gone.

The command keeps the files under `artifacts/`. A crash during the command leaves the task in `finishing` with its run
marker. The next command that reads the task moves it to `interrupted`.
