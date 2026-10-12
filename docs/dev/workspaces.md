# Workspaces

This page describes the base branch and the workspace of a task. The code is in `src/vcs/git/base-branch.ts`, `src/vcs/git/worktree.ts`, `src/vcs/git/changes.ts` and `src/vcs/git/refs.ts`.

## Base branch

No command calls the resolve yet. `tasker start` will supply `ask` and call it (M4). The blocker step for stacked tasks is not part of it (M13).

### Forms

The stored form of a base is one of these:

- `<x>` is a branch on `origin`.
- `refs/heads/<x>` is a local branch of the bare clone.

`parseBaseInput(input)` parses the text that a user types. This is the text of `--base` and the answer of `ask`.

| Input | Result |
| --- | --- |
| `origin/<x>` | `<x>` |
| `refs/remotes/origin/<x>` | `<x>` |
| `refs/heads/<x>` | `refs/heads/<x>` |
| any other text | the same text, as the name of an origin branch |

`parseBaseInput()` throws an `Error` in two cases:

- The input is empty, or the name after `origin/`, `refs/remotes/origin/` or `refs/heads/` is empty. The message is `the base branch is empty`.
- The text after `origin/` or `refs/remotes/origin/` starts with `refs/heads/`. The message is `the base branch is not a branch name: <input>`.

Names such as `-x` and `a..b` pass the parse. The existence check then rejects them, and its error names them.

### Revision

`baseRevision(base)` gives the git revision of a stored base. For `refs/heads/<x>` it returns the same text. For `<x>` it returns `refs/remotes/origin/<x>`, which is the remote-tracking ref of `origin/<x>`. The short name `origin/<x>` can name a stale local branch in the bare clone, so tasker uses the full ref.

### Existence check

`refExists()` (see "Diff and changes") does the check. A base exists when `git show-ref --verify --quiet -- <revision>` exits with 0. Exit code 1 means that the ref is missing. Every other error passes through unchanged.

### The resolve

