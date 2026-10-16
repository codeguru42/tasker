# Start command

This file describes the command that begins a task. [Shared errors](../SKILL.md#shared-errors) lists the errors that many commands share. [The Main lifecycle section of docs/statemachine.md](../../../docs/statemachine.md#main-lifecycle) gives the states.

## `tasker start`

Makes a task for an issue and takes it to the state `workspace_ready`: `tasker start <issue>`. The command reads the issue, makes the clone, resolves the base branch, makes the worktree and runs bootstrap.

`--base <branch>` sets the base branch of this task only. Give a branch on origin, or `refs/heads/<branch>` for a local branch of the clone.

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

The question and the notes of the base step go to stderr. As a result, stdout holds only the six lines and the lines of the tracker writes.

If `issueTracker.updateOnStart` is `true`, the command writes to the issue tracker after the task reaches `workspace_ready`. It prints one line on stdout for each write that works, after the six lines:

- `assigned <issue key> to <assignee> on the tracker`
- `marked <issue key> in progress on the tracker`

If the configuration has no in-progress label, the command only assigns the issue and prints only the first line.

A write that fails does not change the exit code, which stays 0, and does not change the task, which stays in `workspace_ready`. The command prints a warning on stderr at once, with the error of the tracker:

- `warning: cannot assign <issue key> to <assignee> on the tracker: <error>`
- `warning: cannot mark <issue key> in progress on the tracker: <error>`

The error can span two lines. To finish the write, mark the issue on the tracker yourself.

The command stops with exit code 1 and prints the error on stderr in these cases:

- The configuration or the issue key is not valid. Fix it, then run the command again.
- The issue does not exist, or it is closed and has no task. The error names the issue. Open the issue again or use another one.
- The issue has no task, `issueTracker.updateOnStart` is `true`, you did not pass `--reclaim`, and the issue already has the in-progress label. The error is `the issue <issue key> already has the in-progress marker <label>. Pass --reclaim to start it anyway, or remove the marker on the tracker.` The command makes no task and no write. Pass `--reclaim`, or remove the label on the tracker.
- Another start of the same issue is running. The error says that the lock is busy. Wait until it ends.
- The base branch is not known and stdin is not a terminal. The error is `no base branch for <repo>: pass --base <branch> to tasker start, or set repos.<repo>.defaultBaseBranch`. Pass `--base <branch>` or set `defaultBaseBranch` for the repo.
- A step fails. The task goes to the state `failed` with the error. Fix the cause, then run the command again.
- Bootstrap fails. The error names the number and the text of the command, then the exit code, the timeout or the signal, and the path of the log. The last 20 lines of the log follow. Fix the cause, then run the command again.

Two starts for different issues of one repo run at the same time. They wait for each other only while one of them uses the clone or waits for your answer to the question for the base branch. A wait for the clone ends after 5 minutes with the lock error. The task then stays in the state `provisioning`, with no error. Run the command again to continue it.
