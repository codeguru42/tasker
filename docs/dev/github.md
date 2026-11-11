# GitHub process boundary

`src/github/` starts the shared `gh` command. The issue tracker and the forge session use this boundary. Each caller
keeps its own environment and error rules.

`src/issues/github/` owns tracker behavior. `src/github/forge-session.ts` owns the account-specific forge session and
its child environment. `src/forge/github/provider.ts` connects that session to the shared forge interface and GitHub
operations. `src/forge/registry.ts` selects a provider from the forge configuration of a repo.

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
token.

## Forge environment

The GitHub provider supplies defaults before each provider method calls the forge session. If `TASKER_PATH` is
undefined, the provider copies `PATH` to `TASKER_PATH`. If both `TASKER_HOME` and `TASKER_GH_CONFIG_DIR` are undefined,
it copies `HOME` to `TASKER_HOME`. It keeps explicit values, including blank values. It does not add defaults for
`GH_CONFIG_DIR` or `XDG_CONFIG_HOME`.

The forge session reads only the environment passed to `GhSession.run()`. It does not read `process.env` or copy other
ambient values into the child environment.

The session requires a nonblank `TASKER_PATH`. It uses this value for the child's `PATH`. It also needs one
authentication location. If `TASKER_GH_CONFIG_DIR` is nonblank, `TASKER_HOME` can be blank or unset. If `TASKER_HOME` is
nonblank, `TASKER_GH_CONFIG_DIR` can be blank or unset. If both are blank or unset, tasker names both inputs and asks
for one. The child receives `TASKER_HOME` as `HOME` and `TASKER_GH_CONFIG_DIR` as `GH_CONFIG_DIR`. It gets these fixed
values:

- `GH_PROMPT_DISABLED=1`
- `GH_NO_UPDATE_NOTIFIER=1`
- `NO_COLOR=1`

The session rejects supplied `TASKER_GH_TOKEN`, `TASKER_GH_HOST` and `TASKER_GH_REPO` values. It ignores unprefixed
values such as `GH_TOKEN`, `GH_HOST`, `GH_REPO`, `HOME` and `GH_CONFIG_DIR`. It uses `TASKER_GH_BIN` only to select the
executable. It does not put that name or any other `TASKER_*` name in the child environment.

Each repository call uses the supplied worktree as its working directory. The session checks that this folder exists
before it looks up the account token or selects and starts the executable. A missing folder error names the worktree.
The session does not add `--repo`. Before the first repository call, it runs `gh auth token --user <account>` with the
selected executable and the isolated environment. This internal lookup does not receive `GH_TOKEN`. The session trims
the lookup output and requires a successful exit and a nonempty token. It caches a successful token only for that
session. Concurrent calls in one session share the lookup. A failed lookup is tried again on the next call.

The shared process code raises `ProgramFileError` when a path in `TASKER_GH_BIN` is invalid or cannot run. The session
reports that error with install or override guidance. It does not fall back to another `gh` on `PATH`.

Use `gh auth login` outside tasker to establish the account login. Tasker does not log in or change the active account.
The session rejects public calls to `gh auth token`, `gh auth login`, `gh auth logout` and `gh auth switch`.

## Results and errors

The session replaces every occurrence of the account token in successful stdout with `***`. It preserves empty success
output. A nonzero exit rejects before a caller can parse stdout. The session trims stderr and removes the token from it.

The session removes the token from every reachable error message, stream, stack and cause. A repository command error
keeps a sanitized copy of the original command error as its cause. If the token lookup exits with a nonzero code or
succeeds with empty output, the session reports a missing login and gives the account and external login step. If a
signal stops the lookup, the session reports the stop without login guidance. This stopped error does not expose lookup
stdout or stderr in its message, fields or cause. A start error tells the user to install `gh` or set `TASKER_GH_BIN`. A
missing worktree error names the missing directory.