`resolveBaseBranch()` takes these inputs: `repoKey`, `clone` (the bare clone of provision), `sshKey`, `env`, `memory` (the three store functions of [data-root.md](data-root.md#default_base_branches-table)), `ask`, and the optional `hint`, `explicit` and `defaultBaseBranch`. It runs these steps in order:

1. Make the checks that need no git. If `explicit` is set, run `parseBaseInput()` on it. If `hint` is the empty text, throw `the base branch of the issue is empty`. If `hint` starts with `refs/heads/`, throw `the base branch of the issue must name a remote branch: <hint>`. An input that fails a check causes no fetch and no write.
2. Fetch. Run `git fetch origin --prune` through `runRemoteGit()` (see [version-control.md](version-control.md#resolvebasebranch)). A failure passes through unchanged. The resolve then stores and deletes nothing.
3. Use the hint, when `hint` is set. tasker uses the text as it is and does not strip `origin/`. If the branch is missing, throw `the base branch does not exist on origin: <hint> (from the issue)`. Otherwise the source is `hint`.
4. Use the explicit base, when `explicit` is set. Only this step can give `refs/heads/<x>`. If the parsed value is missing, throw `the base branch does not exist: <parsed> (from --base)`. Otherwise the source is `explicit`.
5. Use the learned default of the repo. If `memory.getDefaultBaseBranch(repoKey)` gives a value that exists, the source is `learned`. If the value is missing, tasker calls `memory.forgetDefaultBaseBranch(repoKey, <value>)` and adds the note `the learned base branch <value> no longer exists on origin. tasker forgot it.` Then it skips step 6 and goes to step 7.
6. Use `defaultBaseBranch`, when nothing is learned and `defaultBaseBranch` is set. tasker uses the value as it is, as the name of an origin branch, and does not strip `origin/`. If the branch is missing, throw `the base branch does not exist on origin: <value> (from defaultBaseBranch)`. tasker does not call `ask` in this case and stores nothing. Otherwise tasker saves the value (see "Learned default"), and the source is `config`.
7. Ask. Call `ask()` and run `parseBaseInput()` on the answer. If the value starts with `refs/heads/`, throw `the base branch must name a remote branch: <answer>`. If the branch is missing, throw `the base branch does not exist on origin: <value> (from the answer)`. Otherwise tasker saves the value, and the source is `ask`.

The hint comes from the issue tracker. tasker treats it as untrusted text. No hint can reach `refs/heads/*` through the existence check, because the check uses `refs/remotes/origin/<hint>`, and `git show-ref --verify` matches only the exact ref.

### Learned default

The learned default is the row of the repo in the `default_base_branches` table.

- Steps 6 and 7 call `memory.setDefaultBaseBranch(repoKey, <value>)` after the branch exists in the clone. They add the note `tasker saved <value> as the default base branch of <repoKey>.`
- A hint result and an explicit result store nothing.
- A later resolve with no hint and no explicit base uses the learned value in step 5. As a result, tasker asks at most once for each repo, unless a learned value later stops existing.
- `forgetDefaultBaseBranch()` deletes the row only when its branch equals the given branch. A value that another process saved in the meantime stays.

### Side effects

- The fetch moves and prunes `refs/remotes/origin/*` in the clone. This also happens when a later step of the resolve fails.
- Step 5 deletes a learned value that is missing before `ask` runs. If `ask` or its check then fails, the learned value stays deleted.
- Steps 6 and 7 write the learned value after the branch exists in the clone.
- No step writes or deletes a git ref.

### Result

The resolve returns an object with these fields:

| Field | Content |
| --- | --- |
| `base` | The stored form of the base. |
| `revision` | `baseRevision(base)`. |
| `source` | `hint`, `explicit`, `learned`, `config` or `ask`. |
| `notes` | The notes of the resolve, in the order they were added. The list is empty when nothing happened. |

## Workspaces

The workspace of a task is a git worktree on a task branch. The worktree comes from the bare clone of the repo. No command calls these functions yet. No function in `worktree.ts` talks to the remote, so no call needs `sshEnv()`.

Every function that runs git takes one options object. Calls on the clone use `gitDir`. Calls in a worktree use `cwd`.

`assertTaskWorktree({ clone, env, path })` guards each function that runs git in a worktree, because git with a wrong working folder changes another repo. It makes two checks. If `path` is not a worktree of the clone, it throws `not a worktree of the clone: <path>`. If the real path of the worktree has no `.git` file, it throws `the worktree has no .git file: <target>`. Without that file, git would use a repo around the folder. It returns the real path, and the caller runs git with `cwd` set to it. The guard only reads.

### The branch name

`taskBranchName(shortRef, title)` gives the name of the task branch. The name is the short ref, a `-` and a slug of the title. For example, `issue-14` and `Git provider: task workspaces` give `issue-14-git-provider-task-workspaces`.

- The short ref keeps its case. The code makes the title lower case before it makes the slug.
- The name has at most 100 characters. The code cuts the slug to fit, and it removes a `-`, a `.` or a `.lock` that the cut leaves at the end.
- If the short ref leaves no room, or the title has no usable character, the name is the short ref alone.
- If the short ref is not one of the short ref forms below, or if it fails the name check (see below), the function throws `not a safe short ref: <JSON text of the short ref>`. For example, a short ref of more than 100 characters fails the name check.

The short ref is the one that the issue key parsers make. `src/issue-key/short-ref.ts` holds these forms:

- `issue-<N>` for a GitHub key. `<N>` is a number with no leading zero.
- `<PROJ>-<N>` for a Jira key with no site. `<PROJ>` starts with an upper-case letter, then has upper-case letters, digits or `_`.
- `<site>-browse-<PROJ>-<N>` for a Jira key with a site. The site is in lower case.

Every other function that takes a branch runs the same name check first, before any git call. A branch must be a path slug of at most 100 characters, and it must not be `HEAD`. If it is not, the function throws `not a task branch name: <JSON text of the name>`. As a result, git never gets a name with a leading `-`, `..`, `/`, `~`, `^`, `@{` or a space.

The shape check runs after the name check. A name has the task branch shape when it is a short ref alone, or a short ref, a `-` and a lower-case slug. Each name that `taskBranchName()` gives has this shape. `createTaskWorktree()`, `deleteTaskBranch()`, `publishTaskBranch()` and `deleteRemoteTaskBranch()` run the shape check before any git call and before any write to the disk. If a name has no task branch shape, for example `main`, `master` or `feature-x`, the function throws `not a task branch: <JSON text of the name>`. `taskBranchRevision()` only reads, so it runs the name check only.

### The worktree path

`taskWorktreePath(worktrees, shortRef)` gives `<worktrees>/<shortRef>`, for example `<dataRoot>/worktrees/<slug>/issue-14`. The folder name does not change when the title changes.

### List

`listWorktrees({ clone, env })` gives one entry for each worktree of the clone. It leaves out the bare clone itself. An entry has these fields:

| Field | Content |
| --- | --- |
| `path` | The real path that git lists. |
| `branch` | The task branch. A detached worktree has no `branch`. |
| `lockReason` | Set when the worktree is locked: the reason, or the empty text for a lock with no reason. |

Git lists the real path. For a path through a symlink, git lists the real parent folder.

### Create

`createTaskWorktree({ clone, env, path, branch, baseRevision })` is idempotent (safe to run again), so that `tasker start` can continue a failed attempt. It resolves with one of three values:

- `created`: a new branch and a new worktree.
- `reused-branch`: the existing branch, in a new worktree.
- `reused-worktree`: the existing worktree, used again or repaired.

It runs these steps in order:

1. Run the name check and the shape check on `branch`.
2. Make the parent folder of `path`.
3. Find the real path of `path`, the target. List the worktrees.
4. If a worktree is at the target, handle it as the table below shows.
5. If another worktree has the branch, throw.
6. If something other than an empty folder is at the target, throw. This check runs before any `git worktree add`, because git makes the new branch before it reads the path.
7. If the branch exists, run `git worktree add -- <target> <branch>`. The branch keeps its commits and does not move. Git writes no upstream.
8. Otherwise, run `git worktree add --no-track -b <branch> -- <target> <baseRevision>`. The new branch has no upstream.

The table shows each state and what create does. A stop inside `git worktree add` leaves one of the states in the rows marked "stopped".

| State at the path | What create does | Result |
| --- | --- | --- |
| No branch, no worktree, the path is missing or an empty folder | Adds a new branch from the base, and the worktree | `created` |
| The branch exists, no worktree, the path is missing or an empty folder (stopped: git made the branch, or only an admin folder, and then stopped) | Adds a worktree for the branch | `reused-branch` |
| An unlocked worktree on the branch, with the folder and a `.git` file | Changes nothing | `reused-worktree` |
| An unlocked worktree on the branch, with the folder gone | Removes that worktree entry, then adds a worktree for the branch | `reused-branch` |
| A worktree on the branch locked with the reason `initializing`, with a `.git` file (stopped: the checkout is missing or partial) | Runs `git reset --hard` in the folder, then unlocks the worktree | `reused-worktree` |
| Any other locked worktree, for example locked `initializing` with no `.git` file or with a detached head (stopped), another reason, or no reason | Throws `the worktree is locked: <target> (<reason>)` | none |
| An unlocked worktree on the branch, with the folder but no `.git` file (no `.git`, or a `.git` folder) | Throws `the worktree has no .git file: <target>` | none |
| An unlocked worktree on another branch, or a detached one | Throws `the worktree path has another branch: <target> (<branch or detached>)` | none |
| The branch is in a worktree at another path | Throws `the branch <branch> is in another worktree: <path>` | none |
| A file, a symlink or a folder with content at the path | Throws `something else is at the worktree path: <target>` | none |

Create does not repair a locked worktree that has no `.git` file or a detached head. No git command repairs one worktree without `--force`: `git worktree remove` refuses a locked worktree, `git worktree repair` changes every broken worktree of the clone, and `git worktree prune` acts on every entry that it can prune. The error names the lock and the reason, so a person can decide.

The repair of the `initializing` lock trusts the lock. Git sets this lock while `git worktree add` runs, so the folder holds no work of the task. A person who locks a worktree with the reason `initializing` by hand also gets the `git reset --hard`.

### Remove

`removeTaskWorktree({ clone, env, path })` runs `git worktree remove -- <path>`. It never uses `--force`.

- Git refuses a worktree with a changed tracked file or an untracked file. The `GitError` of git passes through, and its message says `contains modified or untracked files, use --force to delete it`.
- Ignored files do not block the remove. Git deletes them with the folder.
- Git refuses a locked worktree and a folder that is not a worktree. The `GitError` passes through.
- A registered worktree with no folder is removed.
- The branch stays.

### Delete branch

`deleteTaskBranch({ clone, env, branch })` runs the name check and the shape check, then `git branch -D -- <branch>`. It uses `-D`, because a task branch is usually not merged in the clone. The `GitError` of git passes through for a branch that a worktree holds and for a missing branch.

The function deletes only a local branch with the task branch shape. It refuses `main` and `master`.

### Discard

`discardWorktreeChanges({ clone, env, path })` calls `assertTaskWorktree()` before any git command. Then it runs these commands in the real path of the worktree, in this order:

1. `git reset --hard`. A deleted `.gitignore` comes back before the next command reads it.
2. `git clean -ffd`. This deletes untracked files and untracked folders, also a nested git repo.

Ignored files stay, because the command has no `-x`. They do not block a later remove.

### Revision

`taskBranchRevision({ clone, env, branch })` gives the commit SHA of the local task branch. It runs the name check, then reads the exact ref `refs/heads/<branch>` with `refRevision()`, which uses `git show-ref`. It does not use `git rev-parse`, because git can then read another ref, for example `refs/heads/refs/heads/<branch>`. If the branch is missing, it throws `cannot resolve the task branch: <branch>`.

### Side effects

- A failed create leaves the parent folder of the worktree.
- A new task branch has no upstream. A reused branch has no upstream only when it had none before, because `git worktree add` without `-b` keeps the configuration of the branch.
- On reuse, the branch keeps its commits and does not move to the base.
- The repair of the `initializing` lock runs `git reset --hard`. It writes the committed files over a partial checkout.
- A stopped `git worktree add` can leave an admin folder in the clone with only a `locked` file. Git does not list it, and the next create uses a new admin name.
- A failed `git worktree add` can leave the new branch. The next create reuses it.
- For an unlocked worktree whose folder is gone, create removes that worktree entry.
- Remove deletes ignored files with the worktree folder.
- Discard deletes a nested git repo in an untracked folder, and keeps ignored files.
- Delete removes only a local branch with the task branch shape.

## Diff and changes

The functions in `src/vcs/git/changes.ts` read what a task changed against its base, and what is not committed yet. tasker reads the commits itself, because some assistants have no shell in planning. No command calls these functions yet.

### Revision input

Each revision input of these functions goes through `src/vcs/git/refs.ts` before git gets it. The callers pass the stored form of the base from `baseRevision()`, which is a full ref.

- A full revision is 40 lower-case hex characters. `isFullRevision()` tests it. The functions keep it as it is and do not read it. A full revision that the clone does not have reaches git, and git fails.
- A text that starts with `refs/` is a ref. `resolveRevision()` reads the exact ref in two calls in the clone. First, `refExists()` runs `git show-ref --verify --quiet -- <ref>`, and exit code 1 means that the ref is missing. Then `refRevision()` runs `git show-ref --verify --hash -- <ref>` and trims the output. Other errors pass through. The code never reads the error text of git.
- Any other text throws `not a full revision or ref: <JSON text of the input>`. `assertRevisionInput()` makes this check, and each function runs it on every revision input before any git call.
- A ref that is missing throws `cannot resolve the revision: <ref>`.

The exact read refuses a text such as `refs/heads/a..refs/heads/b` or `refs/heads/x^{tree}`, because `show-ref --verify --quiet` exits with 1 for it. Git then never gets a range or a suffix that changes what `diff`, `rev-list` or `merge-base` do. A branch input goes through `taskBranchRevision()`. A missing branch throws `cannot resolve the task branch: <branch>`, and these functions run the name check only.

Order in each function: the input checks, then the worktree guard (for a function that runs git in a worktree), then the ref reads, then the git command with full revisions only.

### The functions

Calls on the clone use `gitDir`. Calls in a worktree use `cwd` with the real path from `assertTaskWorktree()`.

| Function | Git command | Where | Result |
| --- | --- | --- | --- |
| `worktreeDiff({ clone, env, path, baseRevision })` | `git diff --no-renames --no-color --no-ext-diff --no-textconv <base>...HEAD --` | worktree | The text as git prints it. |
| `changedPaths({ clone, env, branch, baseRevision })` | `git diff --no-renames -z --name-only <base>...<branch> --` | clone | The list of raw paths. |
| `ownCommitsText({ clone, env, branch, baseRevision })` | `git log --reverse --no-renames --no-color --no-ext-diff --no-textconv --patch "--format=commit %H%n%n%B" <base>..<branch> --` | clone | The own commits, oldest first, each with its diff. |
| `hasCommitsNotIn({ clone, env, head, others })` | `git rev-list --count <head> --not <others...> --` | clone | `true` when the count is more than 0. |
| `uncommittedChanges({ clone, env, path })` | `git status --porcelain --untracked-files=normal --no-renames -z` | worktree | The list of `{ status, path }`. |
| `isAncestor({ clone, env, ancestor, descendant })` | `git merge-base --is-ancestor <ancestor> <descendant>` | clone | `true` or `false`. |
| `fetchTips({ clone, env, sshKey, path, baseRevision })` | `git fetch --prune origin`, then `git rev-parse --verify HEAD^{commit}` | clone, then worktree | `{ head, base }`. |

`uncommittedRefusal(path, changes)` is a pure function. It gives `the worktree has uncommitted changes: <path>: <JSON text of each path, joined with ", ">`. The JSON text keeps a path with a comma or a newline readable and exact.

### Reasons for the flags

- The three-dot range `<base>...<branch>` compares the branch with the merge base. A file that only the base got after the fork does not show. The two-dot range of `git diff` lists those files, so the diffs use the three-dot range.
- The own commits use the two-dot range `<base>..<branch>`, which gives the commits that the branch has and the base does not.
- `-z` makes git print each path raw and end it with a NUL. Without `-z`, git quotes a path with a newline, a tab, a quote or a non-ASCII character. A private parser splits the output on NUL and drops the empty item after the last NUL.
- `--no-renames` makes a rename give both paths: two paths in the diff, and two records in the status.
- `--untracked-files=normal` makes untracked files show, also when the worktree has `status.showUntrackedFiles=no`. An untracked folder gives one record, for example `?? sub/`. An ignored file does not show. Each path is relative to the root of the worktree.
- `--no-color`, `--no-ext-diff` and `--no-textconv` stop colors, `diff.external` and textconv filters of the user configuration from changing the text. `diff.noprefix` still changes the `a/` and `b/` prefixes of the diff text.
- The explicit `--format` stops `format.pretty` and `log.decorate` of the user from changing the text.

### Results and errors

- `worktreeDiff()` compares commits. An uncommitted change of a tracked file does not show.
- `changedPaths()` and `ownCommitsText()` read the branch in the clone, so the worktree is not necessary. A fresh branch gives an empty list.
- `NO_OWN_COMMITS` is the text that `ownCommitsText()` gives when git prints nothing: `This branch has no commits of its own since its base yet.` A merge commit shows no diff, as git does by default.
- `hasCommitsNotIn()` runs the input check on `head` and on each other revision first. An empty `others` gives `true` for each head that exists, because git then counts every commit that the head reaches.
- `uncommittedChanges()` gives one record for each path. `status` is the two status characters, for example ` M`, `??`, `D ` or `A `. An empty list means a clean worktree. A staged rename gives a `D ` record and an `A ` record.
- `isAncestor()` gives `true` for the same commit. Only a `GitError` with exit code 1 gives `false`. Every other failure passes through, for example exit code 128 for a full revision that the clone does not have.
- A function that takes `path` throws `not a worktree of the clone: <path>` or `the worktree has no .git file: <target>` from the guard.

### The remote

`fetchTips()` is the one function in `changes.ts` that talks to the remote. It runs the fetch through `runRemoteGit()` with `sshKey`, as provision does (see [version-control.md](version-control.md#the-ssh-key)). `runGit()` sets its own ssh command, and that command beats `core.sshCommand` of the clone, so a call without the key environment does not use the configured key.

The steps are: check the base text, run the guard, fetch, read the head of the worktree, then read the base. The base is read after the fetch, because the fetch can make or move the ref.

### Side effects

- The fetch of `fetchTips()` moves and prunes `refs/remotes/origin/*` in the clone. This also happens when the head read or the base read fails after the fetch. A bad base text or a failed guard causes no fetch.
- Every other function in `changes.ts`, `assertTaskWorktree()` and the functions of `refs.ts` read. They write no ref, no file and no configuration.
