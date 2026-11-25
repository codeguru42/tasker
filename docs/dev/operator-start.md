# Start and stop the sessions of a milestone

The operator runs each `herdr` command in its own shell, in a Bash call. See [Operator](../operator.md) and
[Sessions](../sessions.md) and [the glossary](GLOSSARY.md) for the terms.

## The order of a milestone

1. The user picks the slug.
2. Step 2 of [The start of a session by the user](../sessions.md#the-start-of-a-session-by-the-user) gives this step.

3. The operator finds the milestone of its slug, the milestone whose title gives the slug, as
   [docs/dev/GLOSSARY.md](GLOSSARY.md) defines the slug. To read the milestones, the operator runs the command of
   [The read of the milestones](planner.md#the-read-of-the-milestones). If the read fails,
   [the failure rule](limits.md#the-failure-rule) applies. Then the operator creates no milestone and does not tell the
   user to start the initial planner.

   If the repo has no milestone of the slug, the operator drafts a title and a description with the user. The title
   gives the slug, for example `M29 — <name>` for the slug `m29`. If an open milestone of the slug exists, the operator
   shows its title and its description to the user and asks whether they are still right. The reason: a decision after
   the first draft of the description can change it. Then the operator drafts each change of the title or the
   description that the user asks for. If the milestone of the slug is closed, the operator tells the user and does not
   tell the user to start the initial planner.

   The operator writes the description to `/tmp/tasker/<slug>/drafts/milestone.md`, and the file holds nothing else.
   Before it shows the draft, it runs the self-check of the simple-english skill over the file, as
   [Before a post](issues.md#before-a-post) says for a draft. The description holds enough detail for the initial
   planner to start the drafts of the issues. This judgment is open on purpose, and the user makes it with the approval.
   The operator posts the title and the description only after the approval of the user.

   After the approval, the operator runs one of these commands. To create the milestone, it runs
   `gh api -X POST repos/codeguru42/tasker/milestones -f title='<title>' -F description=@<file>`. To change a milestone,
   it runs `gh api -X PATCH repos/codeguru42/tasker/milestones/<number>` with `-f title='<title>'`,
   `-F description=@<file>` or both. `<file>` is the path of the draft file. If the command fails, the failure rule
   applies, and the operator does not tell the user to start the initial planner. A change of the description of a held
   milestone keeps its hold record, as [A milestone hold](working-with-the-user.md#a-milestone-hold) says.

   For a denied create or change command, the operator follows
   [A denied command of the operator](tasker-commands.md#a-denied-command-of-the-operator). If the command ran, the
   operator goes on as after its own command. If the command did not run, the operator does not tell the user to start
   the initial planner and waits for a new word of the user. On a new word of the user to go on, the operator does step
   3 again from its first paragraph.

   After the post, the operator tells the user to start the initial planner, as
   [The start prompts](planner.md#the-start-prompts) says. If the user approves the existing title and description with
   no change, the operator also tells the user to start it. The operator starts no planner session. The approval is the
   decision of the user that the milestone starts, and the operator needs no other request of the user. If the user
   rejects the draft or says that the milestone waits, the operator posts nothing and does not tell the user to start
   the initial planner. Then it waits for a new word of the user. On a new word of the user to go on, the operator does
   step 3 again from its first paragraph.

4. The user works with the initial planner in its tab.
   [The start of the initial planner](planner.md#the-start-of-the-initial-planner) of planner.md gives the rules of the
   initial planner.
5. When the initial planning ends, the user tells the initial planner in its tab. The initial planner gives the report
   of its rounds in its tab and ends its work, as
   [The start of the initial planner](planner.md#the-start-of-the-initial-planner) says.
6. The user closes the tab of the initial planner.
7. The operator tells the user to start the orchestrator, as
   [The start of an orchestrator](../orchestrator.md#the-start-of-an-orchestrator) says.
8. At the end of the milestone, [The close of a milestone](#the-close-of-a-milestone) applies.

If a stop or a start fails, the failure cases of "Stop a session" and "Start a session" apply.

## Start a session

Each time that the operator does this section, it first reads `docs/dev/operator-start.md` again, as
[the doc-read rule](doc-reads.md#the-doc-read-rule) says. Then it does the steps of the text that it read. The reason: a
notice can be lost, and a start or a stop from an old text acts on a real session. A section keeps the text that it read
until the section ends. A new text that lands in the middle of the section applies from the next read. A section keeps
this text also when a notice arrives in the middle of it, and the notice applies to the next section.

1. The operator runs `tasker show-config --repo <key>` in its shell. `<key>` is the repo key of the repo of the local
   clone, for example `codeguru42/tasker`.

   ```sh
   tasker show-config --repo <key>
   ```

   The operator keeps `.sessions.kind` and the entry of `.sessions.models.<role>` of the output. `<role>` is the role of
   the new session: `orchestrator` or, in a handoff of the operator, `operator`. As a result, the new operator starts
   with the model and the effort of `sessions.models.operator`. If the command fails, the operator tells the user the
   command and the error, as [the failure rule](limits.md#the-failure-rule) says. The operator does not do steps 2
   and 3. No tab exists, so no entry goes into [the tab list](../operator.md).

2. Step 2 of [The start of a herdr session](../sessions.md#the-start-of-a-herdr-session) gives this step.

3. Step 3 of [The start of a herdr session](../sessions.md#the-start-of-a-herdr-session) gives this step.

[The facts of a herdr start](../sessions.md#the-facts-of-a-herdr-start) gives the facts of the kind `claude`.

## The start gate of a pi session

The rules of this section are in [The start gate of a pi session](../sessions.md#the-start-gate-of-a-pi-session).

## The start prompts

Under `pi`, the name comes from `-n` at the start, and the session reads it, as [docs/sessions.md](../sessions.md) says,
before its role work. So no prompt holds a name step.

The user starts the initial planner with the prompt of [The start prompts](planner.md#the-start-prompts). The user puts
the milestone title in place of `<milestone>`.

The orchestrator: the user starts it with the first prompt of a milestone scope, as
[The start of an orchestrator](../orchestrator.md#the-start-of-an-orchestrator) says.

## Stop a session

Each time that the operator does this section, it first reads `docs/dev/operator-start.md` again, as
[the doc-read rule](doc-reads.md#the-doc-read-rule) says. Then it does the steps of the text that it read.
[Start a session](#start-a-session) gives the reason and the rule of the new text.

The operator stops a session only on a request of the user. [A question pane](question-pane.md#a-question-pane) gives
the close of a question pane. The operator closes only a tab that it opened in its own session, or a tab that an earlier
operator of its slug opened.

In a handoff of the operator, the old operator closes its own tab with no request of the user. This sentence wins over
two rules for the own tab of the old operator. The first rule is "The operator closes only a tab that it opened in its
own session, or a tab that an earlier operator of its slug opened." The second rule is the sentence of the intro of the
operator index that says "The tab list is the list of the tabs that an operator can close." That index is
[docs/operator.md](../operator.md). [The start of the new operator](handoff-operator.md#the-start-of-the-new-operator)
gives the steps.

In the close of a milestone, the operator closes its own tab on the approval of the user, as
[The own-session closure](milestone-close.md#the-own-session-closure) says. That rule wins over the two rules of the
paragraph before. It also wins over each rule of this section that limits a close to the tab list. The same holds for a
rule that limits a close to a tab that the operator opened.

The operator takes the tab id of each session from [the tab list](../operator.md), also of its own sessions. If the tab
list gives no tab id for the session, the operator tells the user and closes nothing.

A missing tab id has two reports: the tab list gives none, or the row gives a tab id outside the tab list. After either
report, the user can tell the operator to close the session. On that word, the operator takes the tab id from the row of
the session. That word covers a tab that the operator did not open. It wins over each sentence here that limits a stop
to a tab of the tab list, or to a tab that the operator opened. It also wins over the sentence on the tab list in
[docs/operator.md](../operator.md).

On 2026-10-30, the user opened the initial planner, so its tab was not in the tab list. The user said: "You close the
initial planner".

The operator finds the pane id and the tab id in the row of the session. The row of a session is the object in
`.result.agents` of the output of `herdr agent list` whose `terminal_title_stripped` is the name of the session. The row
gives `pane_id` and `tab_id`. Before step 1, the operator runs `herdr agent list` in its shell. If the command fails,
the operator tells the user, as [the failure rule](limits.md#the-failure-rule) says, and closes nothing. If no row has
the name of the session, the operator tells the user and closes nothing.

Each time that the operator reads the row of a session, it counts the rows with the name of the session. If more than
one row has the name, the operator does not do steps 1 to 3, sends no "stop" and closes no pane and no tab. It tells the
user one time. The message names the session, and the pane id and the tab id of each row with that name, and it gives no
other items. This stop did not close the pane of the session, and the operator sends no second message for the failed
close. A close of the wrong pane stops the other session.

If the tab id of the row is not a tab id of the tab list, the operator tells the user and closes nothing. Steps 2 and 3
use the pane id and the tab id of the row.

Before the operator closes the pane of a session, the session runs the rounds of
[Session-review rounds](session-review-rounds.md) and sends the report of the rounds. The operator does steps 2 and 3
only after this report arrives. The wait of step 2 does not replace the report.

After step 1, the operator tells the user one time that it waits for the report of the session. While it waits, it
continues its other work and does not wait in a loop. If the user asks before the report arrives, the operator reads the
state of the session and tells the user, as [A blocked session](../sessions.md#a-blocked-session) says. The word of the
user then closes the pane with no report, keeps the wait, or ends the stop. After an end of the stop, the entry stays in
the tab list.

After the hold messages, the old operator starts no stop of a sender of the slug.
[The hold of the items](handoff.md#the-hold-of-the-items) defines the hold messages and a sender of the slug.

1. The operator sends this message to the session with the tool `SendMessage`: "Operator: stop. Run the rounds of
   docs/dev/session-review-rounds.md, then report." The message is a word of the operator, not a word of the user, so it
   does not start with "From the user:". If `SendMessage` fails, the operator tells the user and does not do steps 2
   and 3. The tab stays open.
2. The operator runs `herdr agent wait <pane id> --timeout 600000` in its shell. `herdr agent wait <session name>` exits
   with 1 and the code `agent_not_found` for each listed session (herdr 0.9.3, measured on 2026-10-24).
3. If the wait ends in `idle` or `done`, the operator runs `herdr tab get <tab id>` in its shell. If
   `.result.tab.pane_count` is 1, the operator runs `herdr tab close <tab id>`. If `.result.tab.pane_count` is more than
   1, the operator runs `herdr pane close <pane id>`. A tab that the user opened can hold other panes of the user. If
   `herdr tab get`, `herdr tab close` or `herdr pane close` fails, the operator tells the user, and the pane stays open.
   If the close works and the tab has an entry in the tab list, the operator takes that entry out. After
   `herdr pane close`, the tab stays open.

A session at its input prompt runs no turn and is ready for the next input at its prompt, in the state `idle` or `done`.
A session in `blocked` is not such a session, and [A blocked session](../sessions.md#a-blocked-session) covers it. The
operator does step 2 only after the report of the rounds, so the session already read "stop". For a session at its input
prompt, the wait of step 2 then ends at once, and the operator does step 3. For such a session, a wait right after the
send of "stop" ends before the session reads it. The measures in the next paragraphs show this, and it is the reason for
the wait for the report.

On 2026-10-25, with herdr 0.9.3 and Claude Code 2.1.310, the task subagent of #519 sent "stop" to a test session of its
own in the state `done`. `herdr agent wait <pane id> --timeout 600000` returned `done` at once. About 0.5 seconds later,
the message started a new turn, and the session answered the stop.

On 2026-10-25, with herdr 0.9.3 and Claude Code 2.1.310, operator-docs sent "From the user: stop" to planner-messages,
which waited for the input of the user. `herdr agent wait wB:p9 --timeout 600000` returned `idle` at once.
`herdr pane read` showed "1 new message (ctrl+End)", so the stop was still unread. Then `herdr tab close` closed the
session before it read the stop.

If the wait fails or times out, the operator tells the user and closes nothing. If the wait ends in `blocked`, the
operator follows "A blocked session" and closes nothing. Without `--until`, the wait also ends in `blocked`.

After each other end of this section, the entry stays in the tab list. Examples are a failed `SendMessage`, a failed
wait, a `blocked` session and a failed `herdr tab close`.

## The close of a milestone

[The close of a milestone](milestone-close.md) gives the terms of the close and its order. They apply in this section.

### The start and the authority

The rules of this subsection are in [The start and the authority](milestone-close.md#the-start-and-the-authority).

### The orchestrator ends

The orchestrator ends as [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) says. The operator
reads no pane of an orchestrator and stops no orchestrator. With no pane id, after a failed close, or for a pi
orchestrator, the user closes its tab. The operator starts its rounds of step 5 after the user tells it that the
milestone is done.

### The rounds of the operator

The operator runs its rounds of [Session-review rounds](session-review-rounds.md) until a round finds nothing new. A
round does not list again the open work that an earlier round listed, as step 7 of
[the session-review skill](../../.claude/skills/session-review/SKILL.md) says.

If a round of the operator fails, the rounds of the operator end. The close then stops at this stage. The operator tells
the user about the failure directly. It keeps the findings for a later recovery. It does not end its role after a failed
round.

### Missing roles

If no orchestrator runs, the operator makes sure of that before it starts its rounds. The close then starts on the word
of the user. The operator takes an orchestrator that already ended as done only with proof of its role and its
milestone. An example of proof is the report of the orchestrator that the milestone is done. The judgment of the proof
is open on purpose, and the operator makes it.

The rest of this subsection is in [Missing roles](milestone-close.md#missing-roles).

### The steps that end each role

1. The end of the orchestrator starts, and the orchestrator runs its rounds. For a long-running milestone, for example
   "Docs", the close starts only on the word of the user.
   [The start and the authority](milestone-close.md#the-start-and-the-authority) gives the details.
2. The end reads of the orchestrator find no open issue of the milestone. Then the orchestrator shows the report that
   the close started in its own tab, and the user tells the operator.
   [The start and the authority](milestone-close.md#the-start-and-the-authority) gives the details.
3. The orchestrator of the kind `claude` closes the GitHub milestone. Then it reports that the milestone is done and
   closes its own tab. A pi orchestrator only reports that the milestone is done.
   [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) gives the details.
4. The orchestrator ends, as [The orchestrator ends](#the-orchestrator-ends) says. The operator does not make sure that
   it ended.
5. The operator runs its rounds until a round finds nothing new.
   [The rounds of the operator](#the-rounds-of-the-operator) gives the details.
6. The operator keeps working until each open question and each open decision is resolved.
   [The question gate of the close](operator-items.md#the-question-gate-of-the-close) gives the details.
7. The operator runs a round. If the round finds something new, the operator goes back to step 6 and runs a round again.
   The operator goes to step 8 only after each open question and each open decision is resolved and a round finds
   nothing new.
8. The operator gives the user its close report and asks for the approval to close. The report says that the last round
   found nothing new. On the approval, the operator closes its own session, as
   [The own-session closure](milestone-close.md#the-own-session-closure) says.

The operator closes its own session in the close, on the approval of the user. The orchestrator of the kind `claude`
closes its own session with no approval.

### The own-session closure

The rules of this subsection are in [The own-session closure](milestone-close.md#the-own-session-closure).

### The own-session closure of a pi session

The rules of this subsection are in
[The own-session closure of a pi session](milestone-close.md#the-own-session-closure-of-a-pi-session).

### The table of the close

Each actor keeps its own report of the rounds and its own state in the close. The GitHub milestone keeps its own state,
open or closed.

| Stage                         | Session that acts       | Change of state                                                                                                                                                       | Who tells whom                                                                                                              | Outcome of a failure                                                                                                                       |
| ----------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| The orchestrator ends         | Orchestrator, then user | The orchestrator of the kind `claude` closes the milestone and its own tab. For a pi orchestrator, with no pane id, or after a failed close, the user closes the tab. | The orchestrator shows the report that the milestone is done in its own tab. The user tells the operator.                   | The user closes the tab. The operator starts no round of step 5 before the user tells it that the milestone is done.                       |
| The rounds of the operator    | Operator                | A round finds nothing new.                                                                                                                                            |                                                                                                                             | The rounds end, and the close stops at this stage. The operator tells the user directly.                                                   |
| The questions of the operator | Operator                | Each open question and each open decision is resolved, as the question gate of the close says.                                                                        | The operator gives the user the full text of each open question and each open decision. It sends each answer to its sender. | The operator keeps working until each open question and each open decision is resolved.                                                    |
| The review of the operator    | Operator                | After the questions, a round finds nothing new. After a round that finds something, the stage "The questions of the operator" runs again.                             |                                                                                                                             | The rounds end, and the close stops at this stage. The operator tells the user directly.                                                   |
| The operator closes           | Operator                | On the approval to close, the operator closes its own session.                                                                                                        | The operator gives the user its close report and asks for the approval to close.                                            | If the close report fails, the failure rule applies. If the operator cannot close itself, it tells the user, and the user closes its pane. |

The operator does not wait in a loop for a report. If a report does not come, the operator tells the user, and the word
of the user decides.

## A denied command of the operator

The rules of this section are in
[A denied command of the operator](tasker-commands.md#a-denied-command-of-the-operator).

## A blocked session

The rules of this section are in [A blocked session](../sessions.md#a-blocked-session).
