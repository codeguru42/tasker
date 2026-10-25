# Releases

tasker has two kinds of version: a stable release and a pre-release.

A stable release is a commit of `main` with a tag. The tag is the version itself, with no prefix. The release makes no
commit. `package.json` and `package-lock.json` hold the placeholder version `0.0.0`, and no release and no install
commits a change to this version. The form is `yyyy.m.d`, the date in UTC, with no leading zeros. Examples: `2026.10.24`
and `2026.1.5`. A stable release is at most one release on each day.

With a release commit, `package.json` holds the version of the last release on each later commit. That text is false for
a development build. With a tag only, the version comes from the tag and nothing else.

A pre-release is a local build of any commit. It has no commit. It has a local tag only when the developer adds one, and
that tag never goes to GitHub. The form is `yyyy.m.d-<commit>`, the date in UTC, with no leading zeros. `<commit>` is
the output of `git rev-parse --short HEAD`. Example: `2026.10.23-c0c0d1a5`. With the commit in the version,
`tasker --version` names the exact code that runs.

Both forms use UTC, so a version does not depend on the time zone of the operator.

tasker uses date versions on purpose and does not use semver (semantic versioning, a version number that shows which
changes break the code of a user). Semver has no meaning for an application that a user runs. Semver is for a library,
where the number tells the user of the library which changes break their code. The stable form has the shape of a semver
version only because the npm registry needs that shape. The numbers are a date and give no semver meaning.

## Why the installed tasker does not change

