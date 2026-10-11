# Version control

All code that starts `git` lives in `src/vcs/git/`. No command uses this code yet.

## The git folder

- `src/vcs/git/run.ts` holds `runGit()`.
- `src/vcs/git/repo-paths.ts` holds `repoSlug()` and `repoPaths()`.
- `src/vcs/git/ssh.ts` holds `sshCommand()`, `sshEnv()`, `hideSshKey()`, `runRemoteGit()`, `remoteCwd()` and `cloneUrl()`.
- `src/vcs/git/default-branch.ts` holds `remoteDefaultBranch()`.
- `src/vcs/git/provision.ts` holds `provisionClone()`.

No other folder in `src/` starts git.

The test `test/vcs/git/boundary.test.ts` enforces this rule. It fails when a file outside `src/vcs/git/` loads `child_process` and has a string literal that is `git` or starts with `git `. The test finds each way to load the module: `import ... from`, `import "..."`, `import("...")`, `require("...")` and `export ... from`. It does this for `child_process` and `node:child_process`. The test has two known gaps. It cannot find a module name that the code builds at run time. It cannot find a git name that the code builds at run time.

## How tasker uses git

This section describes the design. No command uses this code yet.

tasker makes one bare clone for each repo that it owns. The clone is at the `clone` path of `repoPaths()`: `<dataRoot>/clones/<slug>/repo.git`. A bare clone has no work tree.

tasker starts each task in its own worktree. tasker makes the worktree from the bare clone. The worktree is under the `worktrees` path of `repoPaths()`: `<dataRoot>/worktrees/<slug>/`.

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
  - Git uses a `GIT_SSH_COMMAND` that is present, even an empty one, and then ignores `GIT_SSH`. For this reason, `runGit()` never passes an empty value. A non-empty `GIT_SSH_COMMAND` of the caller stays. Otherwise `runGit()` removes `GIT_SSH_COMMAND`. Then a non-empty `GIT_SSH` of the caller stays. Otherwise `runGit()` removes `GIT_SSH` too and sets `GIT_SSH_COMMAND=ssh -o BatchMode=yes`.
  - `runGit()` does not add `process.env`.
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

`provisionClone({ remote, clone, config, env })` in `src/vcs/git/provision.ts` makes the bare clone of a remote and fetches it. `clone` is the `clone` path of `repoPaths()`. `config` is the `vcs.config` of the repo (`authorName`, `authorEmail` and `sshKey`, see [docs/config.md](../config.md)). No command calls it yet.

The marker is the file `<clone>.incomplete`, that is `<dataRoot>/clones/<slug>/repo.git.incomplete`, next to `repo.git`. Provision writes it before `git clone` (step 4) and removes it after the first fetch of a fresh clone (step 8). While the marker exists, each provision takes the path of step 1.

These are the steps:

