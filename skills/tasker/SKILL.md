---
name: tasker
description: Use when you run tasker, the command-line tool that drives an AI coding assistant through an issue. An index of the tasker commands. tasker <command> --help gives the options, and one reference file for each phase gives the output and the errors.
argument-hint: <command> [arguments]
---

# tasker

tasker takes an issue from an issue tracker and drives an AI coding assistant through plan, build, verify, review, and merge.

## Run a command

The command line of the user: `tasker $ARGUMENTS`

If the command line of the user is not empty, follow these rules:

1. Run `tasker` with the command line exactly as the user typed it, in one shell call. Do not add, remove, quote or change a word.
2. Run no other command and read no file before the run. Examples: no `tasker status`, no `tasker doctor`, no `tasker <command> --help`, no `git` command. The reason: the user gives the exact command, and a read before the run can change what the assistant runs.
3. A command can run longer than the time limit of the shell tool. If so, run it in the background. Then wait for its end. Do not poll its output.
4. After the run, give the user the exit code, and stdout and stderr as tasker printed them. Do not shorten an error.
5. Do not run a next command. The output can name one, for example in a `next:` line. Give that command to the user.

For the command line of the user, these rules win over the rule "Use only the commands that this skill lists" of [Rules](#rules). tasker itself reports an unknown command.

If the command line of the user is empty, the skill is a reference only. Then the rest of the skill applies.

## Rules

- Use only the commands that this skill lists, and the options that `tasker <command> --help` prints. If a command or an option is in neither source, do not run it.
- Run `tasker <command> --help` for the options of a command. This skill does not list options.

## Global options

- `tasker --help` (`-h`): prints the usage, the options, and the commands.
- `tasker --version` (`-V`): prints the version.

A global option counts only before the command name. `--version` prints the version only when it comes before a command. After a command, it is an option of that command.

## Configuration

tasker reads one configuration file. It reads `$TASKER_CONFIG`. If that is not set, it reads `$XDG_CONFIG_HOME/tasker/config.json`. If that is not set, it reads `$HOME/.config/tasker/config.json`.

See `docs/config.md` for the keys.

## Issue keys

An issue key names one issue in an issue tracker. The provider of the repo (`issueTracker.provider`) selects the form of the key. tasker does not guess the provider from the shape of a key.

- GitHub: `owner/repo#N`, for example `codeguru42/tasker#8`.
- Jira: `PROJ-N`, for example `PROJ-123`.
- Jira with a site: `<site>/browse/PROJ-N`, for example `example.atlassian.net/browse/PROJ-123`.

N is a positive whole number. The Jira project key (`PROJ`) is in upper case. The site is a bare host name, with no `https://` in front. tasker stores the site in lower case.

A key that does not match the form of its provider is an error. The error names the key.

## Shared errors

For each of these errors, the command exits with code 1 and prints the error on stderr, unless the item says stdout. A reference file names a shared error only when the command handles it in a different way.

- The issue key does not resolve.
- The task is in a state that the command does not accept. The error is `the task of <issue key> is in <state>; tasker <command> needs <states>`. For a state with a primary command, a sentence follows: `next: tasker <primary> <issue key> (also: tasker <other> <issue key>, ...)`. For a state with no primary command, this sentence follows: `commands: tasker <a> <issue key>, tasker <b> <issue key>, ...`. For `finished` and `cancelled`, no sentence follows. [The commands of each state](../../docs/statemachine.md#the-commands-of-each-state) gives the table.
- The issue has no task. The error names the issue and the repo.
- The configuration is missing or invalid.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.
- Another command holds the clone for more than 5 minutes. The error says that the lock is busy. Run the command again.
- The prompt cannot be archived. Fix the cause, then run the command again. The task keeps its state.
- A quota limit stops the run. The task goes to the state `quota_blocked`. The command prints the reset time on stdout. Run `tasker resume <issue>` to continue the task, or `tasker abort <issue>` to leave the state. If the stop is at the overage boundary and names a quota window, you can also run `tasker approve-credits <issue>` (see [the reference](references/recovery.md#tasker-approve-credits)).
- A signal that tasker passes to the run of the assistant (for example a Ctrl-C) stops the run. The task goes to the state `interrupted`. The command prints `<phase> interrupted by <signal>; run tasker resume <issue key> to continue` on stdout. Run `tasker resume <issue>` to continue the task. A quota stop that the events show wins over the signal.
- The quota pause: under `overagePolicy: "ask"`, the use of the quota window reaches `quotaApprovalThreshold`. The run ends first (for `tasker execute`, the turn ends first). Then the task goes to the state `awaiting_quota_approval`. The command prints the use of the quota window and its reset time on stdout, or says that the reset time is unknown. Run `tasker approve-credits <issue>` to approve paid usage in that window and continue the task (see [the reference](references/recovery.md#tasker-approve-credits)), or run `tasker abort <issue>` to leave the state.
- An unexpected error occurs after the run has started. The task goes to the state `failed`. The error is `<step> failed: <error>`. The step is `planning`, `refining`, `executing`, `verifying` or `reviewing`.

### A dead run

A run is dead when the task is in a spawning state and its tasker process is gone. The next command that reads the task moves it to `interrupted`. `tasker status` does this for each task in a spawning state. The command prints this line on stderr before its own output: `note: the run of <issue key> died in <state>; the task is now interrupted`. If the child of the run still ran, a second line follows: `note: stopped the process group <pid> of the dead run`, or `note: cannot stop the process group <pid> of the dead run: <error>`. After a failed stop, the task stays in `interrupted`. Then the command goes on with the task in `interrupted`. A command that does not accept `interrupted` prints the error of the item [The task is in a state that the command does not accept](#shared-errors).

### The number rule

The value of `--version`, `--run`, `--command` and `--review` must be a whole number of 1 or more, with no sign and no leading zero. Without `--version`, `--run` or `--review`, the command uses the newest item. A bad value gives the error `--<option> must be a whole number of 1 or more: <value>`.

### The task of a show command

The commands `show`, `show-bootstrap`, `show-plan`, `show-questions`, `show-verify` and `show-review` use the active task of the issue. If the issue has no active task, they use the newest task.

## States

Each task is in one state. Each command entry names the state that the command needs. [docs/statemachine.md](../../docs/statemachine.md) gives the states and the edges. `tasker show` and `tasker status` print the commands of the state of a task. [The commands of each state](../../docs/statemachine.md#the-commands-of-each-state) gives the table.

## Commands

### `tasker show-config`

Prints the configuration as JSON, with the defaults filled in, and needs no task. See [the reference](references/setup.md#tasker-show-config).

### `tasker show-quota`

Prints the last quota event of each repo as JSON, and needs no task. See [the reference](references/inspect.md#tasker-show-quota).

### `tasker doctor`

Makes sure that the configuration, the data root, git, `gh`, `claude` and the accounts work, and needs no task. See [the reference](references/setup.md#tasker-doctor).

### `tasker install-skills`

Copies the skills of the installed tasker into each folder of `skillsDirs`, and needs no task. See [the reference](references/setup.md#tasker-install-skills).

### `tasker model`

Prints or sets the model and the effort of each assistant role for the repo of an issue. It needs no task and changes no task. See [the reference](references/setup.md#tasker-model).

### `tasker start`

Makes a task for an issue and takes it to `workspace_ready`, or changes nothing when the active task of the issue is already past `workspace_ready`. See [the reference](references/start.md#tasker-start).

### `tasker plan`

Runs the assistant in plan mode for a task in `workspace_ready`, and records the first plan revision. See [the reference](references/plan.md#tasker-plan).

### `tasker refine`

Continues the plan session of a task in `awaiting_plan_review`, `reviewed` or `failed`, and records the next plan revision. See [the reference](references/plan.md#tasker-refine).

### `tasker approve`

Approves the newest plan revision of a task in `awaiting_plan_review`. See [the reference](references/plan.md#tasker-approve).

### `tasker unapprove`

Takes back the approval of the pinned plan revision of a task in `approved`. See [the reference](references/plan.md#tasker-unapprove).

### `tasker show-plan`

Prints one plan revision of the task of an issue, in any state. See [the reference](references/plan.md#tasker-show-plan).

### `tasker show-questions`

Prints the questions of one plan revision, each with its state, in any state. See [the reference](references/plan.md#tasker-show-questions).

### `tasker execute`

Carries out the pinned plan revision of a task in `approved`, one turn for each todo. See [the reference](references/build.md#tasker-execute).

### `tasker verify`

Runs the verify commands of the repo for a task in `executed`, and records the run. See [the reference](references/build.md#tasker-verify).

### `tasker show-verify`

Prints one verify run and the log of each command, in any state. See [the reference](references/build.md#tasker-show-verify).

### `tasker review`

Reviews the committed work of a task in `awaiting_work_review`, and records the findings. With your feedback, it continues the plan session instead and records the next plan revision. See [the reference](references/work-review.md#tasker-review).

### `tasker dismiss-review`

Dismisses open findings of the latest review of a task in `reviewed`, with one reason. See [the reference](references/work-review.md#tasker-dismiss-review).

### `tasker show-review`

Prints one review and its findings with their status, in any state. See [the reference](references/work-review.md#tasker-show-review).

### `tasker accept`

Accepts the work of a task in `awaiting_work_review`. See [the reference](references/work-review.md#tasker-accept).

### `tasker merge`

Lands the work of a task in `accepted` on the base branch of `origin`. See [the reference](references/landing.md#tasker-merge).

### `tasker mark-landed`

Records that the work of a task in `accepted`, `pushed` or `in_peer_review` landed outside tasker. See [the reference](references/landing.md#tasker-mark-landed).

### `tasker update-branch`

Brings the worktree of a task up to date with its base branch, for a task in a state that the reference lists. See [the reference](references/keeping-current.md#tasker-update-branch).

### `tasker finish`

Cleans up a task in `landed` or `cleanup_failed`. See [the reference](references/landing.md#tasker-finish).

### `tasker retry`

Moves a task in `failed` back to the state before the step that failed, and runs that step again. See [the reference](references/recovery.md#tasker-retry).

### `tasker resume`

Moves a task in `quota_blocked` or `interrupted` back to the state before the run that stopped, and runs the same command again. A resume from `updating_branch` runs nothing. See [the reference](references/recovery.md#tasker-resume).

### `tasker approve-credits`

Continues a task in `awaiting_quota_approval`, or in `quota_blocked` at the overage boundary, approves paid usage in its quota window, and runs the same command again. See [the reference](references/recovery.md#tasker-approve-credits).

### `tasker abort`

Cancels an active task and removes its worktree and local branch. It needs any state except `finished` and `cancelled`. See [the reference](references/recovery.md#tasker-abort).

### `tasker status`

Lists the tasks by issue key and state, and needs no task. See [the reference](references/inspect.md#tasker-status).

### `tasker show`

Prints the details of the task of an issue, in any state, with the facts of a pause for a paused task. See [the reference](references/inspect.md#tasker-show).

### `tasker show-bootstrap`

Prints the bootstrap log of the task of an issue, in any state. See [the reference](references/inspect.md#tasker-show-bootstrap).
