# Tasker commands

The reader of this page is the agent of a ticket.

## The plain-form rule

This rule applies to each `tasker` command that the agent runs and that changes a task. Examples are `start`, `plan`, `refine`, `approve`, `execute`, `verify`, `review`, `dismiss-review`, `accept`, `merge`, `finish`, `update-branch`, `retry` and `resume`. The agent runs each such command alone in its own Bash call (one call of the Bash tool of the agent). The call has the plain form: `tasker <command> <issue>` and the options of the command, for example `tasker accept codeguru42/tasker#81`. The issue key has no quotes. No `cd` comes before the command, no pipe comes after it, and no other command is in the same call. A feedback text goes in as one argument, as in `tasker refine <issue> "<feedback>"`. Inside double quotes, the shell expands backticks and `$`. Put the feedback text in single quotes, or keep backticks and `$` out of it. For feedback text from a file, the one allowed form is `tasker refine <issue> "$(cat <absolute path of the file>)"`. `tasker review <issue> "<feedback>"` takes the same form. No other command substitution is allowed. The shell does not expand backticks or `$` in the text of the file. As a result, the warning above covers only the text on the command line.

The reason: the repo file `.claude/settings.json` allows `Bash(tasker *)`. A Bash call matches this permission rule only when the call is one `tasker` command. Claude Code sends a call that does not match to the classifier of its auto mode (the check that allows or denies a tool call). The classifier can deny the call. For example, the classifier denied `tasker accept 'codeguru42/tasker#81' 2>&1 | tail -5`, but it allowed `tasker accept codeguru42/tasker#81`. On 2026-10-17, the agent of #229 ran `tasker refine` with feedback text from a file in the allowed form, in auto mode, and the call ran.

