# Inspect commands

These commands print the state of tasks. They change nothing. [Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share. [The task of a show command](../SKILL.md#the-task-of-a-show-command) says which task `show` and `show-bootstrap` use.

## `tasker status`

Lists the tasks by issue key and state. With no option, it lists the active tasks of all repos. A task is active when its state is not `finished` and not `cancelled`.

If you give more than one option, a task must match all of them. With `--state finished` or `--state cancelled`, the command lists those tasks too.

The command prints one table with the columns `ISSUE`, `REPO`, `STATE`, `UPDATED` and `NEXT`. `UPDATED` is the time of the last change of the task. The task with the newest change comes first. `NEXT` holds the commands of the state. For a state with a primary command, the cell is `<primary> (also: <other>, ...)`, for example `plan (also: abort)`. For a state with no primary command, the cell lists the commands, for example `refine, approve, abort`. For `finished` and `cancelled`, the cell is empty. [The commands of each state](../../../docs/statemachine.md#the-commands-of-each-state) gives the table.

If no task matches, the command prints `no tasks` and exits with code 0.

The command prints an error and exits with code 1 in these cases:

- The repo key does not exist. The error names the key.
- The state does not exist. The error lists the states.

## `tasker show`

Prints the details of the task of an issue: `tasker show <issue>`.

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

Then the command prints the commands of the state, after the fields and before the todo block. For a state with a primary command, it prints `next: tasker <primary> <issue key>` and `also: tasker <other> <issue key>, ...`. For a state with no primary command, it prints one line, `commands: tasker <a> <issue key>, ...`. For `finished` and `cancelled`, it prints no line. [The commands of each state](../../../docs/statemachine.md#the-commands-of-each-state) gives the table.

If the pinned plan revision has at least one todo with a recorded state, the command prints a todo block after the fields. The pinned revision is the approved revision with the highest version. The block starts with the line `todos (approved v<N>):`. Then it prints one line for each todo of the revision, in the order of the plan: `<state>  <id>  <title>`. The state is `done`, `in progress` or `not started`. The command pads the state and the id to the longest value of the revision, and two spaces separate the columns.

If the revision has a fix turn, the line `fix turn: queued` or `fix turn: done` follows the block. If the task has no pinned revision, or no todo has a recorded state, the command prints no block and no fix turn line.

If the task is in the state `reviewed`, the command prints the line `review findings (review <n>, at <revision>):` after all other lines. Then it prints the findings of the latest review in [the text form of `tasker review`](work-review.md#tasker-review). In every other state, the command prints nothing more.

Each field and each todo title stays on one line. A line end in a value prints as the two characters `\n`. The findings use [the text form of `tasker review`](work-review.md#tasker-review), so a line end in a finding starts a new line with the indent of its block.

## `tasker show-bootstrap`

Prints the bootstrap log of the task of an issue: `tasker show-bootstrap <issue>`.

The command prints the log as it is, with no change. The log holds every bootstrap run of the attempt of the task, in order. Each run starts with a line `=== bootstrap run <time> ===`. An empty log prints nothing.

The command prints an error and exits with code 1 in these cases:

- The task has no bootstrap log. The error is `no bootstrap log for <issue key>`.
- tasker cannot read the bootstrap log. The error is `cannot read the bootstrap log for <issue key>: <error>`. `<error>` is the error code, for example `EISDIR`, or else the error message.
