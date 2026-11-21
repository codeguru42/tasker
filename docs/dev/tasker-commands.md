# Tasker commands

The readers of this page are the task subagent of a ticket, and the orchestrator for the plain-form rule, the
orchestrator-command rule and the tool-block rule. Each other actor of [the table](permissions.md#the-table) also reads
the tool-block rule: the planner subagent, the issue-draft, issue-review and issue-post subagents, the write subagent,
the opener subagent, the reuse subagent and a question session. The planner and the operator also read it.

## The plain-form rule

This rule applies to each `tasker` command that the task subagent runs and that changes a task. Examples are `start`,
`plan`, `refine`, `approve`, `execute`, `verify`, `review`, `dismiss-review`, `accept`, `merge`, `finish`,
`update-branch`, `retry` and `resume`. The task subagent runs each such command alone in its own Bash call (one call of
the Bash tool of the task subagent). The call has the plain form: `tasker <command> <issue>` and the options of the
command, for example `tasker accept codeguru42/tasker#81`. The issue key has no quotes. No `cd` comes before the
command, no pipe comes after it, and no other command is in the same call. A feedback text goes in as one argument, as
in `tasker refine <issue> "<feedback>"`. Inside double quotes, the shell expands backticks and `$`. Put the feedback
text in single quotes, or keep backticks and `$` out of it. For feedback text from a file, the one allowed form is
`tasker refine <issue> "$(cat <absolute path of the file>)"`. `tasker review <issue> "<feedback>"` takes the same form.
No other command substitution is allowed. The shell does not expand backticks or `$` in the text of the file. As a
result, the warning above covers only the text on the command line.

The reason: the repo file `.claude/settings.json` allows `Bash(tasker *)`. A Bash call matches this permission rule only
when the call is one `tasker` command. Claude Code sends a call that does not match to the classifier of its auto mode
(the check that allows or denies a tool call). The classifier can deny the call. A form that ran before can still get a
denial.

If the classifier denies a `tasker` command in the plain form, the task subagent does not try another form. The task
subagent follows [the tool-block rule](#the-tool-block-rule). The command did not run.

The plain-form rule does not cover these:

- A read-only `tasker` command, which does not change a task. Examples are `tasker show`, `tasker status`,
  `tasker show-plan`, `tasker show-review`, `tasker show-quota` and `tasker doctor`.
  [The orchestrator-command rule](#the-orchestrator-command-rule) gives the list of read-only commands. Such a command
  can have a pipe, for example `tasker show-quota | jq` in ["Quota"](quota.md#quota).
- A change to `.claude/settings.json`. The rule does not change the permission rules of the repo.

## The orchestrator-command rule

A read-only command is a `tasker` command that changes no task, no configuration file and no installed file. A task
change is a `tasker` command that changes the state or the record of a task, its worktree or its branch. The task
subagent of a task is the task subagent that the orchestrator started for the ticket of that task.

The orchestrator runs only read-only commands itself. A task subagent runs each task change. The reason: the
[plain-form rule](#the-plain-form-rule) and the command rules cover the task subagent. So does
["What the task subagent does"](quota.md#what-the-task-subagent-does).

These commands are read-only:

- `tasker show-config`, `tasker show-config-schema`, `tasker show-quota` and `tasker status`.
- `tasker show`, `tasker show-bootstrap`, `tasker show-plan`, `tasker show-questions`, `tasker show-verify` and
  `tasker show-review`.
- `tasker doctor`.
- `tasker model` with no new model and no `--effort`.
- `tasker --version`, `tasker --help` and `tasker help`.

These commands are task changes: `start`, `plan`, `refine`, `reopen`, `approve`, `unapprove`, `execute`, `verify`,
`review`, `dismiss-review`, `retry`, `resume`, `approve-credits`, `accept`, `merge`, `push`, `open-pr`, `mark-landed`,
`update-branch`, `finish` and `abort`. No session runs `approve-credits`, as [Limits](limits.md#limits) says.

A command that neither list names is not a read-only command. The orchestrator does not run it.

`tasker status` and each `show-*` command that reads one task stay read-only after they find a dead run. They only
report the dead run, as [A dead run](tasks.md#a-dead-run) says. A schema migration after an install also keeps a command
read-only, because the migration comes from the install. See [Schema versions](data-root.md#schema-versions).

The rule has two exceptions:

- An installing orchestrator runs `npm run install:global`, which runs `tasker install-skills`, as
  [the hold before an install](release.md#the-hold-before-an-install) says.
- The orchestrator runs `tasker model` with a new model or with `--effort` itself, only on the words of the user in a
  settled decision message of its [question pane](question-pane.md#send-a-decision). This command writes the
  configuration file of tasker. If the user types such a request in the tab of the orchestrator, the orchestrator does
  not run the command. It asks the question in its question pane, and it runs the command only after the settled
  decision message.

The rule covers only `tasker` commands. The `gh`, `git` and `herdr` commands keep their own rules.

To run a task change, the orchestrator sends the command to the task subagent of the task. The task subagent runs it
under the plain-form rule and the command rules, and it reports the result. An ended task subagent gets the command in a
message, because a message starts it again, as ["Terms" in "Quota"](quota.md#terms) says. A task with no task subagent
of this orchestrator gets a new task subagent for this one task change. An example is a parked task of an earlier
session. [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) gives the prompt for this
task subagent. Each step after a task change stays. An example is [Delete the job](quota.md#delete-the-job) after the
final report of an abort. If the send or the start fails, [the failure rule](limits.md#the-failure-rule) applies. The
command did not run, and the orchestrator does not run it itself. The write subagent of a question pane runs no `tasker`
command.

The orchestrator never runs a denied task change. On the word of the user, the task subagent runs the call again in the
form that the user names. Or the user runs the exact call. [The tool-block rule](#the-tool-block-rule) links here.

## The tool-block rule

A tool block is a denial of a tool call. The permission rules, the classifier of auto mode or the user can deny a call.
The user denies a call when the user declines it at a permission prompt.

Each actor of [the table](permissions.md#the-table) follows these steps for a denial.
[The report chain](permissions.md#the-report-chain) gives the path of each report.

1. After a denial, the actor runs the denied action in no other form and no part of it. It stops that step. It reports
   the exact call, the exact text of the denial, the folder of the call, the step and the purpose to its starter.
2. After a check failure, the actor first runs the same call again one time, in the same form. A second check failure is
   a denial of step 1.
3. A starter that gets the report sends it on to its own starter, up to the orchestrator.
4. On the word of the user, the actor that got the denial runs the call again one time, in the form of the word. For a
   task subagent, the orchestrator relays the word. For an issue subagent, the orchestrator relays the word to the
   planner subagent, and the planner subagent relays it to the issue subagent.
5. No third actor runs the denied call. The one exception: the orchestrator runs a call of a task subagent on the word
   of the user, as the paragraph that starts "After a tool block" says, but never a task change. Without a word of the
   user, no actor runs a form of the call.
6. The orchestrator brings each denial to the user in its question pane. It gives the choices of
   [A denied command of the operator](operator-start.md#a-denied-command-of-the-operator), with no `!` run.
7. Only the user approves a permission prompt, in the session where Claude Code shows it. A word of the user in a
   decision message or in a relayed message approves no permission prompt. The recommendation mode of
   [A decision of the user](working-with-the-user.md#a-decision-of-the-user) never covers a denial.

A task subagent runs a git command in the local clone of the orchestrator with `git -C <clone>`, not with
`cd <clone> && git ...` in a chain.

A delete with a lease of a task branch on `origin` can get a denial of the classifier of auto mode. If the classifier
denies this delete, the task subagent reports the exact text and the exact call, as the paragraph that starts "After a
tool block" says.

A denial covers the whole action of the call, not only its form. After a tool block, the task subagent runs the denied
action in no other form, and no part of it, until the orchestrator sends the answer. Other forms include a script file
with the same commands, a split of the action into several calls, and the same commands with other paths or names. On
2026-10-17, the user declined a fact test with `rm -rf`, and the task subagent of #231 ran it from two script files
before the answer came.

Claude Code checks a Bash call against the allow rules part by part. A compound call is one Bash call that holds two or
more commands, for example a chain with `&&`, `||` or `;`, or a pipe. A part is one command of a compound call. For a
match, each part of the call must match an allow rule. Claude Code splits a call at `&&`, `||`, `;`, `|`, `|&`, `&` and
newlines. This holds for each allow rule, not only for `gh`.

On 2026-11-12, the section "Compound commands" of https://code.claude.com/docs/en/permissions said:

> Claude Code is aware of shell operators, so a rule like `Bash(safe-cmd *)` won't give it permission to run the command
> `safe-cmd && other-cmd`. The recognized command separators are `&&`, `||`, `;`, `|`, `|&`, `&`, and newlines. Every
> subcommand must be allowed for a compound command to run without a prompt, for example because the subcommand matches
> an allow rule or is a read-only command.

Claude Code checks the target of a redirect by itself. A redirect is a `> file`, `>> file` or `2> file` in a Bash call.
The check uses the `Edit` rules, the protected paths and the working directories. A working directory is a folder where
Claude Code allows file edits with no prompt. An allow rule of the command does not cover its target. A target outside
the working directories, with no `Edit` allow rule, matches no rule.

On the same day, the section "Redirections" of the same page said:

> When a command redirects output or input, Claude Code checks the redirect target against your file rules as if Claude
> wrote or read that file directly:
>
> - **Output redirects**: for `> file`, `>> file`, or `2> file`, the check covers your `Edit` allow and deny rules,
>   protected paths, and the working directories. A rule such as `Bash(git commit *)` allows the command, not the
>   target. A target that starts with `~` or contains a glob character needs your approval.

A call that matches no rule goes to the classifier. The classifier decides from the context of the conversation. In a
subagent, the same decision order and the same rules apply as in the parent session.

A background subagent is a subagent of the Agent tool that runs in the background of a top-level session. The user types
no message in the conversation of a background subagent. A word of the user reaches it only in the prompt or in a
message of the parent session.

On the same day, the section "How the classifier evaluates actions" of https://code.claude.com/docs/en/permission-modes
said:

> Each action goes through a fixed decision order. The first matching step wins:
>
> 1. Actions matching your allow, ask, or deny rules resolve immediately, with these exceptions:

The list of exceptions names no `gh` command. Step 3 of the same list said:

> Everything else goes to the classifier, apart from critical-path removals under their default handling.

After the list, the same section said:

> In the classifier requests sent by Claude Code itself, the classifier sees user messages, tool calls other than
> read-only lookups such as file reads and searches, and your CLAUDE.md content.

The section "How auto mode handles subagents" of the same page said:

> While the subagent runs, each of its actions goes through the same decision order as in the parent session, with the
> same block and allow rules.

No part of a denied call runs. This includes a redirect or a command before the denied part.

After a tool block, the task subagent [stops](limits.md#the-answer-wait-rule). It reports the exact text of the denial,
the exact command, the step of the work that the command belongs to, and the purpose of the command. The orchestrator
tells the user these facts. For a denied task change, the orchestrator never runs the blocked action, as
[the orchestrator-command rule](#the-orchestrator-command-rule) says. For each other denied call, the orchestrator does
not run the blocked action for the task subagent, unless the user tells it to. The recommendation mode of
[A decision of the user](working-with-the-user.md#a-decision-of-the-user) does not cover a tool block: the orchestrator
always waits for the user. The report says that the denied call did not run. It names no file and no output of the
denied call as made. This also applies to each other report of a denial, as the paragraph that starts "Each report of a
denial quotes" lists them.

Each report of a denial quotes the exact denied call word for word, as the transcript of the session that ran the call
holds it. A short form or a description of the call does not take its place. This also applies to an item, a later
correction of a report, a summary of past denials and a short question to the user. If a report of a denial gives no
exact call, the session that gets the report asks the sender for the exact call. It asks before it states or changes a
conclusion that rests on the call, for example before the operator tells the user such a conclusion. In the quote, a
token, a key or a password becomes `[redacted]`, and on GitHub, `$HOME` replaces the path of the home folder.

On 2026-11-07, planner-m16 first gave a denied call to operator-m16 as "a plain comment with no guard". The exact call
was
`tail -n +3 /tmp/tasker/m16/drafts/768-comment.md > /tmp/tasker/m16/drafts/768-comment-body.md && gh issue comment 768 --body-file /tmp/tasker/m16/drafts/768-comment-body.md`.
On that short form, operator-m16 told the user that the denials of that day did not fit the guess that a chain caused
them. Then operator-m16 withdrew that guess. The exact call later showed that the denied call was a chain.

The classifier of auto mode can deny a `gh` write of an actor, for example of an issue-post subagent or of the
orchestrator. The actor follows the denial steps above. The report gives the exact command, the folder and the exact
text of the denial. The orchestrator asks the user in its [question pane](question-pane.md#start). The question session
sends the answer in its decision message, as [Send a decision](question-pane.md#send-a-decision) says. If the call ran,
the actor goes on with its work. If it did not run, the step stays open, and the actor runs the action in no other form.
On 2026-10-30, the classifier denied `gh issue comment` and `gh issue edit` of planner-m26.

A check failure is a denial whose text says that the classifier of auto mode gave no verdict. A check failure is a tool
block, with these differences:

- After a check failure, the task subagent runs the same call again one time, in the same form. The text of the failure
  permits this one try. For a check failure, this one try wins over the paragraph that starts "A denial covers the whole
  action" and over the stop of the paragraph that starts "After a tool block". Apart from this one try, the task
  subagent runs the action in no other form, and no part of it, as the paragraph that starts "A denial covers the whole
  action" says.
- If the second try runs, the task subagent continues its work. If the second try also fails with a check failure, the
  task subagent stops, as the paragraph that starts "After a tool block" says. In its report, the task subagent also
  says that the denial is a check failure. If the second try gets a denial that is not a check failure, that denial is a
  tool block with none of these differences.
- For a check failure, the orchestrator tells the user the exact command, the folder of the call and the link
  https://status.claude.com/, and it follows step 6 of the denial steps.
- Each other actor follows the same steps for a check failure of its own call. A second check failure goes up the report
  chain to the orchestrator.

On 2026-10-25, in the session of #428, each Bash call that no permission rule allowed failed with this text:

> The server-side auto mode classifier gave no verdict (error), so auto mode cannot determine the safety of Bash. This
> is a transient failure of the check, not a judgment about the action: a later response may get a verdict. You may try
> the action again once, as-is. Repeated attempts are slowed by a growing delay, and after 10 responses in a row without
> a verdict the turn stops.

The user then ran `gh issue create` with the `!` prefix, and the posts of #482 and #483 worked.

### The denial records

The script `scripts/denial-records.ts` finds each denial of the classifier of auto mode in the transcripts of Claude
Code on the machine of the user. It makes one record for each denial. It keeps the records in a file outside any
session, `$HOME/Documents/tasker/denials/store.jsonl`. The reason: a transcript is a file of one session, and no session
reads all of them. The file holds the text of the assistant, so it stays on the machine of the user.

The script replaces each known form of a token, a key or a password with the mark `[redacted]`. It does this before it
writes a record. The script holds the list of the forms. The list is a guard, not a proof, because a token of another
form stays in the record. A form can also replace text that is no token.

The script makes a record only for a session that started in the local clone of this repo.

The script reads the transcripts in the form of Claude Code 2.1.318. It keeps the fields `serverClassifierContext` and
`serverClassifierRequest` out of each record, because they can hold the text that Claude Code sends to the classifier.
The script also says whether an allow rule matches each part of a denied call. That match is a guess of the script, not
the match of Claude Code.

A planner makes the records on the word of the user, with these steps:

1. In the local clone, run
   `node scripts/denial-records.ts scan --store $HOME/Documents/tasker/denials/store.jsonl --out /tmp/tasker/<slug>/denials`.
   The scan prints one line for each new record, a record that is not in the store file yet.
2. If the scan exits with an error, tell the user the output and stop.
3. If the scan lists no new record, tell the user so and stop.
4. Show the user the lines of the new records and the path of `/tmp/tasker/<slug>/denials/records.jsonl`. Also show the
   `store` command of step 5 with the id of each new record, and its undo step. A follow-up planner sends the question
   of step 4 to `orchestrator-<slug>` with these parts.
5. On the word of the user, run
   `node scripts/denial-records.ts store --store $HOME/Documents/tasker/denials/store.jsonl --out /tmp/tasker/<slug>/denials <id>...`,
   with the id of each new record that the user keeps. If the user keeps no record, run no `store`.
6. If `store` exits with an error, tell the user the output and stop.
7. Tell the user the output `<new> stored`. A follow-up planner sends it as a report to `orchestrator-<slug>`.

Before step 4, the planner runs `stat -c %s $HOME/Documents/tasker/denials/store.jsonl`. It also runs `test -d` on
`$HOME/Documents/tasker/denials`, `$HOME/Documents/tasker` and `$HOME/Documents`. It keeps the results. If the store
file exists, the undo step of the `store` is `truncate -s <size> $HOME/Documents/tasker/denials/store.jsonl`. If no
store file exists, the undo step is `rm $HOME/Documents/tasker/denials/store.jsonl`. Then the undo step runs `rmdir` on
each of the three folders that did not exist, the deepest folder first.

Before step 5, the user can change a line of `records.jsonl`. Then `store` keeps the changed line, after it replaces
each known form again. `<slug>` is the slug of the planner, as [docs/dev/GLOSSARY.md](GLOSSARY.md) defines it.

The store file is state of the user, as [The state of the user](plan-review.md#the-state-of-the-user) defines it. Only a
planner runs `store` on this file, and only the user approves step 5. So the question of step 4 is a question for the
user alone, as [The open items](operator-items.md#the-open-items) says. A task subagent, the orchestrator, a ticket
subagent and a review agent run no `store` on this file.

If the classifier denies `scan` or `store`, the planner runs that step in no other form and in no part. It tells the
user the exact command and the exact text of the denial, and a follow-up planner sends them to `orchestrator-<slug>`.
The planner gives the user no command with the `!` prefix for these steps.

An issue that uses the records says that its task subagent reads the store file. A record goes to no issue, no comment
and no doc. An issue, a comment or a doc gives only counts and conclusions from the records. A count or a conclusion can
name a list `form.kinds` or a write key. It names no write key of a record with `otherProject` `true`.

## The command rules

These rules apply to each `tasker` command that the task subagent runs, also to a read-only one. They add to the
plain-form rule and do not change it.

- Give the full issue key, for example `codeguru42/tasker#90`. A bare number such as `90` does not resolve to an issue.
  As a result, each `tasker` command that takes an issue key fails, also `tasker status --issue`.
  [Issue keys](../../skills/tasker/SKILL.md#issue-keys) gives the forms of a key, and
  [Shared errors](../../skills/tasker/SKILL.md#shared-errors) gives the error and its exit code.
- Never wrap a `tasker` command in `timeout`. At the end of the time, `timeout` sends SIGTERM, and tasker moves the task
  to `interrupted`.
- Run a long `tasker` command in the background. The long commands include `plan`, `refine`, `execute`, `verify`,
  `review` and `resume`. The task subagent sets the `run_in_background` option of its Bash tool. The call keeps the
  plain form.
- To wait for the end of a long command, wait for the report of the Bash tool that the background job of the command
  ended. Do not wait with a loop that reads the state in `tasker status`. Such a loop is not reliable. For example, a
  review run can end in `awaiting_work_review` or in `reviewed`, so a loop that waits while the state is `reviewing`
  cannot tell the end from the start. The Bash tool gives its report after a Bash call of the task subagent ends. While
  the task subagent waits, it runs a short wait in another Bash call, for example
  `timeout 100 bash -c 'while :; do sleep 15; done'`. This call always exits with 124. If no report came, the task
  subagent runs the same wait again. After the report, the task subagent reads the state with `tasker show <issue>`.
  When the orchestrator starts the task subagent again, the task subagent follows
  ["What the task subagent does"](quota.md#what-the-task-subagent-does) in ["Quota"](quota.md#quota).
- Do not wait for a process with `pgrep -f`.
- Start a `tasker` command that reads a feedback file only after the result of the last write of that file. A feedback
  file holds the feedback text of a `tasker` command in the form `"$(cat <absolute path of the file>)"` of
  [the plain-form rule](#the-plain-form-rule). Never send the write of the file and the command as parallel calls of one
  message. If the result of the write reports a problem in the text of the file, fix the file first. Then wait for the
  result of the write of the fix too.

  The session gets the results of the calls of one message only after it sends all of them. A hook of Claude Code is a
  command that Claude Code runs at an event of a session. The setup of a user can have such a hook that checks the text
  of each file that the Write tool writes. As a result, a report of such a hook can reach the session after the `tasker`
  command of the same message read the file.

- When the output of a read-only `tasker` command goes into a pipe, start the call with `set -o pipefail`. As a result,
  a failed `tasker` command stops the chain. To keep only some lines, use `sed -n`, for example `sed -n '1,20p'`, not
  `head`. With `pipefail`, `head` can make the pipe exit with 141 when tasker succeeded, because `head` stops reading
  early.
- The output of `tasker start` can say that it moved the card of the issue. If it does not say so, do not expect that
  move.

## The facts of the installed tasker

The installed tasker is a build of this repo, as [the intro of docs/orchestrator.md](../orchestrator.md) says.
`tasker --version` prints the version of the build. [The intro of docs/dev/release.md](release.md) gives the forms of
the version.

Each fact of this page that names the installed tasker, for example each fact of this section, describes a behavior of
the installed tasker. The fact is not a requirement for later work. If a ticket depends on such a fact, the task
subagent first does [the fact test](plan-review.md#the-fact-test) against the installed `tasker`. The reason, in the
words of the user: "We need to verify that the tasker behavior we are changing actually exists before trying to change
it."

The fact test can show that the installed tasker does not have the behavior. Then the fact is out of date. The task
subagent gives the fact, the command and the output in the feedback text and in the lessons of
[its final report](run-one-ticket.md#the-final-report). The lesson goes to the planner, and the planner files a ticket
for the fact. If an open issue already covers an out-of-date fact, the task subagent names that issue in place of the
lesson.

The task subagent cannot always measure such a behavior, for example when no task of its own is in the state that the
fact needs. Then the task subagent reports the fact as a fact that it cannot test, in the feedback text and in its final
report. A ticket that only records such a fact does no fact test, as the user decided for #366. Such a ticket depends on
no fact of the list. As a result, the rule that the task subagent first does the fact test does not apply to it.

- `tasker plan` can fail with "planning returned no structured output; the assistant produced no plan object". The task
  goes to `failed`. This failure does not come from the code. One `tasker retry <issue>` plans again.
- When the login of the Claude account expires during `tasker execute`, the execute session ends. `tasker execute` then
  fails with `executing todo '<todo>' ... failed: claude exited 1`. The task goes to `failed`, and the task branch is
  unchanged. This failure does not come from the code. After the user logs in to Claude again, `tasker retry <issue>`
  moves the task to `approved` and runs `tasker execute` again.
- `tasker start` can wait about 10 minutes on `git ls-remote` over ssh and then fail with a git transport error. If
  `tasker doctor` then passes, the task subagent runs `tasker start` again.
- `tasker update-branch` prints `origin/<branch> does not exist; nothing to sync from` for a task branch that was never
  pushed. This output is normal.
- `tasker dismiss-review` prints `dismissed findings <positions> of review <number> of <issue key>`. This output is
  normal.
- `tasker merge` prints `landed: <commit> on origin/main`. `tasker finish` prints that it marked the issue done on the
  tracker, and it closes the issue.
- `tasker start` can print a GraphQL warning that the assign of the issue on the tracker failed. The warning does no
  harm.
- `tasker start` refuses a ticket whose parent is not [ready to stack](pick-the-tickets.md#the-stacking-rule). It exits
  with 1 and prints `<parent issue key>: blocking issue is still open`. No task exists after the refusal.
- `tasker refine`, `tasker execute`, `tasker verify`, `tasker review` and `tasker accept` refuse a stacked task whose
  parent has landed. They print
  `the parent <parent key> of <issue key> has landed; run tasker update-branch <issue key> to move the task onto <base that the walk ends on> first`.
  The task keeps its state. `tasker merge` prints the same error, and it prints
  `the parent <parent key> of <issue key> has not landed; land the parent first, then run tasker update-branch <issue key>`
  while the parent is in flight (see [the stacked-task guards](workspaces.md#stacked-task)). `tasker update-branch`
  rebases only the commits of the task onto the base that the walk ends on.
- A stacked task in `awaiting_plan_review` loses its base when `tasker finish` of the parent deletes the branch of the
  parent. `tasker refine` then fails with exit code 1 and the landed error of the moved-base guard, and it changes
  nothing. `tasker update-branch` moves the task onto the base that the walk ends on, and the task stays in
  `awaiting_plan_review`. tasker marks the plan as stale, so a refine comes before `tasker approve`, also when the new
  base changes no fact of the plan.
- A task can fail in `executing` while its base is `main` and its task branch holds no commit of the task. For such a
  task, `tasker update-branch` moves the task branch by fast-forward. The approved plan of such a task stays approved,
  and the task stays in `failed`. After the update, `tasker show` prints `next: tasker retry`.
- `tasker update-branch <issue> --take-remote` of a stacked task whose parent landed moves the base of the task to the
  base that the walk ends on, for example `base: main`, and the task to `executed`, in one run.
- If a task is stacked on the same parent as another task, the shared-file warning of `tasker refine` and
  `tasker approve` for that task lists the files of the parent too. The warning reads the files that the branch of the
  other task changes against the base, and that branch holds the commits of the parent.
- `tasker update-branch` prints the command that undoes the update after each run that moved the head, also with
  `--strategy` or `--take-remote`. A run moved the head when its base step or its sync step moved it. The output gives
  `previous HEAD was <hash>`, and the command is `tasker update-branch <issue> --undo`.
- When the rebase of `tasker update-branch` stops with a conflict, the output names each conflicting path.
- After `tasker update-branch`, the bootstrap of the task does not run again. If the new base changes
  `package-lock.json`, `tasker verify` fails on the old `node_modules` of the worktree of tasker. The fix is a refine
  that tells the execute session to run `npm ci`. For
  [the verify-failure rule](verify-failures.md#the-verify-failure-rule), this failure comes from the code. The task
  subagent sends one refine whose feedback tells the execute session to run `npm ci`, and it runs no `tasker retry`. A
  commit check that finds no broken commit does not change this case.

## The run times

Since #833, an execute run of a plan with many todos can reach the deadline of `limits.executeTimeoutMin` before all
todos are done. This timeout is expected. The run fails with an error that ends with `timed out after <n> min`, and the
task goes to `failed`. A done todo stays done, as [Execute](tasks.md#execute) of `docs/dev/tasks.md` says.

If `tasker execute` fails with a timeout, run `tasker retry <issue>` one time for that run. Run it in the background, as
[the command rules](#the-command-rules) say for a long command. The retry runs `tasker execute` again with a new
deadline, and a done todo gets no turn. If the execute run of the retry also fails with a timeout,
[stop](limits.md#the-answer-wait-rule). Otherwise, run `tasker show <issue>` after the retry. Follow the commands that
it prints.

The user can raise `limits.executeTimeoutMin` in the configuration file of tasker. [`limits`](../config.md#limits) of
`docs/config.md` gives the default of 90 minutes.
