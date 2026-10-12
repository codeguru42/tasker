# Issue trackers

`src/issues/` holds the issue tracker code. No command uses this code yet. `tasker start` uses it in M4.

## The GitHub folder

All code that starts `gh` is in `src/issues/github/`. The test `test/issues/github/boundary.test.ts` enforces this rule with the source scan of `test/helpers.ts`. The test fails when a file outside `src/issues/github/` loads `child_process` or imports `src/process/run-child.ts`, and has a string literal that is `gh` or starts with `gh `. The scan has two known gaps. It cannot find a module name that the code builds at run time. It cannot find a command name that the code builds at run time.

## The files of src/issues/

- `src/issues/github/run.ts` holds `runGh()`, `RunGhOptions`, `GhError`, `GhNotInstalledError` and `GhLoginError`.

Later issues add their files to this list.

## runGh()

`runGh(args, { account, env })` takes the arguments of `gh` (the subcommand first) and resolves with the stdout of `gh`. The stdout is as `gh` printed it, not trimmed. `args` must not be empty, and `args[0]` must not start with `-`.

`runGh()` starts `gh` through `runChild()` in `src/process/run-child.ts`.

`gh` gets no input stream. Its output goes to pipes, never to the terminal. `runGh()` writes nothing to the console or a log. `gh` runs in the cwd of tasker. Each call that acts on a repo must name the repo (`--repo <project>`, `-R <project>`, or the full path in `gh api repos/<owner>/<repo>/...`), because `runGh()` removes `GH_REPO`, and without a repo gh reads the repo from the git folder of its cwd.

`runGh()` has no `signal` option and no `cwd` option.

## The token

Before the first call of an account, `runGh()` reads its token with `gh auth token --hostname github.com --user <account>`. With `--user`, gh 2.101.0 ignores `GH_TOKEN`. tasker reads the token one time for each account in one process. Two calls at the same time for one account start one token call. A failed read is not kept, so the next call reads the token again. The environment of the token call is in [The environment](#the-environment).

## The environment

- `runGh()` starts from the `env` of the caller.
- It removes exactly these names: `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GH_HOST` and `GH_REPO`.
- Then it sets `GH_TOKEN` to the token of the account, `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1` and `NO_COLOR=1`.
- All other names pass as they are, for example `GH_CONFIG_DIR`, `PATH` and `HOME`.
- The token call uses the same environment, without the new `GH_TOKEN`.

`runGh()` does not add `process.env`. `gh` is found on the `PATH` of `env`. An env with no `PATH` or an empty one rejects before `gh` starts, so Node never uses the `PATH` of tasker. The doc comment of `runGh()` holds the same list.

## The errors

The token never appears in an error. The token call never puts its stdout into an error. A main call replaces each occurrence of the token with `***` in the `stdout`, the `stderr` and the message of a `GhError`. No error has a `cause`.

- `GhError` has the fields `subcommand`, `stdout`, `stderr` and `exitCode` (`null` after a signal). The message is `gh <subcommand> failed with exit code N: <stderr>`, with no `: <stderr>` when `stderr` is empty. After a signal, it is `gh <subcommand> was stopped by signal S`.
- `GhNotInstalledError` has the message `gh is not installed: the env has no PATH` or `gh is not installed: gh was not found on PATH`.
- `GhLoginError` has the field `account`. Its message is ``gh has no login for the account <account> on github.com: run `gh auth login --hostname github.com` and log in as <account>``, plus `. gh said: <stderr>` when `gh` gave a `stderr`. The token call gives it when it exits with a non-zero code or prints an empty token. A token call that a signal stops gives a `GhError` with an empty `stdout`.

The subcommand of a `GhError` is `args[0]`, plus `args[1]` when `args[1]` exists and does not start with `-`, joined with one space. These are the examples:

- `issue view 7` gives `issue view`.
- `api graphql -f query=...` gives `api graphql`.
- `api -X PATCH repos/a/b` gives `api`.
- `api user` gives `api user`.

## Tests

The fake `gh` is in `test/helpers.ts`. It uses shell builtins only, so the real `gh` can never run.

- `fakeGh(dir, baseEnv, answers, { logEnv })` writes the fake into `<dir>/bin` and returns an env with that folder as the only `PATH` folder. It also returns `calls()`, `unanswered()` and `assertAnswered()`.
- `writeFakeGh()` writes the fake without vitest hooks, so a child process can use it.
- `ghTokenAnswer(account, token)` is the answer of the token call.

Each answer names the whole argument list. It must match exactly, in order. The first matching answer wins. An answer can set `stdout`, `stderr`, `exitCode` and `killWith` (a signal name: the fake prints its output, then stops itself with that signal).

A call with no answer exits with 99 and goes into `unanswered()`. It fails the test, also when the code under test catches the error.

`test/issues/github/run.test.ts` calls `vi.resetModules()` and imports `run.ts` again before each test, so each test starts with an empty token cache.
