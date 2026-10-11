# Code conventions

This page describes how the code of tasker is laid out and how to test it.

## Layout

- `src/main.ts` is the entry point of the `tasker` command. It calls `run()` and sets the exit code.
- `src/cli.ts` builds the Commander program and exports `run()`, `buildProgram()` and the `Io` and `RegisterCommand` types.
- `src/version.ts` reads the version from `package.json`.
- `src/commands/` holds one file for each command. `src/commands/index.ts` lists them.
- `test/` holds the tests.
- `dist/` holds the build output. Git ignores it.

## Add a command

1. Create `src/commands/<name>.ts`.
2. Export a `RegisterCommand` from that file. A `RegisterCommand` is a function that adds one command to the Commander program.
3. Add the function to the `commands` array in `src/commands/index.ts`.
4. Write the tests first (see "Tests").

## Imports

Write the `.js` extension in each relative import, for example `import { run } from "./cli.js"`. TypeScript with NodeNext modules needs this, even though the file on disk ends in `.ts`.

## Tests

- Tests use Vitest. Each test file matches `test/**/*.test.ts`, and its name mirrors the file in `src/` that it tests.
- Unit tests call `run()` with a capturing `Io` and with fixture commands. The `Io` collects output in arrays, so the test reads stdout and stderr and checks the returned exit code.
- End-to-end tests spawn `src/main.ts` through `tsx`. Write few of them, because they are slow.
- Write the test first. Run it and watch it fail (red). Then write the code that makes it pass (green).
