# The close of a milestone

This page gives the parts of the close of a milestone that the orchestrator uses.

This page gives the close. The close is the set of steps at the end of a milestone. The orchestrator ends first. A round
and the end of the rounds work as [Session-review rounds](session-review-rounds.md) says.

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
  or a draft that waits for a decision of the user. The end of a role, a session closure and a GitHub milestone closure
  are separate outcomes.

## The start and the authority

The close starts only after the end reads of the orchestrator find no open issue of the milestone. A ticket on hold
counts as an open issue. The orchestrator runs its rounds and its end reads first, and then it shows a report that the
close started. [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) gives these steps.
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) keeps these reports as the start of the close for
each session.

The start of the close is the authority for the end of each role of the close and for the GitHub milestone closure.
These steps of the close need no other word of the user:

- The end of the role of the orchestrator, with its own close or its stop
- The GitHub milestone closure of a milestone with no work left, by the orchestrator of the kind `claude`

For the orchestrator of the kind `claude`, the start of the close is the authority for its own close.
[The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) gives this rule.

The user still gives each approval that only the user gives: new scope, a security decision, a permission prompt and a
failed operation. [A question pane](question-pane.md#a-question-pane) holds the start of the close. The state table of
that section has the rows "A handoff or a close of the milestone is due while a pane is open" and "A handoff or a close
of the milestone is due while a write subagent runs". These rows win over the rule that the steps of the close need no
other word of the user.

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

The user stops a running pi orchestrator, and an orchestrator of the kind `claude` closes its own tab.

## The own-session closure

The orchestrator of the kind `claude` uses this procedure after its last report, with no approval, as
[The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) says.
[Own-session closure](codex-sessions.md#own-session-closure) records the measured facts.

- A session that the user resumed, restarted, or opened in a pane cannot close itself. It also cannot close if it cannot
  establish its own pane, tab, and one-pane tab. Whether the session knows that the user resumed, restarted or opened it
  is open on purpose. The session judges it. No one tested those bindings.
- For the orchestrator, the bullet before covers only a resume and a restart. A resumed or restarted orchestrator cannot
  close itself, because its ids can come from an earlier pane. The words "opened in a pane" do not cover an
  orchestrator. A start of an orchestrator is a new session in a new pane. No one measured the ids of an orchestrator
  that the user started by hand in a new tab. The row check still guards each case, as the bullet that starts "Matching
  the agent row" says.
- Read `HERDR_TAB_ID` and `HERDR_PANE_ID`. If either is unset, close nothing.
- Run `herdr agent list`. Exactly one row in `.result.agents` must have `terminal_title_stripped` equal to the session's
  own name. Its `tab_id` and `pane_id` must match the two environment variables. Otherwise, close nothing. The measured
  binding covered only a new pane started by herdr, not an older stale inherited id.
- Run `herdr tab get <tab id>`. If `.result.tab.pane_count` is not 1, close nothing. The closure measure covered only a
  one-pane tab; no one tested own closure in a tab with more panes.
- Run `herdr tab close <tab id>` as the last tool call. Plan no text after the call.
- If the session cannot close itself, a check fails, or a command fails, close nothing more and stay open. Tell the user
  that the session cannot close itself. After a failed check or command, give the command and output. The user closes
  the pane in herdr.
- A permission prompt during `herdr agent list`, `herdr tab get`, `herdr tab close`, or `herdr pane get` puts the
  session in `blocked`. Only the user answers it. No one tested these prompts.
- Matching the agent row with the environment prevents a stale inherited id from closing another session's tab.

The own-session closure has these states.

| State                    | What the session does                                                                | Who tells whom                                        |
| ------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Not started              | Its end up to its last report for the orchestrator                                   | None                                                  |
| Running                  | Does the checks above, then runs `herdr tab close` as its last call                  | None                                                  |
| Ended: the tab is closed | No session runs                                                                      | None. The last report came before closure.            |
| Ended: no closure        | Stays open when the session cannot close itself, or when a check or a command fails. | The session tells the user. The user closes its pane. |

## The table of the close

This page gives the row of the GitHub milestone closure.

| Stage                        | Session that acts                 | Change of state                                                               | Who tells whom                                                              | Outcome of a failure                                                                             |
| ---------------------------- | --------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| The GitHub milestone closure | Orchestrator of the kind `claude` | The milestone closes, and a new read shows its number and the state `closed`. | The orchestrator gives the result in its report that the milestone is done. | A failed write or read keeps the session in its role for a recovery. The session tells the user. |
