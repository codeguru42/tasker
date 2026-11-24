# Start and stop the sessions of a milestone

The operator runs each `herdr` command in its own shell, in a Bash call. See [Operator](../operator.md) and
[Sessions](../sessions.md) and [the glossary](GLOSSARY.md) for the terms.

## The order of a milestone

1. The user picks the slug.
2. Step 2 of [The start of a session by the user](../sessions.md#the-start-of-a-session-by-the-user) gives this step.

3. The operator finds the milestone of its slug, the milestone whose title gives the slug, as
   [docs/dev/GLOSSARY.md](GLOSSARY.md) defines the slug. To read the milestones, the operator runs the command of
   [The read of the milestones](planner.md#the-read-of-the-milestones). If the read fails,
   [the failure rule](limits.md#the-failure-rule) applies. Then the operator creates no milestone and starts no initial
   planner.

   If the repo has no milestone of the slug, the operator drafts a title and a description with the user. The title
   gives the slug, for example `M29 — <name>` for the slug `m29`. If an open milestone of the slug exists, the operator
   shows its title and its description to the user and asks whether they are still right. The reason: a decision after
   the first draft of the description can change it. Then the operator drafts each change of the title or the
   description that the user asks for. If the milestone of the slug is closed, the operator tells the user and starts no
   initial planner.

   The operator writes the description to `/tmp/tasker/<slug>/drafts/milestone.md`, and the file holds nothing else.
   Before it shows the draft, it runs the self-check of the simple-english skill over the file, as
   [Before a post](issues.md#before-a-post) says for a draft. The description holds enough detail for the initial
   planner to start the drafts of the issues. This judgment is open on purpose, and the user makes it with the approval.
   The operator posts the title and the description only after the approval of the user.

   After the approval, the operator runs one of these commands. To create the milestone, it runs
   `gh api -X POST repos/codeguru42/tasker/milestones -f title='<title>' -F description=@<file>`. To change a milestone,
   it runs `gh api -X PATCH repos/codeguru42/tasker/milestones/<number>` with `-f title='<title>'`,
   `-F description=@<file>` or both. `<file>` is the path of the draft file. If the command fails, the failure rule
   applies, and the operator starts no initial planner. A change of the description of a held milestone keeps its hold
   record, as [A milestone hold](working-with-the-user.md#a-milestone-hold) says.

   For a denied create or change command, the operator follows
   [A denied command of the operator](#a-denied-command-of-the-operator). If the command ran, the operator goes on as
   after its own command. If the command did not run, the operator starts no initial planner and waits for a new word of
   the user. On a new word of the user to go on, the operator does step 3 again from its first paragraph.

   After the post, the operator starts the initial planner, as "Start a session" says. If the user approves the existing
   title and description with no change, the operator also starts the initial planner. The approval is the decision of
   the user that the milestone starts, and the operator needs no other request of the user. If the user rejects the
   draft or says that the milestone waits, the operator posts nothing and starts no initial planner. Then it waits for a
   new word of the user. On a new word of the user to go on, the operator does step 3 again from its first paragraph.

4. The user works with the initial planner in its tab.
   [The initial planner and the follow-up planner](planner.md#the-initial-planner-and-the-follow-up-planner) of
   planner.md gives the rules of the initial planner.
5. When the initial planning ends, the user tells the initial planner that the initial planning ends. If the user tells
   the operator first, the operator tells `planner-<slug>` with `SendMessage`, as
   [The word of the user](operator-conversations.md#the-word-of-the-user) says. The message of the operator starts with
   "From the user:" and says that the initial planning ends. Then the operator waits for the message of the initial
   planner that the initial planning is done. This message ends the wait. While it waits, the operator continues its
   other work. It does not wait in a loop, as [the answer-wait rule](limits.md#the-answer-wait-rule) says for a task
   subagent. If the send fails, the operator tells the user, as [the failure rule](limits.md#the-failure-rule) says.
   Then the operator asks the user to tell the initial planner in its tab that the initial planning ends. The tab of the
   initial planner stays open, and the operator still waits for the message of the initial planner.
6. The message of the initial planner is the one signal that ends the initial planning. The operator does this step only
   after this message. The word of the user to the initial planner in step 5 is the request of the user for this stop.
   Then the operator closes the tab of the initial planner, as "Stop a session" says.
7. The operator starts the follow-up planner, as "Start a session" says. Then it tells the user to start the
   orchestrator, as [The start of an orchestrator](../orchestrator.md#the-start-of-an-orchestrator) says.
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
   the new session: `planner`, `orchestrator` or, in a handoff of the operator, `operator`. As a result, the new
   operator starts with the model and the effort of `sessions.models.operator`. If the command fails, the operator tells
   the user the command and the error, as [the failure rule](limits.md#the-failure-rule) says. The operator does not do
   steps 2 and 3. No tab exists, so no entry goes into [the tab list](../operator.md).

2. Step 2 of [The start of a herdr session](../sessions.md#the-start-of-a-herdr-session) gives this step.

3. Step 3 of [The start of a herdr session](../sessions.md#the-start-of-a-herdr-session) gives this step.

[The facts of a herdr start](../sessions.md#the-facts-of-a-herdr-start) gives the facts of the kind `claude`.

## The start gate of a pi session

The rules of this section are in [The start gate of a pi session](../sessions.md#the-start-gate-of-a-pi-session).

## The start prompts

The operator puts the milestone title in place of `<milestone>`. Each prompt is the last argument of
`herdr agent start`. Under `pi`, the name comes from `-n` at the start, and the session reads it, as
[docs/sessions.md](../sessions.md) says, before its role work. So no prompt holds a name step.

[The start prompts](planner.md#the-start-prompts) gives the prompts of the initial planner and the follow-up planner.

The orchestrator: the user starts it with the first prompt of a milestone scope, as
[The start of an orchestrator](../orchestrator.md#the-start-of-an-orchestrator) says.

## Stop a session

Each time that the operator does this section, it first reads `docs/dev/operator-start.md` again, as
[the doc-read rule](doc-reads.md#the-doc-read-rule) says. Then it does the steps of the text that it read.
[Start a session](#start-a-session) gives the reason and the rule of the new text.

The operator stops a session only on a request of the user. [A question pane](question-pane.md#a-question-pane) gives
the close of a question pane. In a handoff of an orchestrator or a follow-up planner, the rule of the user of 2026-10-25
in [The end of a handoff](handoff.md#the-end-of-a-handoff) is that request, for step 4 of [A handoff](#a-handoff). The
operator closes only a tab that it opened in its own session, or a tab that an earlier operator of its slug opened. In a
handoff, the operator also stops a session in a tab that it did not open, for example a tab that the user opened.

In a handoff of the operator, the old operator closes its own tab with no request of the user. This sentence wins over
two rules for the own tab of the old operator. The first rule is "The operator closes only a tab that it opened in its
own session, or a tab that an earlier operator of its slug opened." The second rule is the sentence of the intro of the
operator index that says "The tab list is the list of the tabs that an operator can close." That index is
[docs/operator.md](../operator.md). [The start of the new operator](handoff-operator.md#the-start-of-the-new-operator)
gives the steps.

In the close of a milestone, the operator closes its own tab on the approval of the user, as
[The own-session closure](#the-own-session-closure) says. That rule wins over the two rules of the paragraph before. It
also wins over each rule of this section that limits a close to the tab list. The same holds for a rule that limits a
close to a tab that the operator opened.

Outside a handoff, the operator takes the tab id of each session from [the tab list](../operator.md), also of its own
sessions. If the tab list gives no tab id for the session, the operator tells the user and closes nothing. In a handoff,
the operator takes the tab id from the row of the session.

A missing tab id has two reports: the tab list gives none, or the row gives a tab id outside the tab list. After either
report, the user can tell the operator to close the session. On that word, the operator takes the tab id from the row of
the session, as in a handoff. That word covers a tab that the operator did not open. It wins over each sentence here
that limits a stop to a tab of the tab list, or to a tab that the operator opened. It also wins over the sentence on the
tab list in [docs/operator.md](../operator.md).

On 2026-10-30, the user opened the initial planner, so its tab was not in the tab list. The user said: "You close the
initial planner".

The operator finds the pane id and the tab id in the row of the session. The row of a session is the object in
`.result.agents` of the output of `herdr agent list` whose `terminal_title_stripped` is the name of the session. The row
gives `pane_id` and `tab_id`. Before step 1, the operator runs `herdr agent list` in its shell. If the command fails,
the operator tells the user, as [the failure rule](limits.md#the-failure-rule) says, and closes nothing. If no row has
the name of the session, the operator tells the user and closes nothing.

Each time that the operator reads the row of a session, in a handoff or in each other stop, it counts the rows with the
name of the session. If more than one row has the name, the operator does not do steps 1 to 3, sends no "stop" and
closes no pane and no tab. It tells the user one time. The message names the session, and the pane id and the tab id of
each row with that name, and it gives no other items. This stop did not close the pane of the session, and the operator
sends no second message for the failed close. A close of the wrong pane stops the other session.

Outside a handoff, if the tab id of the row is not a tab id of the tab list, the operator tells the user and closes
nothing. Steps 2 and 3 use the pane id and the tab id of the row.

Before the operator closes the pane of a session, the session runs the rounds of
[Session-review rounds](session-review-rounds.md) and sends the report of the rounds. The operator does steps 2 and 3
only after this report arrives. The wait of step 2 does not replace the report.

After step 1, the operator tells the user one time that it waits for the report of the session. While it waits, it
continues its other work and does not wait in a loop. If the user asks before the report arrives, the operator reads the
state of the session and tells the user, as [A blocked session](../sessions.md#a-blocked-session) says. The word of the
user then closes the pane with no report, keeps the wait, or ends the stop. After an end of the stop, the entry stays in
the tab list.

In steps 1 and 2 of [the steps of the old operator](handoff-operator.md#the-steps-of-the-old-operator), the old operator
waits for each such report before its hold messages. That report is the report again, because the old sender ran its
rounds before its handoff file. If no report arrives, the old operator tells the user, and the word of the user decides.
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

This section gives the close. The close is the set of steps at the end of a milestone. The order is: the orchestrator
ends first, then the operator, then the follow-up planner. In this section, "the planner" means the follow-up planner of
the milestone. A round and the end of the rounds work as [Session-review rounds](session-review-rounds.md) says.

These terms apply in this section:

- A terminal delegation is the last message of the operator to the planner. It gives the remaining close duties to the
  planner before the operator ends its role.
- The end of a role: the session does no more work of its role.
- A session closure ends the session on its host, for example with the close of its herdr tab.
- A GitHub milestone closure changes the state of the milestone on GitHub to `closed`.
- An own-session closure is a session closure that a session runs on its own herdr tab.
- In the close, an open question is an open question of [The open items](operator-items.md#the-open-items). It is also
  an open question of step 7 of [the session-review skill](../../.claude/skills/session-review/SKILL.md).
- An open decision is a decision that waits for the user. It is a waiting decision of step 7 of
  [the session-review skill](../../.claude/skills/session-review/SKILL.md) whose wait did not end. It is also a proposal
  or a draft that waits for a decision of the user.
- A close report is the last report of the operator or of the planner to the user in the close. It asks the user for the
  approval to close the session, as [The own-session closure](#the-own-session-closure) says.

The end of a role, a session closure and a GitHub milestone closure are separate outcomes.

### The start and the authority

The close starts only after the end reads of the orchestrator find no open issue of the milestone. A ticket on hold
counts as an open issue. The orchestrator runs its rounds and its end reads first, and then it tells the operator in a
report that the close started. [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) gives these
steps. When the report that the close started arrives, the operator tells the planner that the close started.
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) keeps these reports and this word as the start of
the close for each session.

The start of the close is the authority for the end of each role of the close and for the GitHub milestone closure.
These steps of the close need no other word of the user:

- The end of the role of the orchestrator, with its own close or its stop
- The end of the role of the operator
- The end of the role of the planner
- The GitHub milestone closure of a milestone with no work left, by the orchestrator or by the planner

The start of the close is not the authority for an own-session closure of the operator or of the planner. The operator
and the planner each close their own session only on the approval of the user, as
[The own-session closure](#the-own-session-closure) says. The recommendation mode of
[A decision of the user](working-with-the-user.md#a-decision-of-the-user) does not cover this approval. For the
orchestrator of the kind `claude`, the start of the close is the authority for its own close.
[The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) gives this rule.

The user still gives each approval that only the user gives: new scope, a security decision, a permission prompt and a
failed operation. [A question pane](question-pane.md#a-question-pane) holds the start of the close. While a pane is open
or a [write subagent](question-pane.md#terms) runs, the operator starts neither its handoff nor the close. If either is
due, it tells the user. The state table of that section has the rows "A handoff or a close of the milestone is due while
a pane is open" and "A handoff or a close of the milestone is due while a write subagent runs". These rows win over the
rule that the steps of the close need no other word of the user.

Use this order only for the close of a milestone. A handoff, the end of the initial planning and each other stop of a
session keep their own procedures. During the close, no session starts a new session of a role or a next milestone on
its own. A word of the user can still start one.

A session that starts the close ends its role. It does not keep its role for the next milestone.

The milestone of a long-running orchestrator, for example "Docs", stays open after its last ticket closes. At the empty
Todo column, the long-running orchestrator runs its rounds and gives its report that the milestone is done, as
[Pick the tickets](pick-the-tickets.md#pick-the-tickets) says. The close of that milestone starts only on the word of
the user. That word starts the report of the long-running orchestrator that the close started. Then the close runs in
the order of this section. Until that word, the long-running orchestrator keeps its role and its other rules outside the
close.

### The orchestrator ends

After the report of the orchestrator that the milestone is done arrives, the operator makes sure that the orchestrator
ended. An orchestrator of the kind `claude` closes its own tab after that report. The report gives the pane id of the
orchestrator, or it says that it gives none. The operator runs `herdr pane get <pane id>` with that pane id. Exit code 1
with JSON stderr `.error.code` equal to `pane_not_found` means that the orchestrator ended. Exit code 0 means that the
pane is still open.

With the pane still open, the operator tells the user and closes nothing. After the next word of the user, it runs the
read again. The report comes before the own close, so the first read can give exit code 0. For any other exit, code or
result, [the failure rule](limits.md#the-failure-rule) applies.

With no pane id, or for a pi orchestrator, the operator stops the orchestrator as [Stop a session](#stop-a-session)
says. The operator keeps each check of that section. Examples are the report of the rounds, the row of the session, the
wait, the tab list and the shared tab. The gate of that section starts "The operator stops a session only on a request
of the user". The start of the close is that request for this stop. The operator starts its rounds of step 5 only after
the orchestrator ended.

### The rounds of the operator

The operator runs its rounds of [Session-review rounds](session-review-rounds.md) until a round finds nothing new. It
sends each finding to the planner, under the rules for a draft and its review in
[The review loop of a draft](planner.md#the-review-loop-of-a-draft). A round does not list again the open work that an
earlier round listed, as step 7 of [the session-review skill](../../.claude/skills/session-review/SKILL.md) says.

If a round of the operator or a send of a finding fails, the rounds of the operator end. The close then stops at this
stage. The operator tells the user about the failure directly. It keeps the findings and the state of the terminal
delegation for a later recovery. It does not end its role after a failed round.

### The terminal delegation

Before the terminal delegation, the operator does steps 6 and 7 of
[The steps that end each role](#the-steps-that-end-each-role). Step 6 follows
[the question gate of the close](operator-items.md#the-question-gate-of-the-close). With an open question or an open
decision, the operator sends no terminal delegation and does not end its role. It also sends none before a round of step
7 finds nothing new. It also sends none while a [write subagent](question-pane.md#terms) runs.

The terminal delegation gives the milestone, the report of the rounds of the operator, the state of each finding and the
remaining close duties. It also gives the id of each item with a settled question and the decision of that question. It
also gives the pane id of the operator, or says that it gives none, as
[The own-session closure](#the-own-session-closure) says. It says that the planner talks to the user directly after the
end of the role of the operator. The operator sends it to the planner with `SendMessage`. If the send fails,
[the failure rule](limits.md#the-failure-rule) applies, and the operator keeps its role.

The terminal delegation is the last message of the operator to another session and the last action of its role. The
operator waits for no result of the rounds of the planner and for no result of the GitHub milestone closure.

### The work of the planner

The planner starts step 10 of [The steps that end each role](#the-steps-that-end-each-role) only after the end of the
role of the operator. [The close duties of the follow-up planner](planner.md#the-close-duties-of-the-follow-up-planner)
give its work. [Milestones](issues.md#milestones) gives the GitHub milestone closure. After the end of the role of the
operator, the planner talks to the user directly, as [The operator](working-with-the-user.md#the-operator) says.

### Missing roles

If no orchestrator runs, the operator makes sure of that before it starts its rounds. The close then starts on the word
of the user. The operator takes an orchestrator that already ended as done only with proof of its role and its
milestone. An example of proof is the report of the orchestrator that the milestone is done. The pane check of
[The orchestrator ends](#the-orchestrator-ends) then shows that its pane is gone. The judgment of the proof is open on
purpose, and the operator makes it.

If no planner runs, the operator keeps its role and tells the user that no session can do the rest of the close. The
word of the user decides the next step. If no operator runs, the user tells the planner that the close started. Then the
planner gives each report to the user directly. The user stops a running pi orchestrator, and an orchestrator of the
kind `claude` closes its own tab. The word of the user takes the place of the terminal delegation for the start of step
10 of the planner.

### The steps that end each role

1. The end of the orchestrator starts, and the orchestrator runs its rounds. For a long-running milestone, for example
   "Docs", the close starts only on the word of the user. [The start and the authority](#the-start-and-the-authority)
   gives the details.
2. The end reads of the orchestrator find no open issue of the milestone. Then the orchestrator tells the operator that
   the close started, and the operator tells the planner. [The start and the authority](#the-start-and-the-authority)
   gives the details.
3. The orchestrator of the kind `claude` closes the GitHub milestone. Then it reports that the milestone is done and
   closes its own tab. A pi orchestrator only reports that the milestone is done.
   [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) gives the details.
4. The operator makes sure that the orchestrator ended, as [The orchestrator ends](#the-orchestrator-ends) says.
5. The operator runs its rounds until a round finds nothing new. It sends each finding to the planner as a proposal.
   [The rounds of the operator](#the-rounds-of-the-operator) gives the details.
6. The operator keeps working until each open question and each open decision is resolved.
   [The question gate of the close](operator-items.md#the-question-gate-of-the-close) gives the details.
   [The questions and the rounds of the close](#the-questions-and-the-rounds-of-the-close) also applies.
7. The operator runs a round. If the round finds something new, the operator sends it to the planner, as step 5 says.
   Then the operator goes back to step 6 and runs a round again. The operator goes to step 8 only after each open
   question and each open decision is resolved and a round finds nothing new.
   [The questions and the rounds of the close](#the-questions-and-the-rounds-of-the-close) gives the details.
8. The operator sends the [terminal delegation](#the-terminal-delegation) to the planner. A send that works ends the
   role of the operator. The planner takes the arrival of the terminal delegation as the end of the role of the
   operator.
9. The operator gives the user its close report and asks for the approval to close. The report says that the last round
   found nothing new, and that the planner is now the contact of the user. On the approval, the operator closes its own
   session, as [The own-session closure](#the-own-session-closure) says.
10. At the arrival of the terminal delegation, the planner talks to the user directly. It works with the user until each
    open question and each open decision is resolved.
    [The questions and the rounds of the close](#the-questions-and-the-rounds-of-the-close) gives the details.
11. The planner runs a round. If the round finds something new, the planner handles it, goes back to step 10, and runs a
    round again. The planner goes to step 12 only after each open question and each open decision is resolved and a
    round finds nothing new. [The questions and the rounds of the close](#the-questions-and-the-rounds-of-the-close)
    gives the details.
12. The planner reads the open issues and the tasks in flight of the milestone again, to make sure that no work is left.
    This read is the milestone guard. Then the planner closes the GitHub milestone and reads it again, to make sure that
    its state is `closed`. After a close by the orchestrator, the read gives the state `closed`, and the planner runs no
    write. New work or a failed read holds steps 13 and 14. [Milestones](issues.md#milestones) gives the details.
13. The planner makes sure that the session of the operator closed, with the operator check of
    [The own-session closure](#the-own-session-closure). If the pane of the operator is still open, the planner tells
    the user. After the next word of the user, it runs the operator check again. If the check shows that the session
    closed, the planner goes to step 14. After a failed check, or with no pane id, the planner also goes to step 14, but
    it cannot close itself.
14. The planner gives the user its close report and asks for the approval to close. The report says that the last round
    found nothing new. The close report ends the role of the planner. On the approval, the planner closes its own
    session, as [The own-session closure](#the-own-session-closure) says.

The operator and the planner close their own sessions in the close, each on the approval of the user. The orchestrator
of the kind `claude` closes its own session with no approval.

### The questions and the rounds of the close

This subsection covers steps 6, 7, 10 and 11 of [The steps that end each role](#the-steps-that-end-each-role). It gives
the gates for questions, decisions and review rounds.

- For the operator, only an end listed in
  [The question gate of the close](operator-items.md#the-question-gate-of-the-close) resolves an open question or
  decision. A waiting decision of [the session-review skill](../../.claude/skills/session-review/SKILL.md) also follows
  its step 8.
- In step 10, only a user answer, a withdrawal, or the user's choice to let the planner decide can resolve a question or
  decision. The choice must be one that the user can give to the sender. In step 10, no answer of the operator resolves
  it. The third end of the skill's step 8 wait does not apply in step 10.
- Step 8 of [the session-review skill](../../.claude/skills/session-review/SKILL.md) also ends a waiting decision when
  its listed conditions hold. An operator answer does not resolve the operator's waiting decision.
- A missing user answer, a deferral, a send to another session, and another round each leave the question or decision
  open.
- An open question or decision outside the milestone also holds steps 7 and 11. Unfinished work from step 7 of
  [the session-review skill](../../.claude/skills/session-review/SKILL.md) also holds them. The session finishes that
  work, drops it as moot under step 7 (c), or asks the user.
- In step 10, the planner asks the user directly because the operator's role ended.
- If an answer asks for more work, the session does that work first. Then it goes on with step 7 or step 11. The
  operator follows [The question gate of the close](operator-items.md#the-question-gate-of-the-close). The planner
  follows [The close duties of the follow-up planner](planner.md#the-close-duties-of-the-follow-up-planner).
- For authority and drafts, follow
  [The close duties of the follow-up planner](planner.md#the-close-duties-of-the-follow-up-planner). The planner
  finishes each held draft before step 12.
- A running [write subagent](question-pane.md#terms) holds the operator at step 8. If none started, or each one ended,
  this hold ends. If one ends without a report, follow [the failure rule](limits.md#the-failure-rule). A write subagent
  can run after its question pane closes. Step 9 ends the operator's session.
- In the close, each new issue goes to the planner as a proposal, including an issue requested by an answer in step 6.
  The operator and its write subagents post no new issue.
- Run the rounds of steps 7 and 11 even after no new work, as [Session-review rounds](session-review-rounds.md) says.
- A finding sent to the planner stays open until the planner handles it, as
  [Session-review rounds](session-review-rounds.md) says. That finding is not a step 6 question or decision, so the
  operator does not wait for it. A planner draft that needs a user decision returns to the operator as an item. That
  item is an open question of step 6.
- The planner handles findings as
  [The close duties of the follow-up planner](planner.md#the-close-duties-of-the-follow-up-planner) says.
- A failed round or a failed send ends the session's rounds. The close stops at that stage. A failed round is not a
  round that found nothing new.

### The own-session closure

The operator and planner use this procedure after their close reports. The orchestrator of the kind `claude` uses it
after its last report, with no approval, as [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator)
says. [Own-session closure](codex-sessions.md#own-session-closure) records the measured facts.

- Give the close report in the reply that asks for approval, before closing the session. Give no report after
  own-session closure.
- The operator's close report says that its last round found nothing new. It says that the planner is now the user's
  contact.
- The planner's close report says that its last round found nothing new. It gives the milestone URL and the result of
  the read after the write.
- Each close report includes the report of the rounds under [Session-review rounds](session-review-rounds.md). Give no
  other report of those rounds to the user in the close.
- Approval to close must be the user's word in that session's conversation. The close-start word, a recommendation, an
  operator answer, and a relayed word do not approve closure. This rule wins over the `From the user:` rule in
  [The operator](working-with-the-user.md#the-operator).
- An approval makes the session run its own-session closure.
- If the planner receives an answer that opens a question or decision, or asks for work, it takes its role again. It
  returns to step 10 and gives a new close report after step 13. Put new work after a closed milestone in the milestone
  from [The milestone of an issue](issue-subagents.md#the-milestone-of-an-issue). Do not reopen the closed milestone, as
  [Milestones](issues.md#milestones) says.
- If the operator receives such an answer, it does no work of its role because its role ended. It tells the user that
  the planner is the contact. It closes nothing until an approval.
- On another answer, such as a wait, rejection or drop, the session closes nothing and stays open. The user's word
  decides the next step.
- With no answer, the session closes nothing and stays open.
- A session that the user resumed, restarted, or opened in a pane cannot close itself. It also cannot close if it cannot
  establish its own pane, tab, and one-pane tab. Whether the session knows that the user resumed, restarted or opened it
  is open on purpose. The session judges it. No one tested those bindings. For a pi session, the match of its own pane
  and tab is a passed pi row check.
- For the orchestrator, the bullet before covers only a resume and a restart. A resumed or restarted orchestrator cannot
  close itself, because its ids can come from an earlier pane. The words "opened in a pane" do not cover an
  orchestrator. A start of an orchestrator is a new session in a new pane. No one measured the ids of an orchestrator
  that the user started by hand in a new tab. The row check still guards each case, as the bullet that starts "Matching
  the agent row" says.
- Read `HERDR_TAB_ID` and `HERDR_PANE_ID`. If either is unset, close nothing.
- Run `herdr agent list`. Exactly one row in `.result.agents` must have `terminal_title_stripped` equal to the session's
  own name. Its `tab_id` and `pane_id` must match the two environment variables. Otherwise, close nothing. The measured
  binding covered only a new pane started by herdr, not an older stale inherited id. For a pi session,
  [the pi row check](#the-pi-row-check) takes the place of this check.
- Run `herdr tab get <tab id>`. If `.result.tab.pane_count` is not 1, close nothing. The closure measure covered only a
  one-pane tab; no one tested own closure in a tab with more panes. The own-tab close of an operator handoff keeps its
  own procedure under [Stop a session](#stop-a-session).
- Run `herdr tab close <tab id>` as the last tool call. Plan no text after the call.
- If the session cannot close itself, a check fails, or a command fails, close nothing more and stay open. Tell the user
  that the session cannot close itself. After a failed check or command, give the command and output. The user closes
  the pane in herdr.
- A permission prompt during `herdr agent list`, `herdr tab get`, `herdr tab close`, or `herdr pane get` puts the
  session in `blocked`. Only the user answers it. No one tested these prompts.
- Failed own-session closure does not change the end of the operator's or planner's role. Only step 13 waits for the
  operator's pane to close.
- Own-session closure is not [Stop a session](#stop-a-session). Do not run that section's stop steps for own closure.
- Before step 8, the operator runs the environment and agent-list checks above. If both pass, its delegation gives the
  `pane_id` of its own row. Otherwise, the delegation states that it gives no pane id. A session that the user opened in
  a pane still gives its pane id, although it cannot close itself. A pi operator runs the pi row check in place of the
  agent-list check.
- At step 13, run `herdr pane get <pane id>` with the id from the delegation. Exit code 1 with JSON stderr `.error.code`
  equal to `pane_not_found` proves the operator pane closed. Exit code 0 means that the pane is still open. The planner
  tells the user its pane id and closes nothing. After the next word of the user, the planner runs the operator check
  again.
- For any other exit, code, or non-JSON result, apply [the failure rule](limits.md#the-failure-rule) and report the
  command and output. With no pane id, run no read. Examples are a terminal delegation that gives no pane id and the
  user's word under [Missing roles](#missing-roles) in place of a terminal delegation.
- After a failed operator check or with no pane id, the planner cannot close itself. Its step 14 close report asks for
  no approval. Tell the user that the planner cannot close itself; the user closes its pane.
- Matching the agent row with the environment prevents a stale inherited id from closing another session's tab. The
  operator check uses a pane id, not a name. A replacement session with the same name in another pane does not prove
  closure.
- [Own-session closure](codex-sessions.md#own-session-closure) records the measured facts. Its observer read used an
  idle recipient. No one tested a busy or blocked recipient or a permission-prompt wait. No one tested the check after a
  user closed the operator pane. No one tested a reused pane id; an exit code 0 then leaves the planner waiting.

The own-session closure has these states.

| State                    | What the session does                                                                                                                                                                                                                                                                     | Who tells whom                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Not started              | Steps 1 to 8 for the operator, steps 10 to 13 for the planner, or its end up to its last report for the orchestrator                                                                                                                                                                      | None                                                  |
| Waits for the approval   | Gives its close report and closes nothing. Approval moves it to Running. An answer that returns the planner to step 10 moves it to Not started. Other answers and no answer keep this state. The orchestrator of the kind `claude` skips this state and goes from Not started to Running. | The session asks the user for approval.               |
| Running                  | Does the checks above, then runs `herdr tab close` as its last call                                                                                                                                                                                                                       | None                                                  |
| Ended: the tab is closed | No session runs                                                                                                                                                                                                                                                                           | None. The close report came before closure.           |
| Ended: no closure        | Stays open when the session cannot close itself, or when a check or a command fails.                                                                                                                                                                                                      | The session tells the user. The user closes its pane. |

### The own-session closure of a pi session

This subsection covers only a pi operator and a pi planner. A pi session is a role session of the agent kind `pi`. Each
rule of [The own-session closure](#the-own-session-closure) holds for a pi operator and a pi planner, with the changes
of this subsection. Examples are the close report before the closure, the read of `HERDR_TAB_ID` and `HERDR_PANE_ID`,
the count of the panes, the close of the tab as the last tool call, a failed command, a permission prompt and the state
table.

For an accept, a change, a rejection, a drop or no answer of the user, the bullets of
[The own-session closure](#the-own-session-closure) on these answers apply. This subsection copies none of them.

The closure rests on an assumption of the user: a pi session can close its own herdr tab. The row "The own-session
closure" of [docs/dev/pi-sessions.md](pi-sessions.md#own-session-closure) gives `not measured` for the tab and for the
process. No one tested the closure of a pi session.

#### The pi row check

The binding method is the read of [The start gate of a pi session](../sessions.md#the-start-gate-of-a-pi-session). The
session runs it for the pane `HERDR_PANE_ID`. It runs the read at the close, not at its start. The record
[K3c](pi-sessions.md#k3c-the-read-by-another-session) and the row "The binding of a session to its pane" of
[the pi records](pi-sessions.md#own-session-closure) measured this read for a test session that herdr started. K3c has
no result label.

The pi row check passes only if each of these checks passes:

- (a) The session runs `herdr agent list`. Exactly one row of `.result.agents` must have `pane_id` equal to
  `HERDR_PANE_ID`.
- (b) The `tab_id` of that row must equal `HERDR_TAB_ID`.
- (c) The session runs `test -e <agent_session.value>` on the path of that row.
- (d) The session runs `grep -m1 session_info <agent_session.value>`. The value of `"name"` must equal the own name of
  the session.

The own name is the name that [docs/dev/GLOSSARY.md](GLOSSARY.md) gives. The session read it at its start from `-n`, and
it lives for the whole session. For a pi operator it is `operator-<slug>`, and for a pi planner it is `planner-<slug>`.

`HERDR_PANE_ID` and `HERDR_TAB_ID` come from the shell of the session. At the close, they can be stale ids that the
session inherited. The pi row check guards against this case. Its purpose is the purpose of the name rule: a stale
inherited pane id or tab id must not close the tab of another session.

The check does not wait. A wait case of the start gate is a failed check. The field `name` of a row is not evidence of
the binding, because the start gate says that the field can be missing. A terminal title, a tab label, the focus of a
pane and the output of `herdr pane current --current` are not evidence either.

| Case                                                                                         | Outcome                                                                 |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| The pi session has no own name                                                               | The check fails.                                                        |
| No binding method exists, because no doc gives the read of the start gate                    | The check fails.                                                        |
| `herdr agent list` exits with an error                                                       | The check fails. The session gives the user the command and its output. |
| No row, or more than one row, has `pane_id` equal to `HERDR_PANE_ID`                         | The check fails.                                                        |
| The `tab_id` of the row differs from `HERDR_TAB_ID`                                          | The check fails.                                                        |
| The row has no `agent_session` path                                                          | The check fails.                                                        |
| `test -e` exits with 1. The file is missing. This is an answer, not an error.                | The check fails.                                                        |
| `test -e` exits with another code                                                            | The check fails. The session gives the user the command and its output. |
| `grep` exits with 1. The file holds no `session_info` line. This is an answer, not an error. | The check fails.                                                        |
| `grep` exits with 2 or another error                                                         | The check fails. The session gives the user the command and its output. |
| The name differs from the own name                                                           | The check fails.                                                        |
| Each part matches                                                                            | The check passes.                                                       |

After each failure, the pi session closes nothing and stays open. Then it tells the user that it cannot close itself,
and the user closes its pane in herdr, as [The own-session closure](#the-own-session-closure) says. If no binding method
exists, each pi row check fails. Then a pi operator gives no pane id, no pi session closes itself, and the user closes
the pane of each pi session.

The binding method has these limits:

- The binding row covers only a session that herdr started in a new pane. It does not cover the stale inherited ids of
  an older session or a first operator that the user started.
- The `agent_session` value is a path to the session file, not the native id. The read uses the file form of pi 1.1.0,
  as [K3a](pi-sessions.md#k3a-the-name-at-the-start) and [K3b](pi-sessions.md#k3b-the-own-read) record.
- Two pi sessions can hold the same own name at the same time, as [K3d](pi-sessions.md#k3d-two-sessions-with-one-name)
  records. So a stale `HERDR_PANE_ID` can name the pane of another session with the same own name. For example, while
  the old operator of a handoff still runs, two panes hold the own name `operator-<slug>`. Then the check can pass for
  the wrong pane.

#### The pane id and the operator check of a pi session

A pi operator follows the pane id rule of [The own-session closure](#the-own-session-closure), with the pi row check in
place of the agent-list check. If each check passes, its [terminal delegation](#the-terminal-delegation) gives its own
pane id. Otherwise, the terminal delegation says that it gives none. The pane id in the terminal delegation lives until
the planner closes or stops. The planner uses it at each operator check, also at a read again after the next word of the
user.

| Start of the pi operator or the pi planner                               | Outcome                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A pi planner                                                             | The pi row check looks for the own name `planner-<slug>`.                                                                                                                                 |
| A new pi operator in a handoff                                           | The pi row check looks for the own name `operator-<slug>`, not the herdr agent name `operator-<slug>-<time>`.                                                                             |
| The first pi operator, which the user starts with no `herdr agent start` | The pi row check looks for the own name. After a passed check, the pi operator gives its pane id. It cannot close itself, because the user opened it in a pane. The user closes its pane. |

For each start, a failed pi row check of the pi operator gives no pane id. Then the planner cannot close itself, and the
user closes the panes of the planner and the operator. An example is a first pi operator with no row of
`herdr agent list` for its pane.

A pi planner runs the operator check in step 13 of [The steps that end each role](#the-steps-that-end-each-role), before
its close report in step 14 of that list. It uses the same command and the same outcomes as a `claude` planner. So the
pi planner makes sure that the session of the operator closed before it closes its own session. This also holds after
the user closed the pane of the operator.

After a failed operator check, or with no pane id, a pi planner cannot close itself, as
[The own-session closure](#the-own-session-closure) says. The operator check reads a pane id, not a name. So a planner
of each kind runs it with the pane id of a pi operator, as with a `claude` operator. A pi planner runs it in the same
way for an operator of each kind.

#### A question or a refusal of pi

If pi asks a question before a tool call of the closure or of the operator check, the question is a permission prompt.
The pi operator or the pi planner that pi asked is then `blocked`, as
[A blocked session](../sessions.md#a-blocked-session) says. Only the user answers the question.

If pi or an extension of pi refuses a command of the closure, the refusal is a failed command of the closure. If pi or
an extension of pi refuses the command of the operator check, the refusal is a failed operator check.

#### Two kinds in one close

The operator and the planner of one close can be of two kinds. Then each session follows the rules of its own kind. The
name rule stays the check of a `claude` session. The pi row check is the check of a pi operator and a pi planner.

#### The facts that no one tested

The first close of a milestone with a pi operator or a pi planner is the first measure of these facts. A failed check
there has the outcome of the table of [the pi row check](#the-pi-row-check). A failed command there has the outcome of
[The own-session closure](#the-own-session-closure). In both cases, the session closes nothing, and the user closes its
pane. These facts are open:

- The values of `HERDR_TAB_ID` and `HERDR_PANE_ID` in the shell of a pi role session, for a session that herdr started
  and for a first operator that the user started in a herdr pane. No one tested this.
- The read of the start gate that a pi session runs for its own pane. The start gate covers only a read by the operator.
  No one tested this.
- A row of `herdr agent list` for the pane of a pi session that the user started with no `herdr agent start`. No one
  tested this.
- A question of pi before a tool call of the closure or of the operator check. No one tested this.
- A refusal of a command of the closure or of the operator check by pi or by an extension of pi. No one tested this.
- The operator check of a planner of one kind after the closure of an operator of another kind. No one tested this.
- The field `name` in the row of a pi role session at the close, a long time after its start. The records come from
  reads soon after a `herdr agent start`. The pi row check does not use this field. No one tested this.

The row "The observer read" of [the pi records](pi-sessions.md#own-session-closure) is `not measured`. Its reads saw
only a living session. No one measured the operator check of a pi planner after the closure of a pi operator.

### The table of the close

Each actor keeps its own report of the rounds and its own state in the close. The operator also keeps the name of the
planner and the state of its terminal delegation. The planner keeps the terminal delegation and the end of the role of
the operator. The GitHub milestone keeps its own state, open or closed.

| Stage                         | Session that acts                             | Change of state                                                                                                                                                                                                                                  | Who tells whom                                                                                                                                | Outcome of a failure                                                                                                                                                           |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The orchestrator ends         | Orchestrator, then operator                   | The orchestrator of the kind `claude` closes the milestone and its own tab, and the pane check shows that its pane is gone. For a pi orchestrator or with no pane id, the operator closes the tab or the pane of the orchestrator with the stop. | The orchestrator gives the operator the report that the milestone is done, with its pane id. For a stop, the operator sends the stop message. | The operator tells the user about the open pane or the failed stop. It starts no round of step 5.                                                                              |
| The rounds of the operator    | Operator                                      | A round finds nothing new.                                                                                                                                                                                                                       | The operator sends each finding to the planner.                                                                                               | The rounds end, and the close stops at this stage. The operator tells the user directly.                                                                                       |
| The questions of the operator | Operator                                      | Each open question and each open decision is resolved, as the question gate of the close says.                                                                                                                                                   | The operator gives the user the full text of each open question and each open decision. It sends each answer to its sender.                   | The operator keeps working until each open question and each open decision is resolved.                                                                                        |
| The review of the operator    | Operator                                      | After the questions, a round finds nothing new. After a round that finds something, the stage "The questions of the operator" runs again.                                                                                                        | The operator sends each finding to the planner.                                                                                               | The rounds end, and the close stops at this stage. The operator tells the user directly.                                                                                       |
| The terminal delegation       | Operator, then planner                        | The send of the terminal delegation to the planner works.                                                                                                                                                                                        | The operator sends the terminal delegation to the planner.                                                                                    | A failed send keeps the operator in its role. The operator tells the user.                                                                                                     |
| The operator closes           | Operator                                      | On the approval to close, the operator closes its own session.                                                                                                                                                                                   | The operator gives the user its close report and asks for the approval to close.                                                              | If the close report fails, the failure rule applies. If the operator cannot close itself, it tells the user, and the user closes its pane.                                     |
| The questions of the planner  | Planner                                       | Each open question and each open decision is resolved with the user.                                                                                                                                                                             | The planner talks to the user directly.                                                                                                       | The planner keeps working with the user until each open question and each open decision is resolved.                                                                           |
| The review of the planner     | Planner                                       | The reports of the drafts arrive, the planner posts or drops each draft, and a round finds nothing new. After a round that finds something, the stage "The questions of the planner" runs again.                                                 | The planner talks to the user directly.                                                                                                       | The rounds end, and the close stops at this stage. The planner tells the user directly.                                                                                        |
| The milestone guard           | Orchestrator, then planner                    | The end reads of the orchestrator and the new reads of the planner show no work left in the milestone.                                                                                                                                           | The orchestrator raises each waiting issue. The planner tells the user about new work directly.                                               | A failed read or new work keeps the milestone open. The orchestrator waits, and the planner keeps its role.                                                                    |
| The GitHub milestone closure  | Orchestrator of the kind `claude`, or planner | The milestone closes, and a new read shows its number and the state `closed`.                                                                                                                                                                    | The orchestrator gives the result in its report that the milestone is done. The planner gives the result in its close report.                 | A failed write or read keeps the session in its role for a recovery. The session tells the user.                                                                               |
| The operator check            | Planner                                       | The read of the pane id of the operator shows that its pane is gone.                                                                                                                                                                             | The planner tells the user while the pane of the operator is still open.                                                                      | With the pane still open, the planner closes nothing and reads again after the next word of the user. After a failed read or with no pane id, the planner cannot close itself. |
| The planner closes            | Planner                                       | The close report ends the role of the planner. On the approval to close, it closes its own session.                                                                                                                                              | The planner gives the user its close report and asks for the approval to close.                                                               | If the close report fails, the failure rule applies, and the planner keeps its role. If the planner cannot close itself, it tells the user, and the user closes its pane.      |

The operator does not wait in a loop for a report. If a report does not come, the operator tells the user, and the word
of the user decides.

The user can end the hold of a ticket on hold while its milestone is open and `ListAgents` shows no session
`orchestrator-<slug>` of its slug. Then the operator of that slug removes the label with
`gh issue edit <number> --remove-label "on hold"`, and it starts an orchestrator of that milestone, as "Start a session"
says. Then it sends the orchestrator the word of the user, as
[The word of the user](operator-conversations.md#the-word-of-the-user) says. If the read of `ListAgents` or the removal
fails, [the failure rule](limits.md#the-failure-rule) applies, and the operator starts no orchestrator. For a denied
command, the operator follows [A denied command of the operator](#a-denied-command-of-the-operator), and after the
command ran, it starts the orchestrator.

## A handoff

Each time that the operator does this section, it first reads `docs/dev/operator-start.md` again, as
[the doc-read rule](doc-reads.md#the-doc-read-rule) says. Then it does the steps of the text that it read.
[Start a session](#start-a-session) gives the reason and the rule of the new text. In steps 4 and 5, "Stop a session"
and "Start a session" each read the file again, because these steps can run hours after step 1.

The operator does these steps for each handoff of a follow-up planner. This also covers a session that the user started
in a tab of the user. The old session is the follow-up planner that hands off its work. The new session takes the work,
with the same name as the old session.

The operator has no part in a handoff of an orchestrator. The old orchestrator starts the new orchestrator and closes
its own tab, as [The start of the new orchestrator](handoff-orchestrator.md#the-start-of-the-new-orchestrator) says.

If a handoff of a follow-up planner is in progress at the start of a handoff of the operator, steps 1 and 2 of
[the steps of the old operator](handoff-operator.md#the-steps-of-the-old-operator) say what each operator does.

1. A recommendation "hand off now" of the old session arrives. This recommendation is a suggestion of a handoff, as
   [The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says. The operator sends the go to the session
   at once with `SendMessage`, with no question to the user. The go is a word of the operator, not a word of the user,
   so it does not start with "From the user:". The session finishes its current tasks and then does the steps of its
   handoff. If `SendMessage` fails, the operator tells the user, as [the failure rule](limits.md#the-failure-rule) says.
2. The old session sends the operator the path of its handoff file as an item. The item can also give the prompt for the
   new session.
3. The operator reads the handoff file. It takes the prompt for the new session from the code block of the file. If the
   read fails, the operator tells the user, as the failure rule says, and does not do steps 4 and 5.
4. The operator stops the old session, as [Stop a session](#stop-a-session) says.
5. The operator starts the new session, as [Start a session](#start-a-session) says. The prompt is the prompt of step 3.

If step 4 does not close the pane of the old session, the operator does not do step 5. It tells the user, as
[the failure rule](limits.md#the-failure-rule) says. In the case of more than one row, the message of
[Stop a session](#stop-a-session) is the one message.
[Two sessions with one name](../sessions.md#two-sessions-with-one-name) gives the fact of two sessions with one name.

In a handoff, these rules stay with the user:

- Only the user answers a prompt of a session in `blocked`, as [A blocked session](../sessions.md#a-blocked-session)
  says.
- After a failed `herdr agent start`, the operator does not close the new tab without the user, as
  [Start a session](#start-a-session) says.

The table gives each change of a handoff. An empty cell means that the page gives no state for that actor. For the case
of more than one row, the row "More than one row has the name" wins over the row "A close or a start fails".

| Change                         | Old session                                                                                                                                                     | Operator                                                              | New session                               | Who tells whom                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| The recommendation arrives     | Waits for the go                                                                                                                                                | Sends the go                                                          |                                           | The old session tells the operator                                                                           |
| The go arrives                 | Finishes its tasks, writes the handoff file                                                                                                                     |                                                                       |                                           | The operator tells the old session                                                                           |
| The path arrives               | Waits                                                                                                                                                           | Reads the handoff file                                                |                                           | The old session tells the operator, with an item                                                             |
| The stop                       | It runs the rounds or gives the report again, as [Session-review rounds](session-review-rounds.md) says. It sends the report of the rounds, and its pane closes | Waits for the report, then for `idle` or `done`, then closes the pane |                                           | The operator tells the old session "stop". The old session tells the operator, with the report of the rounds |
| The start                      |                                                                                                                                                                 | Starts the new session                                                | Runs, from the prompt                     | The operator starts it with `herdr agent start`                                                              |
| A close or a start fails       |                                                                                                                                                                 | Tells the user                                                        |                                           | The operator tells the user                                                                                  |
| More than one row has the name | Runs                                                                                                                                                            | Closes nothing, tells the user                                        | Not started                               | The operator tells the user                                                                                  |
| A handoff of an orchestrator   | Starts the new orchestrator, then closes its own tab by its tab id                                                                                              | Has no part                                                           | Runs, from the prompt of the handoff file | The old orchestrator starts the new orchestrator with `herdr agent start`                                    |

## A denied command of the operator

This section covers a [tool block](tasker-commands.md#the-tool-block-rule) of three kinds of call. Two of them are
commands that the operator runs itself. They are the create or change command of step 3 of
[The order of a milestone](#the-order-of-a-milestone) and the removal of the label "on hold" in
[The close of a milestone](#the-close-of-a-milestone). The third is a call of a
[write subagent](question-pane.md#terms), as
[The pane owner handles a decision](question-pane.md#the-pane-owner-handles-a-decision) says. A denied command of an
item of another session stays with the tool-block rule, apart from the item of the last paragraph of this section.

The orchestrator follows this section in the place of the operator, for a denied call of its own and of each actor of
[the table](permissions.md#the-table). The choices that the orchestrator gives hold no `!` run. A check failure keeps
its own steps, as [the tool-block rule](tasker-commands.md#the-tool-block-rule) says. The first choice depends on the
actor that got the denial:

- Task subagent: the orchestrator relays the word, and the task subagent runs the call one time, in the form of the
  word. The orchestrator never runs a task change itself, as step 5 of the denial steps says.
- Write subagent: The steps of the paragraph of [the question pane](question-pane.md#the-pane-owner-handles-a-decision)
  that starts "The commands after the denied call wait" apply.
- Planner subagent, issue subagent, opener subagent, reuse subagent and question session: the orchestrator gives the
  word to the actor that got the denial, through its starter where [the report chain](permissions.md#the-report-chain)
  says so. The orchestrator never runs that call itself.
- The orchestrator itself, also for a `git` write in its local clone: the orchestrator runs the call again one time on
  the word of the user.

This adds no rule for the operator.

If the user declined the call at a permission prompt, the command did not run. Then the operator gives no choices and
waits for a new word of the user.

After a [check failure](tasker-commands.md#the-tool-block-rule), the operator first runs the same call again one time,
in the same form, as the tool-block rule says for the orchestrator. If the try runs, the operator goes on. If the try
also gets a check failure, the next paragraph applies. The operator then also gives the user the link
https://status.claude.com/. For a call of a write subagent, the retry of the write subagent takes the place of the retry
of the operator. After its second check failure, the operator gives the choices of the next paragraph and the link at
once.

For each other denial, the operator tells the user the exact command and the folder of the call. It also gives the exact
text of the denial, the purpose of the command and its step. Then it gives the user these choices, in this order:

- The user tells the operator to run the denied command again, in the same form or in another form that the user names.
- The user tells another session directly, in that session, to run the command. The user picks that session, for example
  a session with no role.
- The user runs the exact command in the folder of the call, with the `!` prefix of Claude Code.

Only the user picks a choice. The recommendation mode of
[A decision of the user](working-with-the-user.md#a-decision-of-the-user) does not cover this choice, as that section
says for a tool block. The recommendation of the operator is the first or the second choice, never the `!` run. The
reason: the user prefers to run no command with the `!` prefix. Which of these two choices the operator recommends is
open on purpose, and the operator judges it. Until the word of the user, the operator runs the denied command in no
other form, and no part of it.

For the first choice, the operator runs the command one time, in the form that the word of the user gives. A word such
as "try again" gives no form, so the operator runs the same command in the same form. A new denial of that run starts
this section again. If that run fails in another way, the failure case of the step applies.

The operator never asks another session to run the denied command, or a part of it. It also relays no word of the user
to another session to run it. Permission laundering is the run of a denied command by another session on a relayed
request. That run uses the permissions of the other session in place of the denial. As a result, the operator starts no
permission laundering. A word of the user that a session relays answers no permission prompt.

For the second choice, the operator tells the user to give the word in the other session itself. It gives the user the
exact command and the folder of the call for that session, and it sends that session nothing. As a result, the other
session runs the command only on the direct word of the user, under its own permission rules. This paragraph and the
paragraph that starts "The operator never asks another session" win over
[The word of the user](operator-conversations.md#the-word-of-the-user). They also win over its sentence that starts "The
operator does not ask the user to relay". The other session runs the command only when its own rules permit it.

A denial in the other session is a tool block of that session, and the step of the operator stays open. For the second
and the third choice, the user tells the operator whether the command ran. Until then, the step stays open, and the
operator continues its other work. It does not wait in a loop, as [the answer-wait rule](limits.md#the-answer-wait-rule)
says for a task subagent.

The other session can send this operator an item about its denial, for example a follow-up planner of the slug. Then the
result of the second choice is "did not run", and the operator tells the user that result. For such an item, this
paragraph wins over the item steps of the tool-block rule. After the result "did not run", the operator waits for a new
word of the user. A word that picks a choice of this section starts that choice. In step 3 of "The order of a
milestone", such a word is not a new word of the user to go on.

## A blocked session

The rules of this section are in [A blocked session](../sessions.md#a-blocked-session).
