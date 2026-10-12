# Version control

All code that starts `git` lives in `src/vcs/git/`. No command uses this code yet.

## The git folder

- `src/vcs/git/config.ts` holds `GitConfigSchema` and the type `GitVcsConfig`.
- `src/vcs/git/provider.ts` holds `createGitProvider()`.
- `src/vcs/git/run.ts` holds `runGit()` and `gitSshCommand()`.
- `src/vcs/git/repo-paths.ts` holds `repoSlug()` and `repoPaths()`.
- `src/vcs/git/ssh.ts` holds `shellQuote()`, `sshCommand()`, `sshEnv()`, `hideSshKey()`, `homeKeyPath()`, `runRemoteGit()`, `remoteNotAnswering()`, `remoteCwd()`, `isLocalRemote()` and `cloneUrl()`.
- `src/vcs/git/default-branch.ts` holds `remoteDefaultBranch()`.
- `src/vcs/git/provision.ts` holds `provisionClone()`.
- `src/vcs/git/base-branch.ts` holds `parseBaseInput()`, `baseRevision()`, `resolveBaseBranch()` and `LOCAL_PREFIX`.
- `src/vcs/git/worktree.ts` holds `taskBranchName()`, `assertTaskBranch()`, `assertTaskBranchShape()`, `taskWorktreePath()`, `withoutLineEnd()`, `listWorktrees()`, `assertTaskWorktree()`, `createTaskWorktree()`, `removeTaskWorktree()`, `deleteTaskBranch()`, `discardWorktreeChanges()` and `taskBranchRevision()`.
- `src/vcs/git/refs.ts` holds `isFullRevision()`, `refExists()`, `refRevision()`, `assertRevisionInput()` and `resolveRevision()`.
- `src/vcs/git/changes.ts` holds `worktreeDiff()`, `changedPaths()`, `ownCommitsText()`, `hasCommitsNotIn()`, `uncommittedChanges()`, `uncommittedRefusal()`, `isAncestor()`, `fetchTips()`, `fetchOrigin()`, `nulFields()`, `jsonPathList()`, `worktreeHead()`, `worktreeChanges()` and `NO_OWN_COMMITS`.
- `src/vcs/git/reconcile.ts` holds `worktreeState()`, `reconcileWorktree()`, `rebaseOnto()`, `resyncWorktree()`, `restoreWorktree()` and `restoreCommands()`. [workspaces.md](workspaces.md#reconcile) gives the rules.
- `src/vcs/git/assistant-surface.ts` holds `EXECUTE_COMMIT_TEXT`, `DENY_RULES`, `readDenyPaths()` and `sandboxWritePaths()`.
- `src/vcs/git/push-guard.ts` holds `installPushHook()` and `pushWithToken()`.
- `src/vcs/git/remote-tip.ts` holds `remoteTip()` and `tipMoved()`.
- `src/vcs/git/publish.ts` holds `publishTaskBranch()`, `landOnBase()` and `deleteRemoteTaskBranch()`.
- `src/vcs/git/doctor.ts` holds `gitDoctorChecks()`, `gitVersionCheck()`, `identityCheck()`, `connectionCheck()`, `staleLockCheck()` and the type `GitDoctorRepo`. [Doctor checks](#doctor-checks) gives the rules.
- `src/vcs/git/stale-locks.ts` holds `findStaleLocks()`, `readProcView()`, `onceProcView()`, `isInside()` and `DeadlineError`.
- `src/vcs/git/ssh-account.ts` holds `sshTarget()` and `sshAccount()`.

No other folder in `src/` starts git.

The test `test/vcs/git/boundary.test.ts` enforces this rule. It fails when a file outside `src/vcs/git/` loads `child_process` and has a string literal that is `git` or starts with `git `. The test finds each way to load the module: `import ... from`, `import "..."`, `import("...")`, `require("...")` and `export ... from`. It does this for `child_process` and `node:child_process`. The test has two known gaps. It cannot find a module name that the code builds at run time. It cannot find a git name that the code builds at run time.

## The provider interface

`src/vcs/provider.ts` holds the `VcsProvider` interface and `createVcsProvider()`. No command uses them yet. `tasker start` uses them in M4.

A command gets a provider from `createVcsProvider(repoConfig)` and calls its operations. `createVcsProvider()` is the only place that picks a provider. It reads `vcs.provider` and passes `remote` and `vcs.config` to the provider. Git is the only provider. `src/vcs/git/provider.ts` holds `createGitProvider()`.

Each operation takes the context `{ dataRoot, repoKey, env }` first. The git provider finds the folders of the repo with `repoPaths(dataRoot, repoKey)`.

The git provider maps names only. Each operation has the errors and the side effects of its git function, and no others.

These files of `src/vcs/` are outside `src/vcs/git/`:

- `src/vcs/provider.ts` holds the interface, `createVcsProvider()` and the types of the interface.
- `src/vcs/errors.ts` holds `ReconcileConflictError`.
- `src/vcs/config-schema.ts` holds `vcsConfigSchema()`.

The interface owns the types that its operations take and return. The git modules import these types from `src/vcs/provider.ts`. `Check` stays in `src/doctor/check.ts`, because it is the type of a doctor check and not a version control type.

The interface uses neutral names. The git provider maps them to the names of git:

| Neutral name | Git name |
| --- | --- |
| workspace (the folder of a task) | task worktree |
| `taskRef` | task branch (the name, not `refs/heads/<name>`) |
| revision (`baseRevision`, `revision`, `published`) | full revision (40 hex) or full ref |
| base, `defaultBase` | base branch, `defaultBaseBranch` |
| `reused-task-ref` | `reused-branch` |
| `reused-workspace` | `reused-worktree` |

Each operation calls one git function:

| Operation | Git function |
| --- | --- |
| `provision` | `provisionClone()` |
| `createWorkspace` | `createTaskWorktree()` |
| `removeWorkspace` | `removeTaskWorktree()` |
| `resolveBase` | `resolveBaseBranch()` |
| `diffAgainstBase` | `worktreeDiff()` |
| `ownCommits` | `ownCommitsText()` |
| `uncommittedChanges` | `uncommittedChanges()` |
| `reconcile` | `reconcileWorktree()` |
| `publish` | `publishTaskBranch()` |
| `land` | `landOnBase()` |
| `deleteRemoteTaskRef` | `deleteRemoteTaskBranch()` |
| `installPushGuard` | `installPushHook()` |
| `assistantSurface` | `EXECUTE_COMMIT_TEXT`, `DENY_RULES`, `readDenyPaths()` and `sandboxWritePaths()` |
| `doctorChecks` | `gitDoctorChecks()` |

`reconcile` does not fetch. A caller runs `resolveBase` first, which fetches. A conflict rejects with `ReconcileConflictError` from `src/vcs/errors.ts`.

Push guard rule: a provider that cannot guard a push refuses to provision. Its `provision()` rejects, and the provider never runs with a weaker guard. The git provider guards a push with the pre-push hook that `provisionClone()` writes (see [Push guard](#push-guard)). If the hook write fails, `provisionClone()` rejects.

Each git provider gives its own version check, so a doctor run over two git repos has two version checks.

The test `test/vcs/git/boundary.test.ts` also fails when a `.ts` file under `src/` outside `src/vcs/` imports from `src/vcs/git/`. It finds `import ... from`, `import "..."`, `import("...")`, `require("...")` and `export ... from` with a relative path. Files under `test/` are not in scope, because the tests of the git code import it. The test cannot find a module name that the code builds at run time.

## How tasker uses git

This section describes the design. No command uses this code yet.

tasker makes one bare clone for each repo that it owns. The clone is at the `clone` path of `repoPaths()`: `<dataRoot>/clones/<slug>/repo.git`. A bare clone has no work tree.

tasker starts each task in its own worktree. tasker makes the worktree from the bare clone. The worktree is under the `worktrees` path of `repoPaths()`: `<dataRoot>/clones/<slug>/worktrees/`. Each task worktree is at `<worktrees>/<shortRef>`, on its task branch (see [workspaces.md](workspaces.md#workspaces)).

tasker never works directly in the bare clone. Task work happens only in the worktree of the task.

tasker owns the repo that it uses. It never uses a different repo because of the environment of the caller. For this reason, `runGit()` removes the repo-local git variables (see the `options.env` rule in the next section).

As a result, `options.gitDir` is only for the bare clone, and task commands use `options.cwd`.

## `runGit()`

`runGit(args, options)` runs one git command. It resolves with the stdout of git as UTF-8 text. It does not trim the text.

- `args[0]` must be the git subcommand, for example `rev-parse`. It must not be an option. For this reason, an error of git always names the real subcommand.
- `options.cwd` runs git in that folder.
- `options.gitDir` must be the bare clone that tasker made, and nothing else. Git runs with `--bare --git-dir <gitDir>`, and its cwd is the git dir. Git starts one time for each call. As a result, git has no work tree, and a command that needs one fails with a `GitError` (`this operation must be run in a work tree`). The env rule removes `GIT_WORK_TREE`, which beats `--bare`. For the design behind this mode, see [How tasker uses git](#how-tasker-uses-git). tasker never sets `core.worktree` or `core.bare=false` in its clone. A non-bare git dir is out of scope, because its configuration can give git a work tree even with `--bare`. Use `options.cwd` for a command that needs a work tree, for example in a task worktree.
- `options.env` is the environment of the child, with these changes:
  - `runGit()` removes the repo-local git variables in both modes, because tasker owns the repo that it uses (see [How tasker uses git](#how-tasker-uses-git)). These are the 15 names that `git rev-parse --local-env-vars` prints (git 2.47.3): `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CONFIG`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_OBJECT_DIRECTORY`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_IMPLICIT_WORK_TREE`, `GIT_GRAFT_FILE`, `GIT_INDEX_FILE`, `GIT_NO_REPLACE_OBJECTS`, `GIT_REPLACE_REF_BASE`, `GIT_PREFIX`, `GIT_SHALLOW_FILE` and `GIT_COMMON_DIR`. `runGit()` also removes `GIT_NAMESPACE`, and each `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>`.
  - Apart from the ssh and prompt rules below, these are the only variables that `runGit()` removes or changes.
  - For example, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM` and `GIT_CONFIG_NOSYSTEM` reach git. `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` each name a configuration file that git reads. They set the configuration of the user and of the machine. They do not choose the repo, so they do not break the rule that tasker uses only the repo that it owns.
  - `GIT_TERMINAL_PROMPT=0` always wins over the value of the caller.
  - Git uses a `GIT_SSH_COMMAND` that is present, even an empty one, and then ignores `GIT_SSH`. For this reason, `runGit()` never passes an empty value. The ssh command is `gitSshCommand(env)` (next item). When the command is a string, `runGit()` sets `GIT_SSH_COMMAND` to it and removes `GIT_SSH`. A caller that sets both variables loses `GIT_SSH`, but git ignores `GIT_SSH` in that case, so git runs the same ssh command. When the command is `undefined`, `runGit()` removes the empty `GIT_SSH_COMMAND`, and the `GIT_SSH` of the caller stays.
  - `gitSshCommand(env)` holds this ssh rule. It gives a non-empty `GIT_SSH_COMMAND` of `env`. Otherwise it gives `undefined` when `env` has a non-empty `GIT_SSH`. Otherwise it gives `ssh -o BatchMode=yes`.
  - `runGit()` does not add `process.env`.
- `options.signal` is optional. When it fires, git gets SIGTERM and `runGit()` rejects with the abort error (`name` is `AbortError`). The call also destroys the pipes of git, so an ssh child that git left running does not hold tasker. Known limit: git does not stop that ssh child. It runs until ssh ends. A call with no `signal` works as before.
- Git is found on `options.env.PATH`. If the env has no `PATH` or an empty one, `runGit()` rejects before git starts. As a result, Node never uses the `PATH` of tasker.

Git gets no input stream. Its stdout and stderr go to pipes, not to the terminal. Git asks no credential question, because `GIT_TERMINAL_PROMPT=0`. Ssh asks no question (no password and no host key) because of BatchMode, and it fails instead. This holds unless the caller sets its own ssh command (a non-empty `GIT_SSH_COMMAND` or `GIT_SSH`). The default `GIT_SSH_COMMAND` wins over `core.sshCommand` in the git configuration. A caller that needs another ssh command must set `GIT_SSH_COMMAND` itself.

Git stays in the process group of tasker. As a result, a Ctrl-C or a hangup stops git too.

Known limit: a program that git starts and that opens `/dev/tty` by itself can still use the terminal. An example is a GPG pinentry for a signed commit.

`runGit()` rejects in these cases:

| Case | Error |
| --- | --- |
| `args` is empty. | `Error`: `runGit needs a git subcommand` |
| `args[0]` starts with `-`. | `Error`: `runGit needs the git subcommand as the first argument` |
| Git exits with a code other than 0. | `GitError`: `git <subcommand> failed with exit code <n>: <stderr>` |
| A signal stops git. | `GitError`: `git <subcommand> was stopped by signal <SIG>` |
| `gitDir` does not exist or is not a folder. | `Error`: `the git dir does not exist: <gitDir>` |
| `cwd` does not exist or is not a folder. | `Error`: `the working folder does not exist: <cwd>` |
| The env has no `PATH`, or `PATH` is empty. | `GitNotInstalledError`: `git is not installed: the env has no PATH` |
| Git is not on `PATH`. | `GitNotInstalledError`: `git is not installed: git was not found on PATH` |

The checks of the first two rows, of the `PATH` row, of the `gitDir` row and of the `cwd` row run before git starts. A `GitError` has the fields `subcommand`, `stdout`, `stderr` and `exitCode`. `exitCode` is `null` when a signal stops git. The message leaves out `: <stderr>` when stderr is empty.

## Provision

`provisionClone({ remote, clone, config, env, publishTokens })` in `src/vcs/git/provision.ts` makes the bare clone of a remote and fetches it. `clone` is the `clone` path of `repoPaths()`. `config` is the `vcs.config` of the repo (`authorName`, `authorEmail` and `sshKey`, see [docs/config.md](../config.md)). `publishTokens` is the `publishTokens` path of `repoPaths()`. The pre-push hook holds it (see [Push guard](#push-guard)). Provision does not make that folder. No command calls `provisionClone()` yet.

The marker is the file `<clone>.incomplete`, that is `<dataRoot>/clones/<slug>/repo.git.incomplete`, next to `repo.git`. Provision writes it in step 4, before `git init`, and removes it after the first fetch of a fresh clone (step 8). While the marker exists, each provision takes the path of step 1.

These are the steps:

1. If the marker exists, an earlier clone stopped partway. Provision deletes only the clone folder `repo.git`, including each file that a person put there. The marker and the parent folder `<dataRoot>/clones/<slug>/` stay. Then it goes on with step 3.
2. If the clone folder exists and the marker does not, the clone is complete. Provision applies the clone configuration (step 6), then runs `git fetch --prune origin` (step 7), and returns. It does not clone again.
3. Provision runs `git ls-remote --exit-code -- <remote>`. The cwd is `remoteCwd()`, the root of the file system, so a relative remote path resolves against `/`. On the fresh path, provision has made no file and no folder yet, so a failed `ls-remote` leaves nothing on disk. On the path from step 1, the marker and the parent folder still exist, because step 1 removes only the clone folder.
4. Provision makes the parent folder of the clone when it is missing. It writes an empty marker, or overwrites the marker that step 1 left with an empty file.
5. Provision runs `git init --bare --object-format=sha1 -- <clone>` with the same cwd, the root of the file system. It passes the clone path as an absolute path (`resolve(clone)`), so the cwd does not move the clone. Then it runs `git remote add -- origin <url>` in the clone, where `<url>` is `cloneUrl(remote)`. As a result, a relative remote path names the same repo in `ls-remote` and in the fetch. The clone has no local branch. `git clone --bare` copies each branch of the remote to `refs/heads/*`, and these copies do not move on fetch, so they become old. In the new clone, `refs/heads/*` holds only the task branches that tasker makes. `HEAD` of the clone names a branch that does not exist. No tasker code reads it. The default branch comes from the remote (see [`remoteDefaultBranch()`](#remotedefaultbranch)). `--object-format=sha1` stops `init.defaultObjectFormat` in the user configuration and `GIT_DEFAULT_HASH`. With sha256, the fetch from a sha1 remote fails. tasker reads only 40-hex revisions, so a sha256 remote is out of scope.
6. Provision applies the clone configuration: see [The clone configuration](#the-clone-configuration).
7. Provision runs `git fetch --prune origin`. The `--prune` option removes the remote-tracking refs of branches that the remote deleted.
8. On the fresh-clone path, provision removes the marker.

The fetch brings the tags that point into the fetched branches, as git does by default. `git clone --bare` brought every tag of the remote.

A step can fail in these ways:

- If `ls-remote` fails on the path from step 1, the marker and the parent folder stay.
- If a step from 5 to 7 fails, provision rejects. The parent folder, the marker and the clone folder stay, with the clone folder in the state that the failed step left it. A failed `git init` can leave a partial clone folder. A failed `remote add`, configuration step or fetch leaves a bare repo with no refs or only some refs.
- If step 8 fails, the clone is complete, but the marker stays.

In each case, the next provision takes the path of step 1.

If the hook write of step 6 fails on the path of step 2, provision rejects before the fetch. That path has no marker, so the next provision takes step 2 again. The git config writes and the include file of that run are already done.

A second provision on a complete clone takes step 2. A change to `vcs.config` or to `remote` takes effect at the next provision.

A changed `remote` in the configuration has these effects at the next provision:

- Provision fetches from the new remote into the same clone.
- The task branches in `refs/heads/*` and the objects of the old remote stay in the bare clone.
- `git fetch --prune` removes the remote-tracking refs `refs/remotes/origin/*` that the new remote does not have. It updates the others to the new remote, with force, because the refspec starts with `+`.
- A URL that a person set by hand in the clone goes back to `cloneUrl(remote)`.

Provision rejects with these errors:

| Case | Error |
| --- | --- |
| `git ls-remote` exits with code 2: the remote answers and has no refs. | `Error`: `the remote has no refs: <remote>` |
| `git ls-remote` fails in another way. | `Error`: `the remote does not answer: <remote>`, plus `: <stderr>` when stderr is not empty |
| A git config write fails and `<clone>/config.lock` exists. | `Error`: `the clone configuration is locked: <clone>` |
| An fs call of the hook write fails. | `Error`: `cannot install the pre-push hook in the clone: <clone>`, with the fs error as `cause` |

Provision reads no text of git to find a lock. The errors above, except the hook error, have no `cause`. Any other `GitError` of a git call passes through. Its text has gone through `hideSshKey()`, see [The ssh key](#the-ssh-key).

### The clone configuration

Each git config write is one `git config` call with `gitDir` set to the clone. Each value goes in with `git config --replace-all <key> <value>`. This leaves exactly one local line, even when the key had several lines. So an extra local line of each key in this list goes away. An example is a second `include.path` or a second fetch refspec that a person added with `git config --add`. These rules cover only the local configuration of the clone. The global and system configuration do not change. Each run writes each key of this list. In this order, provision:

- Sets `remote.origin.url` to `cloneUrl(remote)`. For a relative local path, this is the root of the file system followed by the path, which is the form that `git clone` writes. Any other remote stays unchanged.
- Sets `remote.origin.fetch` to `+refs/heads/*:refs/remotes/origin/*`, so a fetch makes `origin/<branch>` refs.
- Sets `user.name` to `authorName`. If `authorName` is not set, provision runs `git config --unset-all user.name`. This removes every local line of the key. Provision reads exit code 5 of `--unset-all` as "the key is missing" and treats it as success. Every other failure passes through. On a fresh clone this writes nothing, so git uses the global identity.
- Does the same for `user.email` and `authorEmail`.
- Sets `commit.gpgSign`, `tag.gpgSign` and `tag.forceSignAnnotated` to `false`.
- Sets `core.hooksPath` to `resolve(clone, "hooks")`. A local value beats a global or system value, so a global `core.hooksPath` does not make git skip the hook. The value must be absolute, because git resolves a relative value against the worktree. This replaces a value that a person set in the clone.
- Sets `include.path` to `tasker-ssh.config`.
- After all git config calls succeed, writes the include file.
- Then writes the pre-push hook (see [Push guard](#push-guard)).

The include file is `<clone>/tasker-ssh.config`, that is `<dataRoot>/clones/<slug>/repo.git/tasker-ssh.config`. A relative `include.path` in the config of a bare clone resolves against the clone folder. Provision writes `<clone>/tasker-ssh.config.tmp` first and renames it to `tasker-ssh.config`. A crash between the write and the rename leaves the `.tmp` file in the clone. The next provision overwrites it. A held `config.lock` makes a git config call fail first, so the include file stays as it was.

If `sshKey` is set, the include file holds this text, where `<value>` is `sshCommand(sshKey)`:

```
[core]
	sshCommand = "<value>"
```

If `sshKey` is not set, the include file is empty.

Inside the double quotes, git reads `\\`, `\"` and `\n` (a newline) as escapes. A raw newline ends the value. For this reason, provision writes `\` as `\\`, `"` as `\"` and a newline as `\n`. Git reads every other character of a quoted value as it is. Tests on git 2.47.3 showed this for a tab, a carriage return, `\001`, `;`, `#`, `$` and `'`. A path cannot hold NUL. As a result, `git config --get core.sshCommand` in the clone returns `sshCommand(sshKey)` for any key path.

Use `git config --get core.sshCommand` to read the value. `git config --local --get core.sshCommand` does not show it, because `--local` does not follow includes.

### The ssh key

`sshCommand(sshKey)` gives `ssh -i '<key>' -o IdentitiesOnly=yes -o BatchMode=yes`, with each `'` in the key path written as `'\''`. The command and the key path never go on the git command line. They go in the include file and in the env.

`sshEnv(env, sshKey)` returns `env` with `GIT_SSH_COMMAND` set to `sshCommand(sshKey)`. If `sshKey` is not set, it returns `env` as it is. `runRemoteGit(args, options, sshKey)` runs `runGit()` with that env. Provision runs `ls-remote` and `fetch` through it. `pushWithToken()` runs `push` through it, and `remoteTip()` runs `ls-remote` through it, and `connectionCheck()` runs `ls-remote` through it, and `fetchOrigin()` runs `fetch` through it. `fetchTips()` uses `fetchOrigin()`. The functions of `publish.ts` use these two functions, so each call of them reaches the remote with this env. As a result, `GIT_SSH_COMMAND` reaches ssh in the env of git. A `GIT_SSH_COMMAND` that the user exported is replaced when `sshKey` is set and stays when it is not.
Each git call that reaches the remote must pass the env from `sshEnv()`. The reason is that `runGit()` sets `GIT_SSH_COMMAND=ssh -o BatchMode=yes` when the caller sets no ssh command, and an env `GIT_SSH_COMMAND` wins over `core.sshCommand`. So the `core.sshCommand` of the clone takes effect only when git runs with no `GIT_SSH_COMMAND` and no `GIT_SSH` in its env.

When `runGit()` fails inside `runRemoteGit()`, it rethrows a new `GitError` with no `cause`. The message, `stdout` and `stderr` went through `hideSshKey(text, sshKey, homeDir)`. It replaces each occurrence of these forms with `<sshKey>`, in this order:

1. `sshCommand(sshKey)`.
2. The key as it is.
3. If the key starts with `~/`, the home folder plus the rest of the key. `homeKeyPath()` gives this form. The home folder is `os.userInfo().homedir`, the folder from the password database that ssh uses, not `$HOME`.
4. If the key starts with `~` and a user name (`~name/...`), and the part from the first `/` to the end is not empty: For a `~name/` key, tasker cannot find the home folder of that user. It hides only the part of the key from the first `/` to the end. The home folder of that user can still appear in the error.

`hideSshKey()` hides no other form. If the key path is short, or the part after the first `/` of a `~name/` key is short, other text of the message also becomes `<sshKey>`. If no key is set, the text stays as it is.

## `remoteDefaultBranch()`

`remoteDefaultBranch({ remote, sshKey, env })` in `src/vcs/git/default-branch.ts` runs `git ls-remote --symref -- <remote> HEAD` through `runRemoteGit()`. The cwd is `remoteCwd()`, the root of the file system. This is the same cwd as in provision, and it needs no clone. It finds the line `ref: refs/heads/<name>` followed by a tab and `HEAD`, and returns `<name>`. If the remote has no such line, it throws `Error`: `the remote has no symbolic HEAD: <remote>`.

## `resolveBaseBranch()`

`resolveBaseBranch()` in `src/vcs/git/base-branch.ts` runs `git fetch origin --prune` through `runRemoteGit()` with the ssh key of the repo. No command calls it yet. [workspaces.md](workspaces.md#base-branch) gives the rules.

## Assistant surface

`src/vcs/git/assistant-surface.ts` gives the version-control values for an assistant run. No command uses them yet. A later milestone (M5) connects them to the assistant.

- `EXECUTE_COMMIT_TEXT` is the commit text of the execute prompt. It holds the placeholder `{{BASE_REF}}`. The caller replaces it with the base revision.
- `DENY_RULES` is the list of deny rules for the shell of the assistant, in the rule syntax of Claude Code. It holds `Bash(git push:*)`.
- `readDenyPaths(config)` gives the files that the sandbox must not read. With no `sshKey`, it gives an empty list. A key that starts with `~/` resolves to the home folder plus the rest of the key (see [The ssh key](#the-ssh-key)). A key that is not a `~/` key and not absolute throws `cannot resolve the ssh key path for the sandbox: <key>`, because a deny path that tasker cannot resolve leaves the key open. Examples are a `~name/` key, the key `~` and a relative key such as `keys/id_tasker`. For an absolute path, the function reads the real path of the key file:
  - If the key file is missing, it gives the path alone. ssh cannot open the key either.
  - If the real path is the same as the path, it gives the path alone.
  - If the key file or a folder on its path is a symlink, it gives the path and then the real path, because ssh opens the real file.
  - Any other error of the file system passes through.

### `sandboxWritePaths()`

`sandboxWritePaths({ clone, env, path })` gives four absolute paths, in this order: `objects/`, `refs/` and `logs/` of the clone, and the admin dir of the worktree. One `git commit` in the worktree writes new objects in `objects/`, the branch ref in `refs/`, the reflog in `logs/`, and `index`, `logs/HEAD` and `COMMIT_EDITMSG` in the admin dir. It does not write `packed-refs`, `config`, `hooks/` or `HEAD` of the clone.

- The paths do not cover all of `repo.git`, and not `hooks/` or `config`, because tasker's later git calls run them.
- The paths are inside the clone. They do not cover the `publishTokens` folder (see [Push guard](#push-guard)).
- The function calls `assertTaskWorktree()` first. See the guard paragraph in [workspaces.md](workspaces.md#workspaces-1).
- It reads the clone folder and the admin dir with two `git rev-parse` calls, because one call prints two paths on two lines and a path can hold a newline. It does not use `--path-format=absolute`, because that option needs git 2.31. It resolves each path against the worktree.
- It creates `logs/` when it is missing. A fresh bare clone has no `logs/`, and a sandbox cannot bind a missing path. This is the only write of the function.
- A sandboxed commit with these paths exits with 0. It prints `Unable to create '<clone>/packed-refs.lock': Read-only file system` to stderr, because `packed-refs` is not writable.
- The function does not give the worktree folder. The assistant layer writes there already.

Known limit: the assistant can move any ref of the clone, for example the branch of another task or `refs/remotes/origin/main`. A narrower path does not work, because a commit writes `refs/heads/<branch>.lock` in the `refs/heads/` folder, and every task branch is a file in that folder. M5 closes this gap: tasker records each ref except the task branch before a run and compares it after the run.

## Push guard

The push guard has three layers:

1. Layer 1 is a deny rule in the shell of the assistant. `DENY_RULES` holds it (see [Assistant surface](#assistant-surface)). No command applies the rule yet.
2. Layer 2 is the `pre-push` hook of the clone. `provisionClone()` writes it. See below.
3. Layer 3 is the tip of a branch on the remote. `remoteTip()` reads it and `tipMoved()` compares two tips. No code reads the tip before and after a run yet.

No command calls `installPushHook()`, `pushWithToken()`, `remoteTip()` or `tipMoved()` yet. Provision calls `installPushHook()`. The functions of `publish.ts` call `pushWithToken()` and `remoteTip()` (see [Publish and land](#publish-and-land)).

### The hook

On each run, provision writes `<clone>/hooks/pre-push` with mode 0755. It writes `hooks/pre-push.tmp` first and renames it. It makes the `hooks/` folder when the folder is missing, and it overwrites a `pre-push.tmp` that a crash left. A deleted or edited hook comes back at the next provision. On a fresh clone, `git init --bare` makes `hooks/` first, with the files of the git template (the `.sample` files by default). The hook is a `/bin/sh` script that needs `rm`. It holds `resolve(publishTokens)` in single quotes, quoted with `shellQuote()`.

The hook reads `TASKER_PUBLISH_TOKEN`. It accepts the push when the value is 64 characters of `0-9a-f` and `rm -- <publishTokens>/<token>` succeeds. Then it exits with 0. `rm` has no `-f`, so it fails on a missing file. As a result, one push at most uses a token file. The hex and length checks run before `rm`, so a refused value deletes nothing. In every other case, the hook prints `tasker: the push has no valid publish token` to stderr and exits with 1. Git then prints `error: failed to push some refs to '<url>'` and exits with 1. The hook does not read stdin.

The hook deletes the token file before git sends anything. When the remote then rejects the push, the token stays used up.

The hook runs for `git push` in each worktree of the clone and in the bare clone. It runs when the push names the remote by name or by URL. It also runs for `git push --dry-run`, for a delete and for a push with nothing to send.

These cases skip the hook:

- `git push --no-verify`.
- A `core.hooksPath` from `git -c` on the command line.
- `git send-pack`, which runs no hook.
- A missing hook, a missing `hooks/` folder, or a hook file without the executable bit.
- A write by the assistant to the clone. It can edit the hook or the configuration. The next provision writes the hook and `core.hooksPath` again.

Layer 1 and layer 3 cover these cases.

The token files are in `repoPaths().publishTokens`. That folder is outside the bare clone and outside each worktree. The sandbox of the assistant must not have a write path that covers it. This doc makes no other promise about a sandbox.

### `pushWithToken()`

`pushWithToken(args, { location, publishTokens, sshKey, env })` in `src/vcs/git/push-guard.ts` resolves with no value. It runs `git push <args>` through `runRemoteGit()` (see [The ssh key](#the-ssh-key)). `location` is `{ cwd: <worktree> }` or `{ gitDir: <bare clone> }`.

The function does these steps:

1. It makes the `publishTokens` folder with mode 0700 when the folder is missing. An existing folder keeps its mode.
2. It writes an empty token file `<publishTokens>/<token>` with mode 0600. The token is `randomBytes(32)` as 64 lower-case hex characters. The file flag is `wx`.
3. It runs the push with `TASKER_PUBLISH_TOKEN=<token>`.
4. It deletes the token file with `rmSync(file, { force: true })`, also when the push fails.

`TASKER_PUBLISH_TOKEN` reaches the hook through `runGit()`, because `runGit()` removes only the variables that this doc lists (see [`runGit()`](#rungit)). `pushWithToken()` replaces a `TASKER_PUBLISH_TOKEN` of the caller.

After each call that reaches step 4, the token file is gone. When the hook accepts the token, the hook deletes the file. In every other case, step 4 deletes it. These are the cases: the hook rejects, the push skips the hook, git fails before the hook, and the push throws. A `GitError` of the push passes through. An fs error of step 1 or 2 passes through. A successful push changes the remote.

Crash limit: when the tasker process stops between step 2 and step 4, a valid token file stays. A later push that names that token passes the hook.

### `remoteTip()` and `tipMoved()`

`remoteTip({ remote, branch, sshKey, env })` in `src/vcs/git/remote-tip.ts` reads the tip of one branch on the remote. It runs `git ls-remote -- <remote> refs/heads/<branch>` through `runRemoteGit()` with `remoteCwd()` as cwd. It changes nothing on disk and nothing on the remote.

The result is `{ state: "present", revision }` or `{ state: "absent" }`. The `ls-remote` pattern matches the tail of a ref and is a glob. For this reason, `remoteTip()` takes only the output line whose ref is exactly `refs/heads/<branch>`. A tag, a branch such as `a/refs/heads/<branch>` and revision text give `absent`. An empty remote gives `absent`.

`remoteTip()` throws these errors:

| Case | Error |
| --- | --- |
| `branch` is empty. This check runs before any git call. | `Error`: `the branch name is empty` |
| `git ls-remote` fails with a `GitError`. | `Error`: `the remote does not answer: <remote>`, plus `: <stderr>` when stderr is not empty. The error has no `cause`. |

Any other error passes through. A failed read never gives `absent`.

`tipMoved(before, after)` returns `undefined` when both tips are absent, or when both are present with the same revision. Otherwise it returns `the tip of the branch on the remote moved from <a> to <b>`. Each of `<a>` and `<b>` is the revision, or `absent` for an absent tip.

## Publish and land

`src/vcs/git/publish.ts` holds three functions: `publishTaskBranch()`, `landOnBase()` and `deleteRemoteTaskBranch()`. No command calls them yet.

Each function takes these options:

- `clone` is the bare clone that `provisionClone()` made.
- `remote` is the remote of the repo, the same text that `provisionClone()` got. Provision sets `remote.origin.url` from it, so `origin` in the clone and `remote` name the same repo.
- `publishTokens` is the `publishTokens` path of `repoPaths()`.
- `sshKey` is the `sshKey` of `vcs.config`, or `undefined`.
- `env` is the environment of the child (see [`runGit()`](#rungit)).

Each push runs in the bare clone, with `location: { gitDir: clone }`, through `pushWithToken()`. Each read of the remote runs through `remoteTip()`. As a result, each call to the remote uses the ssh key (see [The ssh key](#the-ssh-key)), and each push uses one token. No push has `--force`, a `+` refspec, `--all`, `--mirror`, `--tags` or `--porcelain`. Each refspec uses full ref names.

Each function checks its inputs before any git call and before any token file. `publishTaskBranch()` and `deleteRemoteTaskBranch()` run the first two checks of this table, in this order, and then the third check on `published`. `landOnBase()` runs the third check on `revision`, and then the two base checks (see [`landOnBase()`](#landonbase)). The checks give these errors:

| Case | Error |
| --- | --- |
| `branch` is not a safe ref part (see [the branch name](workspaces.md#the-branch-name)). | `Error`: `not a task branch name: <JSON text of the name>` |
| `branch` has no task branch shape (see [the branch name](workspaces.md#the-branch-name)). | `Error`: `not a task branch: <JSON text of the name>` |
| `published` or `revision` is not 40 lower-case hex characters. | `Error`: `the published revision is not a full revision: <JSON text>`, or `the revision is not a full revision: <JSON text>` |

Because of the shape check, `publishTaskBranch()` and `deleteRemoteTaskBranch()` never push or delete `main`, `master` or another base.

An error that wraps a failure has no `cause`. The text after the message is `: <detail>`. The detail is the stderr of a `GitError`, or the message of another `Error`. It is left out when it is empty. No code reads the detail. A value that is not an `Error` passes through.

### The published revision

The caller passes `published`, the last revision that tasker published for the branch. No store column, file or git ref holds it in this change. A later milestone stores it. `publishTaskBranch()` returns `revision` for this purpose.

One function decides what the tip on the remote means. The expected tip is `published`, or no branch when `published` is not set. A tip at the expected revision is "expected". No branch while `published` is set is "absent". A tip at any other revision, or a branch while `published` is not set, gives the moved error:

`the task branch moved on origin: <branch>: <before>, <now>`

`<before>` is `tasker published <published>`, or `tasker never published it`. `<now>` is `origin has <revision>`, or `origin does not have it`. Publish and delete use this one function and this one error.

### `publishTaskBranch()`

`publishTaskBranch({ ...options, branch, published })` resolves with `{ state, branch, revision, lease }`. `state` is `published` or `already-published`. `revision` is the local revision of the branch. `lease` is `true` when a push ran with a lease.

These are the steps:

1. Run the input checks. If `published` is set, it must be a full revision.
2. Read the local revision of `refs/heads/<branch>` with `taskBranchRevision()`.
3. Read the tip of the branch on the remote with `remoteTip()`.
4. If the tip is at the local revision, return `already-published` with `lease: false`. No push runs and no token file is made.
5. Decide on the tip (see [The published revision](#the-published-revision)). If the result is "absent" or the tip is at another revision, throw the moved error. No push runs and no token file is made.
6. Push with a lease and return `published` with `lease: true`.

Every publish push uses a lease. The push arguments are always:

```
push --force-with-lease=refs/heads/<branch>:<published or empty> origin refs/heads/<branch>:refs/heads/<branch>
```

The lease text after the colon is `published`, or empty when `published` is not set. Git acts like this:

- With `published`, and origin at `published`, git updates the branch also when the update is not a fast-forward.
- With `published`, and origin moved by someone else or without the branch, git refuses the push (`stale info`).
- Without `published` (the empty lease), git creates the branch when origin has none. It refuses the push when origin has the branch.

Step 5 already refuses these cases. The lease covers a push by someone else between step 3 and step 6.

If the tip read or the push fails, the function throws `cannot publish the task branch: <branch>` and the detail. It does not read the tip again.

| Case | Error |
| --- | --- |
| The local branch is missing. | `Error`: `cannot resolve the task branch: <branch>` |
| The tip is not the expected tip (step 5). | `Error`: the moved error |
| The tip read or the push fails. | `Error`: `cannot publish the task branch: <branch>`, plus the detail |

### `landOnBase()`

`landOnBase({ ...options, base, revision })` resolves with no value. It lands `revision` on the branch `base` of the remote by fast-forward.

These are the steps:

1. Make sure that `revision` is a full revision.
2. If `base` is empty, throw `cannot land <revision>: the base branch is empty`. If `base` starts with `refs/heads/` (`LOCAL_PREFIX`), throw `cannot land <revision> on the base branch: <base>: the base is a local branch`.
3. Read the tip of `base` with `remoteTip()`.
4. If the tip is absent, throw `cannot land <revision> on the base branch: <base>: the base branch does not exist on origin`. No push runs and no token file is made. The tip check refuses a base that origin does not have at the time of the read. For example, it refuses `HEAD`, which a plain push makes as a new branch on origin. If someone deletes the base between the read and the push, the push makes the base again on origin at `<revision>`.
5. Push. The arguments are `push origin <revision>:refs/heads/<base>`. The push has no lease, no `--force` and no `+`. As a result, git refuses a push that is not a fast-forward, and origin does not move. A push of the revision that origin already has succeeds and changes nothing. The clone must have the revision, or git refuses the push.

If the tip read or the push fails, the function throws `cannot land <revision> on the base branch: <base>` and the detail.

### `deleteRemoteTaskBranch()`

`deleteRemoteTaskBranch({ ...options, branch, published })` resolves with `{ state }`. `state` is `deleted` or `already-gone`. `published` is always set.

These are the steps:

1. Run the input checks. `published` must be a full revision.
2. Read the tip with `remoteTip()`. A failure throws `cannot delete the task branch on origin: <branch>` and the detail.
3. Decide on the tip (see [The published revision](#the-published-revision)). If the branch is absent, return `already-gone`. If the tip is at another revision, throw the moved error. No push runs and no token file is made.
4. Push. The arguments are `push --force-with-lease=refs/heads/<branch>:<published> origin :refs/heads/<branch>`. The lease is necessary. A plain delete of a branch that origin does not have succeeds with a warning.
5. Return `deleted`.

If the push fails, the function reads the tip again with the rules of step 3. An absent branch returns `already-gone`. A tip at another revision throws the moved error. If the tip is still at `published`, or if this read fails, the function throws `cannot delete the task branch on origin: <branch>` and the detail of the push error.

### Side effects

- A successful publish creates or moves `refs/remotes/origin/<branch>` in the clone.
- A successful land moves `refs/remotes/origin/<base>` in the clone.
- A successful delete removes `refs/remotes/origin/<branch>` in the clone.
- Each push uses one token, also a push that git then rejects, because the hook deletes the token before git sends anything. `already-published`, `already-gone`, the moved error before a push, a missing base and each input check use no token.
- A failed push changes nothing on origin.
- If someone deletes the base between the tip read and the push, a land makes the base again on origin at the revision.

## Doctor checks

The git doctor checks live in `src/vcs/git/doctor.ts`. No command runs them yet. The `tasker doctor` command will call `gitDoctorChecks({ repos, procRoot, platform })`. It must pass `procRoot: "/proc"` and `platform: process.platform`. Each repo is a `GitDoctorRepo`: `{ key, remote, clone, config }`, where `config` has the shape of `vcs.config`.

The check type is in `src/doctor/check.ts`. It does not depend on git. A `Check` has `name`, `required`, `timeoutMs` and `run(env)`. `run()` resolves with `{ status, detail, remediation? }`. The status is `ok`, `warn` or `error`. `run()` never rejects.

`gitDoctorChecks()` gives the version check first. Then, for each repo in order, it gives the identity check, the connection check and the lock-file check.

| Check | `name` | `required` | `timeoutMs` |
| --- | --- | --- | --- |
| Version | `git version` | true | 5000 |
| Identity | `git identity: <key>` | false | 5000 |
| Connection | `git connection: <key>` | true | 30000 |
| Lock files | `git lock files: <key>` | false | 10000 |

### The wrapper

One private wrapper makes each check. It makes an `AbortSignal` from `timeoutMs`, and it passes the signal to every git call. These rules hold for every check:

- When the time limit passes, the check gives `error` with the detail `the check did not finish in <n> ms`. It gives no partial result.
- Any other thrown value gives `error`. The detail is the message of the error.
- Last, the wrapper sends `detail` and `remediation` through `hideSshKey()`. This is the only call of `hideSshKey()` in `doctor.ts`.

### Git version

The check runs `git version` and reads the first line. It accepts forms such as `2.47.3`, `2.47.3.windows.1`, `2.39.5 (Apple Git-154)` and `2.47.0.rc1`. The minimum version is 2.20.

- Git is not installed: `error`, with the remediation `Install git 2.20 or newer.`
- A version older than 2.20: `error`, with the same remediation.
- Output that has no version: `error`.
- Otherwise: `ok`.

### Commit identity

The check reads `user.name` and `user.email` with `git config --get` in the clone, with no `--local`. As a result, a global identity counts, as it does for a commit. An empty value counts as not set. The check compares only the fields that `vcs.config` sets: `authorName` with `user.name`, and `authorEmail` with `user.email`.

- The clone does not exist: `ok`, the detail `no clone yet` and no remediation. Provision makes the clone and writes the identity at the first start, so this is not a problem. The check tests this first, because `git --git-dir <missing>` reads the global value.
- A field does not match: `warn`. The detail has one line for each field. The remediation is to provision the clone again.
- No mismatch, but `user.name` or `user.email` is empty: `warn`. The remediation is to set `vcs.config.authorName` and `vcs.config.authorEmail`, or a global identity.
- Otherwise: `ok`.

Limit: the check reads the configuration only. The variables `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` win in a real commit, and the check does not read them.

### Connection

The check runs `git ls-remote -- <remote> HEAD` through `runRemoteGit()` with the ssh key of the repo. The cwd is `remoteCwd()`. A `GitError` gives `error`, with the text of `remoteNotAnswering()`. Otherwise the check gives `ok`.

For an ssh remote, the check also runs the probe, also after a failure. The probe reads the account that the remote sees, so the user can tell a wrong key from a wrong `remote`. The detail then ends with one line:

- `The remote sees the ssh account <account>.`
- `The remote gives no ssh account name.`
- `tasker does not read the ssh account when GIT_SSH is set.`

The remediation of a failure depends on the probe. With an account, it tells the user to set `vcs.config.sshKey` to a key of an account that can see the repo, or to make sure that `remote` names the repo. With no account, it tells the user to make sure that `vcs.config.sshKey` names a key that the remote accepts. For a remote that is not ssh, it tells the user to make sure that `remote` names the repo.

### The probe

`sshAccount()` in `src/vcs/git/ssh-account.ts` is the one place that starts ssh directly, because git has no command that shows the greeting. It runs `sh -c '<ssh command> "$@"' ... -T [-p <port>] -- <destination>`. The ssh command comes from `gitSshCommand()` and `sshEnv()`, so it uses the key of the repo. The probe returns only the account name and never returns ssh text.

- `sshTarget()` gives no target for a local path, for a URL that is not ssh, and for a destination, a user or a port that ssh reads as an option.
- When `GIT_SSH` is set, the probe starts nothing.
- Only GitHub greets in the form `Hi <account>! You've successfully authenticated`. Another host gives no account name.

### Stale lock files

The check looks for files that end in `.lock` in the clone and are older than 60 seconds. It skips the folder `objects` and it follows no link. The paths in the detail are relative to the real path of the clone.

- The clone does not exist: `ok`, the detail `no clone yet` and no remediation (same as the identity check).
- No stale lock: `ok`, and the check does not read `/proc`.
- Otherwise the check reads `/proc`. It skips a lock that a process has open, with the line `skipped <path>: a process has it open`. It skips a lock for a git process (`comm` is `git` or starts with `git-`) only when two things are true. The cwd of that process is the real path of the clone or a folder inside it. The lock is inside that cwd. The line is `skipped <path>: a git process runs in <cwd>`. A git process with its cwd outside the clone, for example the home folder or `/`, never causes a skip. A git that runs in a task worktree has its cwd outside the clone, so only the open-file skip covers its lock files. Git holds a lock file open while it writes it.
- A lock that is left gives `warn`. The detail has one line for each file with its age in whole seconds. The remediation says that doctor deletes nothing.
- On a platform that is not Linux, or when `/proc` cannot be read, the detail has a note that tasker cannot tell whether a process uses the files.

The reader skips each part of a process that gives an error, for example `EACCES` for a process of another user. One doctor run reads `/proc` once at most, and only when a lock-file check finds a stale lock.

### Side effects

- The checks write nothing: no file, no git configuration and no ref.
- `ls-remote` runs with the cwd at the root of the file system. `git config --get` only reads.
- A timeout sends SIGTERM to git or to `sh`. An ssh child can keep running until ssh ends.
- The probe makes one ssh connection for each ssh repo. ssh writes `~/.ssh/known_hosts` only when the ssh configuration of the user permits it. BatchMode stops every question.
- The new `signal` option of `runGit()` changes nothing for a caller that does not pass it.

## `repoSlug()` and `repoPaths()`

`repoPaths(dataRoot, repoKey)` gives the folders of one repo. It only computes paths and makes no folder. `<slug>` is `repoSlug(repoKey)`.

| Field | Path |
| --- | --- |
| `clone` | `<dataRoot>/clones/<slug>/repo.git` |
| `publishTokens` | `<dataRoot>/clones/<slug>/publish-tokens/` |
| `worktrees` | `<dataRoot>/clones/<slug>/worktrees/` |

`repoSlug()` turns the repo key into one safe folder name. It encodes the key as UTF-8 bytes. It keeps each byte that is `a-z`, `0-9` or `-`. It writes each other byte as `_` and two lower-case hex digits. For example, `a/b-c` gives `a_2fb-c`, `a-b/c` gives `a-b_2fc` and `Tasker` gives `_54asker`.

Each slug belongs to one key only. A `_` never stands for itself, and two hex digits always follow it. The slug uses only `a-z`, `0-9`, `_` and `-`. As a result, two keys never share a slug, also on a file system that ignores case. A slug is never `.` or `..` and never has a `/`.

`repoSlug()` throws in two cases:

- The key is empty: `cannot make a repo slug from an empty repo key`.
- The slug is longer than 255 bytes, the usual limit for a file name: `the repo key is too long for a folder name: <key>`. The slug is ASCII, so its length in bytes and in characters is the same. Throwing keeps the promise that no two keys share a slug.
