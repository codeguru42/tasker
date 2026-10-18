# Contributing to tasker

This repo is a rebuild of tasker. The [project board](https://github.com/users/codeguru42/projects/3) tracks the work.

## Set up a working copy

1. Use the Node version of `.nvmrc`. The `.nvmrc` file sets the Node version for local work and for CI.
2. Clone the repo: `git clone https://github.com/codeguru42/tasker.git`
3. Install the dependencies. Run `npm ci` in the new folder.
4. Install git. The tests run git.

## Run the checks

Run `npm run check` to make sure that the code is correct. The command runs four steps in this order:

1. `npm run typecheck` runs the TypeScript type check.
2. `npm run lint` runs ESLint, with the type-aware rules of typescript-eslint.
3. `npm run format:check` runs the Prettier format check.
4. `npm test` runs the Vitest tests.

Run `npm run format` to write the format of Prettier. Run `npm run lint:fix` to fix the lint problems that ESLint can fix.

The command stops at the first step that fails. It then exits with a non-zero code. GitHub Actions runs the same command on each push and pull request.

## The docs and the rules

[AGENTS.md](AGENTS.md) is the index of the docs of the repo. [docs/dev/rules.md](docs/dev/rules.md) gives the rules for each change.
