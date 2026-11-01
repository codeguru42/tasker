# Rebase conflicts

This page gives the procedure for a rebase conflict that `tasker update-branch` reports.

The page is for [the installed `tasker`](../orchestrator.md) that drives the work on this repo. To see the flags of a
command, run `tasker <command> --help`.

## Who runs the procedure

The driver does these steps. The driver is the person or the assistant session that drives tasker from a local clone of
this repo.

tasker keeps its own clone of this repo under its data root (`dataRoot`). This page calls it the tasker clone. tasker
starts some assistant sessions in a worktree of the tasker clone. Such a session must not do these steps. It must stop
and report the conflict to the driver.

The driver must not run git commands in the tasker clone. The driver must not change the tasker clone. Only tasker
commands change it. The driver reads the tasker clone only with a fetch through a read-only remote. A fetch only reads
the tasker clone.

## Procedure

Run each git command in the clone of the driver or in its worktree.

1. Once for each clone of the driver, add a remote named `tasker`. Run the commands of this step in the clone of the
   driver, not in a worktree and not in the tasker clone. Run `tasker show <issue>`. It prints the path of the tasker
   clone on the `clone:` line. If `tasker show` fails, or if it prints no `clone:` line, stop. The clone of the driver
   gets no new remote. A person decides the next step, as step 10 describes. Otherwise, run
   `git remote add tasker <path>`, with the value of the `clone:` line as `<path>`.
2. In the same clone, block each push to this remote: `git remote set-url --push tasker DISABLED-read-only`. As a
   result, no push can reach the tasker clone.
3. Run `tasker show <issue>`. It prints the base branch of the task as `base:`. For most tasks, the base branch is
   `main`.
4. If the base branch is the branch of another task, the task is a stacked task. For a stacked task, the driver runs
   `tasker show <parent issue>` in the clone of the driver. The parent issue is the key in the note
   `based on <key>'s branch` that `tasker start` printed. For an agent, the prompt names the parent.

   If the driver cannot name the parent issue, stop. `tasker show` changes no task. If `tasker show` fails, stop. If the
   `state:` line is not `landed`, `finishing` or `finished`, stop. If the `base:` line of the parent has the form
   `refs/heads/<x>`, the parent is stacked too, so stop. In each of these cases, a person decides the next step, as step
   10 describes.

   If the parent landed, go on to step 5. After a `tasker update-branch` with no conflict, a stacked task whose parent
   landed is no longer stacked, or it stays stacked on the first parent that has not landed.

5. Run `git fetch --multiple tasker origin`. The fetch reads the task branch from the tasker clone. The fetch of
   `origin` also gets the base branch.
