---
name: tasker
description: Use when you run tasker, the command-line tool that drives an AI coding assistant through an issue. Lists each tasker command that you can run, with its options.
---

# tasker

tasker takes an issue from an issue tracker and drives an AI coding assistant through plan, build, verify, review, and merge.

## Rules

- Use only the commands and options that this skill lists. If a command or an option is not in this skill, do not run it.

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

## Commands

### `tasker show-config`

Prints the configuration as JSON, with the defaults filled in.

- `--repo <key>`: prints only the repo with this key.

If the key does not exist, or the configuration is missing or invalid, the command prints an error and exits with code 1.

### `tasker start`

Makes a task for an issue and takes it to the state `workspace_ready`: `tasker start <issue>`. The command reads the issue, makes the clone, resolves the base branch, makes the worktree and runs bootstrap.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.
- `--base <branch>`: the base branch of this task only. Give a branch on origin, or `refs/heads/<branch>` for a local branch of the clone.

On success, the command prints one line for each field, as `<field>: <value>`, in this order:

- `issue`
- `repo`
- `state`
- `base`
- `branch`
- `worktree`

The state is `workspace_ready`. If the issue already has an active task that is past this step, the command changes nothing. It prints `task already started` first, then the same six lines.

If a run stops before `workspace_ready`, run the same command again. The second run continues the same task. This holds for a task that failed in the steps of `tasker start`. The second run keeps the stored base. A `--base` option or a `base:` label on the issue sets a new base, and the task keeps the new one. A new base does not move a task branch that already exists.

The command picks the base branch from the first source that has one:

1. The `base:` label of the issue, for example `base: dev`.
2. The `--base` option, or the stored base of the task on a second run.
3. The default that tasker learned for the repo.
4. The `defaultBaseBranch` of the repo in the configuration.
5. A question to you. The command asks only when stdin is a terminal.

If you press Ctrl-C at the question, the command stops. The task goes to the state `failed` with the error `no answer: the question was cancelled`. Run the command again to continue it.

The question and the notes of the base step go to stderr. As a result, stdout holds only the six lines.

The command stops with exit code 1 and prints the error on stderr in these cases:

- The configuration or the issue key is not valid. Fix it, then run the command again.
- The issue does not exist, or it is closed and has no task. The error names the issue. Open the issue again or use another one.
- Another start of the same issue is running. The error says that the lock is busy. Wait until it ends.
- The base branch is not known and stdin is not a terminal. The error says `no base branch for <repo>`. Pass `--base <branch>` or set `defaultBaseBranch` for the repo.
- A step fails. The task goes to the state `failed` with the error. Fix the cause, then run the command again.
- Bootstrap fails. The error names the number and the text of the command, then the exit code, the timeout or the signal, and the path of the log. The last 20 lines of the log follow. Fix the cause, then run the command again.

Two starts for different issues of one repo run at the same time. They wait for each other only while one of them uses the clone or waits for your answer to the question for the base branch. A wait for the clone ends after 5 minutes with the lock error. The task then stays in the state `provisioning`, with no error. Run the command again to continue it.

### `tasker plan`

Runs the assistant in plan mode in the worktree of a task in the state `workspace_ready`, and records the first plan revision: `tasker plan <issue>`. The task goes to the state `planning`, then to `awaiting_plan_review`.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

On success, the command prints these lines:

- `planned <issue> as revision v1`
- `plan: <path>`, the path of the plan file.
- `prompt: <path>`, the path of the archived prompt.
- `todos:`, then one line `- <id>: <title>` for each todo, in the order of the plan.
- `questions: <count>`

After these lines, the command compares the files of the plan with the files of each other active task of the same repo. For each other task, it reads the files of its newest plan revision and the files that its task branch changes. A task in `finished` or `cancelled` does not count. When a file is shared, the command prints this warning on stderr:

```text
WARNING: this plan changes files that other tasks in flight also change.
The task that lands second can get merge conflicts and redo its work.
  <issue key> (<state>):
    <file>
tasker does not refuse. Decide before you approve.
```

The warning has one part for each other task that shares a file. The parts follow the order of the issue keys by number, so `#9` comes before `#10`. The shared files of a task are sorted as plain text. When no file is shared, the command prints no warning.