1. If the marker exists, an earlier clone stopped partway. Provision deletes only the clone folder `repo.git`, including each file that a person put there. The marker and the parent folder `<dataRoot>/clones/<slug>/` stay. Then it goes on with step 3.
2. If the clone folder exists and the marker does not, the clone is complete. Provision applies the clone configuration (step 6), then runs `git fetch --prune origin` (step 7), and returns. It does not clone again.
3. Provision runs `git ls-remote --exit-code -- <remote>`. The cwd is `remoteCwd()`, the root of the file system, so a relative remote path resolves against `/`. On the fresh path, provision has made no file and no folder yet, so a failed `ls-remote` leaves nothing on disk. On the path from step 1, the marker and the parent folder still exist, because step 1 removes only the clone folder.4. Provision makes the parent folder of the clone when it is missing. It writes an empty marker, or overwrites the marker that step 1 left with an empty file.
5. Provision runs `git clone --bare -- <remote> <clone>` with the same cwd, the root of the file system. It passes the clone path as an absolute path (`resolve(clone)`), so the cwd does not move the clone. As a result, a relative remote path names the same repo in `ls-remote` and in `clone`. The fetch runs with the clone as cwd and uses `remote.origin.url` (see [The clone configuration](#the-clone-configuration)).
6. Provision applies the clone configuration: see [The clone configuration](#the-clone-configuration).
7. Provision runs `git fetch --prune origin`. The `--prune` option removes the remote-tracking refs of branches that the remote deleted.
8. On the fresh-clone path, provision removes the marker.

A step can fail in these ways:

- If `ls-remote` fails on the path from step 1, the marker and the parent folder stay.
- If a step from 5 to 7 fails, provision rejects. The parent folder, the marker and the clone folder stay, with the clone folder in the state that the failed step left it. A failed `git clone` can leave a partial clone folder.
- If step 8 fails, the clone is complete, but the marker stays.

In each case, the next provision takes the path of step 1.

A second provision on a complete clone takes step 2. A change to `vcs.config` or to `remote` takes effect at the next provision.

A changed `remote` in the configuration has these effects at the next provision:

- Provision fetches from the new remote into the same clone.
- The local branches `refs/heads/*` that `git clone` copied from the old remote stay in the bare clone. The objects of the old remote also stay.
- `git fetch --prune` removes the remote-tracking refs `refs/remotes/origin/*` that the new remote does not have. It updates the others to the new remote, with force, because the refspec starts with `+`.
- A URL that a person set by hand in the clone goes back to `cloneUrl(remote)`.

Provision rejects with these errors:

| Case | Error |
| --- | --- |
| `git ls-remote` exits with code 2: the remote answers and has no refs. | `Error`: `the remote has no refs: <remote>` |
| `git ls-remote` fails in another way. | `Error`: `the remote does not answer: <remote>`, plus `: <stderr>` when stderr is not empty |
| A git config write fails and `<clone>/config.lock` exists. | `Error`: `the clone configuration is locked: <clone>` |

Provision reads no text of git to find a lock. The errors above have no `cause`. Any other `GitError` of a git call passes through. Its text has gone through `hideSshKey()`, see [The ssh key](#the-ssh-key).

### The clone configuration

Each git config write is one `git config` call with `gitDir` set to the clone. Each value goes in with `git config --replace-all <key> <value>`. This leaves exactly one local line, even when the key had several lines. So an extra local line of each key in this list goes away. An example is a second `include.path` or a second fetch refspec that a person added with `git config --add`. These rules cover only the local configuration of the clone. The global and system configuration do not change. Each run writes each key of this list. In this order, provision:

- Sets `remote.origin.url` to `cloneUrl(remote)`. For a relative local path, this is the root of the file system followed by the path, which is the form that `git clone` writes. Any other remote stays unchanged.
- Sets `remote.origin.fetch` to `+refs/heads/*:refs/remotes/origin/*`, so a fetch makes `origin/<branch>` refs.
- Sets `user.name` to `authorName`. If `authorName` is not set, provision runs `git config --unset-all user.name`. This removes every local line of the key. Provision reads exit code 5 of `--unset-all` as "the key is missing" and treats it as success. Every other failure passes through. On a fresh clone this writes nothing, so git uses the global identity.
- Does the same for `user.email` and `authorEmail`.
- Sets `commit.gpgSign`, `tag.gpgSign` and `tag.forceSignAnnotated` to `false`.
- Sets `include.path` to `tasker-ssh.config`.
- After all git config calls succeed, writes the include file.

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

`sshEnv(env, sshKey)` returns `env` with `GIT_SSH_COMMAND` set to `sshCommand(sshKey)`. If `sshKey` is not set, it returns `env` as it is. `runRemoteGit(args, options, sshKey)` runs `runGit()` with that env. Provision runs `ls-remote`, `clone` and `fetch` through it. As a result, `GIT_SSH_COMMAND` reaches ssh in the env of git. A `GIT_SSH_COMMAND` that the user exported is replaced when `sshKey` is set and stays when it is not.
Each git call that reaches the remote must pass the env from `sshEnv()`. The reason is that `runGit()` sets `GIT_SSH_COMMAND=ssh -o BatchMode=yes` when the caller sets no ssh command, and an env `GIT_SSH_COMMAND` wins over `core.sshCommand`. So the `core.sshCommand` of the clone takes effect only when git runs with no `GIT_SSH_COMMAND` and no `GIT_SSH` in its env.

When `runGit()` fails inside `runRemoteGit()`, it rethrows a new `GitError` with no `cause`. The message, `stdout` and `stderr` went through `hideSshKey(text, sshKey, homeDir)`. It replaces each occurrence of these forms with `<sshKey>`, in this order:

1. `sshCommand(sshKey)`.
2. The key as it is.
3. If the key starts with `~/`, the home folder plus the rest of the key. The home folder is `os.userInfo().homedir`, the folder from the password database that ssh uses, not `$HOME`.
4. If the key starts with `~` and a user name (`~name/...`), and the part from the first `/` to the end is not empty: For a `~name/` key, tasker cannot find the home folder of that user. It hides only the part of the key from the first `/` to the end. The home folder of that user can still appear in the error.

`hideSshKey()` hides no other form. If the key path is short, or the part after the first `/` of a `~name/` key is short, other text of the message also becomes `<sshKey>`. If no key is set, the text stays as it is.

## `remoteDefaultBranch()`

`remoteDefaultBranch({ remote, sshKey, env })` in `src/vcs/git/default-branch.ts` runs `git ls-remote --symref -- <remote> HEAD` through `runRemoteGit()`. The cwd is `remoteCwd()`, the root of the file system. This is the same cwd as in provision, and it needs no clone. It finds the line `ref: refs/heads/<name>` followed by a tab and `HEAD`, and returns `<name>`. If the remote has no such line, it throws `Error`: `the remote has no symbolic HEAD: <remote>`.

## `repoSlug()` and `repoPaths()`

`repoPaths(dataRoot, repoKey)` gives the folders of one repo. It only computes paths and makes no folder. `<slug>` is `repoSlug(repoKey)`.

| Field | Path |
| --- | --- |
| `clone` | `<dataRoot>/clones/<slug>/repo.git` |
| `publishTokens` | `<dataRoot>/clones/<slug>/publish-tokens/` |
| `worktrees` | `<dataRoot>/worktrees/<slug>/` |

`repoSlug()` turns the repo key into one safe folder name. It encodes the key as UTF-8 bytes. It keeps each byte that is `a-z`, `0-9` or `-`. It writes each other byte as `_` and two lower-case hex digits. For example, `a/b-c` gives `a_2fb-c`, `a-b/c` gives `a-b_2fc` and `Tasker` gives `_54asker`.

Each slug belongs to one key only. A `_` never stands for itself, and two hex digits always follow it. The slug uses only `a-z`, `0-9`, `_` and `-`. As a result, two keys never share a slug, also on a file system that ignores case. A slug is never `.` or `..` and never has a `/`.

`repoSlug()` throws in two cases:

- The key is empty: `cannot make a repo slug from an empty repo key`.
- The slug is longer than 255 bytes, the usual limit for a file name: `the repo key is too long for a folder name: <key>`. The slug is ASCII, so its length in bytes and in characters is the same. Throwing keeps the promise that no two keys share a slug.
