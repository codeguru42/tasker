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
