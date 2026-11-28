# Handoff

The readers of this page are a long-running orchestrator and the session of [a topic handoff](#a-topic-handoff), which
can be a session of any role. The role page of the orchestrator is
[The orchestrator](orchestrator/handoff-orchestrator.md).

## The suggestion of a handoff

A suggestion of a handoff of an orchestrator is a question in the pane of the orchestrator, as
[Start](question-pane.md#start) says. An orchestrator asks it in its own pane. The go of the user comes in the decision
message of the go question. The orchestrator accepts the decision message with the go of the user and sends the ack.
Then the rounds before the close run, and the pane closes, as [Close and continue](question-pane.md#close-and-continue)
says. Then the wait of step 2 of the steps of the old orchestrator runs, and the handoff starts after it. The user can
also ask the old session for a handoff at any time. A request of the user for a handoff needs no go question, and no
pane holds it.

For an orchestrator, the go is the word of the user that starts a handoff: the go in the decision message of the go
question, or a request of the user for a handoff. Step 1 of the steps of the old orchestrator holds from the go, also
during the rounds before the close of the go pane. The handoff starts after step 2, as
[The wait before the start](orchestrator/handoff-orchestrator.md#the-wait-before-the-start) says.

After the go, the old orchestrator does
[the steps of the old orchestrator](orchestrator/handoff-orchestrator.md#the-steps-of-the-old-orchestrator). These steps
hold the finish of its current tasks, or their stopping point in
[the stopping-point case](orchestrator/handoff-orchestrator.md#the-stopping-point-case). Then the stop and the start of
[The stop and the start](#the-stop-and-the-start) follow.

The old session can suggest a handoff to the user. The old session counts the events that its role page names:
[the landing count of the orchestrator](orchestrator/handoff-orchestrator.md#the-landing-count). Each role page gives
the count at which the old session suggests a handoff, the count of a suggestion. The role page says in which reply or
at which event.

The reason: the old session does not see its own status line, and no rule tells it to read its context use. The count of
the role page stands in for that read.

In the setup of the user, the status line of each session shows its context use, for example `ctx:32%`. Another session
can read the status line with `herdr pane read <pane id>` (herdr 0.9.3, Claude Code 2.1.310, 2026-10-25).

On 2026-10-16, the Docs orchestrator guessed that about 20% of its context was used and started a handoff. The session
used 6%.

The count starts at 0 at the start of the session. The count lives until the session ends.

In each list of open questions that the old session gives the user, the old session also gives a handoff recommendation.
[The form of a reply](working-with-the-user.md#the-form-of-a-reply) gives the form of these lists. The recommendation
says "hand off now" or "not yet", with its reason. The reason gives the count of the session and the count of a
suggestion of the role page of the session. The count of the session is
[the landing count](orchestrator/handoff-orchestrator.md#the-landing-count) of the orchestrator. For an orchestrator, a
list of open questions that it shows in its own tab is a progress report of
[Reports and questions of a session](working-with-the-user.md#reports-and-questions-of-a-session), and it carries no
handoff recommendation. The go question in its question pane carries the recommendation, as
[the landing count](orchestrator/handoff-orchestrator.md#the-landing-count) says.

When the count of the session reaches the count of a suggestion, the recommendation is "hand off now", also in an answer
to [a question of the user](working-with-the-user.md#a-question-of-the-user). For an orchestrator, the recommendation
"hand off now" is the go question in its question pane, at the event that brings the count to the count of a suggestion,
as [the landing count](orchestrator/handoff-orchestrator.md#the-landing-count) says. No progress report of an
orchestrator carries a handoff recommendation, also not an answer to a question of the user. A recommendation "hand off
now" is a suggestion of a handoff, and the handoff then starts as
[The suggestion of a handoff](#the-suggestion-of-a-handoff) says.

On 2026-10-24, the user asked planner-docs to keep a handoff recommendation in each list of open questions.

If the user says that no more handoffs come, each session of the slug suggests no handoff. This rule lasts until the
session ends or the user says otherwise. It wins over each rule that makes a session suggest a handoff. Each
recommendation of a handoff is then "not yet", and its reason is the words of the user. A request of the user for a
handoff still works, and a handoff that already started goes on.

From the start of the close of a milestone, each session of its slug suggests no handoff, starts no handoff and writes
no handoff file. The reason: the session stops soon after the close, so a handoff file only costs tokens.

[The start and the authority](orchestrator/milestone-close.md#the-start-and-the-authority) gives the start for each
session. For the orchestrator, it is the report of the orchestrator that the close started. The rule lasts until the
session ends.

For the orchestrator, the report that the close started comes only after end reads that find no open issue.
[The end of an orchestrator](orchestrator/pick-the-tickets.md#the-end-of-an-orchestrator) gives this rule. A wait or a
return to work before that report keeps each handoff rule of the orchestrator. An orchestrator of a set scope sends no
such report, so its handoff rules hold until its own close.

This rule wins over each rule that makes a session suggest or start a handoff. Each recommendation of a handoff is then
"not yet", and its reason is the close. If the user asks for a handoff during the close, the session tells the user that
the close holds the handoffs. It starts the handoff only on a new word of the user.

If a handoff already started, the session tells the user, also when it already sent the path of its handoff file. The
word of the user then decides whether the handoff goes on. If it goes on, the handoff goes on as its steps say. If it
ends, the steps of the old session of the handoff no longer hold.

## The handoff file

The old session writes the handoff file `$HOME/Documents/tasker/handoff/<date>-<time>-<role>.md`, for example
`2026-10-17-1505-docs-orchestrator.md`. The time is the local time of the machine, to the minute. The command
`date +%Y-%m-%d-%H%M` prints the date and the time. Take the date and the time when you write the file, not at the start
of the handoff.

This folder is the shared handoff folder. An orchestrator writes its handoff file in its own handoff folder, `handoffs/`
of its [orchestrator folder](limits.md#the-orchestrator-folder), with the same name form. An example is
`2026-11-22-1505-m31-orchestrator.md`. Each other role and each [topic handoff](#a-topic-handoff) use the shared handoff
folder. No file of the shared handoff folder moves.

## The items of a handoff file

The handoff file holds only the parts of this list and the parts of the role page. It holds no other part, for example a
history of the session, the closed questions or the measured facts. The task list of the orchestrator is the one
exception to the measured facts, because its entries give the facts of the stopping-point reports, as
[The task list](orchestrator/handoff-orchestrator.md#the-task-list) says. The rule is the list, not these examples:

- The prompt for the new session, in a code block.
  - The prompt names the section of the role page for its start, for example
    [The start of the new orchestrator](orchestrator/handoff-orchestrator.md#the-start-of-the-new-orchestrator). It does
    not copy the steps of that section.
  - Under `pi`, the name comes from `-n` and the session reads it before its role work, so the prompt holds no name
    step.
  - The prompt holds only the facts of this handoff, for example the path of the file, the session name and the first
    free item id. The first message of the new session always names the path of the handoff file.
  - The first step of the prompt is the prompt read, in these words:
    `Run git branch --show-current. If it does not print main, read nothing and tell me. If git status --porcelain --untracked-files=no prints nothing and you have the Read tool, run git pull --ff-only origin main. After a pull that worked, read docs/dev/doc-reads.md with the Read tool, in pieces to the end. Then read AGENTS.md and <role index> as its doc-read rule says. If status printed a line, the pull failed or was denied, or you have no Read tool, run git fetch origin. Then read docs/dev/doc-reads.md, AGENTS.md and <role index> with git show origin/main:<path>.`
    The old session puts the role index of the new session in place of `<role index>`, for example `docs/planner.md`.
    This sub-bullet wins over the sentences "The prompt holds only the facts of this handoff" and "The old session puts
    no rule in the handoff file." [The doc-read rule](doc-reads.md#the-doc-read-rule) gives the reason.
  - For an orchestrator, the prompt is the filled template
    [`prompt-templates/handoff/orchestrator.md`](../../prompt-templates/handoff/orchestrator.md), as
    [The handoff file of the orchestrator](orchestrator/handoff-orchestrator.md#the-handoff-file-of-the-orchestrator)
    says. The template holds the prompt read with `docs/orchestrator.md` as the role index.
- Each open question with its id, as [The form of a message](items.md#the-form-of-a-message) gives the id.
- Each question to the user that has no answer yet, with its full text and its choices, as
  [A decision of the user](working-with-the-user.md#a-decision-of-the-user) says. For an orchestrator, this bullet
  covers only a question with no question file, as
  [The handoff file of the orchestrator](orchestrator/handoff-orchestrator.md#the-handoff-file-of-the-orchestrator)
  says. A link to a pane handoff file stands next to the id of its open question, as that section says.
- Each note for later that a message carried and that the session still keeps, with its trigger, as
  [A note for later](working-with-the-user.md#a-note-for-later) says.
- Each decision of the user that still applies and that no doc and no open issue holds. This covers the old session and
  the earlier handoff file of the role. As a result, such a decision survives more than one handoff. A decision that an
  entry of [The open peer requests](orchestrator/handoff-orchestrator.md#the-open-peer-requests) gives stands only in
  that entry, so the file holds no second record of it.
- For a decision that an open issue holds, the file gives only the number of that issue. After the issue lands, the
  decision leaves the next handoff file. The bullet of a relayed decision in
  [A decision of the user](working-with-the-user.md#a-decision-of-the-user) uses the decisions of this entry and of the
  entry before it.

The reason: the old session puts the full text of each open question in the file, because the new session has no other
source for it. For an orchestrator, this reason does not hold for a question with a
[question file](question-pane.md#the-question-file), because the new orchestrator reads that file.

The old session puts no rule in the handoff file. The rules stay in the docs, and the prompt points to them.

An old orchestrator of the kind `claude` starts a [planner subagent](planner-subagent.md) for each measured fact and
each lesson. Each one is one [item of planning work](planner-subagent.md#the-start), with its own proposal file. After a
failed start of any one of these planner subagents, an old orchestrator asks the user, as the planner bullet of
[The prompt of a task subagent](orchestrator/pick-the-tickets.md#the-prompt-of-a-task-subagent) says. The old
orchestrator waits for the result of each one, as
[The wait before a handoff](planner-subagent.md#the-wait-before-a-handoff) says. A fact or a lesson that reaches the old
orchestrator after the send becomes a planning request, and its items of planning work wait, as
[The reports during the handoff](orchestrator/handoff-orchestrator.md#the-reports-during-the-handoff) says.

The handoff file names each session other than the new session by its name, also in the prompt. It gives no
[session ref and no socket address](GLOSSARY.md) of such a session. `ListAgents` gives the current name and session ref
of each session. For example, the prompt of `2026-10-25-1713-m22-planner.md` named `orchestrator-m22 [bc2d80]` and
`operator-m22 [8e3ea5]`, each with its socket address, but both sessions handed off, so these values were stale.

The reason for the rules of this section: each part of the file costs tokens at the write, at the read and at each later
turn of the new session.

## The last item id

The handoff file and the prompt for the new session name the first free item id. The item id is the id of a message, in
the form that [The form of a message](items.md#the-form-of-a-message) gives. The first free item id is the number after
the last item id that the old session used. For an orchestrator, the count also covers each question of
[Terms](question-pane.md#terms) and each progress report of
[Reports and questions of a session](working-with-the-user.md#reports-and-questions-of-a-session). So the first free
item id of an orchestrator is the number after the last id of a question or a progress report. An example is "Your first
item id is planner-docs-6." The new session counts its item ids from that id. When an answer names an id of the old
session, the new session takes the message of that id from the handoff file. The reason: "Count your item ids on from
planner-docs-5" can read as "start at planner-docs-5".

When an answer names an id of the old session, a new orchestrator first takes a question of that id from its question
file. [The start of the new orchestrator](orchestrator/handoff-orchestrator.md#the-start-of-the-new-orchestrator) gives
the steps.

## The check of the handoff folder

The new session does this check right after the prompt read, before each other step of the prompt. A new orchestrator
after a handoff is the one exception. It does this check after all its
[start checks](../orchestrator.md#the-start-checks) pass, as
[The start of the new orchestrator](orchestrator/handoff-orchestrator.md#the-start-of-the-new-orchestrator) says. The
new session of a topic handoff is not a new orchestrator after a handoff, also for the role orchestrator. The new
session lists the shared handoff folder `$HOME/Documents/tasker/handoff/` with `ls`. A new orchestrator lists its own
handoff folder in its place, as [The handoff file](#the-handoff-file) says. Before that list, it reads the data root and
runs `mkdir -p`, as [The orchestrator folder](limits.md#the-orchestrator-folder) says.

The files of its role are the files whose names [The handoff file](#the-handoff-file) gives for that role. A file with a
later date and time in its name is newer.

A pane handoff file is not a file of a role. Its name is `pane-handoff-<question id>-<date>-<time>.md`, and it starts
with `pane-handoff-`, so it never matches the name form of a role. It never counts as the newest file of a role. An
example: the folder holds `2026-11-22-1500-orchestrator.md` and `pane-handoff-orchestrator-m31-7-2026-11-22-1506.md`.
The newest file of the role is still `2026-11-22-1500-orchestrator.md`.

The file of the first message is the handoff file whose path the first message names.

The new session then does the case of this list that applies:

- If the file of the first message is the newest file of the role, the new session works from that file.
- If the newest file of the role is newer than the file of the first message, the new session tells the user. Then it
  works from the newest file.
- If the list fails, for example because the folder is missing, [the failure rule](limits.md#the-failure-rule) applies.
  Then the new session works from the file of its first message.

A new orchestrator lists its own handoff folder. The first message can name a file in the shared handoff folder. If the
own handoff folder holds no newer file, or no file, the new orchestrator works from the file of the first message. If
the own handoff folder holds a newer file, the new orchestrator tells the user. Then it works from the newest file. A
new orchestrator after a handoff whose [start check](../orchestrator.md#the-start-checks) failed does not do this check.
The new session of a topic handoff of the role orchestrator does this check right after the prompt read. If a start
check of that session fails, it does not do the check again after the failed step. A run of the check before the failed
step stays valid.

[The failure rule](limits.md#the-failure-rule) covers each role in this check.

The reason: on 2026-10-16, the new Docs orchestrator got the handoff file of 01:12 in its first message. A newer handoff
file of 09:09 for the same role existed. Most issues of the table of the old file had closed.

## The end of a handoff

In a handoff of an orchestrator, the handoff ends after step 6 of
[the steps of the old orchestrator](orchestrator/handoff-orchestrator.md#the-steps-of-the-old-orchestrator).

The rule of the user of 2026-10-25 is the request of the user for these steps: "Then stop the orchestrator and start a
new one."

Until the end, the old session starts no new work. The role page names that work:
[the steps of the old orchestrator](orchestrator/handoff-orchestrator.md#the-steps-of-the-old-orchestrator).

## The stop and the start

In a handoff of an orchestrator, the old orchestrator starts the new orchestrator and closes its own tab, as
[The start of the new orchestrator](orchestrator/handoff-orchestrator.md#the-start-of-the-new-orchestrator) says. The
first message of the new orchestrator is the prompt of the handoff file, and it names the path of the handoff file.

## A topic handoff

A topic handoff moves one topic of a session to a new session, for example the planning of an npm publish to a new
planner. The old session keeps its other work. A request of the user for a handoff of one topic to a new session is a
topic handoff.

Only the user starts a topic handoff. The old session does not suggest one, and the counts of
[The suggestion of a handoff](#the-suggestion-of-a-handoff) do not start one.

The handoff file holds only these parts of the topic:

- The prompt of the new session, as [The items of a handoff file](#the-items-of-a-handoff-file) gives it, with the first
  message that names the path of the file
- The decisions of the user on the topic
- The facts of the topic
- The open questions of the topic, in the form of [The items of a handoff file](#the-items-of-a-handoff-file)

The file does not hold the state of the milestone, the other sessions, the review findings or the table of open issues,
unless the topic needs them. The other items of [The items of a handoff file](#the-items-of-a-handoff-file) and
[The last item id](#the-last-item-id) do not apply. The rule of
[The items of a handoff file](#the-items-of-a-handoff-file) that the file holds no rule does apply. It also covers the
rule of the names. The prompt names [The check of the handoff folder](#the-check-of-the-handoff-folder), not the start
section of a role page.

The file goes in the shared handoff folder of [The handoff file](#the-handoff-file), with the name form of that section.
This also holds for a topic handoff of an orchestrator. The reason: the new session of a topic handoff can have another
role, and only an orchestrator has its own handoff folder. The role part is the role of the new session with the topic
as its slug, for example `2026-10-25-1430-npm-planner.md`. The new session does
[The check of the handoff folder](#the-check-of-the-handoff-folder).

The new session has the name `<role>-<topic>`, for example `planner-npm`. The topic is the topic of the file name. Under
`pi`, the new session gets this name from `-n`, as [The read of the own name](../sessions.md#the-read-of-the-own-name)
says. [docs/dev/GLOSSARY.md](GLOSSARY.md) gives the form of the own name of a session. The old session puts this name in
the prompt of the handoff file.

When the old session is an orchestrator, it gives the path of the file and the prompt to the user as a progress report
of [Reports and questions of a session](working-with-the-user.md#reports-and-questions-of-a-session), in its own tab.
The user starts the new session in a new tab, with the prompt of the file as its first message. The old orchestrator
keeps running. The steps of the role page, [The end of a handoff](#the-end-of-a-handoff) and
[The stop and the start](#the-stop-and-the-start) do not apply.

When the old session is the initial planner, it gives the path of the file and the prompt to the user in its own tab.
The user starts the new session with the start steps of the role of the new session. The user takes the name of the new
session from the handoff file, and the prompt of the file is the first prompt. For a planner, the steps are
[The start prompts](planner.md#the-start-prompts). For an orchestrator, they are
[The steps of the user](../orchestrator.md#the-steps-of-the-user). The old initial planner keeps running. The steps of
the role page, [The end of a handoff](#the-end-of-a-handoff) and [The stop and the start](#the-stop-and-the-start) do
not apply.

On 2026-10-25, the user asked orchestrator-m21 for "a handoff for a new session to plan publishing to NPM". The session
first wrote the full orchestrator handoff. The user said: "we don't need to handoff this entire session. Just include
what is necessary to continue a session for planning NPM publish."

On 2026-10-25, the user asked operator-docs about the store of messages and items, and called it "a larger planning
session". Then the user said "yes, write a handoff". operator-docs wrote the file and started planner-messages at once.
The user said: "I said "write a handoff". That does not imply "start a new session with the handoff you wrote"".