If the command cannot read the files of a task branch, it prints this line before the warning: `note: cannot read the files of the task branch of <issue key>: <error>`. The files of the newest plan revision of that task still count. If the compare itself fails, the command prints the line `note: cannot compare the plan with the other tasks in flight: <error>`.

The warning and the notes only inform. They never stop the command, and they never change the exit code or the state of a task.

The assistant reads only the issue title and body. It does not read the issue comments.

The command stops with exit code 1 and prints the error on stderr in these cases. In the first five cases, the task keeps its state and nothing is written:

- The issue has no task. The error names the issue and the repo. Run `tasker start` first.
- The task is not in `workspace_ready`. The error names the state. `tasker plan` runs only on a task that `tasker start` brought to `workspace_ready`. For a task in `provisioning`, run `tasker start` again. For a task in `failed` or `quota_blocked`, see below. For a task that is past `planning`, the plan already exists.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.
- The issue cannot be read. Fix the cause (for example the gh login), then run the command again.
- The prompt cannot be archived. Fix the cause, then run the command again.
- The assistant fails or runs longer than the time limit. The task goes to the state `failed`, and the error is `planning failed: <reason>` or `planning timed out after <n> min`.
- An unexpected error occurs after the run has started, for example the transcript file cannot be opened. The task goes to the state `failed`, and the error is `planning failed: <error>`.
- The assistant returns a plan that tasker refuses. The task goes to the state `failed`. The error lists each problem.
- The plan file cannot be written. The task goes to the state `failed`, and the error is `cannot write the plan file of revision v1: <error>`.
- A quota limit stops the run. The task goes to the state `quota_blocked`. The command prints the reset time on stdout.

For now, no command continues a task in `failed` or `quota_blocked`. Run `tasker abort <issue>` to leave the state. A crash of tasker leaves the task in `planning`. Run `tasker abort <issue>` for it too.

If you press Ctrl-C, the assistant stops. The run ends as a failure, and the task goes to the state `failed`.

### `tasker abort`

Removes the worktree and the local task branch of an active task, and moves the task to the state `cancelled`: `tasker abort <issue>`.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.
- `--force`: discards the uncommitted changes of the worktree before the abort.

The command prints one line for each step that ran, then `cancelled <issue>`. The steps are the discard of the uncommitted changes (only with `--force`), the removal of the worktree and the deletion of the branch. A step that has nothing to do prints no line. The files under `artifacts/` stay.

The command stops with exit code 1 and prints the error on stderr in these cases:

- The task is `finished` or `cancelled`. The error names the state. A task in any other state, `failed` included, can be aborted.
- The worktree has uncommitted changes and you did not pass `--force`. The error lists each change, then says `tasker abort --force discards them`. Commit the changes or pass `--force`.
- Another command holds the task lock of the issue. The error says that the lock is busy. Wait until it ends.
- Another command holds the clone for more than 5 minutes. The error says that the lock is busy. Run the command again.
- A step fails. The task keeps its state, so run the command again. The second run finishes the steps that are left.

### `tasker show`

Prints the details of the task of an issue: `tasker show <issue>`. The command shows the active task. If the issue has no active task, it shows the newest task.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

The command prints one line for each field, as `<field>: <value>`, in this order:

- `issue`
- `repo`
- `title`
- `state`
- `attempt`
- `base`
- `branch`
- `worktree`
- `created`
- `updated`
- `last event`

A field with no value prints `-`. The `last event` line holds the time, the type and the data of the last event of the task, as one line of JSON text: `last event: <time> <type> <data>`. An event with no data prints `null`.

If the task is in the state `failed`, the command prints two more lines. `failed in` gives the state that the task left when it failed. `error` gives the error of the failure.

Each field stays on one line. A line end in a value prints as the two characters `\n`.

The command prints an error and exits with code 1 in these cases:

- The issue key does not resolve.
- The issue has no task. The error names the issue and the repo.
- The configuration is missing or invalid.

### `tasker show-bootstrap`

Prints the bootstrap log of the task of an issue: `tasker show-bootstrap <issue>`. The command uses the same task as `tasker show`: the active task, else the newest task.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.

The command prints the log as it is, with no change. The log holds every bootstrap run of the attempt of the task, in order. Each run starts with a line `=== bootstrap run <time> ===`. An empty log prints nothing.

