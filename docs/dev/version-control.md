# Version control

All code that starts `git` lives in `src/vcs/git/`. No command uses this code yet.

## The git folder

`src/vcs/git/run.ts` holds `runGit()`. `src/vcs/git/repo-paths.ts` holds `repoSlug()` and `repoPaths()`. No other folder in `src/` starts git.

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
