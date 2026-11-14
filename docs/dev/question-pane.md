# Question panes

This page gives the rules of a question pane. The readers of this page are the operator and each question session. The
operator reads it as a start doc, as [docs/operator.md](../operator.md) says. A question session reads it before its
first reply, as [The question session](#the-question-session) says. The reason for this page: on 2026-11-13, the user
said "pull out the rules for the question pane from the rules for the operator into its own doc".

## A question pane

### Terms

A [question pane](#a-question-pane) is a herdr pane that an opener subagent opens next to the pane of the operator. It
holds one [open question](operator-items.md#the-open-items) at a time. After a reuse, it holds the next open question.

A [question session](../sessions.md) is the Claude Code session in a question pane.

A [question run](#a-question-pane) is a series of open questions, one at a time, in the order of [Start](#start). Each
question gets a new question pane or a reuse of the pane before.

An automatic start is the start of a question pane with no word of the user, as [Start](#start) says.

A stop of a run is a case of [A question pane](#a-question-pane) that stops a run or makes it wait for the user. Two of
these stops are the end of a run in the operator chat and a request for the chat. These two stops hold until a new open
question arrives. A new open question is an open question of an item that arrives after the stop. A word of the user
that starts a pane or a run also ends these two stops.

Each other stop holds until the next word of the user in the operator chat. An automatic start can follow the word of
the user that ends a stop. This also holds for a word that starts no pane. A run that ends with no open question left
has no stop.

A [decision message](#a-question-pane) is a message with `SendMessage` from the question session to the operator. It
gives the decision of the user.

A [close request](#the-rounds-before-the-close) is a message with `SendMessage` from the operator to the question
session. It asks for the rounds of `/session-review` before the close of the pane.

An [opener subagent](#the-prompts) is a subagent of the operator that opens one question pane and starts its question
session.

A [write action](#the-question-session) is an action that the question session sends back to the operator. Each of these
is a write action:

- A write to GitHub, for example to an issue, a comment, a label, a milestone, the project board or a pull request
- A write or an edit of a file
- A git write, for example a commit, a branch or a push, apart from `git fetch origin`
- A change of tasker state
- A `herdr` command
- A change of the configuration of Claude Code
- A message to a session other than the operator

A message to the operator is not a write action. A step that the item of the sender proposes and the user approves is
also not a write action. Examples are the post of a draft, a comment and a measure. The sender does that step.

A [write subagent](#the-operator-handles-a-decision) is a subagent of the operator that does the write actions of one
settled decision message.

A context clear is a step that removes the context of the question session and keeps its pane and its Claude Code
process. The context is each prompt, each reply and each tool output that the session holds.

A clean context is the context of a question session that holds nothing of an earlier question.

A [reuse](#close-and-continue) is the context clear of a question session and the send of the session prompt of the next
question to that session.

A [reuse subagent](#the-prompts) is a subagent of the operator that does one reuse. The reuse prompt of
[The prompts](#the-prompts) gives its steps.

The after-clear read is the read of the reuse prompt that shows that the context clear took effect.

The current question of a pane is the question of the last session prompt that went to the pane.

A question pane is open from its start until the operator closes it. The pane also stops being open if the user tells
the operator that it is closed. A pane stays open through each reuse.

### Start

A pane is the default place of the conversation about an open question. The operator starts the pane of the next open
question with no word of the user. This is an automatic start. The operator makes an automatic start each time that all
of these hold:

- No pane is open.
- No [stop of a run](#terms) holds.
- No [handoff of the operator](handoff-operator.md#the-handoff-of-the-operator) is due or running.
- No [close of the milestone](operator-start.md#the-close-of-a-milestone) is due.
- The kind of the operator is `claude`.
- An open question can get an automatic start.

An example of an automatic start comes at the arrival of an item with an open question. Before that start, the operator
sends each answer of the operator for that item. A word of the user that names an open question starts a pane. A word of
the user that asks to discuss the open questions starts a run. The operator does not ask the user first whether to use a
pane or the chat.

The user can still choose the chat. A word of the user that answers a question in the chat starts no pane. A word of the
user that asks for the chat starts no pane, and it stops the run. A request for the list of open items, for one item or
for a draft also starts no pane. [The open items](operator-items.md#the-open-items) gives the reply to such a request.
The operator judges which kind of word the user gave, and this judgment is open on purpose.

The reason: on 2026-11-12, in the session operator-m16, the user said: "always open a pane for each question from now
on". On 2026-11-13, the user said to operator-docs: "always chain another pane for the next open question". On the same
day, the user also said: "Always open the next question in a pane. Don't wait for me to ask for it."

Each pane holds one question at a time, even when questions belong to one item or concern one action.

The operator opens at most one pane at a time. If one is open, the operator tells the user and starts nothing.

The next open question is the first open question in [the list order of the operator](operator-items.md#the-open-items)
that can get an automatic start. A word of the user that names an open question starts the pane of that question first.
An open question of an item that arrives later takes its place in the list order, so it can come before an older open
question. This holds before, during and after a run. The arrival line and the notification of such a question stay the
same.

A reuse for the next open question is an automatic start of the pane of that question. Each rule of this section for a
pane start holds for it, apart from the new pane and the opener subagent. The same holds for each rule for an automatic
start. The condition "No pane is open" does not apply to a reuse.

Before each pane start, each start of a reuse subagent, each [close request](#the-rounds-before-the-close) and each
close, the operator reads this page again. [Start a session](operator-start.md#start-a-session) keeps its own reread
rule.

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

The operator gives each part of this paragraph through the opener prompt or the reuse prompt of
[The prompts](#the-prompts). This also holds for the paragraphs that start "The operator gives all offered choices",
"The operator gives relevant earlier decisions" and "The operator prepares first-reply text". Before the start, the
operator gives the question session its own name and the operator's name and session ref. The operator also gives the
item id, the sender's question number, and the full question.

The operator gives all offered choices and costs, the sender's recommendation, and each draft or report path named by
the item.

The operator gives relevant earlier decisions, each marked as a decision so far. The operator marks any added reading as
a guess.

The operator prepares first-reply text that follows [The form of a reply](working-with-the-user.md#the-form-of-a-reply)
and the [issue-link rule](working-with-the-user.md#the-issue-link-rule). The operator attributes item facts and measures
to the sender. The first-reply text holds the question, the choices and costs, the recommendation, the paths and the
decisions so far.

The first-reply text gives its one question with no number. For the first-reply text, this paragraph wins over each rule
of [The form of a reply](working-with-the-user.md#the-form-of-a-reply) that numbers or lists the open questions.
Examples are the bullets that start "A reply gives all open questions in one numbered list", "The list holds each
question that is still open", "Each question has its own number" and "The list numbers from 1", and the number "1." of
the example of that section. For each other rule of that section, the question of the first-reply text counts as
question 1, for example for the full details. The reason: on 2026-11-13, the user said: "In the question pane, the
question itself no longer needs to be numbered."

[Start a session](operator-start.md#start-a-session) holds the measured fact that herdr 0.9.3 refuses a prompt with a
newline. So the opener subagent and the reuse subagent put the word `LINE-BREAK` in place of each newline of the
first-reply text. Step 3 of the opener prompt and step 6 of the reuse prompt of [The prompts](#the-prompts) give this
step. Each has one space on each side of the word. The question session puts each newline back.

The question session shows that text as its first reply and changes no word, apart from each word `LINE-BREAK`. It puts
a newline in place of each such word, as the session prompt says. Before that reply, the session shows only the start
line and does only its start reads. The paragraphs that start "Before its first reply" and "Before its start reads"
define these terms. The session uses no AskUserQuestion tool. It then waits for conversation.

The reason: on 2026-11-13, the user said in the operator chat about the first replies of the question panes: "we need to
do something about the text you send to the question pane. It needs to be formatted better in the same way that
questions are formatted here." On that day, operator-docs saw that the first replies of the question panes showed as one
block of text, with no list and no paragraph.

Before its first reply, the question session runs `git fetch origin`. Then it reads `AGENTS.md`,
[A question pane](#a-question-pane), [working with the user](working-with-the-user.md), [the rules](rules.md) and
[the doc-read rule](doc-reads.md#the-doc-read-rule). The fetch and these reads are its start reads, and the session
prompt gives them. If the fetch fails, the session reads the last successful `origin/main`, and it tells the user in its
second reply. The existing `AGENTS.md` rule for a user-facing session with no role still applies, and this rule adds
these docs to it. The rules of these docs change no word of the first-reply text.

Before its start reads, the question session shows the start line, word for word: "I read my rules first, and then I
show the question." The start line tells the user that the question follows. In the rules of this page, the start line
is not the first reply.

The reason: on 2026-11-13, the user said to operator-docs: "question pane should fetch its instructions first then show
the question". These words reverse the words of the user of 2026-11-11 in [Measured facts](#measured-facts). On the same
day, a question session reported that the user waited for its first reply while it read its docs. The start line tells
the user the cause of that wait.

The question session follows the general user-facing, simple-English, [memory](rules.md#the-memory-rule), and
[doc-read](doc-reads.md#the-doc-read-rule) rules from its start.

After the first reply, the question session can read drafts and reports, use read-only commands other than `herdr`
commands, and run `git fetch origin`. If fetch fails, it tells the user and reads the last successful `origin/main`.

The question session sends each [write action](#terms) back to the operator, in its decision message, as
[Send a decision](#send-a-decision) says. The operator starts a [write subagent](#terms) that does the action, as
[The operator handles a decision](#the-operator-handles-a-decision) says. After a close request, the question session
directs the user to the operator chat for a write action.

For a request outside its question, the question session directs the user to the operator chat.

The first reply gives no fact of the question session's own. Some bullets of “A decision of the user” ask the session to
measure or to read a rule first. These bullets hold from the second reply on.

### The prompts

This subsection holds the opener prompt, the reuse prompt and the session prompt of a question pane. The opener prompt
is the prompt of the opener subagent. The reuse prompt is the prompt of the reuse subagent. The session prompt is the
prompt of the question session.

The operator puts a value in place of each placeholder of the lists that follow the opener prompt and the reuse prompt.
It adds no other words. The operator does not write or fill the session prompt. No herdr output of a reuse goes into the
context of the operator, apart from the report of the reuse subagent.

````text question-opener
You are the opener subagent of the question pane <name> of the operator <operator name>. Do the steps that follow in order. If a step fails, do no later step, unless the step says otherwise. Close no pane and send no message to a session.
1. Run git -C <local clone> fetch origin. If the fetch fails, go on with the last origin/main.
2. Run git -C <local clone> show origin/main:docs/dev/question-pane.md. In its output, find the fenced block whose first line, at the start of a line, is ```text question-session. That block is the session prompt.
3. In the session prompt, replace each placeholder with the value of the same name in the list of values. Replace <first reply> last. In its value, put one space, the word LINE-BREAK and one space in place of each newline. Change nothing else inside its value, apart from step 4.
4. Join the lines of the session prompt into one line, with one space between two lines. Write each single quote of the result as '\''. Then put the result in single quotes.
5. Run tasker show-config --repo <repo key>. Keep .sessions.kind and the entry .sessions.models.question of the output. If .sessions.kind is not claude, do no later step.
6. Run herdr pane split <operator pane id> --direction right --cwd <local clone>. Keep the new pane id from .result.pane.pane_id of the output.
7. Run herdr agent start <name> --kind <kind> --pane <new pane id> -- -n <name> <model flags> <quoted prompt>. If it fails, still do step 8.
In step 7, <kind> is the kind of step 5, and <new pane id> is the pane id of step 6. <model flags> are --model and --effort with the values of the entry of step 5. With no entry, leave them out. <quoted prompt> is the result of step 4.
8. Run herdr pane read with the new pane id. If the pane shows no first reply, run timeout 20 bash -c 'sleep 10' and read it again. Read the pane at most 6 times. If the pane shows the first reply, the start worked. The typed prompt is not the first reply. The start line of the session prompt is also not the first reply.
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

````text question-reuse
You are the reuse subagent of the question pane <pane id>. Its question session is <name>, for the operator <operator name>. Do the steps that follow in order. If a step fails, do no later step, unless the step says otherwise. Close no pane and send no message to a session. Send no input to the pane, apart from steps 4 and 7.
1. Run git -C <local clone> fetch origin. If the fetch fails, go on with the last origin/main.
2. Run git -C <local clone> show origin/main:docs/dev/question-pane.md. In its output, find the fenced block whose first line, at the start of a line, is ```text question-session. That block is the session prompt.
3. Run herdr agent wait <pane id> --timeout 600000. If it fails or reaches its time limit, do no later step. Read the state at .result.agent.agent_status. If the state is not idle and not done, do no later step.
4. Run herdr agent get <pane id>. Keep the value at .result.agent.agent_session.value as the old session value. Then run herdr pane send-text <pane id> '/clear'. Then run herdr pane send-keys <pane id> enter.
5. This step is the after-clear read. Run herdr agent get <pane id>. The read shows the context clear if .result.agent.agent_session.value differs from the old session value and .result.agent.agent_status is idle or done. If it does not show the context clear, run timeout 20 bash -c 'sleep 10' and read again. Read at most 6 times. If no read shows the context clear, do no later step.
6. In the session prompt, replace each placeholder with the value of the same name in the list of values. Replace <first reply> last. In its value, put one space, the word LINE-BREAK and one space in place of each newline. Change nothing else inside its value.
7. Join the lines of the session prompt into one line, with one space between two lines. Keep each single quote as it is. Put the result in the shell variable PROMPT with a quoted here-document, so that the shell expands nothing in it. Run herdr pane send-text <pane id> "$PROMPT". Then run herdr pane send-keys <pane id> enter.
8. Run herdr pane read <pane id>. If the pane shows no first reply, run timeout 20 bash -c 'sleep 10' and read it again. Read the pane at most 6 times. If the pane shows the first reply, the reuse worked. The typed prompt is not the first reply. The start line of the session prompt is also not the first reply.
Your final report gives the pane id and each command with its exit code and its error. It also gives the old and the new session value, and whether the after-clear read showed the context clear. It also says whether the pane shows the first reply. Keep the report short.
The list of values: name <name>, operator name <operator name>, operator session ref <operator session ref>. The list goes on: item id <item id>, question number <question number>, local clone <local clone>.
The value of first reply is all the text after the last word FIRST-REPLY of this prompt. FIRST-REPLY <first reply>
````

- `<pane id>`: the pane id of the question pane, as the report of the opener subagent gave it.
- `<name>`: the own name of the question session. The context clear keeps it.
- `<operator name>`, `<operator session ref>` and `<local clone>`: as in the list of the opener prompt.
- `<item id>` and `<question number>`: the item id and the question number of the sender for the next question.
- `<first reply>`: the first-reply text of the next question, with its lines as the operator wrote them.

```text question-session
You are the question session <name>. You discuss one open question with the user for the operator <operator name>, with the session ref <operator session ref>. The question is number <question number> of the item <item id>. Your first reply is all the text after the last word FIRST-REPLY of this prompt, word for word. Only the next two sentences change that text. In your first reply, write a newline in place of each word LINE-BREAK. Also remove the one space on each side of it. Before that reply, do only the three steps that follow, in their order, and use no AskUserQuestion tool.
First, show the start line with no other text. The start line is: I read my rules first, and then I show the question. The start line is not your first reply. Second, run git -C <local clone> fetch origin. If the fetch fails, use the last origin/main. Tell the user about the failure in your second reply. Third, read AGENTS.md, docs/dev/question-pane.md, docs/dev/working-with-the-user.md and docs/dev/rules.md. Also read the section The doc-read rule of docs/dev/doc-reads.md. Read each file with git -C <local clone> show origin/main: and its path. The rules of these docs change no word of your first reply.
These docs give the rules of your work. Send your decision message to <operator name> with SendMessage, as the section A question pane says. If the user asks for a write action, send the action back to <operator name> in your decision message. Give the command and the undo step of the action, as the section A question pane says. A write action is a write to GitHub, a file, git, tasker state or the Claude Code configuration, or a herdr command. The fetch above is not a write action. A message to a session other than <operator name> is also a write action. <operator name> starts a subagent that does the action, or relays the action to another session. FIRST-REPLY <first reply>
```

The opener subagent and the reuse subagent read the session prompt from `origin/main` and fill it. The session prompt
holds no single quote. Step 4 of the opener prompt writes each single quote of the first-reply text so that the shell
keeps it. Step 7 of the reuse prompt keeps each single quote. The send command types the text into the session, not into
a shell.

The three blocks are the only place of the words of the three prompts. The rules of "A question pane" stay the home of
each rule that the blocks state. Step 3 of [Start a session](operator-start.md#start-a-session),
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

For a measure that changes user state, the question session also gives the command and undo step verbatim. It gives the
same for each [write action](#terms). For an action with no undo step, it says that the action has no undo step. Before
the send, the question session shows the user the command, the undo step and the text of each input file. The message
gives the word of the user that approves them verbatim.

Each command of a write action is a [plain call](issues.md#the-reads-before-the-write). Each command names its target
itself, for example with `git -C <folder>` or `gh -R <repo>`. If a command takes a file as input, for example with
`--body-file`, the command names a new path under `/tmp/tasker/<slug>/drafts/`. The slug is the slug of the operator.
The message then gives the text of the file verbatim.

For a write or an edit of a file, the message gives the absolute path and the full new text, not a command. Its undo
step gives the old text, or the delete of a new file. For a message to a session other than the operator, the message
gives the name of the session and the text verbatim. Such a message has no command and no undo step.

For a change of the title or the body of an issue, the question session reads both at the start of the draft.
[Before a post](issues.md#before-a-post) gives this read. The message gives the start hash of that read. For a new
issue, the question session shows the user the blocked-by links of Before a post with the draft. The message gives these
links. The question session runs the self-check of Before a post over the text that it shows, with no file.

If the user ends without a decision, the question session sends **No decision**, the item id, and the question number.
It also sends any stated doc rule, fact, or preference.

After the send, the question session waits at its prompt for a message of the operator: what stays open, or a
[close request](#the-rounds-before-the-close). If the send fails, the question session tells the user in the pane; the
question stays open.

### The operator handles a decision

The operator accepts a decision message only from the question session of its open pane, and only for the current
question of that pane. The message gives the item id and the question number. For every other decision message, the
operator tells the user in one line, sends nothing, and keeps the state of each question.

The operator judges whether the quoted words fully settle that question, with or without choices. A settled message is
the user's decision without a second word in the operator chat.

This includes approval of a post or comment, an answer to a planner draft, and approval of a measure that changes user
state. A measure approval carries its exact command and undo step. Words that let the sender decide count as a decline
of that measure.

The operator sends a settled answer at once under [The answer](operator-items.md#the-answer). Its message starts
`From the user:`. The next line identifies question pane `<name>`. It gives the item id, question number, the user's
words, and requested draft changes.

The sender treats that message as any other `From the user:` message.

A settled message can give [write actions](#terms), as [Send a decision](#send-a-decision) says. The approval of the
user in the message covers one run of the command of each write action, word for word. Words of the user that let the
sender decide approve no write action. A message that does not settle the question starts no write subagent.

The answer of the operator to the sender names each write action and says that the operator tells the user the result.
After the answer, also after a failed send of it, the operator starts one [write subagent](#terms) for the write actions
of the message. The operator runs one write subagent at a time, and a later one starts after the earlier one ends. The
write subagent first writes each input file of the message at its path. Then it does the write actions in their order,
and it writes the full new text of each file write. It reports the exit code and the output of each command, and the
operator then tells the user the result in one line.

The write subagent keeps each rule of the docs for that kind of write. Examples are
[Before a post](issues.md#before-a-post) and [The reads before the write](issues.md#the-reads-before-the-write), with
the start hash of the message. The approval of the user in the message is the approval of Before a post. It also covers
each write that such a rule adds to the action, for example the links of a new issue. If such a rule gives a step with
the user, the write subagent stops before that write and reports. The operator then tells the user, and the action does
not run.

The operator relays two kinds of write action under
[The word of the user](operator-conversations.md#the-word-of-the-user), also to a session of another slug. The first
kind is a message to a session other than the operator. The second kind is a `tasker` command that
[the operator page](../operator.md) does not permit. The write subagent runs only the `tasker` commands that the
operator page permits. The operator relays such a `tasker` command to the orchestrator of the milestone of the issue of
the command. If the command names no issue, or no such orchestrator runs, the operator tells the user, and the action
does not run.

If a command fails, the write subagent runs nothing more, also no undo step, and it reports the state that stays. A
failed command is a command that cannot start or that exits with an error. A write that "The reads before the write"
skips also counts as a failed command. The operator then tells the user the command and the error, as
[the failure rule](limits.md#the-failure-rule) says. If the write subagent ends with no report, the operator tells the
user that the results are not known.

A call of the write subagent can get a [tool block](tasker-commands.md#the-tool-block-rule). After a check failure of
that rule, the write subagent first runs the same call again one time, in the same form. After each other tool block,
and after a second check failure, the write subagent stops. It reports the exact call, the exact text of the denial, the
folder of the call and the purpose. The operator then follows
[A denied command of the operator](operator-start.md#a-denied-command-of-the-operator) for that call.

The commands after the denied call wait for the answer of the user. If the denied call ran in any choice of that
section, the operator starts a new write subagent. It runs the commands after the denied call, under the same approval.
If the user declines the call, or the result is "did not run", the operator tells the user each command that does not
run.

The reason: on 2026-11-13, operator-docs reported that the question session question-move-522-822 ran two
`gh issue edit` calls itself. The calls moved #522 and #822 into the milestone "M31 — Orchestrator". The user then said:
"Write the rule in the positive voice: All write actions are sent back to the operator, including Github, (fill in
anything else that is appropriate). The operator spawns a subagent to perform the action." The user also approved the
list of write actions of [Terms](#terms). A message of the operator that starts with "From the user:" is a word of the
user, as [The operator](working-with-the-user.md#the-operator) says. So the operator relays a message to another session
itself.

If the words do not settle the question, the operator sends only the question session one message saying what remains
open; the pane conversation continues. The operator sends nothing to the sender.

This rule takes precedence over the two named bullets of [The answer](operator-items.md#the-answer). If the return
message fails, the failure rule applies and the run stops until the user speaks.

A decision message covers only its question. It does not approve a Claude Code permission prompt or a `tasker` setting
outside its write actions. A write action of a settled message is a request of the user for its `tasker` command.
[The operator page](../operator.md) needs such a request before the operator sets a value with a `tasker` command.

A **No decision** message leaves the question open. The operator closes the pane or gives it a reuse, as
[Close and continue](#close-and-continue) says. That question gets no automatic start, and only a word of the user that
names it starts its pane again.

The operator relays stated doc rules, facts, and preferences to `planner-<slug>`. If the planner is the sender, the
operator combines that relay with the answer. A failed relay invokes the failure rule.

### The rounds before the close

Before the operator closes or reuses a question pane, it sends the question session a close request. Then it waits for
the report of the rounds. The rule covers a close and a reuse. It holds after a settled answer, a failed answer send, a
**No decision** message and an answer in the operator chat.

The close request is this message with `SendMessage`:
`Operator: close. Run the rounds of docs/dev/session-review-rounds.md, then report.` It is a word of the operator, not a
word of the user, so it does not start with "From the user:". The operator sends at most one close request for each
question of a pane. Each question of a pane gets its own rounds before its context clear or its close. The report is not
a later pane message that an answer in the operator chat wins over.

After the close request, the question session runs the rounds of [Session-review rounds](session-review-rounds.md) with
the user in its pane. The rounds keep each rule of [The question session](#the-question-session). So the question
session skips steps 2, 4 and 5 of `/session-review`, the steps of the memory notes. Steps 4 and 5 delete notes, and step
2 serves only these steps. The question of the pane is not open work of the rounds, because the operator already holds
its state. Each proposal of step 6 goes to the operator in the report.

Each waiting decision and each open question of steps 6, 7 and 8 goes to the user in the pane, not as an item. After its
rounds end, the question session sends the report to the operator with `SendMessage`. The report gives the item id, the
question number and the parts that [Session-review rounds](session-review-rounds.md) asks for. For each decision of the
user in the rounds, it gives the words of the user word for word. It gives each waiting decision and each open question
that has no answer as an open finding.

The report leaves out each doc rule, fact or preference that the decision message already gave. After the close request,
the question session sends no decision message. For a new word of the user on the question of the pane, it directs the
user to the operator chat. If a round fails, the question session tells the user in the pane. Its rounds then end, and
the report names the failure. If the send of the report fails, the question session tells the user in the pane.

The operator accepts a report only from the question session of its open pane, for its current question, after its close
request. For each other report, the operator tells the user in one line, sends nothing and keeps the state of the
question. After a report that it accepts, the operator sends each open finding to `planner-<slug>`, with the words of
the user for that finding. The paragraph of [The operator handles a decision](#the-operator-handles-a-decision) that
starts "The operator relays" gives this relay and its failure. Then the operator decides between a reuse and a close,
also after a failed relay, as [Close and continue](#close-and-continue) says. The operator tells the user in one line
how many findings it sent, and the question keeps its state.

While the operator waits for the report, the pane is open, and the wait has no time limit. If the send of the close
request fails, the failure rule applies, the pane stays open, and the run stops until the user speaks. Before a report
arrives, the user can tell the operator to close the pane, or that the pane is closed. If the pane is still open, the
operator then closes it with no report. In both cases, the question keeps its state, and the run waits for the next word
of the user. This paragraph wins over the paragraph that starts "Before the operator closes a question pane".

The reason: on 2026-11-13, the user said to operator-docs: "file an issue to run `/session-review` in question panes
before closing". No one measured the tokens of the rounds in a question pane.

### Close and continue

After a settled answer or **No decision**, the operator gets the report of the rounds of
[The rounds before the close](#the-rounds-before-the-close). Then it gives the pane a reuse or closes it, as the next
paragraphs say. A failed answer send leaves the question answered, but the operator still makes this choice after these
rounds.

The operator makes a reuse only in one case, with each of these conditions:

- The rounds ended with a round that found nothing new, and the report names no failed round.
- The report gives no open finding.
- A next open question exists, as [Start](#start) defines it.
- Each condition of an automatic start of [Start](#start) holds for that question, apart from the condition "No pane is
  open".
- The user did not tell the operator to close the pane, or that it is closed.

In each other case, the operator closes the pane. A close with no rounds stays a close. Examples are a close that the
user asks for and the close after a report that the operator refuses.

For a reuse, the operator reads this page again. Then it starts one reuse subagent with the reuse prompt of
[The prompts](#the-prompts). The pane stays open while the reuse subagent runs. The operator gives the first-reply text
of the next question under the rules of [The question session](#the-question-session), as for a new pane.

The reuse subagent waits until the question session waits at its input prompt, in the state `idle` or `done`, with a
time limit. It sends no input to a session in a turn or in `blocked`. It runs the context clear and the after-clear
read. Only after a read that shows the context clear, it sends the session prompt of the next question. Then it reads
the pane for the first reply and reports to the operator.

After a reuse that ends with the first reply in the pane, the question session holds the next question. The rules of
[A question pane](#a-question-pane) for that question then hold, as for a pane of a new start. After the context clear,
the question session holds a clean context. The pane id, the Claude Code process and the own name of the session stay
the same. The clear changes no model and no effort.

A step of a reuse can fail or can find a session that is not ready. Then the outcome is one of these:

- The session is in `blocked`. The reuse subagent sends no input to the pane. The operator tells the user the name of
  the session and its pane id. The other rules of [A blocked session](operator-start.md#a-blocked-session) hold. The
  pane stays open, and the run stops until the user speaks.
- The wait fails or reaches its time limit. The reuse subagent sends no input to the pane. The operator closes the pane.
  The next question gets a new pane with an opener subagent, as [Start](#start) says.
- The context clear fails, or the after-clear read fails or does not show the context clear. The reuse subagent sends no
  session prompt. The operator closes the pane. The next question gets a new pane with an opener subagent.
- The send of the session prompt fails, or the pane shows no first reply. Then the paragraphs of [Start](#start) for a
  pane that shows no first reply apply. The operator tells the user the command and the error. The pane stays open, and
  the run stops until the user speaks.
- The reuse subagent ends with no report. Then the paragraph of [Start](#start) for an opener subagent that ends with no
  report applies. The pane counts as open until the user tells the operator that it is closed.
- The user tells the operator to close the pane, or that it is closed, before the reuse subagent ends. Then the operator
  waits for the report of the reuse subagent. If the pane is still open after the report, the operator closes it. The
  next question keeps its state, and the run waits for the next word of the user.
- The user ends the run before the operator starts the reuse subagent. Then the operator closes the pane. After that
  start, the reuse subagent runs to its end, and the pane continues until its close.
- A message for an earlier question of the pane arrives after the context clear, for example a late decision message.
  Then the operator refuses it, as [The operator handles a decision](#the-operator-handles-a-decision) says.

This pane close has no tab-list entry, stop message or [Stop a session](operator-start.md#stop-a-session) procedure. Its
rounds of `/session-review` are the rounds of [The rounds before the close](#the-rounds-before-the-close). For a
question pane, this section wins over the sentence "The operator stops a session only on a request of the user" of
[Stop a session](operator-start.md#stop-a-session). The word of the user that starts the pane counts as that request.
For a pane of an automatic start, the rule of the user in the reason of [Start](#start) counts as that request. A
context clear is no stop of [Stop a session](operator-start.md#stop-a-session), and the same word counts as the request
for each context clear of that pane.

The close of a question pane closes a pane, not a tab. So the sentence of [the operator page](../operator.md) that
starts "The tab list is the list of the tabs" does not limit it.

If herdr reports `pane_not_found`, the pane is already gone and the operator proceeds. For another close failure, the
operator tells the user and stops the run until the user speaks.

Before a later question, the operator reviews decisions so far and passes relevant ones as decisions so far. It does not
change the sender's question or apply an earlier answer to it. The bullet of [The answer](operator-items.md#the-answer)
that starts "An answer of the user or an answer of the operator covers only" gives this rule. The user decides the later
question in the pane of that question, with the decisions so far in view.

If no open question remains, the run ends and the operator tells the user in one line.

The user can end a run in the operator chat. An active pane continues until its close, as
[The rounds before the close](#the-rounds-before-the-close) says.

An answer in the operator chat wins over a later pane message, and the pane gets its rounds and then a reuse or a close.

If the user reports closing the pane with no decision, the question stays open and the run waits for the user's next
word. That question also gets no automatic start, as for a **No decision** message.

While a pane is open or a [write subagent](#terms) runs, the operator starts neither its handoff nor
[The close of a milestone](operator-start.md#the-close-of-a-milestone). If either is due, the operator tells the user. A
write subagent can still run after the close of its pane. The close request, the close of the pane and the next pane
start do not wait for a write subagent.

The reason: on 2026-11-13, the user said, as operator-docs relayed it: "File an issue to modify the process for closing
a question. After the session review passes with no findings, clear the session instead of closing it entirely. Then
send the prompt for the next session. This needs a verification that each question still starts in a clean context."
These words change the words of the user "always chain another pane for the next open question" of [Start](#start).
After a reuse, the next question gets the same pane.

### State table

The user holds no state of its own in this table. The column "Who tells whom" gives each step of the user.

| Event                                                                                               | Question session                                                             | Operator                                                                                                                                                                                                                        | Sender                     | Who tells whom                          |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------- |
| A word of the user starts a pane or a run                                                           | Not started                                                                  | Starts the opener subagent, which opens a pane and starts the session                                                                                                                                                           | Continues its other work   | The user tells the operator             |
| A word of the user asks for the chat or answers in the chat                                         | Not started                                                                  | Starts no pane. A word that asks for the chat stops the run. Handles an answer of the user in the chat                                                                                                                          |                            | The user tells the operator             |
| No word of the user. The conditions of an automatic start hold                                      | Not started                                                                  | Makes an automatic start for the next open question                                                                                                                                                                             | Continues its other work   |                                         |
| A word of the user starts a pane while a pane is open                                               | Running                                                                      | Starts nothing                                                                                                                                                                                                                  |                            | The operator tells the user             |
| The operator is of a kind other than `claude`                                                       | Not started                                                                  | Starts nothing                                                                                                                                                                                                                  |                            | The operator tells the user             |
| No pane opens next to the operator                                                                  | Not started                                                                  | No pane exists. A run stops                                                                                                                                                                                                     |                            | The operator tells the user             |
| The pane does not show the question                                                                 | Not started, running its start reads, or running at a prompt                 | The pane stays open. A run stops                                                                                                                                                                                                |                            | The operator tells the user             |
| The opener subagent ends with no report                                                             | Not started, running its start reads, or running at a prompt                 | The pane counts as open. A run stops                                                                                                                                                                                            |                            | The operator tells the user             |
| The session starts                                                                                  | Running. Shows the start line, does its start reads, then shows the question | The question stays open                                                                                                                                                                                                         |                            | The question session tells the user     |
| The decision message settles the question                                                           | Waits at its prompt for the close request                                    | Sends the answer and the draft changes. Sends the close request                                                                                                                                                                 | The answer starts it again | The question session tells the operator |
| The send of the answer fails                                                                        | Waits at its prompt for the close request                                    | The question stays answered. Sends the close request. The failure rule applies                                                                                                                                                  |                            | The operator tells the user             |
| The decision message does not settle it                                                             | Running                                                                      | Sends what stays open. The question stays open                                                                                                                                                                                  |                            | The operator tells the question session |
| The send of what stays open fails                                                                   | Running                                                                      | The question stays open. A run stops. The failure rule applies                                                                                                                                                                  |                            | The operator tells the user             |
| A send of the question session fails                                                                | Running                                                                      | The question stays open                                                                                                                                                                                                         |                            | The question session tells the user     |
| A "No decision" message                                                                             | Waits at its prompt for the close request                                    | Sends the close request. The question stays open with no automatic start                                                                                                                                                        |                            | The question session tells the operator |
| A message gives a rule, a fact or a preference                                                      | Waits at its prompt                                                          | Sends each one to `planner-<slug>` (see [The operator handles a decision](#the-operator-handles-a-decision))                                                                                                                    |                            | The operator tells the planner          |
| The send to `planner-<slug>` fails                                                                  | Waits at its prompt                                                          | The failure rule applies                                                                                                                                                                                                        |                            | The operator tells the user             |
| The question session gets the close request                                                         | Runs the rounds with the user. Then sends the report                         | Waits for the report. The pane stays open                                                                                                                                                                                       |                            | The operator tells the question session |
| The send of the close request fails                                                                 | Running, or waits at its prompt                                              | The pane stays open. A run stops. The failure rule applies                                                                                                                                                                      |                            | The operator tells the user             |
| A round of the question session fails                                                               | Its rounds end. Sends the report, which names the failure                    | Waits for the report                                                                                                                                                                                                            |                            | The question session tells the user     |
| The send of the report fails                                                                        | Waits at its prompt                                                          | Waits for the report. The pane stays open                                                                                                                                                                                       |                            | The question session tells the user     |
| The report of the rounds arrives, and each condition of a reuse holds                               | Waits at its prompt until the reuse                                          | Sends each open finding to `planner-<slug>`. Tells the user the number of findings. Starts the reuse subagent. The pane stays open. If this row and the row of a word of the user to close before a report match, that row wins |                            | The question session tells the operator |
| The report of the rounds arrives, and a condition of a reuse fails                                  | Waits at its prompt until the close                                          | Sends each open finding to `planner-<slug>`. Closes the pane. Tells the user the number of findings. A run goes on. If this row and the row of a word of the user to close before a report match, that row wins                 |                            | The question session tells the operator |
| The reuse subagent waits for the question session                                                   | Waits at its prompt                                                          | Waits for the report of the reuse subagent. The pane stays open. If this row and a row of a failed reuse step match, that row wins                                                                                              |                            | The operator tells the reuse subagent   |
| The question session is in `blocked` when the reuse subagent waits                                  | `blocked`                                                                    | The reuse subagent sends no input. Tells the user the name and the pane id. The pane stays open. A run stops. This row wins over the next three rows of a failed reuse step                                                     |                            | The operator tells the user             |
| The wait of the reuse subagent fails or reaches its time limit                                      | Any                                                                          | The reuse subagent sends no input. Closes the pane. The next question gets a new pane with an opener subagent. If this row and the row of a `blocked` session match, that row wins                                              |                            | The reuse subagent tells the operator   |
| The context clear fails, or the after-clear read fails or does not show the context clear           | Waits at its prompt                                                          | The reuse subagent sends no session prompt. Closes the pane. The next question gets a new pane with an opener subagent. If this row and a row of an earlier step of a reuse match, that row wins                                |                            | The reuse subagent tells the operator   |
| The send of the session prompt fails, or the pane shows no first reply                              | Waits at its prompt, or running                                              | The pane stays open. A run stops. If this row and a row of an earlier step of a reuse match, that row wins                                                                                                                      |                            | The operator tells the user             |
| The reuse subagent ends with no report                                                              | Any                                                                          | The pane counts as open. A run stops. If this row and the row of a word of the user to close before the end of the reuse subagent match, that row wins                                                                          |                            | The operator tells the user             |
| The reuse subagent ends, and the pane shows the first reply                                         | Running. Shows the start line, does its start reads, then shows the question | The question stays open. The rules of A question pane hold, as for a pane of a new start. If this row and a row of a failed reuse step match, that row wins                                                                     |                            | The question session tells the user     |
| The user tells the operator to close the pane, or that it is closed, before the reuse subagent ends | Any                                                                          | Waits for the report of the reuse subagent. If the pane is open after the report, closes it. The question keeps its state. A run waits for the word of the user. This row wins over each row of a failed reuse step             |                            | The user tells the operator             |
| The user ends the run before the operator starts the reuse subagent                                 | Waits at its prompt                                                          | Closes the pane. After that start, the reuse subagent runs to its end, and the pane continues until its close. If this row and the row of a reuse match, this row wins                                                          |                            | The user tells the operator             |
| A message for an earlier question of the pane arrives after the context clear                       | Any                                                                          | Sends nothing. Tells the user in one line. Each question keeps its state. If this row and the row of a decision message that the operator refuses match, this row wins                                                          |                            | The operator tells the user             |
| A report that the operator refuses                                                                  | Any                                                                          | Sends nothing. The question keeps its state                                                                                                                                                                                     |                            | The operator tells the user             |
| The user tells the operator to close the pane, or that it is closed, before a report                | Any                                                                          | If the pane is open, closes it with no report. The question keeps its state. A run waits for the word of the user                                                                                                               |                            | The user tells the operator             |
| The user asks the session for a step outside it                                                     | Running                                                                      | No change                                                                                                                                                                                                                       |                            | The question session tells the user     |
| The fetch of the question session fails                                                             | Running                                                                      | No change                                                                                                                                                                                                                       |                            | The question session tells the user     |
| A decision message that [the operator refuses](#the-operator-handles-a-decision)                    | Any                                                                          | Sends nothing. The question keeps its state                                                                                                                                                                                     |                            | The operator tells the user             |
| The user answers in the chat of the operator                                                        | Running until the close                                                      | Handles the answer and sends the close request                                                                                                                                                                                  | The answer starts it again | The user tells the operator             |
| The user closes the pane with no decision                                                           | Ended                                                                        | The question stays open with no automatic start. A run waits for the word of the user                                                                                                                                           |                            | The user tells the operator             |
| herdr reports that the pane is already gone                                                         | Ended                                                                        | Goes on                                                                                                                                                                                                                         |                            |                                         |
| The close fails in another way                                                                      | Running or waits at its prompt                                               | A run stops until the word of the user                                                                                                                                                                                          |                            | The operator tells the user             |
| A handoff or a close of the milestone is due while a pane is open                                   | Running                                                                      | Starts neither while the pane is open. Makes no automatic start. The word of the user decides                                                                                                                                   |                            | The operator tells the user             |
| A handoff or a close of the milestone is due, and no pane is open                                   | Not started                                                                  | Makes no automatic start                                                                                                                                                                                                        |                            |                                         |
| The user ends the run                                                                               | A running session keeps running                                              | Starts no next pane. A [stop of a run](#terms) holds                                                                                                                                                                            |                            | The user tells the operator             |
| No open question of the run is left                                                                 | Ended                                                                        | The run ends. A new open question can get an automatic start                                                                                                                                                                    |                            | The operator tells the user             |

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

On 2026-11-13, the task subagent of #910 ran one test session with herdr 0.9.3 and Claude Code 2.1.325, and the user
approved the commands. The session started in the local clone with
`herdr agent start measure-910 --kind claude --pane wB:p2M --timeout 120000 -- -n measure-910 '<prompt>'`. The entry
`sessions.models.question` was not set, so the session ran with the default model. Its status line showed
`[Opus 5.5 medium]` before the clear, after the clear and at the end. No permission prompt came up. No one measured the
wait of step 3 of the reuse prompt, and no one measured a permission that the user granted.

- 2026-11-13: `herdr pane send-text wB:p2M '/clear'` and then `herdr pane send-keys wB:p2M enter` both exited with 0.
  The pane id `wB:p2M` stayed the same. The process stayed the same: `ps -o pid=,comm= -p $PPID` in the session printed
  `2218299 claude` before the clear, and `ps -eo pid=,args=` listed the same pid after it.
- 2026-11-13: after the clear, `herdr agent wait wB:p2M --timeout 60000` exited with 0 at once. It still gave the old
  state `done` and the old `agent_session` value. A `herdr pane read wB:p2M` taken right after it still showed the old
  screen. So the after-clear read does not use a wait or a first read of the screen.
- 2026-11-13: `herdr agent get wB:p2M` right after that gave a new `agent_session` value
  (`654c25ef-14b1-4edc-88bf-dd0da34e5097` in place of `d9caf4f5-3212-4716-94db-0e7c845c96cc`) and `agent_status` `idle`.
  A later `herdr pane read wB:p2M` showed the banner, the line `/clear` and an empty input prompt, with no marker word
  of the first prompt. This is why step 5 of the reuse prompt reads `agent_session.value` and the state.
- 2026-11-13: the first line of `ListAgents` in the session gave the same own name and session ref before and after the
  clear: `This session is measure-910 [3832fc]`. A message from the session with `SendMessage` to `orchestrator-docs`
  arrived after the clear.
- 2026-11-13: the clear made a new transcript file. The record of the turns after the clear holds no text of the first
  prompt. It holds the marker word of the first prompt only from the third prompt on, because that prompt names the
  marker on purpose. The user confirmed this reading.
- 2026-11-13: the filled session prompt went in with `herdr pane send-text wB:p2M "$PROMPT2"` and then
  `herdr pane send-keys wB:p2M enter`, both with exit code 0. The text went in as one argument, with no quote step. The
  state was `working` and then `done`. The pane showed the start line, then the first reply on three lines, as the
  `LINE-BREAK` words say. The single quote in the first-reply text stayed.
- 2026-11-13: a message with `SendMessage` from `orchestrator-docs` to the name of the test session showed in the pane
  as an unread message. The session waited at its input prompt and did not read it.

For the 2026-10-25 trust-prompt fact of #519, see [#519](first-refine.md).
