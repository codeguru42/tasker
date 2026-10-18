# Setup commands

These commands check or change the setup of tasker. They need no task. [Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share.

## `tasker show-config`

Prints the configuration as JSON, with the defaults filled in.

If the repo key of `--repo` does not exist, the command prints an error and exits with code 1.

## `tasker doctor`

Makes sure that the configuration, the data root, git, `gh`, `claude` and the accounts work before you start a task. The command has no options.

The command runs these checks one at a time, in this order:

- `data root`: makes the missing folders of `dataRoot`, then writes one temporary file there and deletes it.
- `free space`: warns when the free space of the file system of `dataRoot` is below `dataRootMinFreeBytes`.
- Once for each version control provider that the configuration uses, in the order of first use: the checks of the provider. For `git`, `git version` runs once, and the identity, connection and lock-file checks then run for each repo, in the order of the configuration.
- Once for each issue tracker that the configuration uses, in the order of first use: the checks of the tracker. For `github`, `gh version` runs once, `gh auth` runs once for each account, and the project and label checks run for each repo.
- Once for each assistant provider that the configuration uses, in the order of first use: the checks of the provider. For `claude-code`, this is `claude version`, and on Linux also `sandbox: bwrap` and `sandbox: socat`.

The command prints one line for each check, with the status (`ok`, `warn` or `error`), the name and the first line of the detail. The other lines of the detail and the remediation follow with an indent. The command prints the lines of a check before the next check starts.

The command exits with these codes:

- 1 when the configuration does not load or the list of checks cannot be built. No check runs.
- 1 when a required check gives `error`. The later checks still run.
- 0 in all other cases. A `warn` never changes the exit code.

The checks never change the remote, GitHub or the clone. The only write is one temporary file in `dataRoot`, which the check deletes.

## `tasker install-skills`

Copies each skill of the installed tasker into each folder of `skillsDirs`. The command has no options.

A skill is a folder under the `skills` folder of the installed tasker. For each folder of `skillsDirs`, in order, and for each skill, in name order, the command does these steps:

1. Make the folder, with its missing parents, when it does not exist.
2. Remove `<folder>/<name>` when it exists.
3. Copy the skill to `<folder>/<name>`.

After the copy, the command prints `installed <name> to <folder>/<name>`. When a step fails, the command prints `error: cannot install <name> to <folder>/<name>: <reason>` on stderr. The next skill and the next folder still get their turn.

The command exits with these codes:

- 1 when the configuration does not load. Nothing is copied.
- 1 when a step for a folder fails. The next folder still gets the skills.
- 0 in all other cases.

## `tasker model`

Prints or sets the model and the effort of each assistant role for the repo of an issue: `tasker model <issue> [<model>] [--role <role>] [--repo <key>] [--effort <effort>]`. The command needs no task and changes no task. For the configuration file, see [the Configuration section](../SKILL.md#configuration).

`<model>` and `--effort` need `--role`. The roles are `plan`, `execute` and `review`.

If the issue key fits more than one repo and you do not give `--repo`, the active task of the issue picks the repo. If no repo, or more than one repo, has an active task for the issue, the command prints an error.

Without `<model>` and `--effort`, the command prints one line for each role, in the order plan, execute, review, as `<role>: <model> (effort <effort>)`, for example `plan: opus (effort high)`. With `--role`, it prints only that role.

With `<model>`, `--effort` or both, the command changes the model, the effort or both of the role that `--role` names. The command makes sure that the new configuration is valid, with the model check of the provider, before it writes. If the new configuration is not valid, the command prints the errors and changes nothing. Then the command writes the new file in one step: a temporary file and a rename. It prints the new line of the role on stdout. It prints this note on stderr: `note: the new model and effort apply only to new sessions. A continued session keeps the model and the effort that it started with.`

The command prints an error and exits with code 1 in these cases:

- You give `<model>` or `--effort` without `--role`. The error is `name the role with --role`. The command stops before it reads the configuration.
- The new configuration is not valid, for example when the model fails the model check of the provider. The error lists the problems, and the file does not change.
