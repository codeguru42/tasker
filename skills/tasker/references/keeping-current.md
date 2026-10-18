# Keeping current

This command brings the task branch current with its copy on origin and brings the worktree of the task up to date with its base branch. [Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share. [The Update branch section of docs/statemachine.md](../../../docs/statemachine.md#update-branch) gives the states.

## `tasker update-branch`

Brings the task branch current with its copy on origin and brings the worktree of the task up to date with its base branch: `tasker update-branch <issue> [--strategy rebase|merge] [--take-remote]`. The task goes through the state `updating_branch`. The command accepts a task in `workspace_ready`, `awaiting_plan_review`, `approved`, `executed`, `awaiting_work_review`, `reviewed`, `accepted`, `pushed`, `in_peer_review`, `cleanup_failed` or `failed`.

The strategy is the value of `--strategy`. If the option is absent, the strategy is `updateBranchStrategy` of the repo, which is `rebase` by default. The option overrides `updateBranchStrategy` for one run.

The command fetches `origin`. Then it runs the sync step. After that it runs the base step on the new local tip.

### The sync step

The sync step compares two tips. The local tip is the head of the task branch in the clone. The remote tip is the copy of the task branch on `origin` that the fetch wrote. The step moves the task branch to the remote tip by a fast-forward. For tips that have diverged, the step compares the patches of the two sides, because a rebase rewrites each commit. As a result, a branch that someone pushed and then rebased does not count as local work at risk.

Neither tip contains the other when the tips have diverged. These terms apply to a divergence:

- The remote side is the commits that only the remote tip reaches.
- The local side is the commits that only the local tip reaches.
- The same patch is the same git patch id, as [the patch check](../../../docs/dev/rebase-conflicts.md#the-patch-check) describes.
- A commit only on origin is a remote-side commit with no same-patch commit on the local side. A remote-side merge commit always counts as one.
- Local work at risk is a local-side commit that is not a merge commit, has no same-patch commit on the remote side, and that the base tip does not reach. A local-side merge commit never counts.

| Case                                                                            | Without `--take-remote`                                                                                   | With `--take-remote`                                     |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| The remote tip is absent                                                        | Nothing moves. The note `note: origin/<task branch> does not exist; nothing to sync from` goes to stderr. | The same as without the option.                          |
| The two tips are equal                                                          | Nothing moves.                                                                                            | Nothing moves.                                           |
| The local tip is an ancestor of the remote tip                                  | The task branch and the worktree move to the remote tip by a fast-forward.                                | The same as without the option.                          |
| The remote tip is an ancestor of the local tip                                  | Nothing moves.                                                                                            | Nothing moves.                                           |
| The tips have diverged, with no commit only on origin and no local work at risk | Nothing moves.                                                                                            | The task branch and the worktree move to the remote tip. |
| The tips have diverged, with a commit only on origin and no local work at risk  | The task branch and the worktree move to the remote tip.                                                  | The task branch and the worktree move to the remote tip. |
| The tips have diverged, with local work at risk                                 | Nothing moves. The command fails with the at-risk error.                                                  | The task branch and the worktree move to the remote tip. |

The at-risk error lists each commit at risk, oldest first, with the first 7 characters of its hash and its subject:

```
<task branch> and origin/<task branch> have diverged, and origin/<task branch> has no copy of these commits:
<short hash> <subject>
run tasker update-branch <issue key> --take-remote to take origin/<task branch> and drop them
```

The rule of a failure after the move applies as it is: the task goes back to its origin state, with the `branch_updated` event with `error`.

`--take-remote` acts only on a divergence. In each other case, a fast-forward or no move is already right, so the flag has nothing to take. When the flag moves the task branch, it drops the local commits that the remote tip does not hold. The command refuses a worktree with uncommitted changes before the move to `updating_branch`. As a result, the take drops no uncommitted change.

The compare by patch has limits. The message, the author and whitespace do not count. A commit that differs from its copy only in these is the same patch.

A task that nobody pushed gets the note on each run.

### The base step

The base step reads the tip of the base. If the task branch contains the tip, the head does not move. If not, the command moves the worktree onto the tip with a fast-forward, a rebase or a merge. A conflict restores the worktree to its start.

If the base step fails after a move of the sync step, the command also moves the task branch and the worktree back to the local tip from before the sync step. As a result, a failed update changes nothing.

The `branch_updated` event has the key `sync`. Its value is `absent`, `none`, `fast-forward` or `take-remote`. `before.head` is the local tip before the sync step.

When the head moved in the sync step or in the base step, the command writes a `base` event `{ base, revision, source: "update" }`. The `base` is the stored base. The `revision` is the stored base revision, a ref, for example `refs/remotes/origin/main`. The command writes no `base` event when the head did not move. A task whose parent landed is the exception: [The base step of a stacked task](#the-base-step-of-a-stacked-task) gives its `base` event.

On success, the command prints these lines on stdout:

- `synced <task branch> from origin/<task branch> at <remote tip> by <sync>` first, only when the sync step moved the head. The value of `<sync>` is `fast-forward` or `take-remote`.
- `<issue key> is current with <base> at <base tip>; nothing moved` when the base step did not move the head. The line describes only the base step.
- `moved <issue key> onto <base> at <base tip> by <how>: <head before> to <head after>` when the base step moved the head. `<head before>` is the head at the start of the base step. The value of `<how>` is `fast-forward`, `rebase` or `merge`.
- `demoted <issue key> from <origin> to <target>` only when the target differs from the origin state.
- `state: <state>` as the last line.

### The base step of a stacked task

A stacked task is a task whose base is `refs/heads/<x>`, where `<x>` is the branch of a task of the same repo. That task is the parent. If more than one task has the branch, the parent is the newest of them. The parent has landed when its task is in `landed`, `finishing`, `cleanup_failed` or `finished`.

The new tip depends on the parent:

- While the parent is in flight, the new tip is the tip of `refs/heads/<parent branch>`.
- After the parent landed, the new tip is the tip of the base of the parent on `origin`, read after the fetch. The task is then no longer stacked.

The strategy picks the move.

Under `rebase`, the command replays the commits of the task branch after the merge base of the task branch and the new tip onto the new tip, with a rebase. The `how` is `rebase`. Git skips each old commit of the parent whose patch the new tip already holds. A commit that git cannot replay is an ordinary rebase conflict, and the rule of a failure after the move applies as it is.

Under `merge`, the command makes a fast-forward when the head is an ancestor of the new tip, and the `how` is `fast-forward`. Otherwise it merges the new tip into the task branch, and the `how` is `merge`.

If the task branch already contains the new tip, nothing moves: the head and the worktree stay as they are.

The `revision` of each `base` event is a ref, never a commit id:

- While the parent is in flight, a move writes `{ base: "refs/heads/<parent branch>", revision: "refs/heads/<parent branch>", source: "update" }`. The command writes no `base` event when nothing moved.
- After the parent landed, the command always writes `{ base: <base of the parent>, revision: <stored base revision of the parent>, source: "parent" }`, also when the head does not move. The task row gets the new base. The `revision` is a ref such as `refs/remotes/origin/main`.

After the parent landed, the command prints `<issue key> is no longer stacked on <parent key>` after the current line or the moved line and before the demoted line. A later run uses the plain base step with the new base. The demotion and the stale-plan rule apply only when the head moved.

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

When a step fails after the move to `updating_branch`, the command prints the error on stderr and stops with exit code 1. The step can be the fetch, the sync step, the move of the branch, a conflict, a failed restore or a failed write. Local work at risk in a divergence is one such failure. A conflict message names each path in conflict. A failed restore names the git commands that put the worktree back. The state after the failure depends on the worktree:

- The worktree is back at the start when three facts hold: the head is the head of the start, the worktree is on the task branch, and the worktree is clean. Then the task goes back to its origin state. The command writes a `branch_updated` event with `error`, `how: "none"` and `after` equal to `before`, in place of a `transition` event. The error on stderr and in the event is the bare message.
- In each other case, the task goes to `failed` with the error `updating branch failed: <message>`. The command prints the same error on stderr.

A stacked task fails in the same way in two more cases. The branch of the parent, while the parent is in flight, is gone from the clone: `the branch of the parent <parent key> is gone: <base>`. The parent landed and is stacked too: `the parent <parent key> of <issue key> is stacked too; its base is <base of the parent>`.

A failed read of the state of the worktree counts as not back at the start. `tasker retry` has no row for a task that failed in `updating_branch`. After a failed restore, run the git commands that the error names. Then run `tasker update-branch` again from `failed`, or run `tasker abort` to end the task.

A crash during the command leaves the task in `updating_branch` with its run marker. The next command that reads the task moves it to `interrupted`.

Run `tasker resume` for a task in `interrupted` that stopped in `updating_branch`. The command moves the task back to its origin state and prints `run tasker update-branch <issue key> again`. Before the move, `tasker resume` first puts the worktree back at the head from before the update. [`tasker resume`](recovery.md#tasker-resume) gives the details.
