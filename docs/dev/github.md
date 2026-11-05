# GitHub process boundary

`src/github/` starts the shared `gh` command. The issue tracker and the forge session use this boundary. Each caller
keeps its own environment and error rules.

`src/issues/github/` owns tracker behavior. `src/github/forge-session.ts` owns the forge session. This ticket adds no
forge provider or operations.

## Shared process

The shared code uses `src/process/` to select and start `gh`. It captures stdout and stderr through pipes. It gives the
child no input stream and writes no output to a log.

`TASKER_GH_BIN` selects the executable. If its value is unset or blank, tasker starts `gh` from the supplied child
`PATH`. A bare value also uses that `PATH`. A value with `/` must name a runnable regular file. A relative path resolves
from tasker's working directory. The child needs a nonblank `PATH` even when the override names a path.

## Tracker environment

The tracker starts from the environment that its caller supplies. It removes `GH_TOKEN`, `GITHUB_TOKEN`,
`GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GH_HOST` and `GH_REPO`. It then sets `GH_PROMPT_DISABLED=1`,
`GH_NO_UPDATE_NOTIFIER=1` and `NO_COLOR=1`. Other supplied names pass to the child, including `PATH`, `HOME`,
`GH_CONFIG_DIR` and `TASKER_GH_BIN`.

The tracker does not add values from `process.env`. Its token lookup uses the same environment without the account
token. Tracker calls that act on a repository include its name in their arguments. Tracker errors have no cause.

## Forge environment

The forge session reads only the environment passed to `GhSession.run()`. It does not read `process.env` or copy other
ambient values into the child environment.

The session requires a nonblank `TASKER_PATH`. It also requires at least one nonblank value: `TASKER_HOME` or
`TASKER_GH_CONFIG_DIR`. The child environment contains `PATH` from `TASKER_PATH`, each nonblank authentication location,
and these fixed values:

- `GH_PROMPT_DISABLED=1`
- `GH_NO_UPDATE_NOTIFIER=1`
- `NO_COLOR=1`

The session rejects supplied `TASKER_GH_TOKEN`, `TASKER_GH_HOST` and `TASKER_GH_REPO` values. It ignores unprefixed
values such as `GH_TOKEN`, `GH_HOST`, `GH_REPO`, `HOME` and `GH_CONFIG_DIR`. It uses `TASKER_GH_BIN` to select the
executable but does not put that variable in the child environment.

Each repository call uses the supplied worktree as its working directory. It does not add `--repo`. Before the first
repository call, the session runs `gh auth token --user <account>` with the selected executable and the isolated
environment. This internal lookup does not receive `GH_TOKEN`. The session trims the lookup output and requires a
successful exit and a nonempty token. It caches a successful token only for that session. Concurrent calls in one
session share the lookup. A failed lookup is tried again on the next call.

Use `gh auth login` outside tasker to establish the account login. Tasker does not log in or change the active account.
The session rejects public calls to `gh auth token`, `gh auth login`, `gh auth logout` and `gh auth switch`.

## Results and errors

The session replaces every occurrence of the account token in successful stdout with `***`. It preserves empty success
output. A nonzero exit rejects before a caller can parse stdout. The session trims stderr and removes the token from it.

The session removes the token from every reachable error message, stream, stack and cause. A repository command error
keeps a sanitized copy of the original command error as its cause. A failed token lookup discards its output and gives
the account and the external login step. A start error tells the user to install `gh` or set `TASKER_GH_BIN`. A missing
worktree error names the missing directory.