6. If a worktree already holds the local task branch, use it, and do [the update rule](limits.md#the-update-rule) in the
   worktree. For an agent, that worktree is the task worktree of
   [the own-worktree rule](limits.md#the-own-worktree-rule) of `docs/dev/limits.md`. Then go to step 7. Otherwise, run
   `git worktree add -b <task branch> <path> tasker/<task branch>`. This makes a worktree with a local task branch. If
   the local task branch already exists, follow the branch-exists case of the own-worktree rule. Do not copy it here.
7. In the worktree, rebase the task branch onto `origin/<base branch>`. If the task is a stacked task whose parent
   landed, the driver runs `git rebase --onto origin/<base branch> <start base> <task branch>` in the worktree instead.

   Here, `<base branch>` is the base of the landed parent, which is the base that the walk ends on, for example `main`.
   After the stop of step 4, that base is a plain branch name. `<start base>` is the start base of the last read, as
   [the same-patch rule](review-findings.md#review-findings) of `docs/dev/review-findings.md` defines it. A plain rebase
   onto `origin/<base branch>` also replays the old commits of the parent. On #182, the 16 commits of the task replayed
   with one conflict, in `docs/dev/tasks.md`.

   In the loop of step 11, run a plain rebase onto `origin/<base branch>`, also for a stacked task. Step 4 goes on only
   for a parent that landed. As a result, the local task branch is already on the base branch. The `<start base>` of
   this step is old. In the loop, this step needs no start base, and its stop for no start base does not apply.

   If the driver holds no start base, stop. A person decides the next step, as step 10 describes. The worktree and the
   local task branch stay. Fix the conflicts. From here to step 11,
   [the local-commit rule](limits.md#the-local-commit-rule) of `docs/dev/limits.md` holds. At the new conflict of step
   11, the rule holds with no break through the loop.

   A conflict in the migration array of `src/store/migrations.ts` has one fix. Keep all the migrations. Put the
   migrations of the base first, in their order, then the migrations of the task. Each number of a migration of the task
   goes up by the count of the new migrations of the base. This holds in the tests and in `docs/dev/data-root.md`.

   Examples of the forms are `migrations[N]`, `migrations.slice(0, N)`, `makeOldDatabase(<path>, N)` and
   `schemaVersion(...)` with `.toBe(N)`. A check of `migrations.length` holds the new total of the migrations. The
   reason is in [Schema versions](data-root.md#schema-versions): a migration never changes its place after it lands. If
   step 8 then fails, for example because two migrations add the same column, stop. A person decides the next step, as
   step 10 describes.

8. In the worktree, run `npm run check`. The command must pass.
9. In the worktree, run `git rev-parse --verify <task branch>`. If the read fails, stop before the push. A person
   decides the next step, as step 10 describes.

   Then push the task branch to `origin` with a normal push: `git push -u origin <task branch>`. Do not force-push. The
   upstream of the task branch can be `tasker/<task branch>`, or it can be unset. As a result, a plain `git push` goes
   to the `tasker` remote and fails, or it fails for no upstream, so the driver must name `origin`. If the push passes,
   keep the hash that the read of the first paragraph printed as `<pushed>`.

10. If the normal push of step 9 fails and `origin` has the task branch, do these steps.

    1. If the driver holds neither the `<taken>` of the last step 11 nor a `<pushed>`, stop.
    2. Run `git rev-parse --verify origin/<task branch>`. The last fetch or the last push got this ref. A push with `-u`
       also moves `origin/<task branch>`. Keep the printed hash as `<origin tip>` until step 10 ends. If the read fails,
       stop.
    3. If `<origin tip>` differs from each hash that the driver holds, stop.
    4. Delete the task branch on `origin` with a lease at the hash that is the same as `<origin tip>`:
       `git push --force-with-lease=refs/heads/<task branch>:<origin tip> origin --delete <task branch>`. If the delete
       fails, stop. The task branch on `origin` can still exist.
    5. Do step 9 again. This push records `<pushed>` in the same way. If the read or this push fails, stop. The task
       branch on `origin` can be gone, or it can hold another commit.
    6. Do steps 11 to 14.

    The `<taken>` of the last step 11 lives until the next step 11 runs. That step records a new `<taken>`, or it
    records no `<taken>`. It records no `<taken>` when one of its two commands fails, or at a new conflict. After the
    next step 11, the old `<taken>` is gone. The delete gives no `<deleted>` of the pushed-branch rule of
    [the broken-commit steps](verify-failures.md#the-broken-commit-steps) in `docs/dev/verify-failures.md`, because the
    push of step 9 comes right after it. This holds for a delete at `<pushed>` too.

    These events end a `<pushed>`:

    - A later push of step 9 that passes and replaces it
    - A step 11 that does not keep it, as step 11 says
    - A stop of this procedure
    - A stop of the pushed-branch rule
    - The end of step 21
    - A run of the update rule, for a `<pushed>` of a new conflict

    Until one of these events, `<pushed>` carries into the next run of this procedure, as `<taken>` does. The update
    rule does not end a `<pushed>` of a take. After a take, tasker holds the work of `<pushed>`.

    If the normal push of step 9 fails in another case, stop. Do not force-push in this step. The delete with a lease of
    item 4 is the only exception. In each stop of this step, a person decides the next step. If the driver is a person,
    that person decides. If the driver is an assistant session, it reports the stop to the person who runs it. The
    worktree and the local task branch stay.

    On 2026-10-24, #409 pushed 816f63f6 at step 9, and step 11 recorded 816f63f6 as `<taken>`. Then `main` moved, and a
    second `tasker update-branch` stopped on a conflict. The agent fixed the branch as 526e9e5b, and the normal push
    failed. The user said: "go ahead with the delete, no need to ask next time".

11. Run `tasker update-branch <issue> --take-remote`. tasker resets its task branch to the task branch on `origin`. Then
    tasker rebases or merges that branch onto the newest base branch.

    A new conflict of this step has these signs:

    - The command exits with 1
    - A line of its stderr starts with `the rebase onto ` or `the merge onto `
    - That line holds `stopped on conflicts:`

    tasker moves its task branch back to its old head. At a new conflict, do not run the fetch and the read of `<taken>`
    of this step. The driver holds no `<taken>`. The driver keeps `<pushed>` as a `<pushed>` of a new conflict.

    In the worktree, run `git fetch origin`. If the fetch fails, stop. Otherwise, go back to step 7 in the same
    worktree. Do not do step 6, because the update rule there drops the fix that only the local task branch holds. This
    return from step 11 to step 7 is the loop.

    On #460 (2026-10-25), the agent rebased onto 20ad87bc and pushed e7b9d58e at step 9. Then `main` moved to 4554ff97,
    and step 11 exited with 1 on a new conflict. The local task branch held the work of e7b9d58e. The orchestrator
    ordered a delete with a lease at e7b9d58e and the same steps again.

    The case of a new conflict covers no other failure of this step. One such failure prints a line that starts with
    `updating branch failed: `, and the task goes to `failed`. That line can also hold `stopped on conflicts:`.

    In each other case, the driver records `<taken>` before step 12. The driver records it in the clone of the driver,
    not in the worktree. Run `git fetch tasker`. Then run `git rev-parse --verify tasker/<task branch>`. Keep the
    printed hash as `<taken>` until step 21 ends. [The take check](#the-take-check), step 10 of
    ["Run one ticket"](run-one-ticket.md#run-one-ticket), which step 21 runs, and the pushed-branch rule of
    [the broken-commit steps](verify-failures.md#the-broken-commit-steps), which runs after this step, use it.
    `<pushed>` has two users: step 10 of this page and step 5 of the pushed-branch rule. If one of the two commands
    fails, step 11 records no `<taken>`. Continue with step 12. [The take check](#the-take-check) then fails. As a
    result, the worktree, the local task branch and the task branch on `origin` stay.

    If this step records a `<taken>`, read its stdout for one of these lines:

    - `synced <task branch> from origin/<task branch> at <pushed> by take-remote`
    - `synced <task branch> from origin/<task branch> at <pushed> by fast-forward`

    If stdout holds one of these lines, keep `<pushed>` as a `<pushed>` of a take. That line shows that tasker took
    `<pushed>`. The tip of tasker can then be a rebase of `<pushed>`. Each other step 11 ends `<pushed>`. If no `synced`
    line prints, `<pushed>` ends. tasker can already hold it, and then `<pushed>` ends too.

12. Run `tasker show <issue>`. It prints the state of the task and the next valid commands.
13. If the task is in `executed`, run `tasker verify` and `tasker review` again. Then land the work as usual.
14. If the task is in another state, follow the commands that `tasker show` prints.

This paragraph applies to steps 15 to 21. If a command of these steps fails, or a step says to stop or not to do the
next steps, the driver stops and deletes nothing more. In each of these cases, the worktree and the local task branch
stay. The task branch on `origin` can still exist. A person decides the next step, as step 10 describes. A hand-over is
not a stop. A hand-over goes from one check of step 17 to the next check, or from step 18 to step 19. Each step names
only what differs.

15. Keep the worktree and the local task branch until the work lands. For an agent, steps 18 to 20 are the only remove
    of its task worktree, at the end of its work. After `tasker finish`, run `tasker show <issue>` in the clone of the
    driver. If `tasker show` prints the line `state: finished`, do steps 16 to 21 in this order. Run them in the clone
    of the driver, not in the worktree. As a result, the driver deletes nothing before step 17 passes. If the task is in
    `cleanup_failed`, `tasker finish` stopped before its cleanup ended. In that case, do not do steps 16 to 21. If
    `tasker show` fails or prints another state, do not do steps 16 to 21.
16. Run `git fetch origin`. The fetch gets the base branch with the landed work. If the fetch fails, stop.
17. Make sure that the base branch contains the work of the task branch. First, read two hashes in your clone:
    `git rev-parse --verify <task branch>` gives `<tip>`, and `git rev-parse --verify origin/<base branch>` gives
    `<base>`. For an agent, `<tip>` is the tip of the local task branch after its last update rule (see
    [the update rule](limits.md#the-update-rule) of `docs/dev/limits.md`). `tasker merge` lands the tip of tasker as a
    fast-forward, so the ancestor check then passes. If no update ran after step 11, `<tip>` is the pushed tip, and the
    take check applies as it is written. If a read fails, stop. Then run [the ancestor check](#the-ancestor-check). If
    it exits with 0, continue with step 18. If the ancestor check exits with 1, do [the patch check](#the-patch-check).
    If the ancestor check exits with a code that is not 0 and not 1, stop at once and do not run `git cherry`. If the
    patch check passes, continue with step 18. If `git cherry` exits with 0 and a line starts with `+`, do
    [the take check](#the-take-check). If the patch check fails in another case, stop. The take check does not run. If
    the take check passes, continue with step 18. If the take check fails, stop.
18. Remove the worktree: `git worktree remove <path>`. Do not use `--force`, because `--force` deletes the changes that
    are not committed. Files that `.gitignore` lists do not stop `git worktree remove`, for example `node_modules/` from
    `npm ci`.
19. If `git worktree remove` fails, stop. Report the exact error of git and the output of
    `git -C <path> status --porcelain --ignored`. For example, git prints
    `fatal: '<path>' contains modified or untracked files, use --force to delete it` when the worktree holds changed
    files or files that git does not track. The report helps to find the cause of such a failure. In one case, an agent
    used `--force` and blamed `node_modules/`. But git removes a worktree that holds only ignored files without
    `--force`, so the cause is unknown.
20. Delete the local task branch: `git branch -D <task branch>`. Step 17 already makes sure that the base branch
    contains the work, a commit with the same patch for each commit, or the landed result of tasker after it took the
    pushed tip. If the command fails, stop. The worktree is gone. The local task branch stays.
21. Make sure that `origin` has no task branch: do step 10 of "Run one ticket" in
    [docs/dev/run-one-ticket.md](run-one-ticket.md#run-one-ticket). If the driver is not the agent of a ticket, it runs
    those commands in the clone of the driver. Where that step says to report to the orchestrator, a person decides the
    next step instead. Step 10 of this page describes this rule. The driver does not do step 11 of "Run one ticket". In
    this step, the worktree and the local task branch are gone. The failure cases of step 21 are the cases of step 10 of
    "Run one ticket". Step 10 of "Run one ticket" names what stays.

### The ancestor check

Run the ancestor check: `git merge-base --is-ancestor <tip> <base>`. The command exits with 0 when the base branch
contains the tip. It exits with 1 when the base branch does not contain the tip. It exits with 128 when git does not
know one of the two names.

If the exit code is 0, the check passes. The ancestor check exits with 1 when the work landed as new commits. For
example, `tasker update-branch --take-remote` rebased the work again onto a newer base branch, or the work landed as a
rebase merge or as a squash.

### The patch check

If the ancestor check exits with 1, run the patch check: `git cherry <base> <tip>`. The command lists each commit of the
task branch that `<base>` does not contain, one line for each commit, with a sign and the full hash. The sign `-` means
that the base branch already has a commit with the same patch. The sign `+` means that it has none. The exit code is 0
in both cases. For example, the same patches print `- <hash>` and `- <hash>`. One changed patch prints `- <hash>` and
`+ <hash>`.

The patch check passes when the output has at least one line and each line starts with `-`. Then the work landed with
the same patches. In issue #99, on 2026-10-14, another ticket landed between the push and `--take-remote`, and each of
the 8 commits of the pushed branch had the same patch as a landed commit.

The patch check fails in each of these cases: a line starts with `+`, the output is empty, or `git cherry` exits with a
code that is not 0.

The patch check compares only the code change (the patch id). It does not compare the commit message or whitespace. A
`-` can match any commit of the base branch after the merge base that has the same patch. The check prevents the delete
of work that did not land. A difference only in the message or in whitespace loses no work. A rebase with the same
patches passes the patch check. A squash of more than one commit makes one new patch, so `git cherry` prints `+` lines,
and the patch check fails.

### The take check

If `git cherry` exits with 0 and a line starts with `+`, the driver runs the take check in the clone of the driver. In
the other failure cases of the patch check, the driver does not run the take check. The take check is for a task where a
later round of tasker rewrote the commits after the push of step 9. For example, a refine of a review loop folds a fix
into an earlier commit with a fixup commit and an autosquash rebase. The local task branch keeps the old commits, and so
does the task branch on `origin` until the pushed-branch rule of
[the broken-commit steps](verify-failures.md#the-broken-commit-steps) deletes it. As a result, `git cherry` prints `+`
for each rewritten commit. In issue #96, on 2026-10-15, the pushed tip was 198ba3a, and the work landed as 574877a.

In this check, the pushed tip is `<tip>`. First, read the tip of the task branch on `origin` one time:
`git rev-parse --verify origin/<task branch>`. If the agent holds a `<deleted>` of the pushed-branch rule of
[the broken-commit steps](verify-failures.md#the-broken-commit-steps), use it as this hash, and do not run the read. The
delete removed `origin/<task branch>` from the local clone. This check calls this hash `<origin hash>`. If
`<origin hash>` differs from `<tip>`, `origin` holds or held a commit other than the pushed tip.

The first fact: `<taken>` from step 11 is the same hash as the pushed tip. Then tasker took the pushed tip. If `<taken>`
differs from the pushed tip, the local task branch has a commit that tasker did not take. After `tasker finish`, the
tasker clone has no task branch. A plain `git fetch tasker` does not prune `tasker/<task branch>`. For this reason, step
11 reads `<taken>`, and this check does not read it.

The second fact: `git merge-base --is-ancestor <landed commit> <base>` exits with 0. Then the landed commit is on the
base branch. The landed commit is the full hash that `tasker merge` prints. `tasker show <issue>` of a finished task
does not print it.

The take check passes when `<origin hash>` is the same hash as `<tip>` and both facts hold. Each commit of the pushed
tip went into the task branch of tasker at step 11. Each later change is a round of tasker, and tasker landed the
result.

The take check fails in each of these cases: a hash differs, step 11 recorded no `<taken>`, the driver does not have the
landed commit, `git merge-base` exits with 1, or a command of the take check exits with 128.
