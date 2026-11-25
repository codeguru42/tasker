# Orchestrator

[The orchestration pages](orchestrator.md) give the rules for an orchestrator. The orchestrator is the assistant session
that runs one [scope](dev/GLOSSARY.md). It picks tickets and starts one task subagent for each ticket. It moves the
cards and sets the landing order.

A ticket is an issue on the project board. A task subagent, as [GLOSSARY.md](dev/GLOSSARY.md) defines it, runs the steps
of ["Run one ticket"](dev/run-one-ticket.md#run-one-ticket) for that ticket. A task subagent for one task change runs
only one `tasker` command of a task. The user is the person who works with the sessions, as
[GLOSSARY.md](dev/GLOSSARY.md) says. The user starts the orchestrator, as
[The start of an orchestrator](#the-start-of-an-orchestrator) says. The user can type in the session of the
orchestrator, but most words of the user reach it through its question pane. No one measured how a session queues a text
that arrives during a turn. The user answers a permission prompt in the tab of the orchestrator, as
[A blocked session](sessions.md#a-blocked-session) says. The orchestrator of the kind `claude` reads its own name and
its slug from the first line of the output of `ListAgents`, as [sessions.md](sessions.md) says. A pi orchestrator uses
the read of [sessions.md](sessions.md) that names `PI_SESSION_FILE`. A task is the record that tasker keeps for one
ticket. tasker moves the task from state to state, for example from `awaiting_plan_review` to `approved`.

Memory is the files where an assistant keeps notes between sessions. Memory is not in the repo. The files of the
[orchestrator folder](dev/limits.md#the-orchestrator-folder) are not memory. The docs define these files, and they hold
no rule, fact or preference that belongs in a doc of the repo.

The orchestrator asks the user each open question in its own question pane, as [question-pane.md](dev/question-pane.md)
says. It shows each progress report as text in its own tab, as [The operator](dev/working-with-the-user.md#the-operator)
says. It sends no item to an operator, and no answer of an operator ends a wait.
[The operator](dev/working-with-the-user.md#the-operator) of working-with-the-user.md says how "tell the user" or "ask
the user" reads. A report or a question to the user that a rule of the orchestration pages calls a reply follows the
same split: a progress report shows in the tab, and a question goes to the pane. When a rule waits for the user, the
answer of the question that the rule waits for ends the wait. The orchestrator gives each lesson, each finding of a
session review, each recurrence and each proposed issue to its planner. The planner bullet of
[The prompt of a task subagent](dev/pick-the-tickets.md#the-prompt-of-a-task-subagent) gives the steps. For an
orchestrator of the kind `claude`, the planner is a new [planner subagent](dev/planner-subagent.md) for each one. An
orchestrator sends a peer only the seven kinds of [The kinds of peer message](#the-kinds-of-peer-message).
[The request rule](#the-request-rule) gives the seventh kind, the request for a decision of the user that needs a peer
to act.

tasker also starts its own sessions for plan, execute and review. They run in a worktree of the tasker clone. They are
not task subagents and they do not run the steps on [the orchestration pages](orchestrator.md).

The orchestrator and its task subagents run tasker from the local clone of the orchestrator. For one ticket, the task
subagent of that ticket is the driver that [docs/dev/rebase-conflicts.md](dev/rebase-conflicts.md) names. The
orchestrator runs only read-only `tasker` commands itself, and a task subagent runs each command that changes a task, as
[the orchestrator-command rule](dev/tasker-commands.md#the-orchestrator-command-rule) says. The orchestrator looks up
the commands that it sends to each actor in [the allowed commands](dev/allowed-commands.md).

Every `tasker` command on [the orchestration pages](orchestrator.md) is the installed `tasker`: the `tasker` command on
the PATH from a global install. When
[the orchestrator-command rule](dev/tasker-commands.md#the-orchestrator-command-rule) lets it, the orchestrator runs
such a command. The installed `tasker` is a build of this repo, from a version that can be older than `main`. For this
reason, `skills/tasker/SKILL.md` does not list its commands (see
[The installed skill](dev/rules.md#the-installed-skill)). See the install bullet of [Limits](dev/limits.md#limits) in
`docs/dev/limits.md`. For the known behaviors of the installed `tasker`, see
[the facts of the installed tasker](dev/tasker-commands.md#the-facts-of-the-installed-tasker).

The start docs of the orchestrator are `docs/orchestrator.md`, the pages of the list "The pages" below,
[docs/dev/rules.md](dev/rules.md), [docs/dev/working-with-the-user.md](dev/working-with-the-user.md),
[docs/sessions.md](sessions.md), with its sections on the start of a session, the start gate of a pi session and a
blocked session, and [docs/dev/GLOSSARY.md](dev/GLOSSARY.md). At its start, the orchestrator makes a complete read of
each start doc before any other work, as [the doc-read rule](dev/doc-reads.md#the-doc-read-rule) says.

The orchestration pages are `docs/orchestrator.md` and the pages of this list, "The pages":

- [docs/dev/question-pane.md](dev/question-pane.md): "A question pane", "The question file" and "The pane handoff".
- [docs/dev/pick-the-tickets.md](dev/pick-the-tickets.md): "Pick the tickets", the stacking rule, the stacked-ticket
  rule, the parent-hold rule, the link offer, the open-question rule, the defer rule, "A ticket on hold", "The end of an
  orchestrator" and "The prompt of a task subagent".
- [docs/dev/doc-reads.md](dev/doc-reads.md): the re-read rule, the notice rule, the task subagent notice and the
  doc-read rule.
- [docs/dev/run-one-ticket.md](dev/run-one-ticket.md): "Run one ticket", the final report, the comeback rule, the base
  rule, the add-work rule, the diff read and the measure rule.
- [docs/dev/plan-review.md](dev/plan-review.md): the repo-files rule, the fact test, the issue check, the
  needed-doc-change rule, the stop rule, the change-of-scope comment, the design-gap rule and the quote check.
- [docs/dev/tasker-commands.md](dev/tasker-commands.md): the plain-form rule, the orchestrator-command rule, the
  tool-block rule, "A denied command of the operator", the command rules, the facts of the installed tasker and the run
  times.
- [docs/dev/milestone-close.md](dev/milestone-close.md): the shared parts of the close of a milestone and the
  own-session closure.
- [docs/dev/items.md](dev/items.md): the form of an item, the terms of its questions and the answer.
- [docs/dev/verify-failures.md](dev/verify-failures.md): the verify-failure rule, bisect diagnosis, the broken-commit
  steps, the session check, the manual fix and the commit check.
- [docs/dev/ci-wait.md](dev/ci-wait.md): the CI wait and "A failed CI run".
- [docs/dev/review-findings.md](dev/review-findings.md): "Review findings" and the docs-only update.
- [docs/dev/land-the-work.md](dev/land-the-work.md): "Land the work", the overlap rule, the Docs rule, the hold rule and
  the stuck-task rule.
- [docs/dev/quota.md](dev/quota.md): "Quota", "Terms", "The delay of each task subagent", "Schedule a job when a task
  subagent starts", the seven-day rule, "When there is no reset time yet", "When the job fires", "The next job", "What
  the task subagent does", "A pi stop", "The pi wait", "A Codex limit", "Delete the job" and "Do not use these".
- [docs/dev/handoff.md](dev/handoff.md): "The suggestion of a handoff", "The handoff file", "The items of a handoff
  file", "The last item id", "The check of the handoff folder", "The end of a handoff", "The stop and the start", "A
  topic handoff" and "The hold of the items".
- [docs/dev/handoff-orchestrator.md](dev/handoff-orchestrator.md): "The long-running orchestrator", "The landing count",
  "The steps of the old orchestrator", "The stopping-point case", "The handoff file of the orchestrator", "The task
  list" and "The start of the new orchestrator".
- [docs/dev/limits.md](dev/limits.md): "Limits", the own-worktree rule, "The orchestrator folder", the update rule, the
  local-commit rule, the shared-clone rule, the address rule, the answer-wait rule and the failure rule.
- [docs/dev/planner-subagent.md](dev/planner-subagent.md): "The kind of the orchestrator", "The planning requests", "The
  start", "The proposal file", "The prompt", "The result", "A settled question", "No metadata", "The kept rules", "The
  changed rules", "The dropped rules", "The issue subagents", "The life of a planner subagent" and "The chain of
  subagents".

## The start of an orchestrator

This section gives the scope, the slug, the start of an orchestrator and
[a stop with no handoff](#a-stop-with-no-handoff). [docs/dev/GLOSSARY.md](dev/GLOSSARY.md) defines the scope, the slug
and the own name.

### The scope

Each orchestrator works on one scope. A milestone scope is one milestone of the repo, and it holds the issues of that
milestone. A set scope is a set of issues that the first prompt names. The issues of a set scope can belong to any
milestone or to no milestone. The kind of the scope of an orchestrator does not change in its session, and no step of
the docs changes it.

The first prompt is the last argument of the start command of a session. The column "First prompt" of
[the seam of an agent kind](config.md#the-seam-of-an-agent-kind) gives this form.

Several orchestrators run at the same time, one for each scope. A milestone scope and a set scope can run at the same
time. No rule limits the count of orchestrators.

### The slug

The user gives the slug in the first prompt. The slug has only lowercase ASCII letters, digits and `-`. The slug of a
milestone scope is the first word of the milestone title in lowercase. The slug of a set scope is not the first word of
the title of an open milestone. The user starts no orchestrator with another slug, for example `M31` or `my scope`.

The own name of an orchestrator is `orchestrator-<slug>`. The role is the part before the first `-`, so a `-` in the
slug keeps the role. For example, `orchestrator-docs-fix` has the role `orchestrator` and the slug `docs-fix`. Each rule
of the docs that finds the orchestrator of a milestone uses the slug of that milestone.

No two orchestrators that run at the same time have the same slug. The reason: two sessions with one name break each
`SendMessage` to that name, as [Two sessions with one name](sessions.md#two-sessions-with-one-name) says. The kind `pi`
has no tool that lists sessions, as the column "Messages" of the seam gives it. So for a pi orchestrator, the user alone
keeps the slugs apart.

### The steps of the user

The user starts each orchestrator in these steps. They take the form of step 2 of
[The start of a session by the user](sessions.md#the-start-of-a-session-by-the-user).

1. Run `tasker show-config --repo <key>`. `<key>` is the repo key of the local clone, for example `codeguru42/tasker`.
2. If the command fails, start no orchestrator.
3. Read `sessions.kind` and the entry of `sessions.models.orchestrator` in the output.
4. Open a new herdr tab. The folder of the tab is the local clone.
5. In that tab, run the start command of the kind, with the own name and the first prompt.

For the kind `claude`, the start command is:

```sh
claude -n orchestrator-<slug> --model <model> --effort <effort> "<first prompt>"
```

For the kind `pi`, the start command is:

```sh
pi -n orchestrator-<slug> --provider <upstream> --model <model> --thinking <effort> "<first prompt>"
```

The row of the kind in [the seam of an agent kind](config.md#the-seam-of-an-agent-kind) gives each flag and the place of
the first prompt. If `sessions.models.orchestrator` has no entry, the user leaves out the model flags and the effort
flag. An example is `claude -n orchestrator-m31 "<first prompt>"`.

The user stops an orchestrator that the user starts. The user asks the orchestrator in its pane to run its rounds. The
user waits for the report of the rounds in the tab, and then closes the tab. If the user closes the tab with no rounds,
the open findings of the session are lost. [A stop with no handoff](#a-stop-with-no-handoff) says the same for a stop.
In a handoff, the old orchestrator closes its own tab, as
[The start of the new orchestrator](dev/handoff-orchestrator.md#the-start-of-the-new-orchestrator) says.

In a handoff, the old orchestrator starts the new orchestrator, as
[The start of the new orchestrator](dev/handoff-orchestrator.md#the-start-of-the-new-orchestrator) says.

### A stop with no handoff

A stop of an orchestrator is the end of its session with no handoff before its scope is done. Examples are a close of
its tab by the user and a crash of the session. The end of a session after its scope is done, for example at the close
of a milestone, is not a stop. A resume of the same session keeps its context, so it is not a stop. An example is a
resume at a `/rename`. A `/clear` is also not a stop of this subsection, and no doc gives what a `/clear` keeps.

An orchestrator runs until its milestone is complete or it drafts a handoff. So the docs expect no stop with no handoff,
except the close of a failed session that [the start checks](#the-start-checks) give.

The close of a failed session is a stop that the docs expect, because the way on asks for it. This applies to a failed
start check with a first prompt that names a handoff file. The next start with the prompt of the handoff file is a start
after a handoff. It is not a start outside a handoff, so the next paragraph does not apply to it. The new orchestrator
takes the open questions and the other state from the handoff file and the question files.

Suppose that the user starts a new orchestrator with the slug of a stopped orchestrator outside a handoff. The docs give
no steps for it, except for the files of its orchestrator folder. The new orchestrator runs
[the start checks](#the-start-checks) and then its role work, as for a first start.

The files of the stopped orchestrator stay in its [orchestrator folder](dev/limits.md#the-orchestrator-folder). At the
end of its start steps, the new orchestrator lists `questions/` and `proposals/`. If one of these folders holds a file,
the new orchestrator tells the user in its tab. It starts no pane and no planner subagent from those files until the
word of the user. The word of the user decides what the orchestrator does with the files.
[Terms](dev/question-pane.md#terms) gives the first free item id of such a start.

The new orchestrator does not rebuild the tasks in flight, the jobs or the peer messages of the stopped orchestrator.
The user deals with the result.

The user said this in a pane about #976: "This will never happen. An orchestrator runs until its milestone is complete
or it drafts a handoff. If the user attempts to start a new fresh orchestrator outside of this, then it is on them and
the user has to deal with the mess."

### The first prompt

The first prompt names the own name and the scope. It also names the branch check, step 1 and the start read of
`docs/dev/doc-reads.md`, `AGENTS.md` and `docs/orchestrator.md`, as
[the doc-read rule](dev/doc-reads.md#the-doc-read-rule) gives them. It also asks for a complete read of each start doc
before any other work.

The first prompt of a milestone scope has this form. `<milestone>` is the title of the milestone.

```text
You are orchestrator-<slug>. Your scope is the milestone <milestone>. Run git branch --show-current. If it does not print main, read nothing and tell me. If git status --porcelain --untracked-files=no prints nothing and you have the Read tool, run git pull --ff-only origin main. After a pull that worked, read docs/dev/doc-reads.md with the Read tool, in pieces to the end. Then read AGENTS.md and docs/orchestrator.md as its doc-read rule says. If status printed a line, the pull failed or was denied, or you have no Read tool, run git fetch origin. Then read docs/dev/doc-reads.md, AGENTS.md and docs/orchestrator.md with git show origin/main:<path>. Read each start doc in full before any other work. Then start.
```

The first prompt of a set scope has this form. Each `<key>` is an issue key in a form of
[docs/dev/issue-keys.md](dev/issue-keys.md).

```text
You are orchestrator-<slug>. Your scope is the issues <key>, <key> and <key>. Run git branch --show-current. If it does not print main, read nothing and tell me. If git status --porcelain --untracked-files=no prints nothing and you have the Read tool, run git pull --ff-only origin main. After a pull that worked, read docs/dev/doc-reads.md with the Read tool, in pieces to the end. Then read AGENTS.md and docs/orchestrator.md as its doc-read rule says. If status printed a line, the pull failed or was denied, or you have no Read tool, run git fetch origin. Then read docs/dev/doc-reads.md, AGENTS.md and docs/orchestrator.md with git show origin/main:<path>. Read each start doc in full before any other work. Then start.
```

For example, the first prompt for the milestone `M31 — Orchestrator` is:

```text
You are orchestrator-m31. Your scope is the milestone M31 — Orchestrator. Run git branch --show-current. If it does not print main, read nothing and tell me. If git status --porcelain --untracked-files=no prints nothing and you have the Read tool, run git pull --ff-only origin main. After a pull that worked, read docs/dev/doc-reads.md with the Read tool, in pieces to the end. Then read AGENTS.md and docs/orchestrator.md as its doc-read rule says. If status printed a line, the pull failed or was denied, or you have no Read tool, run git fetch origin. Then read docs/dev/doc-reads.md, AGENTS.md and docs/orchestrator.md with git show origin/main:<path>. Read each start doc in full before any other work. Then start.
```

An example of the scope part of a set scope is:

```text
Your scope is the issues codeguru42/tasker#756, codeguru42/tasker#522 and codeguru42/tasker#748.
```

### The start checks

After the complete start reads and before its role work, the orchestrator does these steps in order. If a step fails,
the orchestrator does no role work. It tells the user in its own tab, with the error if one exists.

1. Read your own name, as [docs/sessions.md](sessions.md) says.
2. For the kind `claude`, read the output of `ListAgents`. If the read fails, stop.
3. If any row of the output of `ListAgents` has your own name, stop. A second session with that name runs.
4. Make sure that the slug of your own name is the slug of the first prompt.
5. Make sure that the slug has only lowercase ASCII letters, digits and `-`.
6. Make sure that the first prompt names exactly one scope. A first prompt with no scope fails, and so does a first
   prompt with a milestone and a set.
7. Read the milestones with `gh api --paginate 'repos/codeguru42/tasker/milestones?state=all&per_page=100'`. If the read
   fails, stop.
8. For a milestone scope, make sure that the slug is the first word of the title of that milestone, in lowercase.
9. For a set scope, make sure that the slug is not the first word of the title of an open milestone, in lowercase.

In these steps, "stop" means: do no role work, and tell the user in your own tab. A pi orchestrator does not do steps 2
and 3. For a pi orchestrator, the user alone keeps the slugs apart.

After these steps, the orchestrator lists its folders `questions/` and `proposals/`, as
[The orchestrator folder](dev/limits.md#the-orchestrator-folder) says for the end of the start steps.

If the first prompt names a handoff file, a row of `ListAgents` with the own name can be the old orchestrator. Then the
orchestrator runs `herdr agent list` and reads each row whose `terminal_title_stripped` is the own name. Its own row is
the row whose `pane_id` is `HERDR_PANE_ID`. Each other such row must have the `tab_id` that the handoff file gives as
the tab id of the old orchestrator.

If each other row has that tab id, the orchestrator tells the user in its own tab that the old orchestrator still runs.
Then it goes on with step 4. If a row has another tab id, step 3 stops the orchestrator. If `HERDR_PANE_ID` is not set,
or the handoff file gives no tab id, step 3 stops it. If `herdr agent list` fails, step 3 stops it, and it tells the
user the command and the error.

The first line of the output of `ListAgents` names the own session, as [docs/sessions.md](sessions.md) says. The rows
after it name the other sessions. The task subagent of #961 measured steps 2 and 3 on 2026-11-19, with Claude Code
2.1.329 and herdr 0.9.3, in one herdr workspace. It ran
`claude -n test-dup-961 "Run ListAgents and print its output, then stop."` in two tabs with `herdr agent start`.
`claude -n` did not refuse the second start, and both sessions ran with different session refs.

Each session did not list itself in `ListAgents`. Each session listed the other session as a row with the name
`test-dup-961`. The facts hold only with herdr as the start tool.

The measure had four possible outcomes:

- `claude -n` refuses the second start: the user sees the error, and no second session runs. Step 3 stays.
- Both sessions start, and `ListAgents` lists both: step 3 stops the new orchestrator. This outcome happened.
- Both sessions start, and `ListAgents` lists only one: step 3 cannot see the second session. The user alone then keeps
  the slugs apart, as for pi.
- No measure: the user alone keeps the slugs apart, as for pi, and the docs say that no one measured the case.

Suppose that the first prompt names a handoff file, and a step of the start checks fails. The session after that step is
"the failed session". This holds for the kinds `claude` and `pi`, and it holds if the old orchestrator or the user
started the session. If the first prompt names no handoff file, the message stays as it is.

The failed session does no role work. It tells the user in its own tab, with the error if one exists. The message also
gives two more things:

- The path of the handoff file that the first prompt names.
- The way on: close this session, fix the cause of the failure, then start a new orchestrator with the prompt of the
  handoff file.

The user judges the cause and its fix. These docs give no list of causes or fixes. The message is a report of a failure.
It waits for no word of the user, and it gets no question pane. So the gate of
[The operator](dev/working-with-the-user.md#the-operator) does not apply. The failed session does not wait after the
message, and it does not run the start checks again.

The failed session does none of these steps:

- The check of the handoff folder of [The check of the handoff folder](dev/handoff.md#the-check-of-the-handoff-folder).
  A run of that check before the failed step stays valid.
- The read of the tasks in flight with `tasker status`.
- The read of the other sessions with `ListAgents` in the start after a handoff. Steps 2 and 3 of the start checks are
  not this read.
- The board watch job. [The board watch rule](#the-board-watch-job) gives the rule.
- The read of the record of the outside-Todo find, and the run of that find.
- The pick of a ticket.
- An open question of the handoff file, and each question pane.

The failed session changes or deletes no handoff file and no [question file](dev/question-pane.md#the-question-file).

The message gives the path and the way on for these reasons:

- The old orchestrator does not wait for the start checks of the new orchestrator, and it does not act on their result.
  See [The start of the new orchestrator](dev/handoff-orchestrator.md#the-start-of-the-new-orchestrator).
- The handoff file and the question files are the only source of the open questions and the other state of the old
  session.
- A new start with no handoff file loses that state, as [A stop with no handoff](#a-stop-with-no-handoff) says.
- The first prompt already names the path. The message gives it too, so that the message holds the whole way on in one
  place.

The way on asks for the close of the failed session for these reasons:

- For the kind `claude`, step 3 stops a new start while the failed session runs. The failed session has the own name,
  and its tab id is not the tab id of the old orchestrator in the handoff file. After the close, if no other session
  with the own name runs, step 3 of the new start finds no other row with the own name. So step 3 passes.
- The check of the handoff folder then picks the newest handoff file of the role. That is the same file, unless a newer
  file of the role exists.
- For the kind `pi`, the reason is in [The slug](#the-slug). No two orchestrators that run at the same time have the
  same slug, and the user alone keeps the slugs apart.

The way on adds no step for the new orchestrator. It does the start checks and the start after a handoff from the prompt
of the handoff file.

### The states of a start

| State                         | User                         | Orchestrator                                                                                                                            | Who tells whom                                 |
| ----------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| The read of the configuration | Runs `tasker show-config`    |                                                                                                                                         |                                                |
| The read fails                | Starts no orchestrator       |                                                                                                                                         | The command tells the user                     |
| The start                     | Runs the command of the kind | Runs step 1 and the start reads, and makes no board watch job                                                                           |                                                |
| A start check fails           |                              | Does no role work and makes no board watch job. With a handoff file in the first prompt, the message also gives the path and the way on | The orchestrator tells the user in its own tab |
| The start checks pass         |                              | Lists `questions/` and `proposals/`, makes the board watch job and starts its role work                                                 |                                                |

With a first prompt that names a handoff file, the message of a failed start check also gives the path and the way on of
[the start checks](#the-start-checks). These states follow that failed start check:

| State                 | User                                          | Failed session    | New orchestrator               | Who tells whom                                       |
| --------------------- | --------------------------------------------- | ----------------- | ------------------------------ | ---------------------------------------------------- |
| A start check fails   |                                               | Does no role work |                                | The failed session tells the user the message        |
| The close             | Closes the failed session, fixes the cause    | Ends              |                                | Nobody tells                                         |
| The new start         | Starts it with the prompt of the handoff file |                   | Does the start checks          |                                                      |
| The checks pass       |                                               |                   | Does the start after a handoff | As for each start after a handoff                    |
| The checks fail again |                                               |                   | Is a failed session            | The new orchestrator tells the user the same message |

## The board watch job

Each orchestrator reads the board with one recurring job, the board watch job, while no ticket of its scope waits for a
slot. [A ticket that waits for a slot](#a-ticket-that-waits-for-a-slot) gives the term and the delete of the job. The
rule covers an orchestrator of a numbered milestone, an orchestrator of a [set scope](#the-scope) and a
[long-running orchestrator](dev/handoff-orchestrator.md#the-long-running-orchestrator). For each kind of scope, a new
issue can arrive at a time with no running ticket of the scope. Then no landing comes, and no read of the board follows.
On 2026-10-25, orchestrator-docs read the board with a job at minute 7 and minute 37 of each hour.

The rule names no kind of session, so it covers each kind. No one measured a tool for a recurring job in a session of
the kind `pi`. If a pi orchestrator cannot make the job, the bullet "If CronList or CronCreate fails" of this section
applies.

While the orchestrator has the job, the job fires two times each hour. Each fire costs the tokens of one read of the
board. A pi orchestrator that cannot make the job gets a failure only at two kinds of read: a read of the board after
which no ticket waits for a slot, and a failed read of the board. [The failure rule](dev/limits.md#the-failure-rule)
then tells the user each time.

The description of the CronCreate tool of Claude Code 2.1.310 (read by planner-docs on 2026-10-25) gives these facts:

- A job lives only in its session.
- A job fires only while the session is idle.
- A recurring job expires after 7 days. It fires one last time, and then the tool deletes it. No one measured this
  expiry.
- CronCreate returns a job id that CronDelete takes.
- CronList lists the jobs of the session.

On 2026-11-21, orchestrator-m31 read the description of the CronCreate tool in its session. That description said that a
recurring job expires after 30 days. No one measured this expiry. On the same day, `claude --version` on the machine
printed `2.1.330 (Claude Code)`. A running session can have an older version, so the version of that read is not known.

The board watch rule has these parts:

- The orchestrator makes the board watch job only after all the steps of [the start checks](#the-start-checks) pass. The
  CronCreate of the job is role work. Until the start checks pass, the orchestrator makes no job. This holds before the
  start checks begin, while they run and after a failed step. After a failed step, the orchestrator does no role work
  and tells the user in its own tab, as the start checks say. Then no job exists, so no job fires later in the session
  and no CronDelete is necessary. A pi orchestrator does not do steps 2 and 3 of the start checks, so it makes the job
  after the other steps pass. The reason: a job can fire while the session is idle. Its prompt can start role work that
  a failed start check bans.
- On a start whose first prompt names no handoff file, the orchestrator makes the job after it lists `questions/` and
  `proposals/` at the end of the start steps, and before the pick of its first ticket. A new orchestrator after
  [a stop with no handoff](#a-stop-with-no-handoff) starts in this way. On a start after a handoff, it makes the job
  after `ListAgents`, as
  [The start of the new orchestrator](dev/handoff-orchestrator.md#the-start-of-the-new-orchestrator) says. The cron
  fires two times each hour, for example `7,37 * * * *`. Each read of the board after this make follows
  [A ticket that waits for a slot](#a-ticket-that-waits-for-a-slot). So the first read of the board can delete the job.
- The prompt of the job starts with "Board watch:". The rest of the prompt says: read the board, as
  [Pick the tickets](dev/pick-the-tickets.md#pick-the-tickets) says.
- When the job fires, the orchestrator reads the board as the prompt says. It starts each ticket that the rules of Pick
  the tickets allow. It reads the issue of a ticket only right before its start, as
  [the open-question rule](dev/pick-the-tickets.md#the-open-question-rule) says. The job changes none of these rules.
- A read by the job is a read of the board that does not come at a landing. The general rule of the bullet "Each time a
  ticket lands, read the board again" of [Pick the tickets](dev/pick-the-tickets.md#pick-the-tickets) applies to it. A
  read by the job can also come during the close of a milestone. Then it follows the same rules as a read of the board
  on a message of another session.
- Each rule that stops a start wins over the job. Examples are the ban of
  [A failed CI run](dev/ci-wait.md#a-failed-ci-run), a hold of the user and step 1 of
  [The steps of the old orchestrator](dev/handoff-orchestrator.md#the-steps-of-the-old-orchestrator). Another example is
  the ban on a new ticket after the suggestion of a handoff in
  [The landing count](dev/handoff-orchestrator.md#the-landing-count). Other examples are the hold before an install in
  [The hold before an install](dev/release.md#the-hold-before-an-install) and the pi gate. While such a rule holds, the
  job still fires, and it starts no ticket. A ticket that such a rule holds back does not wait for a slot. So while such
  a rule holds back each ticket, the job stays, as [A ticket that waits for a slot](#a-ticket-that-waits-for-a-slot)
  says. A failed start check is not such a rule, because no job exists after it, as the first bullet says.
- The orchestrator has at most one board watch job. It keeps the id of the job and the time of its CronCreate. Before it
  makes the job, it lists its jobs with CronList. CronList also comes before each CronDelete of
  [A ticket that waits for a slot](#a-ticket-that-waits-for-a-slot). If the list holds the kept id, it makes no second
  job. A quota job has another id, so it is not a board watch job.
- The id and the time live from the CronCreate of the job until the orchestrator deletes the job with a CronDelete that
  works, or until the job ends and a CronList shows the end. An example of such an end is the expiry of the job. After a
  failed CronDelete, the id and the time stay. Before the first CronCreate, the orchestrator keeps no id and no time.
  When the list of CronList does not hold the kept id, the job ended, and the orchestrator drops the id and the time.
- If CronList or CronCreate fails, [the failure rule](dev/limits.md#the-failure-rule) applies, and the orchestrator has
  no board watch job. At each later read of the board after which no ticket waits, and at each failed read of the board,
  it tries again, CronList and then CronCreate, until it has a board watch job. The read of the board after a landing is
  one such read when no ticket waits after it, as the bullet "Each time a ticket lands, read the board again" of
  [Pick the tickets](dev/pick-the-tickets.md#pick-the-tickets) says. With no board watch job, it reads the board at the
  other moments that the docs give, for example after each landing.
- If the orchestrator keeps an id and the kept time is 6 days or more old, the renewal runs at a read after which no
  ticket waits and at a failed read of the board. It runs CronList. If the list does not hold the id, the orchestrator
  drops the id and the time, and then it runs CronCreate with no second CronList. If the list holds the id, it runs
  CronDelete. After a CronDelete that works, it drops the id and the time. Then it makes a new job, with CronList first.
  If CronList or CronDelete fails, the failure rule applies. The id and the time stay, and the next read at which the
  renewal runs tries again. If the job still lives, its fire is such a read. If CronList or CronCreate of the new make
  fails, it is the make case with no kept id. The reason: after a failed CronDelete, the orchestrator cannot know
  whether the job lives. A renewal only at a fire can then never run. The renewal comes before the expiry under each of
  the two figures, 7 days and 30 days. Under 30 days, the cost is one extra CronDelete and CronCreate each 6 days. At a
  fire 6 days or more after the kept time with a ticket that waits for a slot, the orchestrator deletes the job and
  makes no new job. The handoff bullet wins over the renewal.
- At the start of a handoff, as [The suggestion of a handoff](dev/handoff.md#the-suggestion-of-a-handoff) says, the
  orchestrator deletes the job with CronDelete, before step 1 of The steps of the old orchestrator. If CronDelete fails,
  the failure rule applies. While the steps of the old orchestrator hold, the orchestrator makes no board watch job at
  any read of the board, also in a renewal. The reason: step 1 holds back each ticket, so no ticket waits, and the make
  of [A ticket that waits for a slot](#a-ticket-that-waits-for-a-slot) makes a new job. When the steps of the old
  orchestrator no longer hold, that subsection applies again from the next read of the board. An example: during the
  close of a milestone, the user ends a handoff that started, as
  [The suggestion of a handoff](dev/handoff.md#the-suggestion-of-a-handoff) says. The new orchestrator makes its own job
  at its make point, as the make bullet says. A session that ends with no handoff loses the job with the session. So the
  job keeps firing during the wait of [The end of an orchestrator](dev/pick-the-tickets.md#the-end-of-an-orchestrator),
  and the own close of the orchestrator ends it. In that wait the scope has no live task, so each slot is free and no
  ticket waits for a slot.
- The board watch job is not a job of [Quota](dev/quota.md#quota). [Delete the job](dev/quota.md#delete-the-job) does
  not cover it. The step "delete the jobs" of step 2 of The steps of the old orchestrator does not cover it either. The
  job takes no slot.

### A ticket that waits for a slot

These two facts make a ticket that waits for a slot:

- It is a ticket that can start, as the fill rule of [Pick the tickets](dev/pick-the-tickets.md#pick-the-tickets)
  defines it. That is each fact of "A ticket that can start now" of
  [the open-question rule](dev/pick-the-tickets.md#the-open-question-rule) except the slot fact.
- No slot is free, and the orchestrator keeps no slot for it.

For this term, the slot fact of [the stacking rule](dev/pick-the-tickets.md#the-stacking-rule) does not count. The check
of the tip of the base of the parent does not count either, because that check runs only before a start. The other wait
cases of the stacking rule and the wait for a fix round of the parent still hold the ticket back.

The judgment uses only the facts after the read of the board. These are the board, the kept results of a read, the
states of the stacking rule and the states of the session, for example a hold of the user and the CI ban. A ticket that
a rule holds back with these facts alone does not wait. This covers the rules of the third fact of "A ticket that can
start now" and each rule that stops a start. Examples are the pi gate, the CI ban, a hold of the user, the hold before
an install (see [The hold before an install](dev/release.md#the-hold-before-an-install)), a ticket on hold, the ban
after the suggestion of a handoff, step 1 of the steps of the old orchestrator and the stacking rule. A ticket that a
kept result of a read stops does not wait either, because the second fact leaves it out of the order.

Some rules need the text of the issue: the bullet of a manual-steps issue, the shared-file bullet, the move rule and the
link offer. They do not count before the read of the issue. Such a ticket can count as a ticket that waits. This is no
fault. The next event that frees a slot reads the board, and the read of the issue then decides.

After each read of the board, the orchestrator first does the starts of the fill rule. Then it judges whether a ticket
of its scope waits for a slot. The judgment follows each one of these reads:

- The read at the start
- The read at a landing
- The read at a fire of the job
- The read on a message of another session
- The read after a defer
- The read after the end of a parent hold
- The read after a stop of a task subagent whose slot it frees

If a ticket waits and the orchestrator keeps an id, it runs CronList. If the list does not hold the id, the job ended,
and the orchestrator drops the id and the time. Otherwise it runs CronDelete with the kept id. After a CronDelete that
works, it drops the id and the time. If a ticket waits and the orchestrator keeps no id, it does nothing with the job.
After the judgment "a ticket waits", no CronCreate runs.

If no ticket waits, the orchestrator keeps its job. If it keeps no id, it makes a job, with CronList first and then
CronCreate. If the kept time is 6 days or more old, the renewal bullet above applies. The handoff bullet wins: while the
steps of the old orchestrator hold, no job comes.

While a slot is free, no ticket waits. While the rules of the term hold back each ticket that the other facts let start,
no ticket waits either. Then the job stays, fires and starts no ticket.

A failed read gives no answer, so it never passes as "a ticket waits" or "no ticket waits". Suppose the read of the
board fails. Suppose another read of the judgment fails, for example the read of the `on hold` list or of the states of
the stacking rule. Then the orchestrator makes no judgment and deletes no job. If it keeps no id, it makes a job, with
CronList first. If the kept time is 6 days or more old, the renewal runs. These are the cron failure cases:

- A failed CronList or CronDelete after "a ticket waits": the failure rule applies, the id and the time stay, and the
  orchestrator tries again at each later read after which a ticket waits.
- A failed CronList or CronCreate at a make with no id: the orchestrator has no job. It tries again at each later read
  after which no ticket waits and at each failed read of the board.
- A failure at a renewal: the renewal bullet gives the path.

A job that a failed CronDelete leaves still fires. Its fire is a read of the board as usual.

The reason is a rule of the user. On 2026-11-22, the user said: "If there are open tickets waiting for a slot there is
no reason for a board watch". While a ticket waits, each slot is in use or kept. The fill rule reads the board after
each event that frees a slot. A new issue that arrives with no landing cannot start before a slot frees, and that event
reads the board. A ticket can stop its wait with no read, for example when the user puts it on hold. Then no job comes
until the next read. No start is lost, because each slot stays in use or kept until an event that reads the board.

While a ticket waits, a rule that acts "at the next read of the board" or "each time it reads the board" acts at the
next read, not at the next fire. Examples in `docs/dev/pick-the-tickets.md` are the notice of a moved held issue of a
set scope, the first offer and the new try of the earlier-blocker offer and of the outside-blocker offer, the
outside-Todo find after a failed find, and the check of a kept result of the open-question rule. The list is open on
purpose. Each change between "a ticket waits" and "no ticket waits" costs a CronList and a CronDelete or a CronCreate.

The states of the job:

| State of the id                       | Read with a ticket that waits | Read with no ticket that waits | Failed read of the board or of another read of the judgment |
| ------------------------------------- | ----------------------------- | ------------------------------ | ----------------------------------------------------------- |
| No job, no id kept                    | Nothing                       | CronList, then CronCreate      | CronList, then CronCreate                                   |
| Id kept, kept time under 6 days old   | CronList, then CronDelete     | Keep the job                   | Keep the job                                                |
| Id kept, kept time 6 days or more old | CronList, then CronDelete     | The renewal bullet             | The renewal bullet                                          |

A job can end with no CronDelete, for example by the expiry. The orchestrator learns of the end only from a CronList, at
the delete of this subsection or at the renewal bullet. Then it drops the id and the time. After a read with a ticket
that waits, it makes no job. At a renewal whose CronList does not hold the kept id, it makes a new job with CronCreate,
with no second CronList. After a CronDelete that works, the new make runs CronList first, as the renewal bullet says. No
row makes a job during the steps of the old orchestrator.

## Peer messages

A peer of an orchestrator is each other orchestrator: each session whose name starts with `orchestrator-`, except the
own session, as step 3 of [the notice rule](dev/doc-reads.md#the-notice-rule) lists them. A peer message is a message
with `SendMessage` from an orchestrator to a peer. The orchestrator of a task is the orchestrator whose task subagent
runs the task. The asking orchestrator is the orchestrator whose work needs a decision of the user.

This section covers only peer messages. The messages of an orchestrator to its task subagents, to a planner and to a
question session keep their own rules.

### The kinds of peer message

An orchestrator sends a peer only these seven kinds of message:

1. The doc notice of [the notice rule](dev/doc-reads.md#the-notice-rule): the notice of a landing.
2. The broken-test notice of [A failed CI run](dev/ci-wait.md#a-failed-ci-run): the notice with the number of the
   broken-test issue.
3. The hold of [the hold rule](dev/land-the-work.md#the-hold-rule): the request for reports, and each report of a state
   or of a close. [The stacked-ticket rule](dev/pick-the-tickets.md#the-stacked-ticket-rule) uses them.
4. The landing order of [the overlap rule](dev/land-the-work.md#the-overlap-rule): the landing order, the relay of a
   change, the answer that accepts or rejects the change, and the notice of a postpone. The bullet "Only the user
   changes a landing order of the overlap rule" of [Land the work](dev/land-the-work.md#land-the-work) gives the relay.
5. The change to an issue in flight of [Land the work](dev/land-the-work.md#land-the-work): the link of the comment, and
   the answer that no step takes the correction.
6. The install hold of [the hold before an install](dev/release.md#the-hold-before-an-install): the request of the hold,
   each report of the state of the tasks, a "no" of the user and the end of the hold.
7. The request of [the request rule](#the-request-rule): the request, and the answer with the decision of the user. The
   end of a milestone hold of a held peer, in item 9 of
   [A milestone hold](dev/working-with-the-user.md#a-milestone-hold), is such a request.

Each kind keeps the rules of its page, except the find of the orchestrator of a task and the relay of a landing order.
An orchestrator sends no other message to a peer. The request rule is the only way for a decision of the user to make a
peer act.

### The orchestrator of a task

The rules that send a peer message about one task use this find: the hold rule, the stacked-ticket rule, the landing
order of the overlap rule, the requester bullet of [Land the work](dev/land-the-work.md#land-the-work) and
[the request rule](#the-request-rule).

1. The sender reads the milestone of the issue with `gh issue view <number> --json milestone -q '.milestone.title'`.
2. The slug is the first word of that title in lowercase, as [The slug](#the-slug) gives it for a milestone scope. For
   example, the title "M31 - Orchestrator" gives the slug `m31`.
3. The target is `orchestrator-<slug>`.
4. If the slug is the own slug, the task is of the own milestone, and no peer message goes out.

The find fails in three cases. The read of the milestone fails, the issue has no milestone, or `ListAgents` shows no
running session of that name. After a failed find, [the failure rule](dev/limits.md#the-failure-rule) applies. The
sender sends no message of that rule for that task, and it tells the user. Each answer and each report goes back to the
session of the sender.

The find has these costs:

- The sender cannot tell that a set scope runs the task. An orchestrator of a set scope gets no hold, no landing order
  and no change to an issue in flight from a peer.
- A wrong target is possible. A set-scope orchestrator can run the task while `orchestrator-<slug>` of the milestone
  also runs. The message then reaches an orchestrator that does not run the task, and that orchestrator can act on it.
- A task of the own milestone that another orchestrator runs keeps the case "no rule finds which one".
- The words of the user decide neither a set scope nor an issue with no milestone, so the docs give no other rule for
  them.

### A message outside the kinds

An orchestrator acts on no message of a peer outside the seven kinds. It runs no step and sends no answer. It tells the
user the name of the sender and the first line of the message. The reason for no answer: an answer is itself a message
outside the kinds.

This rule covers a peer that runs older rules. It also covers a note for later from a peer, as
[A note for later](dev/working-with-the-user.md#a-note-for-later) defines it. The docs give no other form of a peer
message.

### The reasons of the peer messages

- One short list says what an orchestrator can send to a peer.
- Each decision of the user goes to the question pane of the orchestrator that needs it.
- A message from another session is not a word of the user, as [The operator](dev/working-with-the-user.md#the-operator)
  says.
- The cost of the seventh kind: the user answers one decision in two panes, and the request waits in the queue of the
  pane of the peer.

## The request rule

The request of this rule is the seventh kind of [The kinds of peer message](#the-kinds-of-peer-message). It is the one
exception to the rule that an orchestrator sends no other message to a peer.

The terms of this rule:

- The sending orchestrator is the orchestrator that sends a request to another orchestrator.
- The receiving orchestrator is the orchestrator that gets the request.
- The requested change is the action that the request asks the receiving orchestrator to do.

The rules:

- The messages of the first six kinds of [The kinds of peer message](#the-kinds-of-peer-message) still go straight from
  orchestrator to orchestrator. Each one keeps its own rules. The hold before an install of tasker, in
  [the hold before an install](dev/release.md#the-hold-before-an-install), is one of these kinds.
- Each other request that needs a decision of the user goes through the question pane of the receiving orchestrator.
  There are three examples. The first is "our user wants X" for a ticket of a peer. The second is a `tasker` command for
  a task of a peer in a settled decision message. The third is the end of a milestone hold of a held peer, as item 9 of
  [A milestone hold](dev/working-with-the-user.md#a-milestone-hold) says. The sending orchestrator judges whether a
  request needs a decision of the user. This judgment is open on purpose.
- Before it sends the request, the sending orchestrator asks its own user in its own question pane, as
  [Start](dev/question-pane.md#start) says. Before that decision, it sends no request to a peer.
- After an accept of its own user, the sending orchestrator sends the request with `SendMessage`. The target is the
  orchestrator of the task, found as [The orchestrator of a task](#the-orchestrator-of-a-task) says. For the end of a
  milestone hold, the target is the held orchestrator. The sending orchestrator sends no request of a peer to an
  operator as an item. If item 4 of [A milestone hold](dev/working-with-the-user.md#a-milestone-hold) holds the request
  back, the request goes to the user by the third bullet of item 6, and the sending orchestrator does not send it to the
  held orchestrator.
- The receiving orchestrator does not do the requested change. It asks the decision of the user in its own question
  pane, as [Start](dev/question-pane.md#start) says. The decision in the pane is the decision of the user. The
  recommendation mode of [A decision of the user](dev/working-with-the-user.md#a-decision-of-the-user) does not cover
  this question.
- After the answer, the receiving orchestrator does the requested change only if the user accepts it. Then it tells the
  sending orchestrator the decision of the user with `SendMessage`. The sending orchestrator does its own step that
  matches the request, if it has one, only after an accept. An example of such a step is a message to its own task
  subagent.
- A message of this rule fails when the send fails, when the find of the orchestrator of the task fails, or when no
  session of the target name runs. Then [the failure rule](dev/limits.md#the-failure-rule) applies to the orchestrator
  that sends it.
- When the sending orchestrator sends a request that needs a decision of the user, it also shows one report for that
  request as text in its own tab. The same holds for each relayed change of a landing order under the bullet "Only the
  user changes a landing order of the overlap rule" of [Land the work](dev/land-the-work.md#land-the-work).

This table gives each change of a request of this rule:

| Change                | Sending orchestrator                                       | Receiving orchestrator                                     | Question pane                                                | Who tells whom                                                                |
| --------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| The request goes out  | Waits for the decision. Shows its report in its tab        | Does not do the requested change                           |                                                              | The sending orchestrator tells the receiving orchestrator and its own user    |
| The question goes out | Waits for the decision                                     | Waits for the answer                                       | The receiving orchestrator asks the question in its own pane | The receiving orchestrator tells its own user                                 |
| The user accepts      | Waits for the decision                                     | Does the requested change                                  | The pane closes by its rules                                 | The user tells the receiving orchestrator in the pane                         |
| The user rejects      | Waits for the decision                                     | Changes nothing                                            | The pane closes by its rules                                 | The user tells the receiving orchestrator in the pane                         |
| The decision goes out | Does its matching step only after an accept                |                                                            |                                                              | The receiving orchestrator tells the sending orchestrator, with `SendMessage` |
| A message fails       | The failure rule applies to the orchestrator that sends it | The failure rule applies to the orchestrator that sends it |                                                              | The orchestrator that sends it tells its own user                             |

The reasons for this rule:

- The notices and the hold before an install need no decision of the user, and they need speed.
- A message from another session is not a word of the user, as [The operator](dev/working-with-the-user.md#the-operator)
  says.
- The relay sentences of a landing order show their report in the tab of the orchestrator and ask the user in a pane.
- A change to an issue in flight keeps its own bullet, because the requester of that bullet asks its own user before the
  [change-of-scope comment](dev/plan-review.md#the-change-of-scope-comment).
