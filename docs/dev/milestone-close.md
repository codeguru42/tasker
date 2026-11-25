# The close of a milestone

This page gives the parts of the close of a milestone that the orchestrator and the operator share.
[The close of a milestone](operator-start.md#the-close-of-a-milestone) gives the steps of the operator.

This page gives the close. The close is the set of steps at the end of a milestone. The order is: the orchestrator ends
first, then the operator. A round and the end of the rounds work as [Session-review rounds](session-review-rounds.md)
says.

These terms apply on this page:

- The end of a role: the session does no more work of its role.
- A session closure ends the session on its host, for example with the close of its herdr tab.
- A GitHub milestone closure changes the state of the milestone on GitHub to `closed`.
- An own-session closure is a session closure that a session runs on its own herdr tab.
- In the close, an open question is an open question of
  [The terms of the questions](items.md#the-terms-of-the-questions). It is also an open question of step 7 of
  [the session-review skill](../../.claude/skills/session-review/SKILL.md).
- An open decision is a decision that waits for the user. It is a waiting decision of step 7 of
  [the session-review skill](../../.claude/skills/session-review/SKILL.md) whose wait did not end. It is also a proposal
  or a draft that waits for a decision of the user.
- A close report is the last report of the operator to the user in the close. It asks the user for the approval to close
  the session, as [The own-session closure](#the-own-session-closure) says.

The end of a role, a session closure and a GitHub milestone closure are separate outcomes.

## The start and the authority

The close starts only after the end reads of the orchestrator find no open issue of the milestone. A ticket on hold
counts as an open issue. The orchestrator runs its rounds and its end reads first, and then it tells the operator in a
report that the close started. [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) gives these
steps. [The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) keeps these reports as the start of the
close for each session.

The start of the close is the authority for the end of each role of the close and for the GitHub milestone closure.
These steps of the close need no other word of the user:

- The end of the role of the orchestrator, with its own close or its stop
- The end of the role of the operator
- The GitHub milestone closure of a milestone with no work left, by the orchestrator of the kind `claude`

The start of the close is not the authority for an own-session closure of the operator. The operator closes its own
session only on the approval of the user, as [The own-session closure](#the-own-session-closure) says. The
recommendation mode of [A decision of the user](working-with-the-user.md#a-decision-of-the-user) does not cover this
approval. For the orchestrator of the kind `claude`, the start of the close is the authority for its own close.
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
the order of this page. Until that word, the long-running orchestrator keeps its role and its other rules outside the
close.

## Missing roles

If no operator runs, the user stops a running pi orchestrator, and an orchestrator of the kind `claude` closes its own
tab.

## The own-session closure

The operator uses this procedure after its close report. The orchestrator of the kind `claude` uses it after its last
report, with no approval, as [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) says.
[Own-session closure](codex-sessions.md#own-session-closure) records the measured facts.

- Give the close report in the reply that asks for approval, before closing the session. Give no report after
  own-session closure.
- The operator's close report says that its last round found nothing new.
- Each close report includes the report of the rounds under [Session-review rounds](session-review-rounds.md). Give no
  other report of those rounds to the user in the close.
- Approval to close must be the user's word in that session's conversation. The close-start word, a recommendation, an
  operator answer, and a relayed word do not approve closure. This rule wins over the `From the user:` rule in
  [The operator](working-with-the-user.md#the-operator).
- An approval makes the session run its own-session closure.
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
  own procedure under [Stop a session](operator-start.md#stop-a-session).
- Run `herdr tab close <tab id>` as the last tool call. Plan no text after the call.
- If the session cannot close itself, a check fails, or a command fails, close nothing more and stay open. Tell the user
  that the session cannot close itself. After a failed check or command, give the command and output. The user closes
  the pane in herdr.
- A permission prompt during `herdr agent list`, `herdr tab get`, `herdr tab close`, or `herdr pane get` puts the
  session in `blocked`. Only the user answers it. No one tested these prompts.
- Failed own-session closure does not change the end of the operator's role.
- Own-session closure is not [Stop a session](operator-start.md#stop-a-session). Do not run that section's stop steps
  for own closure.
- Matching the agent row with the environment prevents a stale inherited id from closing another session's tab.

The own-session closure has these states.

| State                    | What the session does                                                                                                                                                                                              | Who tells whom                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Not started              | Steps 1 to 7 for the operator, or its end up to its last report for the orchestrator                                                                                                                               | None                                                  |
| Waits for the approval   | Gives its close report and closes nothing. Approval moves it to Running. Other answers and no answer keep this state. The orchestrator of the kind `claude` skips this state and goes from Not started to Running. | The session asks the user for approval.               |
| Running                  | Does the checks above, then runs `herdr tab close` as its last call                                                                                                                                                | None                                                  |
| Ended: the tab is closed | No session runs                                                                                                                                                                                                    | None. The close report came before closure.           |
| Ended: no closure        | Stays open when the session cannot close itself, or when a check or a command fails.                                                                                                                               | The session tells the user. The user closes its pane. |

## The own-session closure of a pi session

This subsection covers only a pi operator. A pi session is a role session of the agent kind `pi`. Each rule of
[The own-session closure](#the-own-session-closure) holds for a pi operator, with the changes of this subsection.
Examples are the close report before the closure, the read of `HERDR_TAB_ID` and `HERDR_PANE_ID`, the count of the
panes, the close of the tab as the last tool call, a failed command, a permission prompt and the state table.

For an accept, a change, a rejection, a drop or no answer of the user, the bullets of
[The own-session closure](#the-own-session-closure) on these answers apply. This subsection copies none of them.

The closure rests on an assumption of the user: a pi session can close its own herdr tab. The row "The own-session
closure" of [docs/dev/pi-sessions.md](pi-sessions.md#own-session-closure) gives `not measured` for the tab and for the
process. No one tested the closure of a pi session.

### The pi row check

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
it lives for the whole session. For a pi operator it is `operator-<slug>`.

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
exists, each pi row check fails. Then no pi session closes itself, and the user closes the pane of each pi session.

The binding method has these limits:

- The binding row covers only a session that herdr started in a new pane. It does not cover the stale inherited ids of
  an older session or a first operator that the user started.
- The `agent_session` value is a path to the session file, not the native id. The read uses the file form of pi 1.1.0,
  as [K3a](pi-sessions.md#k3a-the-name-at-the-start) and [K3b](pi-sessions.md#k3b-the-own-read) record.
- Two pi sessions can hold the same own name at the same time, as [K3d](pi-sessions.md#k3d-two-sessions-with-one-name)
  records. So a stale `HERDR_PANE_ID` can name the pane of another session with the same own name. For example, while
  the old operator of a handoff still runs, two panes hold the own name `operator-<slug>`. Then the check can pass for
  the wrong pane.

### The own name of a pi operator

A pi operator follows the name rule of [The own-session closure](#the-own-session-closure), with the pi row check in
place of the agent-list check.

| Start of the pi operator                                                 | Outcome                                                                                                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| A new pi operator in a handoff                                           | The pi row check looks for the own name `operator-<slug>`, not the herdr agent name `operator-<slug>-<time>`.                    |
| The first pi operator, which the user starts with no `herdr agent start` | The pi row check looks for the own name. It cannot close itself, because the user opened it in a pane. The user closes its pane. |

### A question or a refusal of pi

If pi asks a question before a tool call of the closure, the question is a permission prompt. The pi operator that pi
asked is then `blocked`, as [A blocked session](../sessions.md#a-blocked-session) says. Only the user answers the
question.

If pi or an extension of pi refuses a command of the closure, the refusal is a failed command of the closure.

### The facts that no one tested

The first close of a milestone with a pi operator is the first measure of these facts. A failed check there has the
outcome of the table of [the pi row check](#the-pi-row-check). A failed command there has the outcome of
[The own-session closure](#the-own-session-closure). In both cases, the session closes nothing, and the user closes its
pane. These facts are open:

- The values of `HERDR_TAB_ID` and `HERDR_PANE_ID` in the shell of a pi role session, for a session that herdr started
  and for a first operator that the user started in a herdr pane. No one tested this.
- The read of the start gate that a pi session runs for its own pane. The start gate covers only a read by the operator.
  No one tested this.
- A row of `herdr agent list` for the pane of a pi session that the user started with no `herdr agent start`. No one
  tested this.
- A question of pi before a tool call of the closure. No one tested this.
- A refusal of a command of the closure by pi or by an extension of pi. No one tested this.
- The field `name` in the row of a pi role session at the close, a long time after its start. The records come from
  reads soon after a `herdr agent start`. The pi row check does not use this field. No one tested this.

## The table of the close

This page gives the row of the table of [The table of the close](operator-start.md#the-table-of-the-close) for the
GitHub milestone closure.

| Stage                        | Session that acts                 | Change of state                                                               | Who tells whom                                                              | Outcome of a failure                                                                             |
| ---------------------------- | --------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| The GitHub milestone closure | Orchestrator of the kind `claude` | The milestone closes, and a new read shows its number and the state `closed`. | The orchestrator gives the result in its report that the milestone is done. | A failed write or read keeps the session in its role for a recovery. The session tells the user. |
