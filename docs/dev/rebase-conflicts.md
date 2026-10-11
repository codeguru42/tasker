# Rebase conflicts

This page gives the procedure for a rebase conflict that `tasker update-branch` reports.

## Procedure

1. In a worktree of a local checkout, rebase the task branch onto `origin/main`. Use a local checkout, not the repo of tasker. Fix the conflicts.
2. Run `npm run check`. The command must pass.
3. Push the task branch to `origin` with a normal push. Do not force-push.
4. Run `tasker update-branch <issue> --take-remote`. tasker resets its task branch to the task branch that you pushed. The task goes back to `executed`.
5. Run `tasker verify` and `tasker review` again. Then land the work as usual.
6. Keep the worktree and the local task branch until the work lands. After `tasker finish`, remove them.
