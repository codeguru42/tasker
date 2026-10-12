# Code conventions

This page describes how the code of tasker is laid out and how to test it.

## Layout

- `src/` holds the source of the `tasker` command.
- `src/commands/` holds one file for each command. "Add a command" gives the steps.
- `src/config/` holds the configuration loader. See [docs/config.md](../config.md).
- `src/store/` holds the task store. See [data-root.md](data-root.md).
- `src/doctor/` holds the code that all doctor checks share. See [doctor.md](doctor.md).
- `src/issues/` holds the issue tracker code. See [issue-trackers.md](issue-trackers.md).
- `src/process/` holds the one helper that starts a child process. The git, gh and ssh code start their processes through it.
- `src/vcs/` holds the version control layer. See [version-control.md](version-control.md).
- `src/vcs/git/` holds the git code. See [version-control.md](version-control.md).
- `src/issue-key/` holds the issue key parsers and the resolve of a key to its repo. See [issue-keys.md](issue-keys.md).
- `src/state/` holds the state machine. See [statemachine.md](../statemachine.md).
- `AGENTS.md` is an index that links to the docs. It gives no rules itself. Each assistant session reads it first.
- `CLAUDE.md` has one line, `@AGENTS.md`. Claude Code reads `CLAUDE.md`, and the line imports `AGENTS.md`.
- `docs/` holds the docs. `AGENTS.md` links to each of them.
- `test/` holds the tests.
- `test/fixtures/` holds scripts that tests spawn as child processes.
- `test/helpers.ts` holds the shared test helpers.
- `dist/` holds the build output. Git ignores it.

## Add a command

1. Create `src/commands/<name>.ts`.
2. Export a `RegisterCommand` from that file. A `RegisterCommand` is a function that adds one command to the Commander program. It receives the program and the `Io`. The command writes its output through that `Io`, not to `process.stdout`.
3. Add the function to the `commands` array in `src/commands/index.ts`.
4. Give the command a description. Give each option a description. Then `tasker --help` shows them.
5. Add the command to the Commands section of `skills/tasker/SKILL.md`. Use a heading of this form: `` ### `tasker <name>` ``. If the command has an alias, use the main name in the heading, not the alias. Under the heading, write the description and the list of options.
6. Write the tests first (see "Tests").

Each new command must be in the skill and in the `--help` output. The test `test/skill.test.ts` fails when `tasker --help` lists a command that the skill does not list. The test does not check options, so list them in the skill yourself.

## Add a version control provider

1. Add the provider id to the `vcs.provider` enum in `src/config/schema.ts`, and add a `vcsBranch("<id>")` branch to the union there. Add the id to the `provider` row of the `vcs` table in `docs/config.md`, and describe its `config` keys there.
2. Create `src/vcs/<id>/config.ts` with the strict zod schema of its `vcs.config`. Add a case for the id in `vcsConfigSchema()` in `src/vcs/config-schema.ts`.
3. Create `src/vcs/<id>/provider.ts`. It implements `VcsProvider` from `src/vcs/provider.ts`, and it imports the types of the interface from there.
4. Add a case for the id in `createVcsProvider()` in `src/vcs/provider.ts`.
5. Follow the push guard rule in the doc comment of `VcsProvider`. If the provider cannot guard a push, its `provision()` rejects.
6. Give the doctor checks of the provider from `doctorChecks()`.
7. Write the tests first (see "Tests").

## Add an issue tracker provider

1. Add the id to the `issueTracker.provider` enum in `src/config/schema.ts`, and to the `provider` row of the `issueTracker` table in `docs/config.md`.
2. Add a key parser for the id to `KEY_PARSERS` in `src/issue-key/resolve.ts`. It holds the key match rule: the `IssueKeyError` of the parser for a key of the wrong form, `undefined` for a key of another project, and the stored spelling for a key of the project. The compiler fails until the entry exists.
3. Create `src/issues/<id>/provider.ts`. It implements `IssueProvider` from `src/issues/provider.ts`, and it imports the types of the interface from there. Its `parse` is the entry of `KEY_PARSERS`.
4. Add a branch for the id in `issueProviderFor()` in `src/issues/provider.ts`, in place of the "not available in this version" error.
5. Give `[]` from `blockingIssues` when the tracker has no blocking links.
6. Give `undefined` from `baseBranchHint` when the issue has no hint.
7. Give the doctor checks of the provider from `doctorChecks(repos)`. `issueDoctorChecks()` calls it once with all the repos of the id, so a check that runs once runs once.
8. Write the tests first (see "Tests").

## Imports

Write the `.js` extension in each relative import, for example `import { run } from "./cli.js"`. TypeScript with NodeNext modules needs this, even though the file on disk ends in `.ts`.

## Tests

- Tests use Vitest. Each test file matches `test/**/*.test.ts`. Its name mirrors the file in `src/` that it tests, except for a test that reads a doc, scans the whole source tree, or tests the shared helpers.
- Unit tests call `run()` with a capturing `Io` and with fixture commands. The `Io` collects output in arrays, so the test reads stdout and stderr and checks the returned exit code. The capturing `Io` and the fixture commands come from `test/helpers.ts`. Put a new shared helper in that file. Do not copy it into a test file.
- End-to-end tests spawn `src/main.ts` through `tsx`. Write few of them, because they are slow.
- Write the test first. Run it and watch it fail (red). Then write the code that makes it pass (green).
