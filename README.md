# tasker

tasker takes an issue from an issue tracker and drives an AI coding assistant through plan, build, verify, review, and merge.

## Requirements

- Node.js 26 or later
- npm
- git

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to start work as a contributor.
