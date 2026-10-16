---
name: tasker
description: Use when you run tasker, the command-line tool that drives an AI coding assistant through an issue. An index of the tasker commands. tasker <command> --help gives the options, and one reference file for each phase gives the output and the errors.
---

# tasker

tasker takes an issue from an issue tracker and drives an AI coding assistant through plan, build, verify, review, and merge.

## Rules

- Use only the commands that this skill lists, and the options that `tasker <command> --help` prints. If a command or an option is in neither source, do not run it.
- Run `tasker <command> --help` for the options of a command. This skill does not list options.

## Global options

- `tasker --help` (`-h`): prints the usage, the options, and the commands.
- `tasker --version` (`-V`): prints the version.

A global option counts only before the command name. `--version` prints the version only when it comes before a command. After a command, it is an option of that command.

## Configuration

tasker reads one configuration file. It reads `$TASKER_CONFIG`. If that is not set, it reads `$XDG_CONFIG_HOME/tasker/config.json`. If that is not set, it reads `$HOME/.config/tasker/config.json`.

See `docs/config.md` for the keys.

## Issue keys

An issue key names one issue in an issue tracker. The provider of the repo (`issueTracker.provider`) selects the form of the key. tasker does not guess the provider from the shape of a key.

- GitHub: `owner/repo#N`, for example `codeguru42/tasker#8`.
- Jira: `PROJ-N`, for example `PROJ-123`.
- Jira with a site: `<site>/browse/PROJ-N`, for example `example.atlassian.net/browse/PROJ-123`.

N is a positive whole number. The Jira project key (`PROJ`) is in upper case. The site is a bare host name, with no `https://` in front. tasker stores the site in lower case.

A key that does not match the form of its provider is an error. The error names the key.

## Shared errors

For each of these errors, the command prints the error on stderr and exits with code 1. A reference file names a shared error only when the command handles it in a different way.

- The issue key does not resolve.
- The issue has no task. The error names the issue and the repo.
- The configuration is missing or invalid.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends. The task keeps its state, and the command writes nothing.
- Another command holds the clone for more than 5 minutes. The error says that the lock is busy. Run the command again.
- The prompt cannot be archived. Fix the cause, then run the command again. The task keeps its state.
- A quota limit stops the run. The task goes to the state `quota_blocked`. The command prints the reset time on stdout.
- An unexpected error occurs after the run has started. The task goes to the state `failed`. The error is `<step> failed: <error>`. The step is `planning`, `refining`, `executing`, `verifying` or `reviewing`.

### The number rule

The value of `--version`, `--run`, `--command` and `--review` must be a whole number of 1 or more, with no sign and no leading zero. Without the option, the command uses the newest item. A bad value gives the error `--<option> must be a whole number of 1 or more: <value>`.

### The task of a show command

The commands `show`, `show-bootstrap`, `show-plan`, `show-questions`, `show-verify` and `show-review` use the active task of the issue. If the issue has no active task, they use the newest task.

## States

Each task is in one state. Each command entry names the state that the command needs. [docs/statemachine.md](../../docs/statemachine.md) gives the states and the edges.

## Commands

### `tasker show-config`

Prints the configuration as JSON, with the defaults filled in, and needs no task. See [the reference](references/setup.md#tasker-show-config).

### `tasker start`

Makes a task for an issue and takes it to `workspace_ready`, and needs no active task or a task that stopped before `workspace_ready`. See [the reference](references/start.md#tasker-start).

### `tasker plan`

Runs the assistant in plan mode for a task in `workspace_ready`, and records the first plan revision. See [the reference](references/plan.md#tasker-plan).

### `tasker refine`

Continues the plan session of a task in `awaiting_plan_review` or `reviewed`, and records the next plan revision. See [the reference](references/plan.md#tasker-refine).

### `tasker approve`

Approves the newest plan revision of a task in `awaiting_plan_review`. See [the reference](references/plan.md#tasker-approve).

### `tasker unapprove`

Takes back the approval of the pinned plan revision of a task in `approved`. See [the reference](references/plan.md#tasker-unapprove).

### `tasker execute`

Carries out the pinned plan revision of a task in `approved`, one turn for each todo. See [the reference](references/build.md#tasker-execute).

### `tasker verify`

Runs the verify commands of the repo for a task in `executed`, and records the run. See [the reference](references/build.md#tasker-verify).

### `tasker review`

Reviews the committed work of a task in `awaiting_work_review`, and records the findings. See [the reference](references/work-review.md#tasker-review).

### `tasker dismiss-review`

Dismisses open findings of the latest review of a task in `reviewed`, with one reason. See [the reference](references/work-review.md#tasker-dismiss-review).

### `tasker retry`

Moves a task in `failed` back to the state before the step that failed, and runs that step again. See [the reference](references/recovery.md#tasker-retry).

### `tasker accept`

Accepts the work of a task in `awaiting_work_review`. See [the reference](references/work-review.md#tasker-accept).

### `tasker merge`

Lands the work of a task in `accepted` on the base branch of `origin`. See [the reference](references/landing.md#tasker-merge).

### `tasker mark-landed`

Records that the work of a task in `accepted`, `pushed` or `in_peer_review` landed outside tasker. See [the reference](references/landing.md#tasker-mark-landed).

### `tasker finish`

Cleans up a task in `landed` or `cleanup_failed`. See [the reference](references/landing.md#tasker-finish).

### `tasker abort`

Cancels an active task and removes its worktree and local branch. It needs any state except `finished` and `cancelled`. See [the reference](references/recovery.md#tasker-abort).

### `tasker show`

Prints the details of the task of an issue, in any state. See [the reference](references/inspect.md#tasker-show).

### `tasker show-bootstrap`

Prints the bootstrap log of the task of an issue, in any state. See [the reference](references/inspect.md#tasker-show-bootstrap).

### `tasker show-plan`

Prints one plan revision of the task of an issue, in any state. See [the reference](references/plan.md#tasker-show-plan).

### `tasker show-questions`

Prints the questions of one plan revision, each with its state, in any state. See [the reference](references/plan.md#tasker-show-questions).

### `tasker show-verify`

Prints one verify run and the log of each command, in any state. See [the reference](references/build.md#tasker-show-verify).

### `tasker show-review`

Prints one review and its findings with their status, in any state. See [the reference](references/work-review.md#tasker-show-review).

### `tasker status`

Lists the tasks by issue key and state, and needs no task. See [the reference](references/inspect.md#tasker-status).

### `tasker doctor`

Makes sure that the configuration, the data root, git, `gh`, `claude` and the accounts work, and needs no task. See [the reference](references/setup.md#tasker-doctor).

### `tasker model`

Prints or sets the model and the effort of each assistant role for the repo of an issue. It needs no task and changes no task. See [the reference](references/setup.md#tasker-model).
