# Jira

## The Jira folder

All code that starts `acli`, the command-line tool of Atlassian, is in `src/issues/jira/`. No file outside `src/issues/`
imports from it. A [boundary test](code-conventions.md#tests) enforces both rules.

tasker talks to Jira only through `acli`. It does not call the Jira REST API, and it stores no Jira credential.

## runAcli

`runAcli()` is the one function that starts `acli`. It resolves with the stdout of `acli`, not trimmed.

- A call with no argument rejects.
- A call whose first argument starts with `-` rejects. The first argument is the subcommand.
- A call that the next section lists rejects with `AcliRefusedError`, and nothing starts.
- `runAcli()` reads `TASKER_ACLI_BIN` and `PATH` only from the env that the caller passes, never from `process.env`. It
  passes that env to `acli` as it is.
- An env with no `PATH`, or an empty `PATH`, rejects with `AcliNotInstalledError` before `acli` starts.
- `acli` runs in the cwd of tasker. `runAcli()` has no cwd option.
- `acli` gets no input stream. Its stdout and stderr go to pipes, never to the terminal.
- `options.signal` stops `acli` with `SIGTERM` and rejects with an `AbortError`.
- `runAcli()` writes nothing to the console or a log.

## The commands that tasker never runs

`runAcli()` refuses these calls with `AcliRefusedError`:

- `auth login`, `auth logout` and `auth switch`, at any place in the argument list.
- Each call whose first argument is `config`.

The reason: the active site of `acli` is the choice of the user, and each Jira call of tasker uses it.

## TASKER_ACLI_BIN

The variable `TASKER_ACLI_BIN` in the env of the call names the `acli` program. `resolveProgram()` in `src/process/`
holds the rule:

- If the variable is not set or is blank, the program is `acli`.
- If the value has no `/`, the value is a program name. `runAcli()` finds it on the `PATH` of the env.
- If the value has a `/`, the value is a path. A relative path resolves against the cwd of tasker. The path must name a
  file that the user can run. Otherwise, each call fails at once with `AcliBinError`, and tasker does not fall back to
  `acli` on the `PATH`.

`TASKER_ACLI_BIN` does not pass to a child process of a phase. The rule for each `TASKER_` variable in
`src/process/child-env.ts` covers it.

## The errors

- `AcliError`: `acli` exited with a code other than 0, or a signal stopped it. It holds the subcommand, the stdout, the
  stderr and the exit code. The exit code is `null` when a signal stopped `acli`. `subcommandOf()` in
  `src/process/run-child.ts` gives the subcommand, for example `jira workitem` for `jira workitem view TEST-1`.
- `AcliNotInstalledError`: `acli` was not found. The message names the program that `runAcli()` tried to start.
- `AcliBinError`: `TASKER_ACLI_BIN` names a file that does not exist, a folder, or a file that the user cannot run.
- `AcliRefusedError`: the call is one that tasker never runs.

## The measure of a failed call

The [fact test](plan-review.md#the-fact-test) measured `acli` version `1.3.39-stable`. The command
`acli jira workitem view TEST-999999 --json` asks for an issue that does not exist. It gives:

- Exit code 1.
- An empty stdout.
- On stderr: `✗ Error: Issue does not exist or you do not have permission to see it.`
