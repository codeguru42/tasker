# tasker

tasker takes an issue from an issue tracker and drives an AI coding assistant through plan, build, verify, review, and merge.

## Requirements

- Node.js 26 or later
- npm
- git
- An AI coding assistant: tasker runs Claude Code with the `claude` command. The [assistant configuration](docs/config.md#assistant) selects it.
- An issue tracker: for a GitHub tracker, tasker runs the `gh` command, as the [tracker configuration](docs/config.md#issuetracker) says.

## Install from source

1. Clone the repository: `git clone https://github.com/codeguru42/tasker.git`
2. Go to the new directory: `cd tasker`
3. Install the dependencies: `npm install`
4. Build the project: `npm run build`
5. Link the `tasker` command on your machine: `npm link`
6. Make sure that the command works: `tasker --help`

`tasker --help` lists the options and the commands. `tasker --version` prints the version. `tasker` with no command prints the same usage to stderr and exits with code 1. An unknown command or option prints an error and exits with a non-zero code.

## Configuration

tasker reads one configuration file. It reads `$TASKER_CONFIG`. If that is not set, it reads `$XDG_CONFIG_HOME/tasker/config.json`. If that is not set, it reads `$HOME/.config/tasker/config.json`.

See the [configuration reference](docs/config.md) for the keys. Run `tasker show-config` to see the configuration with the defaults filled in. Run `tasker doctor` to make sure that the machine is set up.

## Quick start

In each command, `<issue>` is the [issue key](skills/tasker/SKILL.md#issue-keys) of the issue, for example `owner/repo#N`.

1. Run `tasker start <issue>` to make the task and its worktree.
2. Run `tasker plan <issue>` to let the assistant write a plan.
3. Run `tasker show-plan <issue>` to read the plan.
4. Run `tasker approve <issue>` to approve the plan.
5. Run `tasker execute <issue>` to let the assistant do the work.
6. Run `tasker verify <issue>` to run the verify commands of the repo.
7. Run `tasker review <issue>` to let the assistant review the work.
8. Run `tasker accept <issue>` to accept the work.
9. Run `tasker merge <issue>` to land the work on the base branch.
10. Run `tasker finish <issue>` to remove the worktree and the task branch.

Run `tasker status` to list the tasks and their states. Run `tasker show <issue>` to see the details of one task.

[The skill index](skills/tasker/SKILL.md) lists all the commands. `tasker <command> --help` gives the options of a command.

## States

Each task moves through states. A command works only in some states. [The state machine doc](docs/statemachine.md) gives the states and the edges.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to start work as a contributor.