The installed `tasker` runs the tickets of this repo. It must not change while a ticket runs. Only an install of a
stable release or of a pre-release changes it. The steps of an install are in the
[Install section of README.md](../../README.md#install). `npm run install:global` also runs `tasker install-skills`,
because the skills describe the commands of one version.

## The hold before an install

Only the user starts an install while tasks are in flight. The installing session is the session that installs, an
orchestrator or an [operator](../operator.md). The installing session asks each other orchestrator for a hold, as a
relayed request of the user. If the installing session is an operator, the messages of the hold go as the paragraph that
starts "The installing session can be an operator" says. If a message of the hold fails,
[the failure rule](limits.md#the-failure-rule) applies to the session that sends it. A missing answer is out of scope.

The hold covers the tasks of each orchestrator, also the tasks of an installing orchestrator. In the hold, the
orchestrator starts no new ticket, and it tells each of its agents to hold. Each agent finishes its current `tasker`
command and then runs no other `tasker` command. An agent can continue a step that runs no `tasker` command. An example
is the rest of [the CI wait](ci-wait.md#the-ci-wait) after step 1 of the CI wait. The agent runs its next `tasker`
command, for example `tasker finish`, only after the hold ends.

No run is in progress when `tasker status` shows no task in a state that spawns a process. These are the blue states of
[docs/statemachine.md](../statemachine.md#main-lifecycle), the "spawning states", for example `planning`, `executing`,
`verifying` and `merging`. When no run is in progress, the orchestrator reports the state of each of its tasks to the
installing session. The installing session runs `tasker status` itself before the install. It installs only when no run
is in progress.

The installing session does the install in the local clone:

1. Do the steps of [Untracked paths before an install](#untracked-paths-before-an-install).
2. Do the steps of [Make a stable release](#make-a-stable-release) or of
   [Install a pre-release](#install-a-pre-release). For the HEAD of `main`, these steps run
   `git pull --ff-only origin main` before `npm run install:global`, as [Install a pre-release](#install-a-pre-release)
   says.
3. Run `tasker doctor`.

The reason for the pull of step 2: since #411, the doc reads use `git show origin/main:<path>`, so the local `main` does
not move by itself. On 2026-10-25, the local `main` was at c6efaf33 and `origin/main` was at 22cbbedd.

After `tasker doctor` passes, the installing session tells each orchestrator in the hold to end the hold. The message
gives the new version of tasker, as `tasker --version` prints it. If the install or `tasker doctor` fails, the
installing session tells the user and keeps the hold. In that case, only the user ends the hold.

An orchestrator that gets a hold that another session relays acts on the hold at once. It can still ask its own user
about the hold. If the user says yes, or gives no answer, the hold stays until it ends as the paragraph that starts
"After `tasker doctor` passes" says. If the user says no, the orchestrator ends the hold for its own tasks and tells the
installing session. The hold of each other orchestrator stays. The installing session tells its own user, and that user
decides whether to wait or to end the other holds.

In each case, the installing session installs only when no run is in progress, as the paragraph that starts "No run is
in progress" says. The rule that an orchestrator acts on a relayed hold at once is an exception for a hold before an
install only. The bullet "Only the user changes a landing order of the overlap rule" of
[Land the work](land-the-work.md#land-the-work) stays as it is, with its sentences on a relayed change. The bullet on a
relayed decision in [A decision of the user](working-with-the-user.md#a-decision-of-the-user) also stays as it is. The
reason for this exception: a hold only delays work. The user decided this on 2026-10-25.

After the end of the hold, each orchestrator loads the tasker skill again with the Skill tool, before its next `tasker`
command. The installing session also does this. Each orchestrator tells each of its agents that the hold ended. It also
tells each agent to load the tasker skill again before the next `tasker` command of the agent. The reason: the install
can change the tasker skill (see [Why the installed tasker does not change](#why-the-installed-tasker-does-not-change)).

The installing session can be an operator. An installing operator sends the request of the hold and the end of the hold
as [the word of the user](operator-conversations.md#the-word-of-the-user): each message starts with "From the user:". It
sends them to its own orchestrator, if one runs, and to each other operator. If an operator that gets such a message has
an orchestrator, it relays the message to that orchestrator. The orchestrator sends each report of the hold and each
answer of its user about the hold to its operator. The operator relays it to the installing session.

If an operator has no orchestrator, it reports that to the installing session at once. The installing operator lists the
sessions with `ListAgents`. It asks the user to examine each session that has no `operator-<slug>` of its slug and is
not an agent of an orchestrator (a name of the form `<owner>-<repo>-<number>`, see
[The prompt of an agent](pick-the-tickets.md#the-prompt-of-an-agent)). An installing operator also runs
`git pull --ff-only origin main`, `npm run install:global`, `tasker --version` and the moves of
[Untracked paths before an install](#untracked-paths-before-an-install). `npm run install:global` runs
`tasker --version` and `tasker install-skills`. This is an exception to the list of the `tasker` commands of the
operator in [docs/operator.md](../operator.md).

On 2026-10-25, on the word of the user, orchestrator-m21 asked orchestrator-docs and orchestrator-m22 for a hold.
orchestrator-docs acted on the relayed hold at once and asked its own user about the hold. Both held, and
`tasker status` showed no run in progress. One agent of orchestrator-docs finished the CI wait of its task in `landed`
and did not run `tasker finish`. After `npm run install:global` and a passing `tasker doctor`, orchestrator-m21 ended
the hold with the new version 2026.10.25-22cbbedd. No answer of the user came before the hold ended, and the hold took
about 10 minutes.

On 2026-10-25, the user said "we need a pause on all tasks to install", and operator-docs sent the hold to
orchestrator-docs. operator-docs also relayed the hold to operator-m22, operator-m24, operator-m14 and operator-skills.
If an operator had an orchestrator, it relayed the hold to it. Each operator reported that no run of its slug was in
progress. The user examined orchestrator-413 and issue-461-6c, which had no operator.

`npm run install:global` refused. The only untracked path was the test skill `.claude/skills/do-nothing/` in the local
clone. operator-docs moved it out of the clone, installed, and moved it back. operator-docs ended the hold the same way,
with the version 2026.10.25-60b6aa03.

## Make a stable release

Do these steps in the local clone, on `main`. While tasks are in flight, do these steps as step 2 of
[the hold before an install](#the-hold-before-an-install).

1. Fast-forward `main`: `git pull --ff-only origin main`.
2. Tag the commit: `git tag $(date -u +%Y.%-m.%-d)`.
3. Push the tag: `git push origin <version>`.
4. Install the release: `npm run install:global`. For untracked paths, see
   [Untracked paths before an install](#untracked-paths-before-an-install).

## Install a pre-release

A pre-release installs the commit that is checked out. Do these steps in the current clone, on the commit that is
checked out, but never in a task worktree. The install replaces the installed `tasker` (see
[Why the installed tasker does not change](#why-the-installed-tasker-does-not-change)). While tasks are in flight, do
these steps as step 2 of [the hold before an install](#the-hold-before-an-install).

For the HEAD of `main`:

1. Fast-forward `main`: `git pull --ff-only origin main`.
2. Optional: to give the install a version of your own, add a local tag on HEAD: `git tag <version>`. Without a tag, the
   script sets the version `yyyy.m.d-<commit>`.
3. Install the commit: `npm run install:global`.

For a commit that is not on `main`:

1. Check out the commit in the current clone.
2. Optional: to give the install a version of your own, add a local tag on HEAD: `git tag <version>`. Without a tag, the
   script sets the version `yyyy.m.d-<commit>`.
3. Install the commit: `npm run install:global`.

The pre-release tag stays local and never goes to GitHub.

### Untracked paths before an install

`npm run install:global` refuses when the working tree has changes, also untracked files. It prints
`install:global: the working tree has changes, also untracked files. Commit or remove them first.`

Before the first step of an install, run `git status --porcelain` in the clone. If it shows only untracked paths (`??`
lines), move each such path to a folder outside the clone. Then install. After the install, also after a failed install,
move each path back to its place. If `git status --porcelain` shows other changes, tell the user and do not install. In
a hold before an install, the hold then stays, as [The hold before an install](#the-hold-before-an-install) says.

## The npm facts

- Without a `files` list, npm leaves out each path of `.gitignore`. `dist/` is in `.gitignore`, so `package.json` has a
  `files` list.
- `npm pack` first deletes `dist/` and then runs `npm run build`, through the `prepack` script. As a result, `dist/`
  holds only the build of the commit that is checked out.
- `npm install -g` of a package file copies the files into the global folder of npm. A later change of the clone does
  not change the installed `tasker`.
- An agent can test a review finding that says that npm changes a version with `npm install <tarball>` in a scratch
  folder, with no `-g`. A global install replaces the installed tasker. On #395, the agent dismissed finding 1 of review
  1 after such a test.
- Without `npm run install:global`, a plain `npm pack` builds a package with the version `0.0.0`. Then
  `tasker --version` of that install prints `0.0.0`.

Measured on 2026-10-24 with npm 11.19.0 and GNU date:

- `npm publish --dry-run` refuses `20261019.0100` and `20261019.010000-c0c0d1a5` with `npm error Invalid version`. It
  accepts `2026.1.5`.
- `date -u +%Y.%-m.%-d` prints the date with no leading zeros, for example `2026.10.24`.
- `npm pkg set version=<value>`, `npm pack` and `npm install -g` keep `2026.10.23-c0c0d1a5` and `2026.10.23-0123456`
  exactly as written. They also keep a version that is not semver exactly as written, for example `v2026.10.24`,
  `2026.01.05` and `wip` (#395). Only `npm publish` changes a leading zero in a number part of a pre-release
  (`2026.10.19-0123456` becomes `2026.10.19-123456`), and a pre-release never goes to the registry.
- semver sorts a pre-release before the stable release of the same day: `2026.10.23-c0c0d1a5 < 2026.10.23`.
