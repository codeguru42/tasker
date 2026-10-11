# Version control

All code that starts `git` lives in `src/vcs/git/`. No command uses this code yet.

## The git folder

`src/vcs/git/run.ts` holds `runGit()`. `src/vcs/git/repo-paths.ts` holds `repoSlug()` and `repoPaths()`. No other folder in `src/` starts git.

The test `test/vcs/git/boundary.test.ts` enforces this rule. It fails when a file outside `src/vcs/git/` loads `child_process` and has a string literal that is `git` or starts with `git `. The test finds each way to load the module: `import ... from`, `import "..."`, `import("...")`, `require("...")` and `export ... from`. It does this for `child_process` and `node:child_process`. The test has two known gaps. It cannot find a module name that the code builds at run time. It cannot find a git name that the code builds at run time.

## `runGit()`

`runGit(args, options)` runs one git command. It resolves with the stdout of git as UTF-8 text. It does not trim the text.

- `args[0]` must be the git subcommand, for example `rev-parse`. It must not be an option. For this reason, an error of git always names the real subcommand.
- `options.cwd` runs git in that folder.
- `options.gitDir` runs git with `--git-dir <gitDir>` and sets no working folder. A missing git dir gives the git error `not a git repository`.
- `options.env` is the environment of the child, plus `GIT_TERMINAL_PROMPT=0`. This key always wins over the value of the caller. `runGit()` does not add `process.env`.
- Git is found on `options.env.PATH`. If the env has no `PATH` or an empty one, `runGit()` rejects before git starts. As a result, Node never uses the `PATH` of tasker.

Git gets no input stream. It gets no controlling terminal, because it starts in a new session. It gets no terminal prompt, because `GIT_TERMINAL_PROMPT=0`. Its stdout and stderr go only to `runGit()`. As a result, git and ssh cannot read from or write to the terminal.

`runGit()` rejects in these cases:

| Case | Error |
| --- | --- |
| `args` is empty. | `Error`: `runGit needs a git subcommand` |
| `args[0]` starts with `-`. | `Error`: `runGit needs the git subcommand as the first argument` |
| Git exits with a code other than 0. | `GitError`: `git <subcommand> failed with exit code <n>: <stderr>` |
| A signal stops git. | `GitError`: `git <subcommand> was stopped by signal <SIG>` |
| `cwd` does not exist. | `Error`: `the working folder does not exist: <cwd>` |
| The env has no `PATH`, or `PATH` is empty. | `GitNotInstalledError`: `git is not installed: the env has no PATH` |
| Git is not on `PATH`. | `GitNotInstalledError`: `git is not installed: git was not found on PATH` |

The checks of the first two rows and of the `PATH` row run before git starts. A `GitError` has the fields `subcommand`, `stdout`, `stderr` and `exitCode`. `exitCode` is `null` when a signal stops git. The message leaves out `: <stderr>` when stderr is empty.

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
