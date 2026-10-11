# tasker

tasker takes an issue from an issue tracker and drives an AI coding assistant through plan, build, verify, review, and merge.

This repo is a rebuild of tasker. Work is tracked on the [project board](https://github.com/users/codeguru42/projects/3).

## Requirements

- Node.js 22.13 or later
- npm

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

See the [configuration reference](docs/config.md) for the keys. Run `tasker show-config` to see the configuration with the defaults filled in.

## Run the checks

Run `npm run check` to make sure that the code is correct. The command runs three steps in this order:

1. `npm run typecheck` runs the TypeScript type check.
2. `npm run lint` runs ESLint.
3. `npm test` runs the Vitest tests.

The command stops at the first step that fails. It then exits with a non-zero code. GitHub Actions runs the same command on each push and pull request.
