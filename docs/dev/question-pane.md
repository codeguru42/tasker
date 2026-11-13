# Question panes

This page gives the rules of a question pane. The readers of this page are the operator and each question session. The
operator reads it as a start doc, as [docs/operator.md](../operator.md) says. A question session reads it after its
first reply, as [The question session](#the-question-session) says. The reason for this page: on 2026-11-13, the user
said "pull out the rules for the question pane from the rules for the operator into its own doc".

## A question pane

### Terms

A [question pane](#a-question-pane) is a herdr pane that an opener subagent opens next to the pane of the operator for
one [open question](operator-items.md#the-open-items).

A [question session](../sessions.md) is the Claude Code session in a question pane.

A [question run](#a-question-pane) is a series of question panes, one at a time, for each open question of the
operator's list.

A [decision message](#a-question-pane) is a message with `SendMessage` from the question session to the operator. It
gives the decision of the user.

An [opener subagent](#the-prompts) is a subagent of the operator that opens one question pane and starts its question
session.

A question pane is open from its start until the operator closes it. The pane also stops being open if the user tells
the operator that it is closed.

### Start

The operator starts a pane only after a word of the user in the operator chat. An item from another session does not
start a pane. A pane is the default place of the conversation about an open question. So a word of the user that names
an open question starts a pane. A word of the user that asks to discuss the open questions starts a run. The operator
does not ask the user first whether to use a pane or the chat.

The user can still choose the chat. A word of the user that asks for the chat, or that answers a question in the chat,
starts no pane. A request for the list of open items, for one item or for a draft also starts no pane.
[The open items](operator-items.md#the-open-items) gives the reply to such a request. The operator judges which kind of
word the user gave, and this judgment is open on purpose.

The reason: on 2026-11-12, in the session operator-m16, the user said: "always open a pane for each question from now
on".

Each pane holds one question, even when questions belong to one item or concern one action.

The operator opens at most one pane at a time. If one is open, the operator tells the user and starts nothing.

The operator takes open questions in its list order, starting with number 1. New open questions join the end of the run;
their arrival line and notification stay the same.

Before each pane start or close, the operator reads this page again.
[Start a session](operator-start.md#start-a-session) keeps its own reread rule.

An operator whose kind is not `claude` starts no pane and tells the user. For each pane, the operator starts an opener
subagent with the opener prompt of [The prompts](#the-prompts). The opener subagent opens the question pane next to the
pane of the operator, in the local clone, a folder that Claude Code trusts. It starts the question session and ends with
a report to the operator.

While the opener subagent runs, the question pane counts as open. If the opener subagent ends with no report, the
operator tells the user and stops the run until the user speaks. The question pane then counts as open until the user
tells the operator that it is closed.

The pane name starts with `question-` and is unique. See the
[`agent_name_taken` fact](operator-start.md#start-a-session).

If the report of the opener subagent says that no pane opened, the operator tells the user the command and the error.
The operator stops the run.

A pane that shows the first reply is a successful start, also after an error of herdr. The report of the opener subagent
can say that the pane shows no first reply. Then the operator tells the user the command and the error. The operator
leaves the pane open and stops the run until the user speaks.

### The question session

The operator gives each part of this paragraph through the opener prompt of [The prompts](#the-prompts). This also holds
for the paragraphs that start "The operator gives all offered choices", "The operator gives relevant earlier decisions"
and "The operator prepares first-reply text". Before the start, the operator gives the question session its own name and
the operator's name and session ref. The operator also gives the item id, the sender's question number, and the full
question.

The operator gives all offered choices and costs, the sender's recommendation, and each draft or report path named by
the item.

The operator gives relevant earlier decisions, each marked as a decision so far. The operator marks any added reading as
a guess.

The operator prepares first-reply text that follows [The form of a reply](working-with-the-user.md#the-form-of-a-reply)
and the [issue-link rule](working-with-the-user.md#the-issue-link-rule). The operator attributes item facts and measures
to the sender. The first-reply text holds the question, the choices and costs, the recommendation, the paths and the
decisions so far.

[Start a session](operator-start.md#start-a-session) holds the measured fact that herdr 0.9.3 refuses a prompt with a
newline.

The question session shows that text as its first reply without changing a word. Before that reply, the session reads no
file, runs no command, and uses no AskUserQuestion tool. It then waits for conversation.

After its first reply, the question session reads [A question pane](#a-question-pane),
[working with the user](working-with-the-user.md), and [the rules](rules.md). The existing `AGENTS.md` rule for a
user-facing session with no role still applies. This rule changes only when the reads happen and adds these docs.

The question session follows the general user-facing, simple-English, [memory](rules.md#the-memory-rule), and
[doc-read](doc-reads.md#the-doc-read-rule) rules from its first reply.

After the first reply, the question session can read drafts and reports, use read-only commands, and run
`git fetch origin`. If fetch fails, it tells the user and reads the last successful `origin/main`.

The question session posts nothing to GitHub, edits or writes no file, and changes no tasker state. It runs no herdr
command and messages no session except the operator.

For a request outside its question, the question session directs the user to the operator chat.

The first reply gives no fact of the question session's own. Some bullets of “A decision of the user” ask the session to
measure or to read a rule first. These bullets hold from the second reply on.

### The prompts

This subsection holds the opener prompt and the session prompt of a question pane. The opener prompt is the prompt of
the opener subagent. The session prompt is the prompt of the question session. The operator puts a value in place of
each placeholder of the list after the opener prompt and adds no other words. The operator does not write or fill the
session prompt.

````text question-opener
You are the opener subagent of the question pane <name> of the operator <operator name>. Do the steps that follow in order. If a step fails, do no later step, unless the step says otherwise. Close no pane and send no message to a session.
1. Run git -C <local clone> fetch origin. If the fetch fails, go on with the last origin/main.
2. Run git -C <local clone> show origin/main:docs/dev/question-pane.md. In its output, find the fenced block whose first line, at the start of a line, is ```text question-session. That block is the session prompt.
3. In the session prompt, replace each placeholder with the value of the same name in the list of values. Replace <first reply> last. Change nothing inside its value, apart from the join of step 4.
4. Join the lines of the session prompt into one line, with one space between two lines. Write each single quote of the result as '\''. Then put the result in single quotes.
5. Run tasker show-config --repo <repo key>. Keep .sessions.kind and the entry .sessions.models.question of the output. If .sessions.kind is not claude, do no later step.
6. Run herdr pane split <operator pane id> --direction right --cwd <local clone>. Keep the new pane id from .result.pane.pane_id of the output.
7. Run herdr agent start <name> --kind <kind> --pane <new pane id> -- -n <name> <model flags> <quoted prompt>. If it fails, still do step 8.
In step 7, <kind> is the kind of step 5, and <new pane id> is the pane id of step 6. <model flags> are --model and --effort with the values of the entry of step 5. With no entry, leave them out. <quoted prompt> is the result of step 4.
8. Run herdr pane read with the new pane id. If the pane shows no first reply, run timeout 20 bash -c 'sleep 10' and read it again. Read the pane at most 6 times. If the pane shows the first reply, the start worked.
Your final report gives the new pane id and each command with its exit code and its error. It also says whether the pane shows the first reply. Keep the report short.
The list of values: name <name>, operator name <operator name>, operator session ref <operator session ref>. The list goes on: item id <item id>, question number <question number>, local clone <local clone>.
The value of first reply is all the text after the last word FIRST-REPLY of this prompt. FIRST-REPLY <first reply>
````

- `<name>`: the own name of the question session. It starts with `question-` and is unique.
- `<operator name>` and `<operator session ref>`: the own name and the session ref of the operator, as
  [docs/sessions.md](../sessions.md) defines them.
- `<operator pane id>`: the pane id of the operator, the value of `$HERDR_PANE_ID` in its shell.
- `<local clone>`: the path of the local clone, as [the doc-read rule](doc-reads.md#the-doc-read-rule) uses it.
- `<repo key>`: the repo key of the repo of the local clone, for example `codeguru42/tasker`.
- `<item id>` and `<question number>`: the item id and the question number of the sender.
- `<first reply>`: the first-reply text, with its lines as the operator wrote them.

```text question-session
You are the question session <name>. You discuss one open question with the user for the operator <operator name>, with the session ref <operator session ref>. The question is number <question number> of the item <item id>. Your first reply is all the text after the last word FIRST-REPLY of this prompt, word for word. Before that reply, read no file, run no command and use no AskUserQuestion tool.
After that reply, run git -C <local clone> fetch origin. If the fetch fails, tell the user, and use the last origin/main. Then read AGENTS.md, docs/dev/question-pane.md, docs/dev/working-with-the-user.md and docs/dev/rules.md. Also read the section The doc-read rule of docs/dev/doc-reads.md. Read each file with git -C <local clone> show origin/main: and its path.
These docs give the rules of your work. Send your decision message to <operator name> with SendMessage, as the section A question pane says. FIRST-REPLY <first reply>
```

The opener subagent reads the session prompt from `origin/main` and fills it. The session prompt holds no single quote.
Step 4 of the opener prompt writes each single quote of the first-reply text so that the shell keeps it.

The two blocks are the only place of the words of the two prompts. The rules of "A question pane" stay the home of each
rule that the blocks state. Step 3 of [Start a session](operator-start.md#start-a-session),
[the seam of an agent kind](../config.md#the-seam-of-an-agent-kind), [`sessions`](../config.md#sessions),
[the doc-read rule](doc-reads.md#the-doc-read-rule) and `AGENTS.md` are also such homes. An issue that changes such a
rule also changes the block. The blocks are an exception to [the one-home rule](rules.md#code).

The question session runs with the model and the effort of the entry `sessions.models.question` of
[`sessions`](../config.md#sessions). If `sessions.models` has no entry `question`, the rule of that section for a role
with no entry applies.

The reason: on 2026-11-13, operator-docs wrote the prompt of the question session in its own words at each pane start,
and the words differed. The user said: "File an issue to make it a tracked doc rather than embedded in the operator
instructions". The user then decided on an opener subagent with two prompts in a tracked doc. The user also gave a
reason for the session prompt. A session prompt that the operator writes adds tokens to the context of the operator that
a real use does not have.

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

The operator accepts a decision message only from the question session of its open pane that it started for that
question. For every other decision message, the operator tells the user in one line, sends nothing, and keeps the
question's state.

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
setting. It is not the request of the user that [the operator page](../operator.md) needs before the operator sets a
value with a `tasker` command.

A **No decision** message leaves the question open. The operator closes the pane and skips that question for the rest of
this run.

The operator relays stated doc rules, facts, and preferences to `planner-<slug>`. If the planner is the sender, the
operator combines that relay with the answer. A failed relay invokes the failure rule.

### Close and continue

After a settled answer or **No decision**, the operator closes the pane without another word. A failed answer send
leaves the question answered, but the operator still closes the pane.

This pane close has no tab-list entry, stop message, session-review rounds, or
[Stop a session](operator-start.md#stop-a-session) procedure. For a question pane, this section wins over the sentence
"The operator stops a session only on a request of the user" of [Stop a session](operator-start.md#stop-a-session). The
word of the user that starts the pane counts as that request.

The close of a question pane closes a pane, not a tab. So the sentence of [the operator page](../operator.md) that
starts "The tab list is the list of the tabs" does not limit it.

If herdr reports `pane_not_found`, the pane is already gone and the operator proceeds. For another close failure, the
operator tells the user and stops the run until the user speaks.

Before a later question, the operator reviews decisions so far and passes relevant ones as decisions so far. It does not
change the sender's question or apply an earlier answer to it. The bullet of [The answer](operator-items.md#the-answer)
that starts "An answer of the user or an answer of the operator covers only" gives this rule. The user decides the later
question in its own pane, with the decisions so far in view.

If no open question remains, the run ends and the operator tells the user in one line.

The user can end a run in the operator chat. An active pane continues until its decision message.

An answer in the operator chat wins over a later pane message, and the operator closes the pane.

If the user reports closing the pane with no decision, the question stays open and the run waits for the user's next
word.

While a pane is open, the operator starts neither its handoff nor
[The close of a milestone](operator-start.md#the-close-of-a-milestone). The operator tells the user when either is due.

### State table

The user holds no state of its own in this table. The column "Who tells whom" gives each step of the user.

| Event                                                                            | Question session                    | Operator                                                                                                     | Sender                     | Who tells whom                          |
| -------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------- | --------------------------------------- |
| A word of the user starts a pane or a run                                        | Not started                         | Starts the opener subagent, which opens a pane and starts the session                                        | Continues its other work   | The user tells the operator             |
| A word of the user asks for the chat or answers in the chat                      | Not started                         | Starts no pane. Handles an answer of the user in the chat                                                    |                            | The user tells the operator             |
| A word of the user starts a pane while a pane is open                            | Running                             | Starts nothing                                                                                               |                            | The operator tells the user             |
| The operator is of a kind other than `claude`                                    | Not started                         | Starts nothing                                                                                               |                            | The operator tells the user             |
| No pane opens next to the operator                                               | Not started                         | No pane exists. A run stops                                                                                  |                            | The operator tells the user             |
| The pane does not show the question                                              | Not started, or running at a prompt | The pane stays open. A run stops                                                                             |                            | The operator tells the user             |
| The opener subagent ends with no report                                          | Not started, or running at a prompt | The pane counts as open. A run stops                                                                         |                            | The operator tells the user             |
| The session starts                                                               | Running. Shows the question         | The question stays open                                                                                      |                            | The question session tells the user     |
| The decision message settles the question                                        | Waits at its prompt until the close | Sends the answer and the draft changes, closes the pane, starts the next pane of a run                       | The answer starts it again | The question session tells the operator |
| The send of the answer fails                                                     | Waits at its prompt until the close | The question stays answered. Closes the pane. The failure rule applies                                       |                            | The operator tells the user             |
| The decision message does not settle it                                          | Running                             | Sends what stays open. The question stays open                                                               |                            | The operator tells the question session |
| The send of what stays open fails                                                | Running                             | The question stays open. A run stops. The failure rule applies                                               |                            | The operator tells the user             |
| A send of the question session fails                                             | Running                             | The question stays open                                                                                      |                            | The question session tells the user     |
| A "No decision" message                                                          | Waits at its prompt until the close | Closes the pane. The question stays open. A run goes on                                                      |                            | The question session tells the operator |
| A message gives a rule, a fact or a preference                                   | Waits at its prompt until the close | Sends each one to `planner-<slug>` (see [The operator handles a decision](#the-operator-handles-a-decision)) |                            | The operator tells the planner          |
| The send to `planner-<slug>` fails                                               | Waits at its prompt until the close | The failure rule applies                                                                                     |                            | The operator tells the user             |
| The user asks the session for a step outside it                                  | Running                             | No change                                                                                                    |                            | The question session tells the user     |
| The fetch of the question session fails                                          | Running                             | No change                                                                                                    |                            | The question session tells the user     |
| A decision message that [the operator refuses](#the-operator-handles-a-decision) | Any                                 | Sends nothing. The question keeps its state                                                                  |                            | The operator tells the user             |
| The user answers in the chat of the operator                                     | Running until the close             | Handles the answer and closes the pane                                                                       | The answer starts it again | The user tells the operator             |
| The user closes the pane with no decision                                        | Ended                               | The question stays open. A run waits for the word of the user                                                |                            | The user tells the operator             |
| herdr reports that the pane is already gone                                      | Ended                               | Goes on                                                                                                      |                            |                                         |
| The close fails in another way                                                   | Running or waits at its prompt      | A run stops until the word of the user                                                                       |                            | The operator tells the user             |
| A handoff or a close of the milestone is due                                     | Running                             | Starts neither while the pane is open. The word of the user decides                                          |                            | The operator tells the user             |
| The user ends the run                                                            | A running session keeps running     | Starts no next pane                                                                                          |                            | The user tells the operator             |
| No open question of the run is left                                              | Ended                               | The run ends                                                                                                 |                            | The operator tells the user             |

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
  `SendMessage`.
- 2026-11-12: one pane held three questions. The user then asked for the third question in a new pane: "Tell the parent
  pane to start this in a new pane so I can discuss further." Then the user said: "For future question panes, send one
  question at a time. Do not group questions even if they are all for the same underlying action."
- 2026-11-11: two `herdr pane close <pane id>` calls failed with `pane_not_found`, because the pane was already gone.
  The cause is not known.
- 2026-11-11: one decision changed the scope of another draft. The planner wrote the next question from the decisions so
  far.

For the 2026-10-25 trust-prompt fact of #519, see [#519](first-refine.md).
