# Code conventions

This page describes how the code of tasker is laid out and how to test it. [rules.md](rules.md#code) gives the rule for when one function serves several cases.

## Layout

- `src/` holds the source of the `tasker` command.
- `src/commands/` holds one file for each command. "Add a command" gives the steps.
- `src/config/` holds the configuration loader, the edit of the configuration file and the grouping of the repos by provider. See [docs/config.md](../config.md).
- `src/store/` holds the task store. See [data-root.md](data-root.md).
- `src/doctor/` holds the code that all doctor checks share. See [doctor.md](doctor.md).
- `src/issues/` holds the issue tracker code. See [issue-trackers.md](issue-trackers.md).
- `src/assistant/` holds the assistant provider interface, the pick of a provider and the model forms. See [assistants.md](assistants.md).
- `src/process/` holds the code that starts a child process. Every child process starts from a module in this folder. The git, gh and ssh code start their processes through its shared helper.
- `src/phases/` holds the code that runs the commands of a phase. See [phases.md](phases.md).
- `src/vcs/` holds the version control layer. See [version-control.md](version-control.md).
- `src/vcs/git/` holds the git code. See [version-control.md](version-control.md).
- `src/issue-key/` holds the issue key parsers and the resolve of a key to its repo. See [issue-keys.md](issue-keys.md).
- `src/tasks/` holds the steps of the task commands. See [tasks.md](tasks.md).
- `src/state/` holds the state machine. See [statemachine.md](../statemachine.md).
- `src/plan/` holds the plan answer (its shape and its checks), the order of its todos and the turn result of an execute run. See [assistants.md](assistants.md).
- `src/review/` holds the findings answer of a review run (its shape and its checks) and the text form of a list of findings. See [assistants.md](assistants.md).
- `src/prompts/` holds the prompt templates, their fill, their version and the archive. See [assistants.md](assistants.md).
- `AGENTS.md` is an index that links to the docs. It gives no rules itself. Each assistant session reads it first.
- `CLAUDE.md` has one line, `@AGENTS.md`. Claude Code reads `CLAUDE.md`, and the line imports `AGENTS.md`.
- `docs/` holds the docs. `AGENTS.md` links to each of them.
- `test/` holds the tests.
- `test/fixtures/` holds scripts that tests spawn as child processes. It also holds the recorded streams that the tests play back, and small modules that a fixture script imports. Such a module imports only `node:` modules, because a fixture that loads a file under `test/helpers/` at run time starts 2 to 3 times slower, too slowly for the deadline tests.
- `test/helpers/` holds the shared test helpers, one file for each kind of helper, and the tests of each file.
- `dist/` holds the build output. Git ignores it.

## Add a command

1. Create `src/commands/<name>.ts`.
2. Export a `RegisterCommand` from that file. A `RegisterCommand` is a function that adds one command to the Commander program. The command writes its output through the `Io`, not to `process.stdout`.
3. Add the function to the `commands` array in `src/commands/index.ts`.
4. Give the command a description. Give each option a description. Then `tasker --help` shows them.
5. Add one entry to the Commands section of `skills/tasker/SKILL.md`. The entry has the heading `` ### `tasker <name>` `` and one sentence: what the command does and the state that it needs. The sentence links to the heading of the command in the reference file of its phase, for example `references/plan.md#tasker-refine`. Then add the heading `` ## `tasker <name>` `` to that reference file, with the output, the errors and the behavior. If the command has an alias, use the main name in both headings, not the alias. Do not list the options.
6. Name the command in the row of each state that it works from. Do this in `src/state/commands.ts` and in the table of [the commands of each state](../statemachine.md#the-commands-of-each-state). In the state check of the command, call `taskInState` or `assertTaskState` with the name of the command, not with a list of states.
7. Write the tests first (see "Tests").

The program enables the positional options of Commander. As a result, a root option counts only before the command name. A command can have an option with the name of a root option, for example `--version`.

Each new command must be in the skill and in the `--help` output. `test/skill.test.ts` enforces this rule and the link rule of step 5. The options live in `--help` only. `test/state/commands.test.ts` enforces the rule that each row of the table in `src/state/commands.ts` names only commands of `tasker --help`.

## Add a version control provider

1. Add the provider id to the `vcs.provider` enum in `src/config/schema.ts`, and add a `vcsBranch("<id>")` branch to the union there. Add the id to the `provider` row of the `vcs` table in `docs/config.md`, and describe its `config` keys there.
2. Create `src/vcs/<id>/config.ts` with the strict zod schema of its `vcs.config`. Add a case for the id in `vcsConfigSchema()` in `src/vcs/config-schema.ts`.
3. Create `src/vcs/<id>/provider.ts`. It implements `VcsProvider` from `src/vcs/provider.ts`. [version-control.md](version-control.md#the-provider-interface) gives the rule for the types.
4. Add a case for the id in `createVcsProvider()` in `src/vcs/provider.ts`.
5. Follow the push guard rule in the doc comment of `VcsProvider`.
6. Give the doctor checks of the provider from `doctorChecks()`.
7. Write the tests first (see "Tests").

## Add an operation to the version control provider

[version-control.md](version-control.md#the-provider-interface) gives the import boundary. A command ticket that needs a git function with no operation adds the operation in the same change.

1. Add the operation to `VcsProvider` in `src/vcs/provider.ts`. Give it a neutral name. Use words such as workspace, task ref and revision, not git words such as worktree, branch and commit.
2. Put each new type of the operation in `src/vcs/provider.ts`. If a git module defines the type now, move the type. [version-control.md](version-control.md#the-provider-interface) gives the rule for the types.
3. Map the operation to its git function in `src/vcs/git/provider.ts`. [version-control.md](version-control.md#the-provider-interface) gives the rule for the mapping.
4. Write the test first (see "Tests"). Add it to `test/vcs/git/provider.test.ts`. If the operation changes nothing, the test compares the result of the operation with a direct call of the git function on the same fixture. If the operation changes state, the test checks the result and the side effect of the operation, as the existing tests in that file do.

## Add an issue tracker provider

1. Add the id to the `issueTracker.provider` enum in `src/config/schema.ts`, and to the `provider` row of the `issueTracker` table in `docs/config.md`.
2. Add a key parser for the id to `KEY_PARSERS` in `src/issue-key/resolve.ts`.
3. Create `src/issues/<id>/provider.ts`. It implements `IssueProvider` from `src/issues/provider.ts`, and it imports the types of the interface from there. Its `parse` is the entry of `KEY_PARSERS`.
4. Add a branch for the id in `issueProviderFor()` in `src/issues/provider.ts`, in place of the "not available in this version" error.
5. Follow the doc comments of `blockingIssues` and `baseBranchHint` in `IssueProvider`.
6. Give the doctor checks of the provider from `doctorChecks()`.
7. Write the tests first (see "Tests").

## Add an assistant provider

1. Add the id to the `assistant.provider` enum in `src/config/schema.ts`, and to the `provider` row of the `assistant` table in `docs/config.md`.
2. Add the model forms of the id to `src/assistant/models.ts`. Give the forms to the user in `docs/config.md`.
3. Create `src/assistant/<id>/provider.ts`. It implements the interface in `src/assistant/provider.ts`, and it imports the types of the interface from there.
4. Add a branch for the id to the pick switch in `src/assistant/provider.ts`, in place of the "not available in this version" error.
5. Follow the rule "refuse, never drop" in the doc comment of the interface.
6. Give the doctor checks of the provider from `doctorChecks()`.
7. Write the tests first (see "Tests").

## Imports

Write the `.js` extension in each relative import, for example `import { run } from "./cli.js"`. TypeScript with NodeNext modules needs this, even though the file on disk ends in `.ts`.

## zod

These facts hold for zod 4.6.5. `test/zod-facts.test.ts` guards these facts.

- A default `.superRefine()` still runs after an issue that does not stop the parse, for example an unknown key, a failed pattern or a failed `.min()`.
- zod skips a default `.superRefine()` after a missing field, a wrong type or a bad enum value.
- A `z.preprocess` that adds an issue skips its inner schema and a default `.superRefine()` of the parent object. The other fields of the object still get their checks.
- With `{ when: () => true }`, a `.superRefine()` runs in every case. It gets the input with each unknown key removed. It must still check the shape of each field that it reads.

As a result, when a check must report all problems in one run, as [rules.md](rules.md#code) says, give it `{ when: () => true }`. When a check must stop after a schema failure, run it as plain code after a successful `safeParse`, not as a refinement.

## Tests

- Tests use Vitest. Each test file matches `test/**/*.test.ts`. Its name mirrors the file in `src/` that it tests, except for a test that reads a doc, a test that scans the whole source tree, a test of the shared helpers, or a test that guards a fact about an outside tool.
- Unit tests call `run()` with a capturing `Io` and with fixture commands. The test reads stdout and stderr from the `Io` and the exit code from the result of `run()`. The capturing `Io` and the fixture commands come from `test/helpers/`. [rules.md](rules.md#tests) gives the rules for the shared helpers.
- End-to-end tests spawn `src/main.ts` through `tsx`. Write few of them, because they are slow.
- Write the test first. Run it and watch it fail (red). Then write the code that makes it pass (green).
- In Vitest 5.0.3, an `onTestFinished` callback runs after the `afterEach` hooks.
- Node 26 runs a `.ts` file of the repo directly. So a copy of a file of the repo, with its `.js` imports changed to `.ts`, tests a fact of the code with no `node_modules`.
- A boundary test cannot find a module name that the code builds at run time. It also cannot find a git name or a `gh` command name that the code builds at run time.
- A test that must send a signal inside `spawn()` replaces `spawn` of `node:child_process` in a fixture module. Then the fixture calls `syncBuiltinESMExports()` from `node:module`. `test/fixtures/signal-in-spawn.ts` is the example. Under `tsx`, a static import of `spawn` under `src/` also gets the replacement (tested on Node v26.7.0).
- The fixture of a command test whose command makes a commit sets the git identity of the clone through `vcs.config.authorName` and `authorEmail` of the repo configuration. Git needs an author identity for a commit, and the command runs git with the environment of the test. The GitHub runner has no global git identity. `useWorkReviewTask` in `test/helpers/task-fixtures.ts` sets this identity.
