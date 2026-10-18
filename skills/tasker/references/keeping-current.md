# Keeping current

This command brings the task branch current with its copy on origin and brings the worktree of the task up to date with its base branch. [Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share. [The Update branch section of docs/statemachine.md](../../../docs/statemachine.md#update-branch) gives the states.

## `tasker update-branch`

Brings the task branch current with its copy on origin and brings the worktree of the task up to date with its base branch: `tasker update-branch <issue> [--strategy rebase|merge]`. The task goes through the state `updating_branch`. The command accepts a task in `workspace_ready`, `awaiting_plan_review`, `approved`, `executed`, `awaiting_work_review`, `reviewed`, `accepted`, `pushed`, `in_peer_review`, `cleanup_failed` or `failed`.

The strategy is the value of `--strategy`. If the option is absent, the strategy is `updateBranchStrategy` of the repo, which is `rebase` by default. The option overrides `updateBranchStrategy` for one run.

The command fetches `origin`. Then it runs the sync step. After that it runs the base step on the new local tip.

### The sync step

The sync step compares two tips. The local tip is the head of the task branch in the clone. The remote tip is the copy of the task branch on `origin` that the fetch wrote. The command pulls in an external change only by a fast-forward. In each other case, it moves nothing, or it tells you to fix the branch.

| Case                                           | What the command does                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The remote tip is absent                       | Nothing moves. The note `note: origin/<task branch> does not exist; nothing to sync from` goes to stderr.                                                                                                                                                                                                                                 |
| The two tips are equal                         | Nothing moves.                                                                                                                                                                                                                                                                                                                            |
| The local tip is an ancestor of the remote tip | The task branch and the worktree move to the remote tip by a fast-forward.                                                                                                                                                                                                                                                                |
| The remote tip is an ancestor of the local tip | Nothing moves.                                                                                                                                                                                                                                                                                                                            |
| The tips have diverged                         | Nothing moves. The command fails with the error `<task branch> and origin/<task branch> have diverged; make one of them contain the other, then run tasker update-branch <issue key> again`. The rule of a failure after the move applies as it is: the task goes back to its origin state, with the `branch_updated` event with `error`. |

A task that nobody pushed gets the note on each run.

### The base step

The base step reads the tip of the base. If the task branch contains the tip, the head does not move. If not, the command moves the worktree onto the tip with a fast-forward, a rebase or a merge. A conflict restores the worktree to its start.

If the base step fails after a fast-forward of the sync step, the command also moves the task branch and the worktree back to the local tip from before the sync step. As a result, a failed update changes nothing.

The `branch_updated` event has the key `sync`. Its value is `absent`, `none` or `fast-forward`. `before.head` is the local tip before the sync step.

When the head moved in the sync step or in the base step, the command writes a `base` event `{ base, revision, source: "update" }`. The `base` is the stored base. The `revision` is the stored base revision, for example `refs/remotes/origin/main`. The command writes no `base` event when the head did not move.

On success, the command prints these lines on stdout:

- `synced <task branch> from origin/<task branch> at <remote tip> by fast-forward` first, only when the sync step moved the head.
- `<issue key> is current with <base> at <base tip>; nothing moved` when the base step did not move the head. The line describes only the base step.
- `moved <issue key> onto <base> at <base tip> by <how>: <head before> to <head after>` when the base step moved the head. `<head before>` is the head at the start of the base step. The value of `<how>` is `fast-forward`, `rebase` or `merge`.
- `demoted <issue key> from <origin> to <target>` only when the target differs from the origin state.
- `state: <state>` as the last line.

### The state after the command

A move of the sync step counts as a moved head. If the head did not move, the task goes back to its origin state. If the head moved, the old approval or the old verify result no longer describes the tree, so the task goes to the target of this table:

| Origin state                                                                                    | Target                 |
| ----------------------------------------------------------------------------------------------- | ---------------------- |
| `approved`                                                                                      | `awaiting_plan_review` |
| `awaiting_work_review`, `reviewed`, `accepted`, `pushed`, `in_peer_review`                      | `executed`             |
| `failed`, when the task failed in `reviewing`, `accepted`, `pushing`, `opening_pr` or `merging` | `executed`             |
| Each other origin state                                                                         | The origin state       |

For the origin `approved`, the command clears the approval of the pinned plan revision. It writes no `unapproved` event.

After a move of the head, also a move of the sync step, `tasker approve` refuses a plan that is older than the move. The error is `the plan v<N> of <issue key> is older than the last move of the worktree; run tasker refine <issue key> "<feedback>" first`.

### Errors

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and nothing is written. The shared errors of no task, of [the wrong state](../SKILL.md#shared-errors), of the task lock and of the clone lock belong to this group:

- The task has no branch, no worktree, no base or no base revision.
- The value of `--strategy` is not `rebase` or `merge`. The error is `--strategy must be rebase or merge: <value>`.
- The worktree has uncommitted changes. The error has the line `the worktree has uncommitted changes: <path>`, then one line for each change, and the last line `tasker update-branch needs a clean worktree`.

When a step fails after the move to `updating_branch`, the command prints the error on stderr and stops with exit code 1. The step can be the fetch, the sync step, the move of the branch, a conflict, a failed restore or a failed write. Diverged tips are one such failure. A conflict message names each path in conflict. A failed restore names the git commands that put the worktree back. The state after the failure depends on the worktree:

- The worktree is back at the start when three facts hold: the head is the head of the start, the worktree is on the task branch, and the worktree is clean. Then the task goes back to its origin state. The command writes a `branch_updated` event with `error`, `how: "none"` and `after` equal to `before`, in place of a `transition` event. The error on stderr and in the event is the bare message.
- In each other case, the task goes to `failed` with the error `updating branch failed: <message>`. The command prints the same error on stderr.

A failed read of the state of the worktree counts as not back at the start. `tasker retry` has no row for a task that failed in `updating_branch`. After a failed restore, run the git commands that the error names. Then run `tasker update-branch` again from `failed`, or run `tasker abort` to end the task.

A crash during the command leaves the task in `updating_branch` with its run marker. The next command that reads the task moves it to `interrupted`.
