# Landing commands

These commands land the work on the base branch, record a landing that happened outside tasker, and clean up.
[Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share.
[The Landing section of docs/statemachine.md](../../../docs/statemachine.md#landing) gives the states.

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
  - The parent is cancelled. The error is
    `the parent <parent key> of <issue key> is cancelled; <issue key> cannot land on it`.
  - The parent is in any other state. The error is
    `the parent <parent key> of <issue key> has not landed; land the parent first, then run tasker update-branch <issue key>`.
- The task has no branch. The error is `the task of <issue key> has no branch`.
- The task has no base. The error is `the task of <issue key> has no base`.
- The task has no parent, and the base is a local branch of the clone. The error is
  `the base of <issue key> is a local branch of the clone: <base>; tasker merge pushes only to a branch on origin`.
- The task has no base revision. The error is `the task of <issue key> has no base revision`.
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

Records that the work of a task in the state `accepted`, `pushed` or `in_peer_review` already landed on the base branch
outside tasker: `tasker mark-landed <issue>`. The task goes to the state `landed`.

The command fetches `origin`. Then it reads the tip of the task branch in the clone and makes sure that the tip of the
base contains it. For a local base, the tip is the tip of the local branch in the clone. The command never pushes.

On success, the command prints the line `marked <issue key> landed at <revision>` on stdout. The revision is the tip of
the task branch.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state
and nothing is written. The shared errors of no task, of the wrong state, of the task lock and of the clone lock belong
to this group:

- The task is stacked, so it has a parent task. The error depends on the parent:
  - The parent landed. The error is
    `the parent <parent key> of <issue key> has landed; run tasker update-branch <issue key> to move the task onto <base that the walk ends on> first`.
    Run `tasker update-branch <issue key>`.
  - The parent is cancelled. The error is
    `the parent <parent key> of <issue key> is cancelled; <issue key> cannot land on it`.
  - The parent is in any other state. The error is
    `the parent <parent key> of <issue key> has not landed; land the parent first, then run tasker update-branch <issue key>`.
- The task has no branch. The error is `the task of <issue key> has no branch`.
- The task has no base. The error is `the task of <issue key> has no base`.
- The task has no base revision. The error is `the task of <issue key> has no base revision`.
- The fetch or the read of the base fails, for example because `origin` has no such base. The error is
  `cannot read the base tip: <error>`.
- The base does not contain the task branch. The error is
  `the branch <branch> (<revision>) is not on the base <base revision> (<base tip>)`. The base revision is the ref that
  the check compared, for example `refs/remotes/origin/main`.

A fetch that ran still moves the refs of `origin` in the clone, also when the command stops with an error.

## `tasker finish`

Cleans up a task in the state `landed` or `cleanup_failed`: `tasker finish <issue>`. The task goes through the state
`finishing` to the state `finished`.

The command removes the worktree of the task. Then it deletes the local task branch. It moves the task to `finishing`
before the first step, and to `finished` after the last step.

The command prints one line on stdout for each step that ran: `removed the worktree <path>` and
`deleted the branch <branch>`. A step with nothing to do prints no line. If `issueTracker.updateOnFinish` is `true`, the
command then marks the issue done on the tracker and prints `marked <issue key> done on the tracker`. At the end, the
command prints the line `finished <issue key>`.

If the write to the tracker fails, the exit code stays 0 and the task still goes to `finished`. The command prints the
warning `warning: cannot mark <issue key> done on the tracker: <error>` on stderr. The error can span two lines. To
finish the write, mark the issue done on the tracker yourself.

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state
and nothing is written. The shared errors of no task, of the wrong state, of the task lock and of the clone lock apply
to this command.

The task goes to `cleanup_failed` when a step fails after the move to `finishing`. The error is
`finishing failed: <reason>`. The command prints the same error on stderr and stops with exit code 1. For example, git
refuses to remove a worktree with uncommitted changes.

To recover, fix the cause and run `tasker finish` again. A second run finishes the steps that are left.

The command keeps the files under `artifacts/`. A crash during the command leaves the task in `finishing` with its run
marker. The next command that reads the task moves it to `interrupted`.