If the classifier denies a `tasker` command in the plain form, the agent does not try another form. The agent stops and reports the exact text of the denial to the orchestrator. The orchestrator tells the user. The command did not run, so the task keeps its state. The agent runs no other `tasker` command until the orchestrator tells it the next step. The agent waits as [the answer-wait rule](orchestration.md#the-answer-wait-rule) says.

The plain-form rule does not cover these:

- A read-only `tasker` command, which does not change a task. Examples are `tasker show`, `tasker status`, `tasker show-plan`, `tasker show-review`, `tasker show-quota` and `tasker doctor`. Such a command can have a pipe, for example `tasker show-quota | jq` in "Quota".
- A change to `.claude/settings.json`. The rule does not change the permission rules of the repo.

## The tool-block rule

A tool block is a denial of a tool call by the permission rules or by the classifier of auto mode. In past sessions, the classifier of auto mode denied `gh auth token` and a `claude -p` run. [The plain-form rule](#the-plain-form-rule) covers a denied `tasker` command in the plain form. If any other tool block stops the agent, the agent reports the exact text of the denial to the orchestrator. Then the agent waits as [the answer-wait rule](orchestration.md#the-answer-wait-rule) says. The orchestrator tells the user. The orchestrator does not run the blocked action for the agent, unless the user tells it to.

## The command rules

These rules apply to each `tasker` command that the agent runs, also to a read-only one. They add to the plain-form rule and do not change it.

- Give the full issue key, for example `codeguru42/tasker#90`. A bare number such as `90` fails with `no repo configured for 90`, for example in `tasker show 90`. `tasker status --issue 90` does not fail. It prints `no tasks match the given filters` and exits with 0, so a check with a bare number finds no task.
- Never wrap a `tasker` command in `timeout`. At the end of the time, `timeout` sends SIGTERM, and tasker moves the task to `interrupted`. On 2026-10-13, `timeout 595 tasker execute` stopped an execute run this way, and `tasker resume` had to continue it.
- Run a long `tasker` command in the background. The long commands include `plan`, `refine`, `execute`, `review` and `resume`. The agent sets the `run_in_background` option of its Bash tool. The call keeps the plain form.
- To wait for the end of a long command, wait for the report of the Bash tool that the background job of the command ended. Do not wait with a loop that reads the state in `tasker status`. Such a loop is not reliable. For example, a review run can end in `awaiting_work_review` or in `reviewed`, so a loop that waits while the state is `reviewing` cannot tell the end from the start. The Bash tool gives its report after a Bash call of the agent ends. While the agent waits, it runs a short wait in another Bash call, for example `timeout 100 bash -c 'while :; do sleep 15; done'`. This call always exits with 124. If no report came, the agent runs the same wait again. After the report, the agent reads the state with `tasker show <issue>`. When the orchestrator starts the agent again, the agent follows "What the agent does" in "Quota".
- When the output of a read-only `tasker` command goes into a pipe, start the call with `set -o pipefail`. As a result, a failed `tasker` command stops the chain. To keep only some lines, use `sed -n`, for example `sed -n '1,20p'`, not `head`. With `pipefail`, `head` can make the pipe exit with 141 when tasker succeeded, because `head` stops reading early.

## The facts of the installed tasker

- `tasker plan` can fail with "planning returned no structured output; the assistant produced no plan object". The task goes to `failed`. This failure does not come from the code. One `tasker retry <issue>` plans again.
- `tasker start` can wait about 10 minutes on `git ls-remote` over ssh and then fail with a git transport error. If `tasker doctor` then passes, the agent runs `tasker start` again.
- `tasker update-branch` prints `origin/<branch> does not exist; nothing to sync from` for a task branch that was never pushed. This output is normal.
- `tasker dismiss-review` prints `dismissed review findings for <issue key>`. This output is normal. It differs from the output that [skills/tasker/references/work-review.md](../../skills/tasker/references/work-review.md#tasker-dismiss-review) gives for the `tasker dismiss-review` of this repo.
- `tasker merge` prints `landed: <commit> on origin/main`. `tasker finish` prints that it marked the issue done on the tracker, and it closes the issue.
- `tasker start` can print a GraphQL warning that the assign of the issue on the tracker failed. The warning does no harm.
- `tasker start` refuses a ticket whose parent is not [ready to stack](pick-the-tickets.md#the-stacking-rule). It exits with 1 and prints `<parent issue key>: blocking issue is still open`. No task exists after the refusal.
- `tasker verify` refuses a stacked task whose parent has landed. It prints `task <id>'s parent <parent issue key> has landed on origin/main; run tasker update-branch <issue key> to move this task onto it first`. The task stays in `executed`. `tasker update-branch` rebases only the commits of the task onto the base of the parent.
- A stacked task in `awaiting_plan_review` loses its base when `tasker finish` of the parent deletes the branch of the parent. `tasker refine` then fails with exit code 1 and an `unknown revision` error of `git diff`, and it changes nothing. `tasker update-branch` moves the task onto the base of the parent, and the task stays in `awaiting_plan_review`. tasker marks the plan as stale, so a refine comes before `tasker approve`, also when the new base changes no fact of the plan.
- `tasker update-branch <issue> --take-remote` of a stacked task whose parent landed moves the base of the task to the base of the parent, for example `base branch: main`, and the task to `executed`, in one run.
- If a task is stacked on the same parent as another task, the shared-file warning of `tasker refine` and `tasker approve` for that task lists the files of the parent too. The warning reads the files that the branch of the other task changes against the base, and that branch holds the commits of the parent.
- `tasker update-branch` prints the command that undoes the update after each update that moves the task branch, also with `--take-remote`. The output gives `previous HEAD was <hash>`, and the command is `tasker update-branch <issue> --undo`. On #252, each plain `tasker update-branch` printed this hint.
- When the rebase of `tasker update-branch` stops with a conflict, the output names each conflicting path.

## The run times

An agent picks the wait for a long command (see the wait bullet of [the command rules](#the-command-rules)) from these usual run times. The times come from the tickets of this repo.

- `tasker start`: a few seconds. For the wait of about 10 minutes on ssh, see [the facts of the installed tasker](#the-facts-of-the-installed-tasker).
- `tasker plan`: about 1 to 2 minutes for a small issue, and about 4 to 6 minutes for a large issue.
- `tasker refine`: about 1 to 4 minutes.
- `tasker execute`: about 1 to 2 minutes for 2 to 4 todos, and about 8 to 15 minutes for 20 to 30 todos.
- `tasker verify` (`npm run check`): seconds.
- `tasker review`: about 25 seconds to 2 minutes.
- A docs ticket: about 1 to 2 minutes for each of plan, refine and execute.
