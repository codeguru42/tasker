# Code conventions

This page describes how the code of tasker is laid out and how to test it.

## Layout

- `src/main.ts` is the entry point of the `tasker` command. It calls `run()` and sets the exit code.
- `src/cli.ts` builds the Commander program and exports `run()`, `buildProgram()` and the `Io` and `RegisterCommand` types. A `RegisterCommand` receives the program and the `Io`.
- `src/version.ts` reads the version from `package.json`.
- `src/commands/` holds one file for each command. `src/commands/index.ts` lists them.
- `src/config/` holds the configuration loader. `path.ts` finds the file, `expand.ts` expands paths, `allowed-env-names.ts` holds the default env allowlist, `schema.ts` validates the file, and `load.ts` reads it. The schema of `vcs.config` comes from `vcsConfigSchema()`.
- `src/store/` holds the task store. `layout.ts` creates the folders under `dataRoot`, `migrate.ts` applies schema versions, `migrations.ts` holds the schema versions, `transaction.ts` holds `immediateTransaction()`, the shared helper that runs each write and each migration in one `BEGIN IMMEDIATE` transaction, and `store.ts` opens the database, reads and writes tasks and events, and reads, saves and forgets the learned default base branch of each repo.
- `src/doctor/` holds the doctor types. `check.ts` holds `Check`, `CheckResult` and `CheckStatus`.
- `src/issues/` holds the issue tracker code. `docs/dev/issue-trackers.md` names each file.
- `src/process/` holds `run-child.ts`, with `runChild()` and `CommandNotFoundError`, the one helper that starts a child process for `runGit()`, `runGh()` and `sshAccount()`.
- `src/vcs/` holds the version control layer. `provider.ts` holds the `VcsProvider` interface, its types and `createVcsProvider()`, `errors.ts` holds `ReconcileConflictError`, and `config-schema.ts` holds `vcsConfigSchema()`. A command imports only from `provider.ts`, `errors.ts` and `config-schema.ts`, never from `src/vcs/git/`. See docs/dev/version-control.md.
- `src/vcs/git/` holds all code that starts git. `run.ts` holds `runGit()` and `gitSshCommand()`, `repo-paths.ts` holds `repoSlug()` and `repoPaths()`, `ssh.ts` holds `shellQuote()`, the ssh command of a key, `homeKeyPath()`, `runRemoteGit()`, `remoteNotAnswering()`, `remoteCwd()`, `isLocalRemote()` and `cloneUrl()`, `default-branch.ts` holds `remoteDefaultBranch()`, `provision.ts` holds `provisionClone()`, `config.ts` holds `GitConfigSchema` and the type `GitVcsConfig`, `provider.ts` holds `createGitProvider()`, `base-branch.ts` holds `parseBaseInput()`, `baseRevision()`, `resolveBaseBranch()` and `LOCAL_PREFIX`, `worktree.ts` holds `taskBranchName()`, `assertTaskBranch()`, `assertTaskBranchShape()`, `taskWorktreePath()`, `withoutLineEnd()`, `listWorktrees()`, `assertTaskWorktree()`, `createTaskWorktree()`, `removeTaskWorktree()`, `deleteTaskBranch()`, `discardWorktreeChanges()` and `taskBranchRevision()`, `refs.ts` holds `isFullRevision()`, `refExists()`, `refRevision()`, `assertRevisionInput()` and `resolveRevision()`, `changes.ts` holds `worktreeDiff()`, `changedPaths()`, `ownCommitsText()`, `hasCommitsNotIn()`, `uncommittedChanges()`, `uncommittedRefusal()`, `isAncestor()`, `fetchTips()`, `fetchOrigin()`, `nulFields()`, `jsonPathList()`, `worktreeHead()`, `worktreeChanges()` and `NO_OWN_COMMITS`, `reconcile.ts` holds `worktreeState()`, `reconcileWorktree()`, `rebaseOnto()`, `resyncWorktree()`, `restoreWorktree()` and `restoreCommands()`, `assistant-surface.ts` holds `EXECUTE_COMMIT_TEXT`, `DENY_RULES`, `readDenyPaths()` and `sandboxWritePaths()`, `push-guard.ts` holds `installPushHook()` and `pushWithToken()`, `remote-tip.ts` holds `remoteTip()` and `tipMoved()`, `publish.ts` holds `publishTaskBranch()`, `landOnBase()` and `deleteRemoteTaskBranch()`, `doctor.ts` holds `gitDoctorChecks()`, `gitVersionCheck()`, `identityCheck()`, `connectionCheck()` and `staleLockCheck()`, `stale-locks.ts` holds `findStaleLocks()`, `readProcView()`, `onceProcView()`, `isInside()` and `DeadlineError`, and `ssh-account.ts` holds `sshTarget()` and `sshAccount()`. Only this folder starts git. The test `test/vcs/git/boundary.test.ts` enforces this.
- `src/issue-key/` holds the issue key parsers. `ref.ts` holds the `IssueRef` type and `IssueKeyError`, `path-slug.ts` makes a string safe for a file path and a git branch name, `github.ts` parses a GitHub key, and `jira.ts` parses a Jira key, and `short-ref.ts` holds the pattern parts of a key, the short ref forms (`SHORT_REF`), `isShortRef()`, `githubShortRef()` and `jiraShortRef()`. The parsers and `worktree.ts` use it. The caller selects the parser and passes the repo key.
- `src/state/` holds the state machine. `machine.ts` declares the task states and the legal edges, and checks a change of state.
- `AGENTS.md` is an index that links to the docs. It gives no rules itself. Each assistant session reads it first.
- `CLAUDE.md` has one line, `@AGENTS.md`. Claude Code reads `CLAUDE.md`, and the line imports `AGENTS.md`.
- `docs/config.md` is the configuration reference.
- `docs/dev/data-root.md` describes the folders under `dataRoot` and the tables of the database.
- `docs/dev/workspaces.md` describes the base branch and the workspace of a task.
- `docs/dev/orchestration.md` gives the rules for an orchestrator, an assistant session that runs tickets from the project board through the installed `tasker`.
- `docs/dev/rebase-conflicts.md` gives the procedure for a rebase conflict that `tasker update-branch` reports.
- `docs/dev/version-control.md` describes the git code in `src/vcs/git/`, `runGit()` and the folders of a repo.
- `docs/dev/issue-trackers.md` describes the issue tracker code in `src/issues/`, `runGh()`, the token, the environment and the errors.
- `docs/dev/rules.md` gives the rules for each change to this repo: the check, test first, the commits, the docs, the test helpers, plain English and `AGENTS.md`.
- `docs/statemachine.md` describes the task states, the edges between them and the diagrams.
- `skills/tasker/SKILL.md` is the skill that tells an agent how to use tasker. It lists each command and its options.
- `test/` holds the tests.
- `test/fixtures/` holds scripts that tests spawn as child processes.
- `test/helpers.ts` holds the shared test helpers: `captureIo()`, the `greet` fixture command, `validConfig()`, which returns a new valid configuration object for each call, `makeTempDir()`, which makes a new temporary folder for each call, `repoRoot`, the repo root URL that spawn tests use as `cwd`, `writeTempConfig()`, which writes a configuration to `config.json` in a new temp dir, `tableNames()`, which lists the table names of a database, `GIT_TEST_IDENTITY`, the fixed author of test commits, `gitTestEnv()`, which gives the env of a git child process that reads no git configuration of the host, `makeGitOrigin()`, which makes a real local bare origin repo, `makeGitClone()`, which makes a bare clone of that origin inside its temp folder, `makeProviderFixture()`, which makes a local origin and the provider context of the repo `tasker`, `gitCloneTokens()`, which gives the publish tokens folder of that clone, `addCloneCommit()`, which adds a commit to a branch of that clone, `localBranches()`, which lists the local branches (`refs/heads/*`) of a bare clone, `commitInWorktree()`, which writes a file in a task worktree and commits it there, `NO_TOKEN`, the text that the pre-push hook prints for a push with no token, `NOT_TASK_BRANCHES`, the names that have no task branch shape, `failureOf()`, which gives the error that a promise rejects with and fails the test when the promise resolves or the error has another type, `fakeSsh()`, which writes a fake `ssh` into a folder and gives the env, the log and the `ssh://tasker.invalid` remote, `sshKeyArgs()`, which gives the six ssh arguments of a key, `writeFakeGit()`, which writes a fake `git` shell script into a folder, `writeFakeSsh()`, which writes a fake `ssh` that serves a local origin, refuses, hangs, or acts like GitHub (the `greet` mode prints the greeting of an account and serves or misses the repo), `writeGitRecorder()`, which writes a `git` wrapper that logs each call and runs the real git, `writeGitFailAfter()`, which writes a `git` wrapper that runs the real git and then exits with 1 for one subcommand, `readArgLog()`, which reads the logs of the git recorder, the fake ssh and the fake gh back, `sourceDir`, `sourceFiles()`, `loadsChildProcess()`, `importsPath()`, `runChildPath`, `startsCommand()` and `filesThatStart()`, the shared source scan of the boundary tests, `writeFakeCommand()`, which writes an executable shell script with any name into a folder, `writeFakeGh()`, `fakeGh()` and `ghTokenAnswer()`, the fake `gh` (it matches the whole argument list exactly, the first matching answer wins, `killWith` stops the fake by a signal, and a call with no answer fails the test), `isInside()`, which is true when a path is a folder or inside it, `treeSnapshot()`, which lists every entry of a folder with its type, size and mtime, `writeFakeProc()`, which makes a fake `/proc` folder, and `ageFile()`, which sets the mtime of a file in the past. The origin has `addCommit`, `createBranch` and `branchHead`, which change and read it, and `remove`, which deletes the temp folder.
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

## Imports

Write the `.js` extension in each relative import, for example `import { run } from "./cli.js"`. TypeScript with NodeNext modules needs this, even though the file on disk ends in `.ts`.

## Tests

- Tests use Vitest. Each test file matches `test/**/*.test.ts`, and its name mirrors the file in `src/` that it tests. Four tests are exceptions. `test/skill.test.ts` tests `skills/tasker/SKILL.md`, not a file in `src/`. `test/vcs/git/boundary.test.ts` and `test/issues/github/boundary.test.ts` check the whole source tree. `test/helpers.test.ts` tests the git fixture of `test/helpers.ts`.
- Unit tests call `run()` with a capturing `Io` and with fixture commands. The `Io` collects output in arrays, so the test reads stdout and stderr and checks the returned exit code. The capturing `Io` and the fixture commands come from `test/helpers.ts`. Put a new shared helper in that file. Do not copy it into a test file.
- End-to-end tests spawn `src/main.ts` through `tsx`. Write few of them, because they are slow.
- Write the test first. Run it and watch it fail (red). Then write the code that makes it pass (green).
