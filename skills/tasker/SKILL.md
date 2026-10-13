---
name: tasker
description: Use when you run tasker, the command-line tool that drives an AI coding assistant through an issue. Lists each tasker command that you can run, with its options.
---

# tasker

tasker takes an issue from an issue tracker and drives an AI coding assistant through plan, build, verify, review, and merge.

## Rules

- Use only the commands and options that this skill lists. If a command or an option is not in this skill, do not run it.

## Global options

- `tasker --help` (`-h`): prints the usage, the options, and the commands.
- `tasker --version` (`-V`): prints the version.

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

## Commands

### `tasker show-config`

Prints the configuration as JSON, with the defaults filled in.

- `--repo <key>`: prints only the repo with this key.

If the key does not exist, or the configuration is missing or invalid, the command prints an error and exits with code 1.

### `tasker show`

Prints the details of the task of an issue: `tasker show <issue>`. The command shows the active task. If the issue has no active task, it shows the newest task.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

The command prints one line for each field, as `<field>: <value>`, in this order:

- `issue`
- `repo`
- `title`
- `state`
- `attempt`
- `base`
- `branch`
- `worktree`
- `created`
- `updated`
- `last event`

A field with no value prints `-`. The `last event` line holds the time, the type and the data of the last event of the task, as one line of JSON text: `last event: <time> <type> <data>`. An event with no data prints `null`.

If the task is in the state `failed`, the command prints two more lines. `failed in` gives the state that the task left when it failed. `error` gives the error of the failure.

Each field stays on one line. A line end in a value prints as the two characters `\n`.

The command prints an error and exits with code 1 in these cases:

- The issue key does not resolve.
- The issue has no task. The error names the issue and the repo.
- The configuration is missing or invalid.

### `tasker show-bootstrap`

Prints the bootstrap log of the task of an issue: `tasker show-bootstrap <issue>`. The command uses the same task as `tasker show`: the active task, else the newest task.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

The command prints the log as it is, with no change. The log holds every bootstrap run of the attempt of the task, in order. Each run starts with a line `=== bootstrap run <time> ===`. An empty log prints nothing.

The command prints an error and exits with code 1 in these cases:

- The issue key does not resolve.
- The issue has no task. The error names the issue and the repo.
- The task has no bootstrap log. The error is `no bootstrap log for <issue key>`.
- tasker cannot read the bootstrap log. The error is `cannot read the bootstrap log for <issue key>: <error code>`.
- The configuration is missing or invalid.

### `tasker status`

Lists the tasks by issue key and state. With no option, it lists the active tasks of all repos. A task is active when its state is not `finished` and not `cancelled`.

- `--repo <key>`: lists only the tasks of the repo with this key.
- `--issue <issue>`: lists only the tasks of this issue key.
- `--state <state>`: lists only the tasks in this state. If you name `finished` or `cancelled`, the command lists those tasks too.

If you give more than one option, a task must match all of them.

The command prints one table with the columns `ISSUE`, `REPO`, `STATE` and `UPDATED`. `UPDATED` is the time of the last change of the task. The task with the newest change comes first.

If no task matches, the command prints `no tasks` and exits with code 0.

The command prints an error and exits with code 1 in these cases:

- The repo key does not exist. The error names the key.
- The state does not exist. The error lists the states.
- The issue key does not resolve.
- The configuration is missing or invalid.