The command prints an error and exits with code 1 in these cases:

- The issue key does not resolve.
- The issue has no task. The error names the issue and the repo.
- The task has no bootstrap log. The error is `no bootstrap log for <issue key>`.
- tasker cannot read the bootstrap log. The error is `cannot read the bootstrap log for <issue key>: <error code>`.
- The configuration is missing or invalid.

### `tasker show-plan`

Prints one plan revision of the task of an issue: `tasker show-plan <issue>`. The command uses the same task as `tasker show`: the active task, else the newest task.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.
- `--version <N>`: prints revision `N`. `N` must be a whole number of 1 or more, with no sign and no leading zero. With no `--version`, the command prints the newest revision. A bad value is an error, and the command stops before it reads the configuration.
- `--path`: prints only the path of the plan file `v<N>.md` of the revision, with a final line end. The command prints the path also when the file is missing, because it does not read the file.

The command prints this output:

```
<issue key> plan v<N>
<approval line>

<plan text>
todos:
  <id>: <title>
    <description>
    depends on: <ids>
questions:
  <id>: <question>
    <context>
    <state>
```

- The approval line is `not approved` when no revision of the task is approved. It is `approved` when the printed revision is the approved revision. Otherwise it is `approved revision is v<K>`, where `v<K>` is the approved revision.
- The plan text comes from the file `v<N>.md` and prints as it is. If it does not end with a line end, the command adds one.
- The todos and the questions come from the stored revision, not from the file.
- `depends on` lists the ids of the todos that come first, joined with `, `. A todo with none prints `depends on: none`.
- The state of a question of revision `v<N>` comes only from the next revision `v<N+1>`. If `v<N+1>` has no question with the same id, the state is `answered in v<N+1>: <answer>`. The answer is the feedback of `v<N+1>`. If `v<N+1>` has no feedback, the state is `answered in v<N+1>`. Else the state is `open`. A revision after `v<N+1>` does not change the state, and a question of the newest revision is always `open`.
- A revision with no questions prints `  none` under `questions:`.
- A line end inside a title, a description, a context, a question or an answer starts a new line with the indent of its block.
- Each line of the output, the last one too, ends with a line end.

The command prints an error and exits with code 1 in these cases:

- The issue key does not resolve.
- The issue has no task. The error names the issue and the repo.
- The `--version` value is bad. The error is `--version must be a whole number of 1 or more: <value>`.
- The task has no plan revision. The error is `the task of <issue key> has no plan revision; run tasker plan first`. This error also comes with `--version`.
- The task has no revision `N`. The error is `the task of <issue key> has no plan revision v<N>`.
- The plan file is missing. The error is `no plan file at <path>`. This does not apply to `--path`.
- tasker cannot read the plan file. The error is `cannot read the plan file <path>: <error code>`. This does not apply to `--path`.
- The configuration is missing or invalid.

### `tasker show-questions`

Prints the questions of one plan revision of the task of an issue, each with its state: `tasker show-questions <issue>`. The command uses the same task as `tasker show`: the active task, else the newest task. The command does not read the plan file.

- `<issue>`: the issue key of the task.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.
- `--version <N>`: prints the questions of revision `N`. The rule is the same as for `tasker show-plan`: `N` must be a whole number of 1 or more, with no sign and no leading zero. With no `--version`, the command uses the newest revision.

If the revision has questions, the command prints the header line `<issue key> plan v<N>`, then the questions block of `tasker show-plan`:

```
<issue key> plan v<N>
questions:
  <id>: <question>
    <context>
    <state>
```

The state is `open`, `answered in v<N+1>: <answer>`, or `answered in v<N+1>` when the next revision `v<N+1>` has no feedback. The rule is the same as for `tasker show-plan`: only the next revision `v<N+1>` decides the state. If the revision has no questions, the command prints one line: `<issue key> plan v<N> has no questions`. Each line ends with a line end.

The command prints an error and exits with code 1 in these cases:

- The issue key does not resolve.
- The issue has no task. The error names the issue and the repo.
- The `--version` value is bad. The error is `--version must be a whole number of 1 or more: <value>`.
- The task has no plan revision. The error is `the task of <issue key> has no plan revision; run tasker plan first`. This error also comes with `--version`.
- The task has no revision `N`. The error is `the task of <issue key> has no plan revision v<N>`.
- The configuration is missing or invalid.

