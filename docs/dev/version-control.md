# Version control

All code that starts `git` lives in `src/vcs/git/`.

## The git folder

No folder of `src/` outside `src/vcs/git/` starts git. A boundary test enforces this rule. The test has two known gaps: it cannot find a module name that the code builds at run time, and it cannot find a git name that the code builds at run time.

[workspaces.md](workspaces.md#reconcile) gives the rules of reconcile. [Doctor checks](#doctor-checks) gives the rules of the git doctor checks.

## The provider interface

One factory is the only place that picks a provider. It reads `vcs.provider`. Git is the only provider. The git provider maps names only and adds no behavior.

- The interface owns the types of its operations. The git modules import them from the interface. No module re-exports them.
- The doctor check type stays in `src/doctor/`, because it is not a version control type.
- Reconcile does not fetch. The caller resolves the base first, which fetches.
- Push guard rule: a provider that cannot guard a push refuses to provision, and it never runs with a weaker guard. The git provider guards a push with the pre-push hook that provision writes (see [Push guard](#push-guard)).
- Limit: each git provider gives its own version check, and its lock-file check reads `/proc` in its own call. A doctor run over two git repos has two version checks and can read `/proc` two times.

Import boundary: no file under `src/` outside `src/vcs/` imports from `src/vcs/git/`. A boundary test enforces this rule. Files under `test/` are out of scope, because the tests of the git code import it. The test cannot find a module name that the code builds at run time.

[code-conventions.md](code-conventions.md#add-an-operation-to-the-version-control-provider) gives the steps to add an operation.

## How tasker uses git

This section describes the design.

tasker makes one bare clone for each repo that it owns. A bare clone has no work tree. tasker starts each task in its own worktree, which it makes from the bare clone, on its task branch (see [workspaces.md](workspaces.md#workspaces-1)). [data-root.md](data-root.md#folders) gives the folders.

tasker never works directly in the bare clone. Task work happens only in the worktree of the task.

tasker owns the repo that it uses. It never uses a different repo because of the environment of the caller. For this reason, `runGit()` removes the repo-local git variables (see the next section). As a result, a git dir is only for the bare clone, and task commands use a working folder.

## `runGit()`

The first argument is the git subcommand, never an option, so an error of git always names the real subcommand.

- The bare-clone mode runs git with `--bare --git-dir`, so git has no work tree, and a command that needs one fails. `GIT_WORK_TREE` beats `--bare`, so tasker removes it. tasker never sets `core.worktree` or `core.bare=false` in its clone. Limit: a non-bare git dir is out of scope, because its configuration can give git a work tree even with `--bare`. A command that needs a work tree runs in a task worktree.
- tasker removes the repo-local git variables, because it owns its repo. The list is what `git rev-parse --local-env-vars` prints (git 2.47.3), plus `GIT_NAMESPACE`, and each `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>`. `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM` and `GIT_CONFIG_NOSYSTEM` still reach git, because they set the configuration of the user and of the machine and do not choose the repo.
- `GIT_TERMINAL_PROMPT=0` always wins, so git asks no credential question.
- Git uses a `GIT_SSH_COMMAND` that is present, even an empty one, and then ignores `GIT_SSH`. So tasker never passes an empty value.
- A `GIT_SSH` of the caller stays only when tasker sets no ssh command.
- The default `ssh -o BatchMode=yes` makes ssh fail and never ask for a password or a host key. For the rule that an env `GIT_SSH_COMMAND` wins over `core.sshCommand`, see [The ssh key](#the-ssh-key).
- tasker does not add `process.env`, and git is found on the `PATH` of the given env. An empty `PATH` fails before git starts, so Node never uses the `PATH` of tasker.

Git gets no input stream. It stays in the process group of tasker, so a Ctrl-C or a hangup stops it too.

Limit: an abort sends SIGTERM to git and destroys the pipes, but git does not stop an ssh child. The ssh child runs until ssh ends.

Limit: a program that git starts and that opens `/dev/tty` by itself, for example a GPG pinentry, can still use the terminal.

## Provision

The marker is the file `bare-repo.incomplete` next to the clone folder `bare-repo` (see [data-root.md](data-root.md#folders)). Provision writes it before `git init` and removes it after the first fetch of a fresh clone. While the marker exists, the next provision takes the recovery path: it deletes the clone folder, with every file that a person put there, and clones again. The marker and the parent folder stay.

A complete clone has no marker and is not cloned again. This is the path of a complete clone. Provision applies the configuration and fetches. A change to `vcs.config` or to `remote` takes effect at the next provision.

- `git ls-remote --exit-code` runs before any write, so a failed `ls-remote` on a fresh path leaves nothing on disk. Exit code 2 means that the remote answers and has no refs.
- The cwd of `ls-remote` and `init` is the root of the file system, so a relative remote path resolves against `/` and names the same repo in `ls-remote` and in the fetch.
- Provision uses `init --bare` and `remote add`, and not `git clone --bare`. `clone --bare` copies each remote branch to `refs/heads/*`, and these copies do not move on fetch, so they become old. In the clone of tasker, `refs/heads/*` holds only task branches. `HEAD` of the clone names a branch that does not exist, and no tasker code reads it. The default branch comes from the symbolic HEAD of the remote.
- `--object-format=sha1` overrides `init.defaultObjectFormat` and `GIT_DEFAULT_HASH`, because a sha256 clone cannot fetch from a sha1 remote. tasker reads only 40-hex revisions, so a sha256 remote is out of scope.
- `--prune` removes the remote-tracking refs of branches that the remote deleted. The fetch brings the tags that point into the fetched branches, as git does by default.

A failure leaves files on disk. If a step after the `init` fails, the parent folder, the marker and the clone folder stay, with the clone folder in the state that the failed step left it. If the removal of the marker fails, the clone is complete, but the marker stays. In each case, the next provision takes the recovery path. A failed hook write on the path of a complete clone rejects before the fetch. That path has no marker, so the next provision takes it again, and the config writes of that run are already done.

A changed `remote` has these effects at the next provision:

- Provision fetches from the new remote into the same clone.
- The task branches in `refs/heads/*` and the objects of the old remote stay in the bare clone.
- `git fetch --prune` removes the remote-tracking refs `refs/remotes/origin/*` that the new remote does not have. It updates the others to the new remote, with force, because the refspec starts with `+`.
- A URL that a person set by hand in the clone goes back to the URL from the configuration.

Provision finds a held lock from the `config.lock` file and never from the text of git. Every other git error passes through with the ssh key hidden (see [The ssh key](#the-ssh-key)).

### The clone configuration

Each value goes in with `git config --replace-all`. This leaves exactly one local line, even when a person added more with `--add`. Each run writes each key. Only the local configuration of the clone changes.

- `remote.origin.url` for a relative local path has the form that `git clone` writes.
- The fetch refspec makes `origin/<branch>` refs.
- An unset author name or email removes the local key, so git uses the global identity. Exit code 5 of `git config --unset-all` means "the key is missing", and provision treats it as success.
- Signing is turned off.
- `core.hooksPath` is local, so a global value does not make git skip the hook. It is absolute, because git resolves a relative value against the worktree.
- The include file holds the ssh command. A relative `include.path` in a bare clone resolves against the clone folder. Provision writes the file to a `.tmp` file and renames it, so a crash leaves only the `.tmp` file. A held `config.lock` fails a config call first, so the include file stays as it was.

If `sshKey` is set, the include file holds this text, where `<value>` is the ssh command:

```
[core]
	sshCommand = "<value>"
```

If `sshKey` is not set, the include file is empty.

Inside the double quotes, git reads `\\`, `\"` and `\n` (a newline) as escapes. A raw newline ends the value. For this reason, provision writes `\` as `\\`, `"` as `\"` and a newline as `\n`. Git reads every other character of a quoted value as it is. Tests on git 2.47.3 showed this for a tab, a carriage return, `\001`, `;`, `#`, `$` and `'`. A path cannot hold NUL. As a result, `git config --get core.sshCommand` in the clone returns the ssh command for any key path.

Use `git config --get core.sshCommand` to read the value. `git config --local --get core.sshCommand` does not show it, because `--local` does not follow includes.

### The ssh key

The key path and the ssh command never go on the git command line. They go in the include file and in the env.

An env `GIT_SSH_COMMAND` wins over `core.sshCommand`, and `runGit()` always sets one when the caller sets none. So each git call that reaches the remote must use the key env. The `core.sshCommand` of the clone takes effect only when git runs with no `GIT_SSH_COMMAND` and no `GIT_SSH` in its env. A `GIT_SSH_COMMAND` that the user exported is replaced when `sshKey` is set and stays when it is not.

A failed remote call throws again with the key hidden and no `cause`.

- The home folder for a `~/` key comes from the password database, as ssh uses it, and not from `$HOME`.
- Limit: for a `~name/` key, tasker cannot find the home folder of that user. It hides only the part of the key from the first `/` to the end, and the home folder can still show.
- Limit: if the key path is short, other text of the message can also be hidden.

## Assistant surface

These are the version-control values for an assistant run.

- The deny rule names `git push` for the shell of the assistant (layer 1 of the push guard).
- A key path that tasker cannot resolve (`~name/`, `~` or a relative path) throws, because a deny path that tasker cannot resolve leaves the key open.
- For a symlinked key, the real path is denied too, because ssh opens the real file.
- A missing key file gives the path alone, because ssh cannot open it either.

### Sandbox write paths

One `git commit` in a worktree writes new objects in `objects/`, the branch ref in `refs/`, the reflog in `logs/`, and `index`, `logs/HEAD` and `COMMIT_EDITMSG` in the admin dir of the worktree. It does not write `packed-refs`, `config`, `hooks/` or `HEAD` of the clone. The write paths cover only these places.

- The paths do not cover all of the clone folder, and not `hooks/` or `config`, because the later git calls of tasker run them.
- The paths do not cover the folder of the publish tokens (see [Push guard](#push-guard)).
- The worktree guard runs first (see [workspaces.md](workspaces.md#workspaces-1)).
- Two `git rev-parse` calls read the clone folder and the admin dir, because one call prints two paths on two lines and a path can hold a newline. The code does not use `--path-format=absolute`, because that option needs git 2.31.
- The code creates `logs/` when it is missing. A fresh bare clone has no `logs/`, and a sandbox cannot bind a missing path.
- A sandboxed commit with these paths exits with 0. It prints `Unable to create '<clone>/packed-refs.lock': Read-only file system` to stderr, because `packed-refs` is not writable.
- The paths do not give the worktree folder. The assistant layer writes there already.

The name of the clone folder must not end in `.git`. When the cwd of `claude` is a linked worktree, `claude` reads the `.git` file of the worktree. If the admin dir is `<common>/worktrees/<name>` and the name of `<common>` ends in `.git`, `claude` adds all of `<common>` to the write list of its sandbox. No setting of `claude` turns this off. For this reason, the clone folder is `bare-repo`.

These results come from `claude` 2.1.299, with a bare clone, one linked worktree and the four write paths of this section:

- With the clone folder `repo.git`, `touch HEAD`, `touch info/x`, `touch description`, a new file in the clone root and `git pack-refs` all exit with 0 in the sandbox.
- With the clone folder `bare-repo`, each of these fails with `Read-only file system`. `git commit` in the worktree still exits with 0 and moves the branch.
- A `denyWrite` setting does not fix the `.git` case. A deny of the whole clone also blocks `objects/` and the admin dir, so `git commit` fails. A deny of each file cannot cover a new file name. A deny of a missing file leaves a placeholder file, and `git pack-refs` then fails.

Known limit: the assistant can move any ref of the clone, for example the branch of another task or `refs/remotes/origin/main`. A narrower path does not work, because a commit writes `refs/heads/<branch>.lock` in the `refs/heads/` folder, and every task branch is a file in that folder.

## Push guard

The push guard has three layers:

1. Layer 1 is a deny rule for the shell of the assistant (see [Assistant surface](#assistant-surface)).
2. Layer 2 is the `pre-push` hook of the clone. Provision writes it. See below.
3. Layer 3 is the tip of a branch on the remote. A read of the tip before a run and after it shows a push that skipped the hook.

### The hook

Provision writes the hook on each run, through a `.tmp` file and a rename. A deleted or edited hook comes back at the next provision. On a fresh clone, `git init --bare` makes `hooks/` first, with the files of the git template. The hook is a `/bin/sh` script that needs `rm`.

The hook accepts the push when the value of `TASKER_PUBLISH_TOKEN` is 64 characters of `0-9a-f` and `rm -- <token file>` succeeds. `rm` has no `-f`, so it fails on a missing file. As a result, one push at most uses a token file. The hex and length checks run before `rm`, so a refused value deletes nothing. In every other case, the hook refuses the push.

The hook deletes the token file before git sends anything. When the remote then rejects the push, the token stays used up.

The hook runs for `git push` in each worktree of the clone and in the bare clone. It runs when the push names the remote by name or by URL. It also runs for `git push --dry-run`, for a delete and for a push with nothing to send.

These cases skip the hook:

- `git push --no-verify`.
- A `core.hooksPath` from `git -c` on the command line.
- `git send-pack`, which runs no hook.
- A missing hook, a missing `hooks/` folder, or a hook file without the executable bit.
- A write by the assistant to the clone. It can edit the hook or the configuration. The next provision writes the hook and `core.hooksPath` again.

Layer 1 and layer 3 cover these cases.

The hook alone does not cover them. A caller that runs an assistant must apply the deny rule of layer 1, and compare the tips of layer 3 before and after the run.

The token files are outside the bare clone and outside each worktree. The sandbox of the assistant must not have a write path that covers them. This doc makes no other promise about a sandbox.

### The publish token

The token reaches the hook, because `runGit()` removes only the variables that this doc names (see [`runGit()`](#rungit)).

After each push call, the token file is gone. When the hook accepts the token, the hook deletes the file. In every other case, tasker deletes it: the hook rejects, the push skips the hook, git fails before the hook, or the push throws.

Crash limit: when the tasker process stops between the write of the token file and its delete, a valid token file stays. A later push that names that token passes the hook.

### The remote tip

The `ls-remote` pattern matches the tail of a ref and is a glob. So tasker takes only the output line whose ref is exactly `refs/heads/<branch>`. A tag, a branch such as `a/refs/heads/<branch>` and revision text give "absent". A failed read never gives "absent".

## Publish and land

Each push runs in the bare clone with one token and the ssh key (see [The ssh key](#the-ssh-key)). No push uses `--force`, a `+` refspec, `--all`, `--mirror`, `--tags` or `--porcelain`. Each refspec uses full ref names.

The shape check of [the branch name](workspaces.md#the-branch-name) means that publish and delete never push or delete `main`, `master` or another base.

An error that wraps a failure has no `cause`, and no code reads its detail.

### The published revision

The caller passes the last revision that tasker published for the branch. Limit: no store column, file or git ref holds it.

One rule decides what the tip on the remote means for publish and delete. The expected tip is the published revision, or no branch when none is set. A tip at the expected revision is "expected". No branch while a published revision is set is "absent". A tip at any other revision, or a branch while no published revision is set, gives the moved error.

### Publish

Every publish push uses a lease, and the lease covers a push by someone else between the tip read and the push. Git acts like this:

- With `published` set, and origin at `published`, git updates the branch also when the update is not a fast-forward.
- With `published` set, and origin moved by someone else or without the branch, git refuses the push (`stale info`).
- Without `published` (the empty lease), git creates the branch when origin has none. It refuses the push when origin has the branch.

A push is skipped when origin already has the local revision.

### Land

The land push has no lease, no `--force` and no `+`. As a result, git refuses a push that is not a fast-forward, and origin does not move.

- A push of a revision that origin already has succeeds and changes nothing.
- The clone must have the revision, or git refuses the push.
- A base that origin does not have is refused, for example `HEAD`, which a plain push would make as a new branch on origin.
- Limit: if someone deletes the base between the tip read and the push, the push makes the base again at the revision.
- A local base (`refs/heads/`) cannot land.

### Delete

The delete needs the lease, because a plain delete of a branch that origin does not have succeeds with a warning. After a failed push, tasker reads the tip again, so a branch that is already gone is not an error.

### Side effects

- Each push, also a push that git then rejects, uses one token, because the hook deletes the token before git sends anything.
- A failed push changes nothing on origin.
- A successful publish or land moves the matching `refs/remotes/origin/*` ref in the clone, and a successful delete removes it.

## Doctor checks

The caller of the git doctor checks must pass `procRoot: "/proc"` and `platform: process.platform`.

[doctor.md](doctor.md) gives the rules of the check type and the timeout.

### The wrapper

The git checks send `detail` and `remediation` through the ssh key hider, so a check never shows the key. For the signal and timeout rules, see [doctor.md](doctor.md#the-shared-wrapper).

### Git version

The check accepts the output forms `2.47.3.windows.1`, `2.39.5 (Apple Git-154)` and `2.47.0.rc1`.

### Commit identity

The check reads with no `--local`, so a global identity counts, as it does for a commit.

- A missing clone is tested first, because `git --git-dir <missing>` reads the global value.
- A missing clone is not a problem, because provision writes the identity at the first start.
- Limit: `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` win in a real commit, and the check does not read them.

### Connection

The probe lets the user tell a wrong key from a wrong `remote`.

### The probe

The probe is the one place that starts ssh directly, because git has no command that shows the greeting. It uses the key of the repo. It returns only the account name and never returns ssh text.

- It starts nothing when `GIT_SSH` is set.
- Only GitHub greets in the form `Hi <account>! You've successfully authenticated`. Another host gives no account name.

### Stale lock files

- A lock that a process holds open is skipped, because git holds a lock file open while it writes it.
- A git process in the clone causes a skip only when the lock is inside its cwd. A git in a task worktree has its cwd outside the clone, so only the open-file skip covers its lock files.
- Limit: on a platform that is not Linux, or when `/proc` cannot be read, tasker cannot tell if a process uses the file.
- `/proc` is read at most once for each call, and only when a stale lock exists.
- Doctor deletes nothing.

### Side effects

- The checks write nothing.
- ssh writes `known_hosts` only when the ssh configuration of the user permits it.
- A timeout can leave an ssh child that runs until ssh ends.

## The repo slug

The slug turns the repo key into one folder name that a person can read. It is the same slug that tasker uses for the folder of the files of a task, for the short ref and for the title part of a branch name.

The slug has these limits:

- A repo slug longer than 255 bytes, the usual limit for a file name, throws.
- Two inputs can give the same slug. For example, the repo keys `a/b` and `a-b` share a repo folder.
- Two issue keys can also give the same slug, for example the Jira keys `jira.example.com/browse/PROJ-1` and `jira-example.com/browse/PROJ-1`. The two issues then share the short ref, the worktree folder, the task branch and the folder of the files of a task.
- On a file system that ignores case, two keys that differ only in case also share a folder.

tasker does not check for a shared slug.
