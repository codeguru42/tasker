# Start and stop the sessions of a milestone

The operator runs each `herdr` command in its own shell, in a Bash call. See [Operator](../operator.md) and
[Sessions](../sessions.md) for the terms.

## The order of a milestone

1. The user picks the slug.
2. The user runs `tasker show-config --repo <key>` and reads `sessions.models.operator`. `<key>` is the repo key of the
   repo of the local clone, for example `codeguru42/tasker`. If the command fails, the user does not open the operator.
   Then the user opens the operator in `claude` and names it `operator-<slug>`. The user passes the model and the effort
   of `sessions.models.operator` with the flags of [the seam of an agent kind](../config.md#the-seam-of-an-agent-kind),
   for example `claude -n operator-m9 --model opus --effort high`. If `sessions.models.operator` has no entry, the user
   passes neither flag.
3. The operator finds the milestone of its slug, the milestone whose title gives the slug, as
   [docs/sessions.md](../sessions.md) defines the slug. To read the milestones, the operator runs
   `gh api --paginate 'repos/codeguru42/tasker/milestones?state=all&per_page=100'`. If the read fails,
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
7. The operator starts the follow-up planner and the orchestrator, as "Start a session" says.
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

2. The operator runs `herdr tab create` in its shell. The folder of `--cwd` is the local clone.

   ```sh
   herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd <local clone> --label <name> --no-focus
   ```

   In a handoff of the operator, the operator leaves out `--no-focus`, as
   [The start of the new operator](handoff-operator.md#the-start-of-the-new-operator) says.

   The operator keeps `.result.tab.tab_id` and `.result.root_pane.pane_id` of the output. If the command works, the
   operator puts the tab id and the session name into the tab list. If the command fails, the operator tells the user
   the command and the error, as [the failure rule](limits.md#the-failure-rule) says. The operator does not do step 3.
   No tab exists, so no entry goes into the tab list.

3. Before the command, the operator joins the lines of the prompt into one line, with one space between two lines. herdr
   0.9.3 refuses a prompt with a newline, with the error "agent arguments cannot be encoded safely for the target
   shell". operator-docs measured this on 2026-10-24, in the handoff of planner-docs. Then the operator runs
   `herdr agent start` in its shell. The command starts the agent of the kind in the new pane.

   ```sh
   herdr agent start <name> --kind <kind> --pane <pane id> -- -n <name> <model flags> "<prompt>"
   ```

   In a handoff of the operator, the herdr agent name and the session name differ. The herdr agent name is
   `operator-<slug>-<time>`, and `-n` takes the session name `operator-<slug>`. "The start of the new operator" gives
   the command.

   `<kind>` is `sessions.kind`. `<model flags>` is the model flag and the effort flag of the kind in
   [the seam of an agent kind](../config.md#the-seam-of-an-agent-kind), with the model and the effort of the entry of
   the role. If `sessions.models` has no entry for the role, the operator leaves out `<model flags>`.

   `herdr agent start` can fail while the new session still starts. The known errors are "timed out waiting for agent
   startup", and "named agent `<name>` no longer owns the target terminal" with the code `agent_name_not_found`.
   `<name>` is the name of the session.

   After one of these errors, the operator first looks for the new session in `ListAgents`, or it runs
   `herdr pane read <pane id>` in its shell. The pane id is the one that step 2 kept. If the session runs, the start
   worked. If `ListAgents` does not list the new session, or `herdr pane read` fails or shows no running session, the
   failure case that follows applies. In a handoff of the operator, step 3 of "The start of the new operator" wins over
   the first sentence of this paragraph.

   operator-docs saw the timeout on 2026-10-24, in the handoff of planner-docs, and the session ran. operator-docs saw
   the error "named agent orchestrator-docs no longer owns the target terminal" (`agent_name_not_found`) on 2026-10-24,
   at the start of the new orchestrator-docs, and the session ran.

   If the command fails in another way, or the new session does not run, the operator tells the user the command and the
   error. The new tab stays open, and its entry stays in the tab list. The operator does not close the tab without the
   user. If the user closes that tab, or tells the operator to close it, the entry leaves the tab list.

The facts that follow were measured on 2026-10-24 with herdr 0.9.3 and Claude Code 2.1.310:

- Herdr sets `HERDR_WORKSPACE_ID` in each pane that it manages. As a result, the new tab opens in the workspace of the
  operator.
- The flag `-n` sets the session name, and the last argument is the first prompt of the session.
  [The seam of an agent kind](../config.md#the-seam-of-an-agent-kind) is the home of these flags.
- In the fact tests of #503 and #516, the row of a test session had the field `name`, with the herdr agent name. Each
  task subagent read the row soon after a `herdr agent start` that exited with 0. The row for a pane that
  `herdr pane report-agent` reported, with no `herdr agent start` in that pane, has no `name` field. The task subagent
  of #503 measured this with herdr 0.9.3 on 2026-10-25.
- On 2026-10-25 at about 15:40 MDT, none of the 17 rows of `herdr agent list` had a `name` field. This includes the rows
  of planner-m14 and orchestrator-m14, which `herdr agent start` started. The cause of the missing field is not known.
  The start of planner-m14 and the start of orchestrator-m14 each exited with 1 and the error code `timeout`. For the
  other rows, the result of the start is not known. operator-m14 and planner-m14 measured this with herdr 0.9.3 on
  2026-10-25.
- `herdr agent start` refuses a herdr agent name that already runs. It exits with code 1 and prints the error code
  `agent_name_taken`. The task subagent of #503 measured this with herdr 0.9.3 on 2026-10-25.
- The new session is a top-level session, not a subagent of the operator.
- The tool `SendMessage` works in both directions, and `ListAgents` lists the session.
- The model flag and the effort flag of [the seam of an agent kind](../config.md#the-seam-of-an-agent-kind) reach the
  new session. The new session runs with the model and the effort of these flags.

## The start prompts

The operator puts the milestone title in place of `<milestone>`. Each prompt is the last argument of
`herdr agent start`.

The initial planner:

```text
You are the planner of <milestone>. Run git fetch origin. Then run git show origin/main:AGENTS.md and git show origin/main:docs/planner.md. This is the initial planning: the user works with you in this tab. After the start reads, read the title and the description of the milestone. Then start the drafts of its issues.
```

The follow-up planner:

```text
You are the planner of <milestone>. This is not the initial planning. Run git fetch origin. Then run git show origin/main:AGENTS.md and git show origin/main:docs/planner.md.
```

The orchestrator:

```text
You are the orchestrator of <milestone>. Run git fetch origin. Then run git show origin/main:AGENTS.md and git show origin/main:docs/orchestrator.md. Then start.
```

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
state of the session and tells the user, as [A blocked session](#a-blocked-session) says. The word of the user then
closes the pane with no report, keeps the wait, or ends the stop. After an end of the stop, the entry stays in the tab
list.

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
A session in `blocked` is not such a session, and [A blocked session](#a-blocked-session) covers it. The operator does
step 2 only after the report of the rounds, so the session already read "stop". For a session at its input prompt, the
wait of step 2 then ends at once, and the operator does step 3. For such a session, a wait right after the send of
"stop" ends before the session reads it. The measures in the next paragraphs show this, and it is the reason for the
wait for the report.

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

The end of a role, a session closure and a GitHub milestone closure are separate outcomes.

### The start and the authority

The close starts only after the last ticket of the milestone closes and no task of the milestone is in flight. Before
its first rounds of the close, the orchestrator tells the operator in a report that the close started. The orchestrator
runs its rounds before its report that the milestone is done, as
[Pick the tickets](pick-the-tickets.md#pick-the-tickets) says. When the report that the close started arrives, the
operator tells the planner that the close started. [The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff)
keeps these reports and this word as the start of the close for each session.

The start of the close is the authority for the end of each role of the close and for the GitHub milestone closure.
These steps of the close need no other word of the user:

- The end of the role of the orchestrator, with its stop
- The end of the role of the operator
- The end of the role of the planner
- The GitHub milestone closure of a milestone with no work left

An own-session closure is a session closure that a session runs on its own herdr tab. In the close, an open question is
an open question of [The open items](operator-items.md#the-open-items). It is also an open question of step 7 of
[the session-review skill](../../.claude/skills/session-review/SKILL.md). An open decision is a decision that waits for
the user. It is a waiting decision of step 7 of [the session-review skill](../../.claude/skills/session-review/SKILL.md)
whose wait did not end. It is also a proposal or a draft that waits for a decision of the user. A close report is the
last report of the operator or of the planner to the user in the close. It asks the user for the approval to close the
session, as [The own-session closure](#the-own-session-closure) says.

The start of the close is not the authority for an own-session closure. The operator and the planner each close their
own session only on the approval of the user, as [The own-session closure](#the-own-session-closure) says. The
recommendation mode of [A decision of the user](working-with-the-user.md#a-decision-of-the-user) does not cover this
approval.

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

After the report of the orchestrator that the milestone is done arrives, the operator stops the orchestrator as
[Stop a session](#stop-a-session) says. The operator keeps each check of that section. Examples are the report of the
rounds, the row of the session, the wait, the tab list and the shared tab. The gate of that section starts "The operator
stops a session only on a request of the user". The start of the close is that request for this stop. The operator
starts its rounds of step 5 only after the stop of the orchestrator worked.

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
milestone. An example of proof is the report of the orchestrator that the milestone is done. The judgment of the proof
is open on purpose, and the operator makes it.

If no planner runs, the operator keeps its role and tells the user that no session can do the rest of the close. The
word of the user decides the next step. If no operator runs, the user tells the planner that the close started. Then the
planner gives each report to the user directly. The user stops a running orchestrator. The word of the user takes the
place of the terminal delegation for the start of step 10 of the planner.

### The steps that end each role

1. The last ticket of the milestone closes, and no task of the milestone is in flight. For a long-running milestone, for
   example "Docs", the close starts only on the word of the user.
   [The start and the authority](#the-start-and-the-authority) gives the details.
2. The orchestrator tells the operator that the close started. The operator tells the planner.
   [The start and the authority](#the-start-and-the-authority) gives the details.
3. The orchestrator runs its rounds and reports that the milestone is done.
4. The operator stops the orchestrator, as "[The orchestrator ends](#the-orchestrator-ends)" says.
5. The operator runs its rounds until a round finds nothing new. It sends each finding to the planner as a proposal.
   [The rounds of the operator](#the-rounds-of-the-operator) gives the details.
6. The operator keeps working until each open question and each open decision is resolved.
   [the question gate of the close](operator-items.md#the-question-gate-of-the-close) gives the details.
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
   session, as "[The own-session closure](#the-own-session-closure)" says.
10. At the arrival of the terminal delegation, the planner talks to the user directly. It works with the user until each
    open question and each open decision is resolved.
    [The questions and the rounds of the close](#the-questions-and-the-rounds-of-the-close) gives the details.
11. The planner runs a round. If the round finds something new, the planner handles it, goes back to step 10, and runs a
    round again. The planner goes to step 12 only after each open question and each open decision is resolved and a
    round finds nothing new. [The questions and the rounds of the close](#the-questions-and-the-rounds-of-the-close)
    gives the details.
12. The planner reads the open issues and the tasks in flight of the milestone again, to make sure that no work is left.
    This read is the milestone guard. Then the planner closes the GitHub milestone and reads it again, to make sure that
    its state is `closed`. New work or a failed read holds steps 13 and 14. [Milestones](issues.md#milestones) gives the
    details.
13. The planner makes sure that the session of the operator closed, with the operator check of
    "[The own-session closure](#the-own-session-closure)". If the pane of the operator is still open, the planner tells
    the user. After the next word of the user, it runs the operator check again. If the check shows that the session
    closed, the planner goes to step 14. After a failed check, or with no pane id, the planner also goes to step 14, but
    it cannot close itself.
14. The planner gives the user its close report and asks for the approval to close. The report says that the last round
    found nothing new. The close report ends the role of the planner. On the approval, the planner closes its own
    session, as "[The own-session closure](#the-own-session-closure)" says.

Only the operator and the planner close their own sessions in the close, each on the approval of the user.

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
  The operator and its write subagents post no new issue. This rule wins over an issue-posting write action in
  [The operator handles a decision](question-pane.md#the-operator-handles-a-decision). The operator sends that action to
  the planner as a proposal.
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

The operator and planner use this procedure after their close reports.
[Own-session closure](codex-sessions.md#own-session-closure) records the measured facts.

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
  from [The milestone of an issue](planner.md#the-milestone-of-an-issue). Do not reopen the closed milestone, as
  [Milestones](issues.md#milestones) says.
- If the operator receives such an answer, it does no work of its role because its role ended. It tells the user that
  the planner is the contact. It closes nothing until an approval.
- On another answer, such as a wait, rejection or drop, the session closes nothing and stays open. The user's word
  decides the next step.
- With no answer, the session closes nothing and stays open.
- Each agent kind uses the same closure procedure. The user assumes each kind can close its herdr tab. No one tested
  that assumption for a kind other than `claude`.
- A session that the user resumed, restarted, or opened in a pane cannot close itself. It also cannot close if it cannot
  establish its own pane, tab, and one-pane tab. Whether the session knows that the user resumed, restarted or opened it
  is open on purpose. The session judges it. No one tested those bindings.
- Read `HERDR_TAB_ID` and `HERDR_PANE_ID`. If either is unset, close nothing.
- Run `herdr agent list`. Exactly one row in `.result.agents` must have `terminal_title_stripped` equal to the session's
  own name. Its `tab_id` and `pane_id` must match the two environment variables. Otherwise, close nothing. The measured
  binding covered only a new pane started by herdr, not an older stale inherited id.
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
  `pane_id` of its own row. Otherwise, the delegation states that it gives no pane id. Item 2 does not change this rule,
  so a session that the user opened in a pane still gives its pane id.
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
  user closed the operator pane or after another agent kind closed. No one tested a reused pane id; an exit code 0 then
  leaves the planner waiting.
- The `codex` closure measures were declined on 2026-11-13, as
  [Own-session closure](codex-sessions.md#own-session-closure) records. A measured Codex display title was not its exact
  session name, so the exact-name check closes nothing and supplies no operator pane id.

| State                    | What the session does                                                                                                                                                                        | Who tells whom                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Not started              | Steps 1 to 8 for the operator, or steps 10 to 13 for the planner                                                                                                                             | None                                                  |
| Waits for the approval   | Gives its close report and closes nothing. Approval moves it to Running. An answer that returns the planner to step 10 moves it to Not started. Other answers and no answer keep this state. | The session asks the user for approval.               |
| Running                  | Does the checks above, then runs herdr tab close as its last call                                                                                                                            | None                                                  |
| Ended: the tab is closed | No session runs                                                                                                                                                                              | None. The close report came before closure.           |
| Ended: no closure        | Stays open when the session cannot close itself, or when a check or a command fails.                                                                                                         | The session tells the user. The user closes its pane. |

### The table of the close

Each actor keeps its own report of the rounds and its own state in the close. The operator also keeps the name of the
planner and the state of its terminal delegation. The planner keeps the terminal delegation and the end of the role of
the operator. The GitHub milestone keeps its own state, open or closed.

| Stage                         | Session that acts           | Change of state                                                                                                                                                                                  | Who tells whom                                                                                                              | Outcome of a failure                                                                                                                                                           |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The orchestrator ends         | Orchestrator, then operator | The report of the rounds arrives, the wait ends, and the operator closes the tab or the pane of the orchestrator.                                                                                | The orchestrator gives the operator the report that the milestone is done. The operator sends the stop message.             | The operator tells the user about the failed stop. It starts no round of step 5.                                                                                               |
| The rounds of the operator    | Operator                    | A round finds nothing new.                                                                                                                                                                       | The operator sends each finding to the planner.                                                                             | The rounds end, and the close stops at this stage. The operator tells the user directly.                                                                                       |
| The questions of the operator | Operator                    | Each open question and each open decision is resolved, as the question gate of the close says.                                                                                                   | The operator gives the user the full text of each open question and each open decision. It sends each answer to its sender. | The operator keeps working until each open question and each open decision is resolved.                                                                                        |
| The review of the operator    | Operator                    | After the questions, a round finds nothing new. After a round that finds something, the stage "The questions of the operator" runs again.                                                        | The operator sends each finding to the planner.                                                                             | The rounds end, and the close stops at this stage. The operator tells the user directly.                                                                                       |
| The terminal delegation       | Operator, then planner      | The send of the terminal delegation to the planner works.                                                                                                                                        | The operator sends the terminal delegation to the planner.                                                                  | A failed send keeps the operator in its role. The operator tells the user.                                                                                                     |
| The operator closes           | Operator                    | On the approval to close, the operator closes its own session.                                                                                                                                   | The operator gives the user its close report and asks for the approval to close.                                            | If the close report fails, the failure rule applies. If the operator cannot close itself, it tells the user, and the user closes its pane.                                     |
| The questions of the planner  | Planner                     | Each open question and each open decision is resolved with the user.                                                                                                                             | The planner talks to the user directly.                                                                                     | The planner keeps working with the user until each open question and each open decision is resolved.                                                                           |
| The review of the planner     | Planner                     | The reports of the drafts arrive, the planner posts or drops each draft, and a round finds nothing new. After a round that finds something, the stage "The questions of the planner" runs again. | The planner talks to the user directly.                                                                                     | The rounds end, and the close stops at this stage. The planner tells the user directly.                                                                                        |
| The milestone guard           | Planner                     | New reads of the open issues and the tasks in flight show no work left in the milestone.                                                                                                         | The planner tells the user about new work directly.                                                                         | A failed read or new work keeps the milestone open, and the planner keeps its role.                                                                                            |
| The GitHub milestone closure  | Planner                     | The milestone closes, and a new read shows its number and the state `closed`.                                                                                                                    | The planner gives the result in its close report.                                                                           | A failed write or read keeps the planner in its role for a recovery. The planner tells the user.                                                                               |
| The operator check            | Planner                     | The read of the pane id of the operator shows that its pane is gone.                                                                                                                             | The planner tells the user while the pane of the operator is still open.                                                    | With the pane still open, the planner closes nothing and reads again after the next word of the user. After a failed read or with no pane id, the planner cannot close itself. |
| The planner closes            | Planner                     | The close report ends the role of the planner. On the approval to close, it closes its own session.                                                                                              | The planner gives the user its close report and asks for the approval to close.                                             | If the close report fails, the failure rule applies, and the planner keeps its role. If the planner cannot close itself, it tells the user, and the user closes its pane.      |

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

The operator does these steps for each handoff of an orchestrator or a follow-up planner. This also covers a session
that the user started in a tab of the user. The old session is the orchestrator or the follow-up planner that hands off
its work. The new session takes the work, with the same name as the old session.

If a handoff of an orchestrator or a follow-up planner is in progress at the start of a handoff of the operator, steps 1
and 2 of [the steps of the old operator](handoff-operator.md#the-steps-of-the-old-operator) say what each operator does.

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
[Stop a session](#stop-a-session) is the one message. Two sessions with one name break each `SendMessage` to that name.

In a handoff, these rules stay with the user:

- Only the user answers a prompt of a session in `blocked`, as [A blocked session](#a-blocked-session) says.
- After a failed `herdr agent start`, the operator does not close the new tab without the user, as
  [Start a session](#start-a-session) says.

The table gives each change of a handoff. An empty cell means that the page gives no state for that actor. For the case
of more than one row, the row "More than one row has the name" wins over the row "A close or a start fails".

| Change                         | Old session                                                                                                                                                     | Operator                                                              | New session           | Who tells whom                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| The recommendation arrives     | Waits for the go                                                                                                                                                | Sends the go                                                          |                       | The old session tells the operator                                                                           |
| The go arrives                 | Finishes its tasks, writes the handoff file                                                                                                                     |                                                                       |                       | The operator tells the old session                                                                           |
| The path arrives               | Waits                                                                                                                                                           | Reads the handoff file                                                |                       | The old session tells the operator, with an item                                                             |
| The stop                       | It runs the rounds or gives the report again, as [Session-review rounds](session-review-rounds.md) says. It sends the report of the rounds, and its pane closes | Waits for the report, then for `idle` or `done`, then closes the pane |                       | The operator tells the old session "stop". The old session tells the operator, with the report of the rounds |
| The start                      |                                                                                                                                                                 | Starts the new session                                                | Runs, from the prompt | The operator starts it with `herdr agent start`                                                              |
| A close or a start fails       |                                                                                                                                                                 | Tells the user                                                        |                       | The operator tells the user                                                                                  |
| More than one row has the name | Runs                                                                                                                                                            | Closes nothing, tells the user                                        | Not started           | The operator tells the user                                                                                  |

## A denied command of the operator

This section covers a [tool block](tasker-commands.md#the-tool-block-rule) of three kinds of call. Two of them are
commands that the operator runs itself. They are the create or change command of step 3 of
[The order of a milestone](#the-order-of-a-milestone) and the removal of the label "on hold" in
[The close of a milestone](#the-close-of-a-milestone). The third is a call of a
[write subagent](question-pane.md#terms), as
[The operator handles a decision](question-pane.md#the-operator-handles-a-decision) says. A denied command of an item of
another session stays with the tool-block rule, apart from the item of the last paragraph of this section.

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

- When an item arrives, and when the user asks, the operator runs `herdr agent list` in its shell. If the command fails,
  [the failure rule](limits.md#the-failure-rule) applies.
- A session in `blocked` waits at a permission prompt or a question prompt in its own tab. The operator tells the user
  the name of the session and the label of its tab.
- The operator does not answer the prompt. Only the user answers it, in that tab.
