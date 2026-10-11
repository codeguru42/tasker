# Rebase conflicts

This page gives the procedure for a rebase conflict that `tasker update-branch` reports.

The page is for the installed `tasker` that drives the work on this repo. Its commands (`update-branch --take-remote`, `show`, `verify`, `review`, `finish`) are not the commands that this repo builds. For this reason, `skills/tasker/SKILL.md` does not list them. To see the flags of a command, run `tasker <command> --help`.

## Procedure

1. In your own local clone of this repo, make a worktree for the task branch. Do not use the clone that tasker keeps under its data root (`dataRoot`). Do not run git commands in that clone. Only tasker commands change it.
2. In the worktree, rebase the task branch onto `origin/main`. Fix the conflicts.
3. Run `npm run check`. The command must pass.
4. Push the task branch to `origin` with a normal push. Do not force-push. If `origin` already has the task branch, the normal push fails. In this case, stop and ask the operator.
5. Run `tasker update-branch <issue> --take-remote`. tasker resets its task branch to the task branch that you pushed.
6. Run `tasker show <issue>`. It prints the state of the task and the next valid commands.
7. If the task is in `executed`, run `tasker verify` and `tasker review` again. Then land the work as usual.
8. If the task is in another state, follow the commands that `tasker show` prints.
9. Keep the worktree and the local task branch until the work lands. After `tasker finish`, remove them.