### `tasker status`

Lists the tasks by issue key and state. With no option, it lists the active tasks of all repos. A task is active when its state is not `finished` and not `cancelled`.

- `--repo <key>`: lists only the tasks of the repo with this key.
- `--issue <issue>`: lists only the tasks of this issue key.
- `--state <state>`: lists only the tasks in this state. If you name `finished` or `cancelled`, the command lists those tasks too.

If you give more than one option, a task must match all of them.

The command prints one table with the columns `ISSUE`, `REPO`, `STATE` and `UPDATED`. `UPDATED` is the time of the last change of the task. The task with the newest change comes first.

If no task matches, the command prints `no tasks` and exits with code 0.

The command prints an error and exits with code 1 in these cases:

- The repo key does not exist. The error names the key.
- The state does not exist. The error lists the states.
- The issue key does not resolve.
- The configuration is missing or invalid.

### `tasker doctor`

Makes sure that the configuration, the data root, git, `gh`, `claude` and the accounts work before you start a task. The command has no options.

The command runs these checks one at a time, in this order:

- `data root`: makes the missing folders of `dataRoot`, then writes one temporary file there and deletes it.
- `free space`: warns when the free space of the file system of `dataRoot` is below `dataRootMinFreeBytes`.
- For each repo, in the order of the configuration: the git checks.
- Once for each issue tracker that the configuration uses, in the order of first use: the checks of the tracker. For `github`, `gh version` runs once, `gh auth` runs once for each account, and the project and label checks run for each repo.
- Once for each assistant provider that the configuration uses, in the order of first use: the checks of the provider. For `claude-code`, this is `claude version`, and on Linux also `sandbox: bwrap` and `sandbox: socat`.

The command prints one line for each check, with the status (`ok`, `warn` or `error`), the name and the first line of the detail. The other lines of the detail and the remediation follow with an indent. The command prints the lines of a check before the next check starts.

The command exits with these codes:

- 1 when the configuration does not load or the list of checks cannot be built. No check runs.
- 1 when a required check gives `error`. The later checks still run.
- 0 in all other cases. A `warn` never changes the exit code.

The checks never change the remote, GitHub or the clone. The only write is one temporary file in `dataRoot`, which the check deletes.

### `tasker model`

Prints or sets the model and the effort of each assistant role for the repo of an issue: `tasker model <issue> [<model>] [--role <role>] [--repo <key>] [--effort <effort>]`. The command needs no task and changes no task. For the configuration file, see the Configuration section.

- `<issue>`: the issue key. The command uses the repo of the issue.
- `[<model>]`: the new model of the role. The command sets it only with `--role`.
- `--role <role>`: the role to print or to set. The roles are `plan`, `execute` and `review`.
- `--repo <key>`: uses the repo with this key. Use it when two repos share the project of the issue.
- `--effort <effort>`: the new effort of the role: `low`, `medium` or `high`.

If the key fits more than one repo and you do not give `--repo`, the active task of the issue picks the repo. If no repo, or more than one repo, has an active task for the issue, the command prints an error.

Without `<model>` and `--effort`, the command prints one line for each role, in the order plan, execute, review, as `<role>: <model> (effort <effort>)`, for example `plan: opus (effort high)`. With `--role`, it prints only that role.

With `<model>`, `--effort` or both, the command changes the model, the effort or both of the role that `--role` names. The command makes sure that the new configuration is valid, with the model check of the provider, before it writes. If the new configuration is not valid, the command prints the errors and changes nothing. Then the command writes the new file in one step: a temporary file and a rename. It prints the new line of the role on stdout. It prints this note on stderr: `note: the new model and effort apply only to new sessions. A continued session keeps the model and the effort that it started with.`

The command prints an error and exits with code 1 in these cases:

- The issue key does not resolve.
- The configuration is missing or invalid.
- You give `<model>` or `--effort` without `--role`. The error is `name the role with --role`. The command stops before it reads the configuration.
- The new configuration is not valid, for example when the model fails the model check of the provider. The error lists the problems, and the file does not change.
