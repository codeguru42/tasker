# Keeping current

This command brings the worktree of a task up to date with its base branch. [Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share. [The Update branch section of docs/statemachine.md](../../../docs/statemachine.md#update-branch) gives the states.

## `tasker update-branch`

Brings the worktree of a task up to date with its base branch: `tasker update-branch <issue> [--strategy rebase|merge]`. The task goes through the state `updating_branch`. The command accepts a task in `workspace_ready`, `awaiting_plan_review`, `approved`, `executed`, `awaiting_work_review`, `reviewed`, `accepted`, `pushed`, `in_peer_review`, `cleanup_failed` or `failed`.

The strategy is the value of `--strategy`. If the option is absent, the strategy is `updateBranchStrategy` of the repo, which is `rebase` by default. The option overrides `updateBranchStrategy` for one run.

The command fetches `origin` and reads the tip of the base. If the task branch contains the tip, the head does not move. If not, the command moves the worktree onto the tip with a fast-forward, a rebase or a merge. A conflict restores the worktree to its start.

When the head moved, the command writes a `base` event `{ base, revision, source: "update" }`. The `base` is the stored base. The `revision` is the stored base revision, for example `refs/remotes/origin/main`. The command writes no `base` event when the head did not move.

On success, the command prints these lines on stdout:

- `<issue key> is current with <base> at <base tip>; nothing moved` when the head did not move.
- `moved <issue key> onto <base> at <base tip> by <how>: <head before> to <head after>` when the head moved. The value of `<how>` is `fast-forward`, `rebase` or `merge`.
- `demoted <issue key> from <origin> to <target>` only when the target differs from the origin state.
- `state: <state>` as the last line.

### The state after the command

If the head did not move, the task goes back to its origin state. If the head moved, the old approval or the old verify result no longer describes the tree, so the task goes to the target of this table:

| Origin state                                                                                    | Target                 |
| ----------------------------------------------------------------------------------------------- | ---------------------- |
| `approved`                                                                                      | `awaiting_plan_review` |
| `awaiting_work_review`, `reviewed`, `accepted`, `pushed`, `in_peer_review`                      | `executed`             |
| `failed`, when the task failed in `reviewing`, `accepted`, `pushing`, `opening_pr` or `merging` | `executed`             |
| Each other origin state                                                                         | The origin state       |

For the origin `approved`, the command clears the approval of the pinned plan revision. It writes no `unapproved` event.

After a move of the head, `tasker approve` refuses a plan that is older than the move. The error is `the plan v<N> of <issue key> is older than the last move of the worktree; run tasker refine <issue key> "<feedback>" first`.

### Errors

The command stops with exit code 1 and prints the error on stderr in these cases. In each case, the task keeps its state and nothing is written. The shared errors of no task, of [the wrong state](../SKILL.md#shared-errors), of the task lock and of the clone lock belong to this group:

- The task has no branch, no worktree, no base or no base revision.
- The value of `--strategy` is not `rebase` or `merge`. The error is `--strategy must be rebase or merge: <value>`.
- The worktree has uncommitted changes. The error has the line `the worktree has uncommitted changes: <path>`, then one line for each change, and the last line `tasker update-branch needs a clean worktree`.

When a step fails after the move to `updating_branch`, the command prints the error on stderr and stops with exit code 1. The step can be the fetch, the move of the branch, a conflict or a failed restore. The task goes to `failed` with the error `updating branch failed: <message>`. A conflict message names each path in conflict. A failed restore names the git commands that put the worktree back.

A crash during the command leaves the task in `updating_branch` with its run marker. The next command that reads the task moves it to `interrupted`.
