# Code conventions

This page describes how the code of tasker is laid out and how to test it.

## Layout

- `src/main.ts` is the entry point of the `tasker` command. It calls `run()` and sets the exit code.
- `src/cli.ts` builds the Commander program and exports `run()`, `buildProgram()` and the `Io` and `RegisterCommand` types.
- `src/version.ts` reads the version from `package.json`.
- `src/commands/` holds one file for each command. `src/commands/index.ts` lists them.
- `skills/tasker/SKILL.md` is the skill that tells an agent how to use tasker. It lists each command and its options.
- `test/` holds the tests.
- `test/helpers.ts` holds the shared test helpers: `captureIo()` and the `greet` fixture command.
- `dist/` holds the build output. Git ignores it.

## Add a command

1. Create `src/commands/<name>.ts`.
2. Export a `RegisterCommand` from that file. A `RegisterCommand` is a function that adds one command to the Commander program.
3. Add the function to the `commands` array in `src/commands/index.ts`.
4. Give the command a description. Give each option a description. Then `tasker --help` shows them.
5. Add the command to the Commands section of `skills/tasker/SKILL.md`. Use a heading of this form: `` ### `tasker <name>` ``. If the command has an alias, use the main name in the heading, not the alias. Under the heading, write the description and the list of options. If this is the first command, also remove the line `tasker has no commands yet.` from the skill.
6. Write the tests first (see "Tests").

Each new command must be in the skill and in the `--help` output. The test `test/skill.test.ts` fails when `tasker --help` lists a command that the skill does not list. The test does not check options, so list them in the skill yourself.

## Imports

Write the `.js` extension in each relative import, for example `import { run } from "./cli.js"`. TypeScript with NodeNext modules needs this, even though the file on disk ends in `.ts`.

## Tests

- Tests use Vitest. Each test file matches `test/**/*.test.ts`, and its name mirrors the file in `src/` that it tests. The exception is `test/skill.test.ts`. It tests `skills/tasker/SKILL.md`, not a file in `src/`.
- Unit tests call `run()` with a capturing `Io` and with fixture commands. The `Io` collects output in arrays, so the test reads stdout and stderr and checks the returned exit code. The capturing `Io` and the fixture commands come from `test/helpers.ts`. Put a new shared helper in that file. Do not copy it into a test file.
- End-to-end tests spawn `src/main.ts` through `tsx`. Write few of them, because they are slow.
- Write the test first. Run it and watch it fail (red). Then write the code that makes it pass (green).
