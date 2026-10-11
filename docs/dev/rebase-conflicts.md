# Rebase conflicts

This page gives the procedure for a rebase conflict that `tasker update-branch` reports.

The page is for the installed `tasker` that drives the work on this repo. Its commands (`update-branch --take-remote`, `show`, `verify`, `review`, `finish`) are not the commands that this repo builds. For this reason, `skills/tasker/SKILL.md` does not list them. To see the flags of a command, run `tasker <command> --help`.

## Who runs the procedure

The operator does these steps. The operator is the person or the assistant session that drives tasker from its own local clone of this repo.

tasker keeps its own clone of this repo under its data root (`dataRoot`). This page calls it the tasker clone. tasker starts some assistant sessions in a worktree of the tasker clone. Such a session must not do these steps. It must stop and report the conflict to the operator.

The operator must not run git commands in the tasker clone. The operator must not change the tasker clone. Only tasker commands change it. The operator reads the tasker clone only with a fetch through a read-only remote. A fetch only reads the tasker clone.

## Procedure

Run each git command in the clone of the operator or in its worktree.

1. Once for each clone of the operator, add a remote named `tasker`: `git remote add tasker <path of the tasker clone>`. The installed tasker keeps the tasker clone at `<dataRoot>/repos/<owner>-<repo>/repo.git`, for example `$HOME/.local/share/tasker/repos/codeguru42-tasker/repo.git`. `tasker show <issue>` prints the worktree of the task, under `<dataRoot>/repos/<owner>-<repo>/worktrees/`. The tasker clone is `repo.git` in the same folder. `docs/dev/data-root.md` describes the tasker that this repo builds, not the installed tasker, so its folders do not apply to this procedure.
2. In the same clone, block each push to this remote: `git remote set-url --push tasker DISABLED-read-only`. As a result, no push can reach the tasker clone.
3. Run `tasker show <issue>`. It prints the base branch of the task as `base branch:`. For most tasks, the base branch is `main`.
4. If the base branch is the branch of another task (a stacked task), stop. A person decides the next step, as step 10 describes.
5. Run `git fetch --multiple tasker origin`. The fetch reads the task branch from the tasker clone. The fetch of `origin` also gets the base branch.
6. Run `git worktree add -b <task branch> <path> tasker/<task branch>`. This makes a worktree with a local task branch.
7. In the worktree, rebase the task branch onto `origin/<base branch>`. Fix the conflicts.
8. In the worktree, run `npm run check`. The command must pass.
9. Push the task branch to `origin` with a normal push: `git push -u origin <task branch>`. Do not force-push. Step 6 makes `tasker/<task branch>` the upstream of the task branch. As a result, a plain `git push` goes to the `tasker` remote and fails, so the operator must name `origin`.
10. If `origin` already has the task branch, the normal push fails. In this case, stop and do not force-push. A person decides the next step. If the operator is a person, that person decides. If the operator is an assistant session, it reports the failed push to the person who runs it.
11. Run `tasker update-branch <issue> --take-remote`. tasker resets its task branch to the task branch on `origin`.
12. Run `tasker show <issue>`. It prints the state of the task and the next valid commands.
13. If the task is in `executed`, run `tasker verify` and `tasker review` again. Then land the work as usual.
14. If the task is in another state, follow the commands that `tasker show` prints.
15. Keep the worktree and the local task branch until the work lands. After `tasker finish`, remove them.
