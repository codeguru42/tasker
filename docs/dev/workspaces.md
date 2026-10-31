# Workspaces

This page describes the base branch and the workspace of a task. It also gives the reasons for the git flags of the diff
and the reconcile.

## Revisions

Every revision input that reaches git is a full revision, or an exact ref that tasker read with `git show-ref --verify`.
So git never gets a short name, a range or a suffix (`a..b`, `x^{tree}`) as input that changes what `diff`, `rev-list`
or `merge-base` do. The code never reads the error text of git.

The short name `origin/<x>` can name another ref first, because git reads `refs/tags/` and `refs/heads/` before
`refs/remotes/`. Examples are a tag `origin/<x>` that the fetch brings from the remote, and a local branch
`refs/heads/origin/<x>` that a person makes in the clone. So tasker uses the full ref `refs/remotes/origin/<x>`.

tasker reads the exact ref `refs/heads/<branch>` with `git show-ref`, not `git rev-parse`, because `rev-parse` can read
another ref, for example `refs/heads/refs/heads/<branch>`.

The existence check: a base exists when `git show-ref --verify --quiet -- <revision>` exits with 0. This matches only
the exact ref. Exit code 1 means that the ref is missing. Every other error passes through unchanged.

## The fetch

Each fetch moves and prunes `refs/remotes/origin/*` in the clone, also when a later step fails. The prune removes each
`refs/remotes/origin/*` ref of a branch that the remote deleted. A failed fetch stores and deletes nothing. The fetch
uses the ssh key of the repo (see [version-control.md](version-control.md#the-ssh-key)). The base is read after the
fetch, because the fetch can make or move the ref.

The resolve of the base and the containment read of the diff part fetch. No worktree or reconcile function fetches, so
the caller resolves the base first.

## Base branch

### Forms

The stored form of a base is one of these:

- `<x>` is a branch on `origin`.
- `refs/heads/<x>` is a local branch of the bare clone.

Names such as `-x` and `a..b` pass the parse of the text that a user types. [The existence check](#revisions) then
rejects them, and its error names them.

### Stacked task

A stacked task is a task whose column `parent_task_id` is not NULL. Its parent is the task of that id. The parent has
landed when its task is in `landed`, `finishing`, `cleanup_failed` or `finished`. After `tasker update-branch` moves a
task whose parent landed, the task has the base that the walk ends on, and it has the new parent, or none. The same
store write sets the column (see [the base change after the parent landed](tasks.md#update-branch)).

`tasker start` writes the column in the same store write as the base. For a base of the form `refs/heads/<x>`, the
parent is a task of the same repo whose branch is `<x>`. Its state is not `cancelled` or `finished`. Of such tasks, the
parent is the one with the highest id. For each other base, or with no such task, the value is NULL.

A cancelled task never lands. A finished task is done, and its branch is gone or left over. In both cases, a new start
on that branch has a plain local base. A parent in `landed`, `finishing` or `cleanup_failed` gets the link on purpose.
The landing guard refuses `tasker merge` and `tasker mark-landed` until each parent in its chain landed and
`tasker update-branch` moved the task. The moved-base guard refuses `tasker refine`, `tasker execute`, `tasker verify`,
`tasker review` and `tasker accept` while the parent has landed and the task did not move.

Each task of a chain lands on the base of the first task, after its parent. The landing guard refuses a task whose
parent is in flight, with the error `has not landed`. It refuses a task whose parent is cancelled for good, so the user
runs `tasker abort` for that task. The moved-base guard does not stop for a cancelled parent, so other work goes on.

The synced base tip is the commit id of the base tip that the task branch was last built on. It lives in the column
`synced_base_tip` of the task row. For a stacked task, it is the parent tip: the commit of the branch of the parent that
the task branch builds on.

### The resolve

The checks that need no git run first, so a bad input causes no fetch and no write.

The source order is: `--base` of this run, then the issue hint, then the stored base of the task, then the blocker step
of start, then the learned default, then `defaultBaseBranch`, then a question.

The reason: the user who passes `--base` names the base of this run on purpose. With `--base`, start does not read the
hint. As a result, a bad hint does not stop the start.

- Only `--base` and the blocker step can give a local branch (`refs/heads/<x>`). A hint and an answer must name a remote
  branch.
- The existence check runs on the blocker base, as for `--base refs/heads/<x>`. If the ref is missing, the command
  prints a note on stderr, and the resolve goes on with the next source. The base is then a branch on origin, and the
  parent of the task is `NULL`.
- A missing `defaultBaseBranch` fails and does not ask.
- The hint comes from the issue tracker, so it is untrusted text. It cannot reach `refs/heads/*`, because the check uses
  `refs/remotes/origin/<hint>`, and `git show-ref --verify` matches only the exact ref.

### Learned default

The learned default is the row of the repo in the `default_base_branches` table.
[data-root.md](data-root.md#default_base_branches-table) holds the forget rule.

- A value from the configuration default or from the answer is saved only after the branch exists in the clone.
- A hint, `--base` and the blocker step store nothing.
- tasker asks at most once for each repo, unless a learned value later stops existing.
- A learned value that is missing is deleted before the question runs. If the question or its check then fails, the
  learned value stays deleted.

## Worktrees

The workspace of a task is a git worktree on a task branch. The worktree comes from the bare clone of the repo. No
worktree function talks to the remote, so none needs the ssh key environment.

### The worktree guard

Git with a wrong working folder changes another repo. The assistant can write the `.git` file of a worktree and its
admin dir (`<clone>/worktrees/<name>`), and git follows both. A git call in a changed worktree can read a configuration
that the assistant chose. So each function that runs git in a worktree first makes sure that the worktree is a worktree
of the clone, that it has a `.git` file, and that it uses its own admin dir in the clone. This check reads files and
runs no git.

One fact of the check catches a `.git` file that names the admin dir of another task worktree of the same clone. The
`gitdir` file of the admin dir must name the `.git` file of the worktree. A rewritten `gitdir` file never reaches this
check, because the list of worktrees then shows another path.

Git lists the real path of a worktree. For a path through a symlink, git lists the real parent folder.

### The branch name

The name of a task branch is the short ref plus a slug of the title, so a person can read it. See
[issue-keys.md](issue-keys.md#short-refs) for the short ref. The folder of the worktree is named by the short ref, so it
does not change when the title changes.

Every function that takes a branch runs the name check first, before any git call. As a result, git never gets a name
with a leading `-`, `..`, `/`, `~`, `^`, `@{` or a space.

The shape check runs after the name check. A function that writes or deletes a branch refuses a name without the task
branch shape, so tasker never changes `main`, `master` or another base. A function that only reads a branch runs only
the name check. A detached HEAD has no branch and passes.

### Create

Create is idempotent (safe to run again), so `tasker start` can continue a failed attempt. Create does not use the
guard.

- The check that the path is empty runs before `git worktree add`, because git makes the new branch before it reads the
  path.
- A new branch has no upstream (`--no-track`).
- A failed `git worktree add` can leave the new branch, and the next create reuses it. A reused branch keeps its commits
  and its configuration, and it does not move to the base.
- A stopped `git worktree add` can leave an admin folder in the clone with only a `locked` file. Git does not list it,
  and the next create uses a new admin name.
- For an unlocked worktree whose folder is gone, create removes that worktree entry and adds the worktree again.

Create does not repair a locked worktree that has no `.git` file or a detached head. No git command repairs one worktree
without `--force`: `git worktree remove` refuses a locked worktree, `git worktree repair` changes every broken worktree
of the clone, and `git worktree prune` acts on every entry that it can prune. The error names the lock and the reason,
so a person can decide.

The repair of the `initializing` lock trusts the lock. Git sets this lock while `git worktree add` runs, so the folder
holds no work of the task. The repair runs `git reset --hard`, so it writes the committed files over a partial checkout.
A person who locks a worktree with the reason `initializing` by hand also gets the `git reset --hard`.

### Remove

tasker never uses `--force`.

- Git refuses a worktree with a changed tracked file or an untracked file.
- Git refuses a locked worktree and a folder that is not a worktree.
- A registered worktree with no folder is removed.
- Ignored files do not block the remove. Git deletes them with the folder.
- The branch stays.

### Delete branch

The delete uses `-D`, because a task branch is usually not merged in the clone. tasker deletes only a local branch with
the task branch shape.

### Discard

`git reset --hard` runs first, so a deleted `.gitignore` comes back before `git clean` reads it. `git clean -ffd` (two
`f`) also deletes a nested git repo. There is no `-x`, so ignored files stay and do not block a later remove.

## Diff and changes

This part reads what a task changed against its base, and what is not committed yet. tasker reads the commits itself,
because some assistants have no shell in planning.

The order in each function is: the input checks, then the worktree guard, then the ref reads, then git. A function that
takes a worktree path throws the errors of the guard. [The guard text](#the-worktree-guard) gives the reasons. Apart
from the fetch, these reads write no ref, no file and no configuration.

### Reasons for the flags

- The three-dot range `<base>...<branch>` compares the branch with the merge base. A file that only the base got after
  the fork does not show. The two-dot range of `git diff` lists those files, so the diffs use the three-dot range.
- The own commits use the two-dot range `<base>..<branch>`, which gives the commits that the branch has and the base
  does not.
- `-z` makes git print each path raw and end it with a NUL. Without `-z`, git quotes a path with a newline, a tab, a
  quote or a non-ASCII character. A private parser splits the output on NUL and drops the empty item after the last NUL.
- `--no-renames` makes a rename give both paths: two paths in the diff, and two records in the status.
- `--untracked-files=normal` makes untracked files show, also when the worktree has `status.showUntrackedFiles=no`. An
  untracked folder gives one record, for example `?? sub/`. An ignored file does not show. Each path is relative to the
  root of the worktree.
- The status call runs with `GIT_OPTIONAL_LOCKS=0` in its environment. Without it, `git status` takes `index.lock` and
  can rewrite the index of the worktree. A git command of the assistant in the same worktree then fails on the lock.
- `--no-color`, `--no-ext-diff` and `--no-textconv` stop colors, `diff.external` and textconv filters of the user
  configuration from changing the text. `diff.noprefix` still changes the `a/` and `b/` prefixes of the diff text.
- The explicit `--format` stops `format.pretty` and `log.decorate` of the user from changing the text.
- `--no-show-signature` stops `log.showSignature` of the user configuration. Git then starts no gpg and adds no
  signature lines to the text.
- `--cherry-mark` with `--left-only` or `--right-only` in `remoteTaskBranchSides` marks a commit that has a same-patch
  commit on the other side. With `--left-right` and `--cherry-mark`, git prints `=` for such a commit and hides its
  side, so one call cannot give both sides. The function runs one call for each side.
- `--topo-order --reverse` gives the oldest commit first on each side.
- `--encoding=UTF-8` makes git print a non-ASCII subject as UTF-8. With `i18n.logOutputEncoding=ISO-8859-1` in the user
  configuration, git re-encodes the subject without it.

### Git facts of the results

- A commit diff compares commits, so an uncommitted change does not show.
- A merge commit shows no diff, as git does by default.
- `rev-list --count <head> --not` with no others counts every commit that the head reaches.
- Only exit code 1 of `merge-base --is-ancestor` means "no". Exit code 128, for example for a revision that the clone
  does not have, is an error.
- A staged rename gives a delete and an add.

### Git facts of the read of the two sides

`remoteTaskBranchSides` reads the two sides of the range `<local>...<remote>` with `git log --cherry-mark`, one call for
each side.

- The mark `%m` is never `+`. It is `=` for a commit with a same-patch commit on the other side. Otherwise it is `<` on
  the left side and `>` on the right side. The code treats only `=` as the same patch.
- A merge commit on either side is never `=`. It is `<` or `>`, and `%P` holds two hashes divided by a space.
- `git cherry` leaves out each merge commit on both sides, so the read does not use `git cherry`.
- A commit that differs only in its message and its author gives `=` on both sides. A commit that differs only in
  whitespace at the end of a line also gives `=`.
- `git rev-list <local> ^<remote> ^<base tip>` prints the local-side commits that the base tip does not reach. It leaves
  out a base commit that the local side holds. It keeps a local merge commit and a rebased commit. The read uses this
  output for `onBase`.

## Reconcile

Reconcile brings a task worktree onto a base that moved. When a step fails, it puts the worktree back where it was. It
acts only on a worktree that is on a task branch or detached. [The branch name](#the-branch-name) gives the check.

### The order

The clean check runs before any step, because the restore runs `checkout --force` and `clean -fd`. Both delete
uncommitted work.

### The arguments

[`runGit()`](version-control.md#rungit) removes the repo-local git variables. As a result, `-c key=value` is not
possible, so each rule of the user configuration has a command option.

`--onto` applies only the commits of `<upstream>..HEAD`. The rebase options are:

| Option                   | Reason                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- |
| `--merge`                | `rebase.backend=apply` uses `rebase-apply/`. This option forces `rebase-merge/`. |
| `--no-autostash`         | It stops `rebase.autoStash`.                                                     |
| `--no-update-refs`       | It stops `rebase.updateRefs`, which moves other local branches.                  |
| `--no-rebase-merges`     | It stops `rebase.rebaseMerges`, so the history stays linear.                     |
| `--no-gpg-sign`          | It stops a gpg failure from `commit.gpgSign`.                                    |
| `--no-verify`            | It skips the `pre-rebase` hook.                                                  |
| `--no-rerere-autoupdate` | It stops `rerere.autoUpdate`, so a conflict stays unmerged.                      |

The reasons for the options of the merge are:

| Option                       | Reason                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `-s ort`                     | It stops `pull.twohead`, which can drop the changes of the base. |
| `--ff`                       | It stops `merge.ff=only`.                                        |
| `--commit` and `--no-squash` | They stop `branch.<name>.mergeOptions=--squash`.                 |
| `--no-edit`                  | It stops `GIT_MERGE_AUTOEDIT=yes` from running an editor.        |
| `--no-log`                   | It stops `merge.log`, so the message stays the default.          |
| `--no-autostash`             | It stops `merge.autoStash`.                                      |
| `--no-gpg-sign`              | It stops a gpg failure from `commit.gpgSign`.                    |
| `--no-verify`                | It skips the `pre-merge-commit` and `commit-msg` hooks.          |
| `--no-verify-signatures`     | It stops `merge.verifySignatures`.                               |
| `--no-rerere-autoupdate`     | It stops `rerere.autoUpdate`, so a conflict stays unmerged.      |

These settings need no option. `rebase.autoSquash` has no effect on a rebase that is not interactive.
`merge.conflictStyle` changes only the markers, and the abort removes them. `pull.rebase` has no effect.

### The conflict rule

Exit code 1 does not mean a conflict. A refused dirty worktree, an untracked file in the way, a refusing `pre-rebase`
hook and a gpg failure in a rebase also exit with 1. A merge can exit with 2 or 128 for other failures.

The code decides on a conflict only from the list of `git diff --name-only --diff-filter=U -z`. Each unmerged path shows
one time, raw and relative to the root. An empty list means no conflict.

### A failed step

After a failed git step, the code runs the abort only when some path is unmerged. Then it always runs the restore. It
throws the conflict error only when the list of unmerged paths is not empty. Otherwise it throws the original git error
again. An error that is not a git error passes through with no restore.

- The code drops an error of the abort, because the restore runs next and checks the state.
- An error of the restore wins over the other errors.

### The resync

- A base that got the task by a fast-forward outside tasker gives no move.
- A base that got the task with a merge commit outside tasker gives a fast-forward, because the merge commit is ahead of
  HEAD.
- A fast-forward has no conflicts.

### The move to a revision

The move puts the task branch, HEAD, the index and the tracked files at a revision. The revision can be an ancestor of
HEAD, a descendant of HEAD or on another line. The command is `git reset --keep --no-recurse-submodules <sha>`.

- The clean check runs first, as in the other reconcile functions. A worktree with uncommitted changes is refused.
- `--keep` is used and `--hard` is not. `--keep` makes git refuse a change in a tracked file that the move changes (exit
  128, HEAD and the change stay). It also refuses an untracked file in the path of a tracked file of the target (exit
  128, HEAD stays). So a change that appears after the clean check is not lost. `--hard` deletes such a change.
- `--no-recurse-submodules` stops `submodule.recurse` of the user configuration from changing the command. No submodule
  was tested.
- A detached HEAD is refused before the reset. On a detached HEAD, `git reset --keep` moves only HEAD, and the move must
  change the task branch.
- The branch must have the task branch shape, as for each function that writes a branch.
- After a `GitError`, the restore of the reconcile runs.

Side effects:

- `git reset --keep` runs no `post-checkout` hook. It runs only the `reference-transaction` hook.
- It prints nothing on stdout.
- An ignored file in the path of a tracked file of the target is written over.

### The restore

- `rebase --quit` runs first, because a failed or conflicted rebase leaves `rebase-merge/`, and `checkout --force` does
  not remove it.
- `checkout --force -B` puts the branch back at the start, also when the failed step moved it. The checkout also removes
  the merge state.
- `git symbolic-ref -q HEAD` exits with 1 for a detached HEAD. Every other failure passes through.
- Git has no plumbing command with an exit code that tells if a rebase or a merge is in progress, and the text of
  `git status` is not stable. So the code tests the paths from `git rev-parse --git-path <name>`.
- A git error of a restore command does not stop the restore. The code keeps the stderr and runs the next command.

### The restore error

When the restore cannot get the start state back, the error names the state and the git commands that a person runs. The
function that makes the commands is exported, because the fixture cannot make each state.

A branch that another worktree has checked out, a `refs/heads/<branch>.lock` file and an `index.lock` file in the admin
folder make the checkout fail.

### Side effects

- A successful rebase moves the task branch, or only HEAD for a detached start, and rewrites its commits. A merge adds a
  merge commit. A fast-forward moves the branch or HEAD.
- The hooks `post-checkout`, `post-rewrite` and `post-merge` in `<clone>/hooks` run. No option skips them.
- With `rerere.enabled` in the user configuration, git writes `rr-cache/` and `MERGE_RR` in the clone. No option stops
  it.
- `ORIG_HEAD` and `AUTO_MERGE` stay in the admin folder.
- The restore drops the commits that the failed step made on the branch. It deletes untracked files and keeps ignored
  files.
- A refused dirty worktree changes nothing.
