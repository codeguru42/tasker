# The conversations of the operator

## A side conversation

When the user starts a topic that belongs to the planner, the operator sends it to `planner-<slug>` with `SendMessage`.
The message gives the facts and the sources of the topic. Examples are a lesson, a proposed issue and a change to a doc
or a rule.

The message gives only what its source says, apart from a reading that it marks as a guess. If the operator adds its own
reading of a source, it marks the reading as a guess, or it leaves the reading out. The operator picks the form of the
mark, for example the word "Guess:" before the reading. The reason: the planner drafts issues from the message, so an
unmarked guess can become a requirement. On 2026-10-25, operator-docs relayed a memory note about #19 to planner-docs
and added its own reading as if the note said it. Then it sent a correction.

If the operator leaves out its reading or marks it as a guess, the message names the issue or the pull request of the
fact. The receiver reads that issue or pull request for the details that the source does not give. If no issue or pull
request holds the fact, the message says so.

The operator drafts no issue. The planner sends back the report of the post or the drop, or an item about a draft that
waits for a decision of the user, as [The review loop of a draft](planner.md#the-review-loop-of-a-draft) of planner.md
says. An item has the form of [The form of an item](operator-items.md#the-form-of-an-item). If the send fails,
[the failure rule](limits.md#the-failure-rule) applies.

## The word of the user

The operator relays each instruction of the user to a session of its slug with `SendMessage`. Examples are a handoff and
a landing order. A stop is not such a relay, even on a request of the user. For a stop, the operator sends the message
of step 1 of [Stop a session](operator-start.md#stop-a-session). An installing operator also sends
[the hold before an install](release.md#the-hold-before-an-install) to each other operator. An operator relays such a
hold to its own orchestrator.

The message starts with "From the user:" and gives the words of the user. If the send fails,
[the failure rule](limits.md#the-failure-rule) applies.

A word of the user can belong to a session of another slug, for example the confirmation of a landing order of that
slug. Then the operator sends the word with `SendMessage` to the operator of that slug, with the same start. The message
asks that operator to pass the word to that session. If `ListAgents` shows no operator of that slug, the operator tells
the user. The operator asks the user first only when the word is not clear. The operator does not ask the user to relay
a word that it can send.

The paragraph of [A side conversation](#a-side-conversation) that starts "The message gives only what its source says"
also covers each such message and each answer of the user. The paragraph after it does not. On 2026-10-30, operator-m26
relayed an answer to orchestrator-m26 and added its own reading as if the user said it. Then it sent a correction.

## A question pane

### Terms

A [question pane](#a-question-pane) is a herdr pane that the operator opens next to its own pane for one
[open question](operator-items.md#the-open-items).

A [question session](../sessions.md) is the Claude Code session in a question pane.

A [question run](#a-question-pane) is a series of question panes, one at a time, for each open question of the
operator's list.

A [decision message](#a-question-pane) is a message with `SendMessage` from the question session to the operator. It
gives the decision of the user.

A question pane is open from its start until the operator closes it. The pane also stops being open if the user tells
the operator that it is closed.

### Start

The operator starts a pane only after a word of the user in the operator chat. The user can name one open question or
ask for a run; an item from another session does not start a pane.

Each pane holds one question, even when questions belong to one item or concern one action.

The operator opens at most one pane at a time. If one is open, the operator tells the user and starts nothing.

The operator takes open questions in its list order, starting with number 1. New open questions join the end of the run;
their arrival line and notification stay the same.

Before each pane start or close, the operator reads this page again.
[Start a session](operator-start.md#start-a-session) keeps its own reread rule.

The operator opens the question pane next to its pane, in a folder Claude Code trusts. An operator whose kind is not
`claude` starts no pane and tells the user.

The pane name starts with `question-` and is unique. See the
[`agent_name_taken` fact](operator-start.md#start-a-session).

If herdr does not open a pane next to the operator, the operator reports the command and error and starts no question
session. The operator stops the run.

A start succeeds when the pane shows the question as its first reply, even if herdr reports an error. If no question
appears, the operator reports the command and error, leaves the pane open, and stops the run until the user speaks.

### The question session

Before the start, the operator gives the question session its own name and the operator's name and session ref. The
operator also gives the item id, the sender's question number, and the full question.

The operator gives all offered choices and costs, the sender's recommendation, and each draft or report path named by
the item.

The operator gives relevant earlier decisions, each marked as a decision so far. The operator marks any added reading as
a guess.

The operator prepares first-reply text that follows [The form of a reply](working-with-the-user.md#the-form-of-a-reply)
and the [issue-link rule](working-with-the-user.md#the-issue-link-rule). The operator attributes item facts and measures
to the sender.

The question session shows that text as its first reply without changing a word. Before that reply, the session reads no
file, runs no command, and uses no AskUserQuestion tool. It then waits for conversation.

After its first reply, the question session reads [A question pane](#a-question-pane),
[working with the user](working-with-the-user.md), and [the rules](rules.md). The existing `AGENTS.md` rule for a
user-facing session with no role still applies.

The question session follows the general user-facing, simple-English, [memory](rules.md#the-memory-rule), and
[doc-read](doc-reads.md#the-doc-read-rule) rules from its first reply.

After the first reply, the question session can read drafts and reports, use read-only commands, and run
`git fetch origin`. If fetch fails, it tells the user and reads the last successful `origin/main`.

The question session posts nothing to GitHub, edits or writes no file, and changes no tasker state. It runs no herdr
command and messages no session except the operator.

For a request outside its question, the question session directs the user to the operator chat.

The first reply gives no fact of the question session's own. Some bullets of “A decision of the user” ask the session to
measure or to read a rule first. These bullets hold from the second reply on.

### Send a decision

The question session sends a decision when the user picks a choice, fully settles the question, or lets the sender
decide.

The decision message first gives the item id and sender's question number. It then gives the decision and the user's
settling words verbatim, each requested draft change, and each doc rule, fact, or preference the user stated.

For a measure that changes user state, the question session also gives the command and undo step verbatim.

If the user ends without a decision, the question session sends **No decision**, the item id, and the question number.
It also sends any stated doc rule, fact, or preference.

The send is the question session's last step unless the operator returns what stays open. If the send fails, the
question session tells the user in the pane; the question stays open.

### The operator handles a decision

The operator accepts a decision message only from the question session of its open pane for that question. For every
other decision message, the operator tells the user in one line, sends nothing, and keeps the question's state.

The operator judges whether the quoted words fully settle that question, with or without choices. A settled message is
the user's decision without a second word in the operator chat.

This includes approval of a post or comment, an answer to a planner draft, and approval of a measure that changes user
state. A measure approval carries its exact command and undo step. Words that let the sender decide count as a decline
of that measure.

The operator sends a settled answer at once under [The answer](operator-items.md#the-answer). Its message starts
`From the user:`. The next line identifies question pane `<name>`. It gives the item id, question number, the user's
words, and requested draft changes.

The sender treats that message as any other `From the user:` message.

If the words do not settle the question, the operator sends only the question session one message saying what remains
open; the pane conversation continues. The operator sends nothing to the sender.

This rule takes precedence over the two named bullets of [The answer](operator-items.md#the-answer). If the return
message fails, the failure rule applies and the run stops until the user speaks.

A decision message covers only its question. It does not approve a Claude Code permission prompt or a separate tasker
setting.

A **No decision** message leaves the question open. The operator closes the pane and skips that question for the rest of
this run.

The operator relays stated doc rules, facts, and preferences to `planner-<slug>`. If the planner is the sender, the
operator combines that relay with the answer. A failed relay invokes the failure rule.

### Close and continue

After a settled answer or **No decision**, the operator closes the pane without another word. A failed answer send
leaves the question answered, but the operator still closes the pane.

This pane close has no tab-list entry, stop message, session-review rounds, or
[Stop a session](operator-start.md#stop-a-session) procedure. The user's request to start the pane counts as the request
needed for its close.

If herdr reports `pane_not_found`, the pane is already gone and the operator proceeds. For another close failure, the
operator tells the user and stops the run until the user speaks.

Before a later question, the operator reviews decisions so far and passes relevant ones as decisions so far. It does not
change the sender's question or apply an earlier answer to it.

If no open question remains, the run ends and the operator tells the user in one line.

The user can end a run in the operator chat. An active pane continues until its decision message.

An answer in the operator chat wins over a later pane message, and the operator closes the pane.

If the user reports closing the pane with no decision, the question stays open and the run waits for the user's next
word.

While a pane is open, the operator starts neither its handoff nor
[The close of a milestone](operator-start.md#the-close-of-a-milestone). The operator tells the user when either is due.

### State table

The user holds no state of its own in this table. The column "Who tells whom" gives each step of the user.

| Event                                           | Question session                    | Operator                                                                               | Sender                     | Who tells whom                          |
| ----------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------- |
| The user asks for a pane or a run               | Not started                         | Opens a pane and starts the session                                                    | Continues its other work   | The user tells the operator             |
| The user asks for a pane while a pane is open   | Running                             | Starts nothing                                                                         |                            | The operator tells the user             |
| The operator is of a kind other than `claude`   | Not started                         | Starts nothing                                                                         |                            | The operator tells the user             |
| No pane opens next to the operator              | Not started                         | No pane exists. A run stops                                                            |                            | The operator tells the user             |
| The pane does not show the question             | Not started, or running at a prompt | The pane stays open. A run stops                                                       |                            | The operator tells the user             |
| The session starts                              | Running. Shows the question         | The question stays open                                                                |                            | The question session tells the user     |
| The decision message settles the question       | Waits at its prompt until the close | Sends the answer and the draft changes, closes the pane, starts the next pane of a run | The answer starts it again | The question session tells the operator |
| The send of the answer fails                    | Waits at its prompt until the close | The question stays answered. Closes the pane. The failure rule applies                 |                            | The operator tells the user             |
| The decision message does not settle it         | Running                             | Sends what stays open. The question stays open                                         |                            | The operator tells the question session |
| The send of what stays open fails               | Running                             | The question stays open. A run stops. The failure rule applies                         |                            | The operator tells the user             |
| A send of the question session fails            | Running                             | The question stays open                                                                |                            | The question session tells the user     |
| A "No decision" message                         | Waits at its prompt until the close | Closes the pane. The question stays open. A run goes on                                |                            | The question session tells the operator |
| A message gives a rule, a fact or a preference  | Waits at its prompt until the close | Sends each one to `planner-<slug>` (requirement 4.8)                                   |                            | The operator tells the planner          |
| The send to `planner-<slug>` fails              | Waits at its prompt until the close | The failure rule applies                                                               |                            | The operator tells the user             |
| The user asks the session for a step outside it | Running                             | No change                                                                              |                            | The question session tells the user     |
| The fetch of the question session fails         | Running                             | No change                                                                              |                            | The question session tells the user     |
| A decision message that requirement 4.1 refuses | Any                                 | Sends nothing. The question keeps its state                                            |                            | The operator tells the user             |
| The user answers in the chat of the operator    | Running until the close             | Handles the answer and closes the pane                                                 | The answer starts it again | The user tells the operator             |
| The user closes the pane with no decision       | Ended                               | The question stays open. A run waits for the word of the user                          |                            | The user tells the operator             |
| herdr reports that the pane is already gone     | Ended                               | Goes on                                                                                |                            |                                         |
| The close fails in another way                  | Running or waits at its prompt      | A run stops until the word of the user                                                 |                            | The operator tells the user             |
| A handoff or a close of the milestone is due    | Running                             | Starts neither while the pane is open. The word of the user decides                    |                            | The operator tells the user             |
| The user ends the run                           | A running session keeps running     | Starts no next pane                                                                    |                            | The user tells the operator             |
| No open question of the run is left             | Ended                               | The run ends                                                                           |                            | The operator tells the user             |

### Measured facts

Ad hoc planner `adhoc-m19` ran a similar procedure on 2026-11-11 and 2026-11-12 with herdr 0.9.3. An operator did not
run it. The planner asked its own questions. The answer relay to a sender, a run across items, and a start again after a
taken name did not run. No one tested them.

No one read the Claude Code version inside the question sessions. The installed `claude --version` printed
`2.1.322 (Claude Code)` on both days. Bullets without a command are observations of that run, and no session can measure
them again.

- 2026-11-11: `herdr pane split <pane id> --direction right --cwd <folder>` made a new pane to the right. Its output
  gave the new pane id in `.result.pane.pane_id`. No one tested which pane got the focus.
- 2026-11-12: `herdr agent start --help` says that `--timeout` waits for the interactive readiness. The default is 30000
  and the maximum is 300000 milliseconds.
- 2026-11-11: a `herdr agent start` with no `--timeout` exited with the error code `timeout` ("timed out waiting for
  agent startup"). The session still ran, and `herdr pane read <pane id>` showed it. See the
  [timeout fact](operator-start.md#start-a-session).
- 2026-11-11: a prompt let the question session show the question with the AskUserQuestion tool. Then
  `herdr agent start` exited with 1 and the error code `agent_not_ready`. The text was "agent ... is blocked during
  startup and is not ready for prompts". The session ran with the question open. The planner did not record the full
  command.
- 2026-11-11: after that attempt, the user said: "try one more time: show the text of the question, but don't use the
  AskQuestion tool. I expect to have a conversation before making a decision."
- 2026-11-11: after an attempt whose prompt let the question session read files first, the user said: "The first action
  is to show the question. Don't have the new session read anything. Just show the question."
- 2026-11-11: one prompt asked for the question as the first reply and banned each read before it. With that prompt, the
  question session printed the question as its first reply. It read the draft and the code during the conversation. The
  planner did not record the commands and the exit codes of these starts.
- 2026-11-12: the first reply of a question session wrote plain issue keys, not links. It had read no rule yet.
- 2026-11-12: the question session did not know where to send its decision. Then the planner gave it its session name.
  The user said: "tell the pane your id so it can send a response back". Each later prompt named the planner by the name
  of its Claude Code session, `codeguru42/tasker#850`, and gave its session ref. Each decision came back with
  `SendMessage`. See the [newline-prompt fact](operator-start.md#start-a-session).
- 2026-11-12: one pane held three questions. The user then asked for the third question in a new pane: "Tell the parent
  pane to start this in a new pane so I can discuss further." Then the user said: "For future question panes, send one
  question at a time. Do not group questions even if they are all for the same underlying action."
- 2026-11-11: two `herdr pane close <pane id>` calls failed with `pane_not_found`, because the pane was already gone.
  The cause is not known.
- 2026-11-11: one decision changed the scope of another draft. The planner wrote the next question from the decisions so
  far.

For the 2026-10-25 trust-prompt fact of #519, see [#519](first-refine.md).
