# Question panes

This page gives the rules of a question pane. The readers of this page are each pane owner and each question session.
The orchestrator reads it as a start doc, as [docs/orchestrator.md](../orchestrator.md) says. A question session reads
it before its first reply, as [The question session](#the-question-session) says. The reason for this page: on
2026-11-13, the user said "pull out the rules for the question pane from the rules for the operator into its own doc".

The orchestrator is the only top-level role of this page. No session sends an open question to an operator, and no
session gives an answer of an operator.

## A question pane

### Terms

A [question pane](#a-question-pane) is a herdr pane that an opener subagent opens next to the pane of its pane owner. It
holds one [open question](operator-items.md#the-open-items) at a time, even when questions belong to one item or concern
one action. After a reuse, it holds the next open question.

The rows of the opener subagent, the reuse subagent and the write subagent in [the table](permissions.md#the-table) give
the kinds of command that each of them runs.

The pane owner (short form: owner) is the session that starts a question pane. An orchestrator of each kind is a pane
owner. Each pane owner has at most one open pane.

An open question of the orchestrator is a question for the user that the orchestrator or one of its sessions asks. The
sessions are, for example, a task subagent and the follow-up planner. The orchestrator asks it in its own question pane.

Each waiting decision and each open question of the rounds of the orchestrator is also an open question of the
orchestrator. An example is a finding of [the end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator)
that needs a decision of the user.

The question id is the name of one open question. The orchestrator gives each question the next free item id of its own
counter, in the form `orchestrator-<slug>-<n>`. Each progress report of
[The operator](working-with-the-user.md#the-operator) also takes the next number of that counter. The first free item id
of the handoff file carries that counter through a handoff, as [The last item id](handoff.md#the-last-item-id) says.

At a start with no handoff file, the orchestrator reads the highest number at the end of a question id in `questions/`
of its [orchestrator folder](limits.md#the-orchestrator-folder). The first free item id is 1 more than that number. If
that folder holds no question file, the first free item id is 1. So a new question file never overwrites an old one.

If the list of `questions/` fails at such a start, the orchestrator gives item ids as usual. While the bar of the
fallback holds, it writes no question file, so no id overwrites a file. At the first list that works, the orchestrator
raises its next item id above the highest number in `questions/`.

After a stop with no handoff, a new item id can still repeat an id of the stopped session. Examples are the id of a
progress report and the id of a deleted question. The reason: the count reads only the question files.

[The glossary](GLOSSARY.md) defines a question session.

A [question run](#a-question-pane) is a series of open questions, one at a time, in the order of [Start](#start). Each
question gets a new question pane or a reuse of the pane before.

An automatic start is the start of a question pane with no word of the user, as [Start](#start) says.

The pane handoff is a message of the question session that carries its talk with the user to the old orchestrator. It
belongs to [the stopping-point case](handoff-orchestrator.md#the-stopping-point-case) of a handoff. The marker of the
pane handoff is the word `PANE-HANDOFF.` right after the header. An example is
`QUESTION-PANE w1:p2 orchestrator-m31-7 m4: PANE-HANDOFF.`

The pane handoff request is a message of the pane owner, not a word of the user. It goes with the herdr path and the
header of a message of the pane owner. It has this form:
`PANE-OWNER <owner name> <question id>: pane handoff. Send the pane handoff of docs/dev/question-pane.md with the marker PANE-HANDOFF. Send no decision message after it.`

The pane handoff file is the file in which the old orchestrator keeps the pane handoff. Its name is
`pane-handoff-<question id>-<date>-<time>.md`, and it lies in the folder of the handoff file, which is `handoffs/` of
the orchestrator folder. An example is `pane-handoff-orchestrator-m31-7-2026-11-22-1506.md`. The date and the time come
from `date +%Y-%m-%d-%H%M` at the write. A second handoff of the same question writes a new file. The write of this file
is a step of the handoff of the old orchestrator. It is not a write action of this page, and the question session sends
only the content.

The herdr path is the way that a pane owner and its question session send messages to each other. It works for each kind
of session. The sender writes the message as one line. It writes the word `LINE-BREAK` with one space on each side in
place of each newline. No one measured a newline inside `send-text`, so the one-line form stays.

The sender puts the text in the shell variable `BODY` with a quoted here-document, so that the shell expands nothing in
it. A quoted here-document does not fill in `$HERDR_PANE_ID`, so the sender writes the header outside it and joins the
header to `BODY`. Then the sender runs `herdr pane send-text`, the wait command `timeout 20 bash -c 'sleep 1'` and
`herdr pane send-keys ... enter` in one Bash call, joined with `&&`. A question session sends a message with these
lines:

```sh
IFS= read -r BODY <<'EOF'
<text of the message>
EOF
MSG="QUESTION-PANE $HERDR_PANE_ID <question id> m<n>: $BODY"
herdr pane send-text <receiver pane id> "$MSG" && timeout 20 bash -c 'sleep 1' && herdr pane send-keys <receiver pane id> enter
```

The pane owner uses the same lines, with `MSG="PANE-OWNER <owner name> <question id>: $BODY"` in place of the `MSG`
line. A message with no effective Enter stays in the pane and stops the work, and a header with the literal text
`$HERDR_PANE_ID` names no pane.

A message of the question session starts with the header `QUESTION-PANE <own pane id> <question id> m<n>:`. The own pane
id is `$HERDR_PANE_ID` in the shell of the question session. The header is the first words of a message, up to and with
the first colon that has a space after it. A pane id can hold a colon with no space after it, for example `w1:p2`. That
colon stays inside the header.

A message number is the number of one message of the question session in its question. It is the letter `m` and a whole
number from 1 up, with no leading zero and no space between them, for example `m3`. In the header, the message number is
the word after the question id, after one space. The colon follows the message number with no space, and a space follows
the colon. The question session writes the message number as literal text in the `MSG` line, outside the quoted
here-document, as it writes the question id. A part such as `m31` of the question id `orchestrator-m31-157` is no
message number.

The question session numbers its messages for the current question from `m1` up, in the order of the first send of each
message. Each new message gets the next number. Each kind of message of the question session gets a message number:

- A decision message or a **No decision** message
- A second message with the text of an input file and the approval word
- A request outside the question
- A message after the close request with a word of the user about the pane or the run
- Each report of a round and the final report

A message whose first send failed keeps its number. A later send is a send of a message again, after its first send. A
later send keeps the number of that message, so an ack answers that message, whichever copy arrived. After a reuse, the
next question has a new question id. So the count of the next question starts at `m1` again.

The reason for the message number: the question id already names the question, so a number inside the question is
enough. A number needs no choice of words. The order of the numbers shows which ack is missing. A question session
reported the case of this rule. In one session, it sent 4 messages to its pane owner and got 4 acks with the same text.
It did not know which message each ack answered.

A message of the pane owner starts with `PANE-OWNER <owner name> <question id>:` and has no message number. The pane
owner accepts each message of the question session, each report included, with one of two header forms:
`QUESTION-PANE <pane id> <question id> m<n>:` and `QUESTION-PANE <pane id> <question id>:`. The open pane id and the
current question id of the header decide the accept. The message number decides no accept and no refuse. A question
session that read this page before the message number came sends a header with no number. The pane owner refuses a
header of another form, tells the user in one line, sends nothing and keeps the state of each question.

A typed header does not prove its sender, because any pane can type it. The user did not settle the form of the header.
The form of this page is the choice of this page.

An ack is a short reply that says that a message arrived. For each message of the question session that it accepts, the
pane owner sends `PANE-OWNER <owner name> <question id>: ACK m<n>. The report arrived.` with the herdr path. `m<n>` is
the message number of the header of that message, word for word. For an accepted message with no number in its header,
the ack has no number: `PANE-OWNER <owner name> <question id>: ACK. The report arrived.` The pane owner sends no ack for
a message that it refuses.

The question session matches each ack to its own message with the same message number. After a later send of a message,
an ack with that number answers that message, whichever copy arrived. After each send, the question session waits at its
prompt for the ack. The wait has no time limit. If no ack comes, the user can ask the question session to send again. No
one measured this wait.

A report is a message that needs no answer from the user. The orchestrator shows each of its reports as text in its own
tab. A report of the follow-up planner goes to `orchestrator-<slug>`, which shows it the same way. No pane starts for a
report.

A stop of a run is a case of [A question pane](#a-question-pane) that stops a run or makes it wait for the user. Two of
these stops are the end of a run and a request for the chat of the orchestrator. These two stops hold until a new open
question arrives. A new open question is an open question that arrives after the stop. A word of the user that starts a
pane or a run also ends these two stops.

Each other stop holds until the next word of the user to the pane owner. An automatic start can follow the word of the
user that ends a stop. This also holds for a word that starts no pane. A run that ends with no open question left has no
stop.

A [decision message](#a-question-pane) is a message of the question session to the pane owner with the herdr path. It
gives the decision of the user.

A [close request](#the-rounds-before-the-close) is a message of the pane owner to the question session with the herdr
path. It asks for the rounds of `/session-review` before the close of the pane.

An [opener subagent](#the-prompts) is a subagent of the pane owner that opens one question pane and starts its question
session.

A [write action](#the-question-session) is an action that the question session sends back to the pane owner. Each of
these is a write action:

- A write to GitHub, for example to a label, a milestone, the state of an issue, the project board or a pull request
- A write of a file, apart from the pull of step 1 of [the doc-read rule](doc-reads.md#the-doc-read-rule)
- A git write, for example a commit, a branch or a push, apart from `git fetch origin` and the pull of step 1 of
  [the doc-read rule](doc-reads.md#the-doc-read-rule)
- A change of tasker state
- A `herdr` command, apart from the send of the question session to its owner pane
- A change of the configuration of Claude Code. A user-level file holds such a change. `.claude/settings.json` of the
  repo is a tracked file, so a change of it is a request, as the next paragraphs say
- A message to a session other than the pane owner

A message to the pane owner is not a write action. This also holds for a `herdr` command that sends it. A step that the
question of the sender proposes and the user approves is also not a write action. Examples are the post of a draft, a
comment and a measure. The sender does that step.

These kinds are requests, not write actions: a change of the title or the body of an issue, a comment on an issue, a
change of a blocked-by link or of the field `Priority`, and a change of a tracked file of the repo. A change of the text
of an issue and a comment count as requests only when the item of the sender did not propose them. A step that the item
proposes stays a step of the sender. [The actor of each write action](#the-actor-of-each-write-action) gives the actor
of each kind and of each request.

The metadata of an issue is its milestone, its labels, its state (open or closed) and the column of its card on the
project board. The blocked-by links and the field `Priority` are not metadata in these rules.

A metadata request is a set of words of the user in a question pane. The words ask for a change of the metadata of one
or more issues. They name the issue and the new value, for example "move #12 to M31" or "close #40". The item of the
sender did not propose the change. A question, a maybe or a thought is not a metadata request, for example "should we
move #12 to M31?" or "maybe close #40". Words that only let the sender decide are not a metadata request.

The question session judges whether the item proposed the change. This judgment is open on purpose. If the session is
not sure whether the item proposed the change, it treats the words as a metadata request. It also adds its guess that
they can be a choice of the item. The confirm question of [Send a decision](#send-a-decision) then covers that guess, as
it does for each guess. If the session is not sure that the words ask for a change, it treats them as a discussion and
sends nothing.

A metadata request covers only a change of the metadata of an issue. It covers no change of a milestone itself, for
example its description, its hold record or its close. It covers no change of the title, the body or a comment of an
issue.

A move of an issue into the milestone "Future" is not a metadata request. Such a move also removes the blocked-by links
of the issue, as the "Future" bullet of [The blocked-by links](issue-subagents.md#the-blocked-by-links) says. A
blocked-by link is not metadata, so no new metadata request can undo that removal.

A metadata request is a write action, not a request of the paragraph that starts "These kinds are requests". A metadata
change that the item of the sender proposes is a proposed step of the sender, not a metadata request.

A look-first word is a word of the user that asks to see or to approve the command of a metadata request before it runs.
Examples are "show me the command first", "ask me before you do it" and "let me approve it". The question session judges
whether words are a look-first word. This judgment is open on purpose. If the session is not sure, the words count as a
look-first word.

A user-level file is one of three files: the configuration file of tasker at the path of
[Where the file is](../config.md#where-the-file-is), `$HOME/.claude/settings.json` and `$HOME/.claude/CLAUDE.md`. Each
such file is outside the local clone and outside each worktree. An untracked file of the local clone, for example
`.claude/settings.local.json`, is not a user-level file. Another file needs a doc change first, for example a skill in
`$HOME/.claude/skills/`. The user plans a separate repo for agent config. That repo can need a new write area, and this
waits for a later decision.

For an orchestrator of the kind `claude`, the planner of the orchestrator is a new
[planner subagent](planner-subagent.md) for each request, relay or open finding. This also holds for an accepted
proposal and a recurrence. On this page, a send to such a planner is the start of a planner subagent. A failed start
counts as a failed send, as [The start](planner-subagent.md#the-start) says. For an orchestrator of another kind, the
planner of the orchestrator is `planner-<slug>`, with the slug of the orchestrator.

An input file is a file under `/tmp/tasker/<slug>/drafts/`, with the slug of the pane owner.

The start hash of a user-level file is the output of `sha256sum <path>`, or the words "no file" for a file that does not
exist.

A request for a new issue is words of the user in a question pane that ask for one or more new issues. The question did
not propose these issues. Such a request is about the question of the pane. A request about another topic stays a
request outside the question. A request for a new issue is not a write action.

A title or body request is words of the user in a question pane. The words ask for a change of the title or the body of
an issue. The item of the sender did not propose the change. A title or body request takes the form and the path of a
request for a new issue. The issue reading is the reading of the question session that names the issue of the words. The
issue reading is a guess. It goes through the confirm question of [Send a decision](#send-a-decision), as each other
guess does.

A [write subagent](#the-pane-owner-handles-a-decision) is a subagent of the pane owner. It runs one run of
write-subagent actions in a row of one settled decision message. An exception covers a decision message that does not
settle the question. For that message, a write subagent runs the metadata requests of the message, as
[The pane owner handles a decision](#the-pane-owner-handles-a-decision) says. A write subagent writes no file other than
a user-level file and an input file. It writes no memory note, as [the memory rule](rules.md#docs) says.

A context clear is a step that removes the context of the question session. The context is each prompt, each reply and
each tool output that the session holds.

A clean context is the context of a question session that holds nothing of an earlier question.

A [reuse](#close-and-continue) is the context clear of a question session and the send of the session prompt of the next
question to that session.

A [reuse subagent](#the-prompts) is a subagent of the pane owner that does one reuse. The reuse prompt of
[The prompts](#the-prompts) gives its steps.

The after-clear read is the read of the reuse prompt that shows that the context clear took effect.

The current question of a pane is the question of the last session prompt that went to the pane.

A question pane is open from its start until the pane owner closes it. The pane also stops being open if the user tells
the pane owner that it is closed. A pane stays open through each reuse.

### Start

A pane is the default place of the conversation about an open question. Each orchestrator, of each kind, starts and owns
its own panes. It starts a pane for each open question of the orchestrator and of its sessions, the follow-up planner
included. The orchestrator makes an automatic start each time that all of these hold:

- No pane of this orchestrator is open.
- No [stop of a run](#terms) holds.
- No handoff of the orchestrator is due or running, as
  [The long-running orchestrator](handoff-orchestrator.md#the-long-running-orchestrator) says.
- An open question can get an automatic start.

Each pane owner has at most one open pane. Two orchestrators can each have one open pane. The pane of one orchestrator
never holds a question of another orchestrator. A pane holds one question at a time.

The condition "No handoff of the orchestrator is due or running" holds through the whole handoff. Each open question
stays open. Its question file stays, and the handoff file holds only a question with no file, as
[The handoff file of the orchestrator](handoff-orchestrator.md#the-handoff-file-of-the-orchestrator) says. A new pane
that opens during a handoff can stay open after the close of the old orchestrator. The new orchestrator accepts a
decision message only from the question session of its own open pane, as
[The pane owner handles a decision](#the-pane-owner-handles-a-decision) says. So no orchestrator then accepts the
decision of that pane. In [the stopping-point case](handoff-orchestrator.md#the-stopping-point-case), no automatic start
and no reuse happens either. A word of the user can still start a pane.

The question that asks the user for the go of a suggested handoff of the orchestrator or of its follow-up planner can
get an automatic start, although the handoff is due. It is the only such question. After the go, until the close of its
pane and during the handoff, the condition holds for each question.
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says how the suggestion works.

On 2026-11-15, operator-m16 reported this case. It came from a handoff of operator-m16. The old operator opened and
reused question panes for about ten questions during the wait of step 1 of its handoff. The handoff took a long time.
The user asked: "did you do the handoff I requested a while ago?"

An example of an automatic start comes at the arrival of an open question. A word of the user that names an open
question starts a pane. A word of the user that asks to discuss the open questions starts a run. The orchestrator does
not first ask the user to choose a pane or its own tab.

The user can still type in the tab of the orchestrator. A word of the user that answers a question there starts no pane.
A word of the user that asks for the tab starts no pane, and it stops the run. A request for the list of open questions
also starts no pane. The orchestrator judges which kind of word the user gave, and this judgment is open on purpose.

The reason: on 2026-11-12, in the session operator-m16, the user said: "always open a pane for each question from now
on". On 2026-11-13, the user said to operator-docs: "always chain another pane for the next open question". On the same
day, the user also said: "Always open the next question in a pane. Don't wait for me to ask for it."

The orchestrator opens at most one pane at a time. If one is open, the orchestrator tells the user in its tab and starts
nothing.

The next open question is the first open question in the list order that can get an automatic start. The list order has
three keys, and a key breaks the tie of the key before it:

1. The priority: `P0`, `P1`, none, then `P2`. The read of the priority is the read of
   [The open items](operator-items.md#the-open-items). If the read fails, each question counts as a question with no
   priority.
2. The issue number: the lower number first. A question with no issue comes last within its priority.
3. The arrival: the earlier first. In one message, the lower question number of the asking session comes first.

The list order covers each [question file](#the-question-file) and each question with no file. For keys 1 and 2, the
issue of a question is the issue on the issue line of its question file. The orchestrator reads only that line for the
order. If that read fails, the question counts as a question with no issue and no priority. For key 3, the orchestrator
orders the questions by the number at the end of the question id. It compares these numbers as numbers, not as text, so
`orchestrator-m31-99` comes before `orchestrator-m31-100`.

The orchestrator gives the question ids in the arrival order of key 3. This holds for both parts of key 3. The earlier
question comes first. In one message, the lower question number of the asking session comes first. For the questions of
one result of a [planner subagent](planner-subagent.md#a-draft-that-needs-the-user), the orchestrator gives the question
ids in the order of the numbers of the result, as that section says.

A word of the user that names an open question starts the pane of that question first. An open question that arrives
later takes its place in the list order, so it can come before an older open question. This holds before, during and
after a run.

A reuse for the next open question is an automatic start of the pane of that question. Each rule of this section for a
pane start or an automatic start holds for it. The new pane, the opener subagent and the condition "No pane of this
orchestrator is open" do not apply to it.

Before each pane start, each start of a reuse subagent, each [close request](#the-rounds-before-the-close) and each
close, the orchestrator reads this page again.

At each pane start and each reuse, the orchestrator runs `herdr notification show` with `--sound request`. The text
names the orchestrator and the question id. If the command fails, the orchestrator follows
[the failure rule](limits.md#the-failure-rule) and leaves the pane open.

For each pane, the orchestrator starts an opener subagent with the opener prompt of [The prompts](#the-prompts). The
opener subagent opens the question pane next to the pane of the orchestrator, in the local clone, a folder that Claude
Code trusts. It starts the question session and ends with a report to the orchestrator.

While the opener subagent runs, the question pane counts as open. If the opener subagent ends with no report, the
orchestrator tells the user in its tab and stops the run until the user speaks. The question pane then counts as open
until the user tells the orchestrator that it is closed.

No one measured that a pi orchestrator can start an opener subagent, a reuse subagent or a write subagent. See
[`sessions`](../config.md#sessions). If a subagent cannot start, the orchestrator follows
[the failure rule](limits.md#the-failure-rule). The pane stays unstarted, and the run stops until the user speaks. For a
write subagent, the action does not run.

The pane name starts with `question-` and is unique. See the
[`agent_name_taken` fact](operator-start.md#start-a-session).

If the report of the opener subagent says that no pane opened, the orchestrator tells the user the command and the error
in its tab. The orchestrator stops the run.

A pane that shows the first reply is a successful start, also after an error of herdr. The report of the opener subagent
can say that the pane shows no first reply. Then the orchestrator tells the user the command and the error in its tab.
The orchestrator leaves the pane open and stops the run until the user speaks.

### The question file

A question file is the file `questions/<question id>.md` in the
[orchestrator folder](limits.md#the-orchestrator-folder), for example `questions/orchestrator-m31-161.md`. Each open
question of the orchestrator gets its own question file. The orchestrator folder gives the reads, the calls and the
fallback for this folder.

Each of these kinds of open question gets a question file:

- A question of the orchestrator itself
- A question of a task subagent
- A question of the follow-up planner
- A question in the result of a planner subagent
- A question of a peer request of [The request rule](../orchestrator.md#the-request-rule)
- A question that arrives while a pane is open
- A question that arrives during a handoff, before the write of the handoff file

For a peer request, the receiving orchestrator writes the question file in its own folder. The sending orchestrator is
the session that asked.

The orchestrator writes the question file at the arrival of the question, right after it gives the question id. It
writes the file before any pane start or reuse for that question. The file holds the first-reply text, as the pane owner
prepares it under [The question session](#the-question-session). If the question has an issue of the question, the file
starts with the issue line of that section. The file is plain text with no heading of its own, so its text goes into the
prompt word for word.

The question file stands alone, because the orchestrator can read it after a compaction or in a later session. It holds
each fact that the question needs, and it names the session that asks and the ticket. It names nothing that only the
context of the orchestrator holds, for example "the question before". A detail outside the five-sentence limit of The
question session goes where that section says. A path of a draft or a report comes first. The tab of the orchestrator
holds only a detail with no such path.

A part of the text can change before the pane start or the reuse of the question. An example is the decisions so far of
[Close and continue](#close-and-continue). Then the orchestrator writes the question file again before that start. If
this write fails, the fallback applies.

Before each write of a question file, the orchestrator runs the link check over the first-reply text. This covers the
first write at the arrival of the question and each later write. The orchestrator also runs the link check before it
puts a first-reply text in an opener prompt or a reuse prompt. This covers text that it added or changed after the last
write of the file. It also covers a question with no file, where the text comes from its session under the fallback.

The link check is a read of the text by the orchestrator. It uses no script and no code. It finds each mention of an
issue outside a code span and outside a code block. A mention is the issue key. The key is `#N` for an issue of this
repo, for example `#1048`, and the full key for an issue of another repo, for example `owner/repo#12`.

Each mention must pass two points. First, the mention is a markdown link in the form of the
[issue-link rule](working-with-the-user.md#the-issue-link-rule). Second, the first mention of each issue in the text
gives a few words of the content of the issue next to its link. The orchestrator chooses these words, and this choice is
open on purpose. The words stand in the sentence of the mention, so they add no sentence to the limit of five sentences
of [The question session](#the-question-session).

For example, a question of a task subagent names `#977` as a plain key. The question file then gives
`[#977](https://github.com/codeguru42/tasker/issues/977)` with a few words of its content at the first mention. An issue
of another repo gets the link text `owner/repo#12`, as in `[owner/repo#12](https://github.com/owner/repo/issues/12)`.
The issue line of the question, if it has one, counts as the first mention of that issue. A later mention of the same
issue gives only the link. A mention inside a code span or a code block stays as it is, as the issue-link rule says.

If a mention fails one of the two points, the orchestrator changes the text so that the mention follows the issue-link
rule. Then it writes the file or puts the text in the prompt. So a question file and a prompt never hold a mention that
fails the link check. The link check covers only the first-reply text. A message between two sessions keeps the plain
key, and the question session still shows the text word for word.

The reason is that the question session cannot fix a missed link, because it shows the text word for word. On
2026-11-22, the first-reply text of the question orchestrator-m31-221 named eight issues as plain keys outside its issue
line. The user said: "link for all mentioned issues".

At each pane start and each reuse, the orchestrator reads the question file of the question. It puts the text of the
file in the opener prompt or the reuse prompt as the first-reply text. For a question with no file, and under the
fallback, it uses the text from its session. The opener subagent, the reuse subagent and the question session read no
file of the orchestrator folder.

The opener prompt, the reuse prompt and the session prompt do not change. The files in `prompt-templates/question-pane/`
that hold them do not change either.

If the read at a pane start or a reuse fails, the fallback applies, and the orchestrator uses the text from its session.
If the session no longer holds that text, the orchestrator starts no pane for that question and tells the user in its
tab. The question stays open, and its file stays.

The question files of `questions/` are the open questions of the orchestrator. A question with no file is the one
exception, and it stays open in the session of the orchestrator. Because the folder is the list, an open question stays
through a compaction of the context. Before each pane start and each reuse, the orchestrator lists `questions/` with
`ls`. It then picks the next open question in the list order of [Start](#start). Under the fallback, it runs no list and
picks from the open questions of its session.

If the list of `questions/` fails, the fallback applies. The orchestrator also makes no automatic start until the next
word of the user. It tells the user in its tab that the folder can hold open questions. At the next word of the user, it
lists the folder again.

A question stops being open at one of these points:

- The orchestrator accepts a decision message that settles the question, and it sends the settled decision to the
  session that asked. A failed send of that decision is also such a point, because the question then stays decided, as
  the [State table](#state-table) says.
- For a question of the orchestrator itself, the orchestrator accepts a decision message that settles the question.
- An answer of the user in the tab of the orchestrator settles the question.
- A word of the user ends or drops the question.
- The question no longer applies, for example because its sender takes it back, or its ticket landed or was dropped.

Whether a question no longer applies is a judgment of the orchestrator, open on purpose. The orchestrator then tells the
user in its tab.

Right after that point, the orchestrator deletes the question file. A **No decision** message, a message that does not
settle the question and a close of the pane with no decision delete no file. Such a question gets no automatic start, as
the State table says. If the delete fails, the question still stops being open. The orchestrator tells the user the path
of the file, and it does not count that file as an open question in its session. The fallback also applies.

A question with no file is a question that the orchestrator keeps in its session under the fallback. Its pane starts
with the text from the session. At a handoff, the handoff file holds the full text of each such question, as
[The items of a handoff file](handoff.md#the-items-of-a-handoff-file) says. The old orchestrator writes no question file
for a question that reaches it after the write of its handoff file.
[The handoff file of the orchestrator](handoff-orchestrator.md#the-handoff-file-of-the-orchestrator) gives this rule.
[A ticket on hold](pick-the-tickets.md#a-ticket-on-hold) gives the delete of a question file at a hold.

After a compaction of the context of the orchestrator or after a handoff, these known limits hold:

- A question that got a **No decision** message or a close with no decision can get an automatic start again. The
  question file holds no mark of that rule, and the handoff file holds no such mark either.
- A question whose delete failed can get a pane again.
- A detail of a question that went to the tab of the orchestrator is lost.

The user can close the pane or end the question.

### The question session

The pane owner gives each part of this paragraph through the opener prompt or the reuse prompt of
[The prompts](#the-prompts). This also holds for the paragraphs that start "The pane owner gives all offered choices",
"The pane owner gives relevant earlier decisions" and "The pane owner prepares first-reply text". Before the start, it
gives the question session its own name, the name of the pane owner, the pane id of the pane owner and the question id.
It also gives the full question. For a question of a task subagent or of the follow-up planner, the first reply names
the ticket and the session that asks.

The row of a question session in [the table](permissions.md#the-table) gives its kinds of command.

The pane owner gives all offered choices and costs, the recommendation of the sender, and each draft or report path
named by the question. For a question of the result of a planner subagent, it also gives the kind of the question.

The pane owner gives relevant earlier decisions, each marked as a decision so far. The pane owner marks any added
reading as a guess.

The pane owner prepares first-reply text that follows
[The form of a reply](working-with-the-user.md#the-form-of-a-reply) and the
[issue-link rule](working-with-the-user.md#the-issue-link-rule). It attributes facts and measures of the question to the
sender. The text holds the question, the choices and costs, the recommendation, the paths and the decisions so far. It
also follows the bullet of [A decision of the user](working-with-the-user.md#a-decision-of-the-user) that starts "Define
each term".

The first-reply text gives its one question with no number. For the first-reply text, this paragraph wins over each rule
of [The form of a reply](working-with-the-user.md#the-form-of-a-reply) that numbers or lists the open questions.
Examples are the bullets that start "A reply gives all open questions in one numbered list", "The list holds each
question that is still open", "Each question has its own number" and "The list numbers from 1", and the number "1." of
the example of that section. For each other rule of that section, the question of the first-reply text counts as
question 1. The reason: on 2026-11-13, the user said: "In the question pane, the question itself no longer needs to be
numbered."

If the question has an issue of the question, the first line of the first-reply text is the issue line. The issue of the
question is the one issue that the question is about. Examples are the issue whose draft the question asks about and the
ticket of the task subagent that asks. The issue line has this form: the word `Issue:`, one space, the link of the issue
as the [issue-link rule](working-with-the-user.md#the-issue-link-rule) gives it, a comma and a phrase of at most 10
words that says what the issue is about. An example is
`Issue: [#988](https://github.com/codeguru42/tasker/issues/988), show the commands in the first reply`. The phrase holds
no sentence, so the issue line does not count in the limit of the paragraph that starts "The other details of the
first-reply text".

The issue line is the only fixed line of the first-reply text. A later mention of the same issue in the first-reply text
gives only the link, as the issue-link rule says. A question has one issue line at most. If the question is about two or
more issues, the issue line names the issue that the question is mainly about. Each other issue stays a mention under
the issue-link rule. The pane owner judges the issue of the question, and this judgment is open on purpose.

If the question has no issue of the question, the first-reply text has no issue line. Examples are a question about the
work in general and a question about two or more issues with no main issue. The first-reply text then also has no empty
issue line and no line such as `Issue: none`. The pane owner writes the issue line when it prepares the first-reply
text, for the first question of a pane and for the question of each reuse. The issue line of an earlier question of the
pane does not carry over. The opener subagent and the reuse subagent change no word of the issue line, and the question
session shows it as part of its first reply.

The reason: the user opens the issue of the question with one click and does not look for its key in the text. On
2026-11-20, the user said: "file a ticket to update the question pane template to include a link to the issue under
discussion".

The other details of the first-reply text have a limit: at most five sentences.
[The form of a reply](working-with-the-user.md#the-form-of-a-reply) gives examples of them, in its bullet that starts
"Inside a question, only". The question, its proposed steps, its choices, the paths and the decisions so far do not
count. If what a choice does, its cost or the recommendation stands in the question of the choice, it does not count. A
code block counts as one sentence. Next to each fact that no one measured, the first-reply text still says that no one
measured it, in the sentence of the fact.

A definition of a term in the sentence of the term, for example in parentheses, does not count in the limit. The
first-reply text also gives the order of the steps that the question rests on, for example the steps of a test. These
are steps of the sender, not the proposed steps of the question. A definition that needs its own sentence and the order
of these steps count in the limit. The pane owner judges which steps the question rests on, which definition needs its
own sentence and which details fit in the limit. This judgment is open on purpose.

If the limit has no room for each detail, the definitions and this order stay, and other details go out. If the
definitions and this order alone need more than five sentences, the first-reply text gives them all. It then gives no
other detail that counts in the limit. In each case, the first-reply text keeps each detail as short as possible, also
the definitions and this order past five sentences. The pane owner judges how short each detail is, and this judgment is
open on purpose.

For the first-reply text, this limit wins over each rule that asks for more details in a question. An example is the
bullet of [The form of a reply](working-with-the-user.md#the-form-of-a-reply) that starts "Question 1 of the list".
Another example is the words "The session gives the command and the result" of
[A decision of the user](working-with-the-user.md#a-decision-of-the-user). This limit does not win over the bullet of
that section that starts "Define each term".

If a detail of the question does not fit in this limit, the first-reply text names where the user can read it. A path of
a draft or a report of the question comes first. The tab of the orchestrator is the place only for a detail with no such
path. A sentence that names such a place does not count.

For a measure that changes the state of the user, the first-reply text gives the command and its undo step, as
[The commands in the first reply](#the-commands-in-the-first-reply) says. It also gives each other part of such a
question that [The state of the user](plan-review.md#the-state-of-the-user) asks for. An example is what the command and
the undo step each change. These parts do not count in the limit. The question session needs them for its decision
message, as [Send a decision](#send-a-decision) says.

The reason: on 2026-11-13, the user said, as operator-docs relayed it: "details sent to the question pane need to be
shorter, like 5 sentences max". On that day, operator-docs reported a paragraph each for what happened, the problem and
the facts in the first replies of the question panes. These words narrow the earlier words of the user on the details in
the question pane, in [The form of a reply](working-with-the-user.md#the-form-of-a-reply).

The first replies of question-769-bullet and question-910-marker on 2026-11-13 gave no definition of some terms, for
example "old path" and "marker word". The user asked what some of them meant. In question-910-marker, the user also gave
the order of the steps of a test back to the session and asked whether it was right. On the same day, the user chose
that the definitions and the order of the steps stay past five sentences, as operator-docs relayed it. The words of the
user were: "keep it short as possible but going over 5 sentences is allowed".

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

Before its first reply, the question session does step 1 of [the doc-read rule](doc-reads.md#the-doc-read-rule). Then it
reads `docs/dev/doc-reads.md`, before its other start reads. Then it reads `AGENTS.md`, `docs/dev/question-pane.md`,
[working with the user](working-with-the-user.md) and [the rules](rules.md), as the doc-read rule says. Each start read
is a complete read of its file, from line 1 to the end, as
[step 2](doc-reads.md#step-2-read-each-doc-with-the-read-tool) of the doc-read rule says. Step 1 and these reads are its
start reads, and the session prompt gives them. The second reply gives the command and its output for each case of step
1 that the doc-read rule gives to the user. For a wrong branch, the second reply also says that the rules are unread.
The session then sends no decision and no write action. The existing `AGENTS.md` rule for a user-facing session with no
role still applies, and this rule adds these docs to it. The rules of these docs change no word of the first-reply text.

Before its start reads, the question session shows the start line, word for word: "I read my rules first, and then I
show the question." The start line tells the user that the question follows. In the rules of this page, the start line
is not the first reply.

The reason: on 2026-11-13, the user said to operator-docs: "question pane should fetch its instructions first then show
the question". These words reverse the words of the user of 2026-11-11 in [Measured facts](#measured-facts). On the same
day, a question session reported that the user waited for its first reply while it read its docs. The start line tells
the user the cause of that wait.

The question session follows the general user-facing, simple-English, [memory](rules.md#docs), and
[doc-read](doc-reads.md#the-doc-read-rule) rules from its start.

After the first reply, the question session can read drafts and reports, use read-only commands other than `herdr`
commands, and run step 1 of [the doc-read rule](doc-reads.md#the-doc-read-rule) in place of `git fetch origin`. For a
failed step 1, the doc-read rule gives the next step.

After its first reply, the question session follows these rules. Each item names the home of the rule:

- It sends each message to the pane owner with the herdr path and the header of [Terms](#terms). It waits for the ack of
  [Terms](#terms).
- It sends each write action and each request of [Terms](#terms) back to the pane owner.
  [Send a decision](#send-a-decision) gives the send.
- It shows and approves commands and input files as [The commands in the first reply](#the-commands-in-the-first-reply)
  says.
- It decides when to send a decision, and it handles a direct pick, a discussion, the confirm question, a guess and **No
  decision**. It gives the parts of the decision message and handles a failed send. [Send a decision](#send-a-decision)
  gives these rules.
- It starts no subagent that plans, drafts, reviews or posts an issue, as the paragraph of this section that starts "A
  question session starts no subagent" says.
- It runs the rounds after a close request, as [The rounds before the close](#the-rounds-before-the-close) says.
- It sends the pane handoff after a pane handoff request, as [The pane handoff](#the-pane-handoff) says.

The question session sends each [write action](#terms) and each request of [Terms](#terms) back to the pane owner with
the herdr path, as [Send a decision](#send-a-decision) says. The pane owner hands each one to its actor, as
[The actor of each write action](#the-actor-of-each-write-action) says.

For a [request for a new issue](#terms), the question session does not draft the issue and asks for no approval of a
draft. It gives no command, no undo step, no input file and no blocked-by links for it. A request for a change of a
tracked file of the repo uses the same form, with no write action, no command and no undo step. An example is a new
allow rule in `.claude/settings.json` of the repo.

A [title or body request](#terms) uses the same form as a request for a new issue. The question session reads no title
and no body of the issue for it and keeps no start hash. It shows no old text and no new text, and it asks the user to
approve no text.

A change of the draft of the sender stays with the sender, as a requested draft change. A split of such a draft into two
or more issues is also such a change. The question session judges whether the question proposed the issue. This judgment
is open on purpose.

If the question session is not sure, it gives the words as a request for a new issue. If the words ask for a change of
the title or the body of an issue, it gives them as a title or body request. In both cases, it adds its guess that they
can be a change of the draft of the sender. This guess goes through the confirm question of
[Send a decision](#send-a-decision) before the send. If the user does not accept it, the message gives the words as that
request with no guess. The planner then decides.

A question session starts no subagent that plans, drafts, reviews or posts an issue. It asks no session other than the
pane owner for such work.

For a request outside its question, the question session sends the request to the pane owner with the herdr path. The
user can also type it in the tab of the orchestrator.

The first reply gives no fact of the question session's own. Some bullets of “A decision of the user” ask the session to
measure or to read a rule first. These bullets hold from the second reply on.

### The commands in the first reply

If a question leads to a [write action](#terms), the first-reply text shows the exact command and the undo step of each
write action before the choices. For an action with no undo step, it says that the action has no undo step. These are
the words that the decision message gives later, as [Send a decision](#send-a-decision) says.

For a write of a file, the first-reply text shows the absolute path and the full new text. For a message to a session,
it shows the session name and the text. It shows them only if the pane owner already has them. A text that the question
session makes in the talk is shown to the user in the talk, and the decision message gives it.

The first-reply text does not show the text of an input file. The command names the path of the file. Each choice that
leads to a write action says in its own text whether a pick approves the commands shown under it. For a write action
with an input file, the choice text says that the user approves the text of the file after the pick, not that a pick
approves it. The pane owner or the sender writes this into the choice text, and the question session shows it word for
word.

If the write actions differ between the choices, the first-reply text shows one set of commands under each choice that
leads to a write action. A choice with no write action shows none.

The commands and the undo steps of this subsection do not count in the five-sentence limit of
[The question session](#the-question-session). A code block of another kind still counts as one sentence.

The pane asks no approval question. A direct pick and a yes to the confirm question are sent at once, as
[Send a decision](#send-a-decision) says. A yes to the confirm question counts as the pick of the planned choice. A
write action is approved only if the text of the picked choice says so in plain words, the action has no input file, and
its command, path or text was in the first reply and did not change. The decision message marks each other write action
"not approved", with its command and its undo step. The pane owner runs none of them, and the user can approve one later
in a new pane message or in the tab of the orchestrator.

A metadata request with no look-first word is an exception to the approval rule of the paragraph before. The words of
the user that ask for the change are the approval. The question session shows no command, no undo step and no input file
for it, and it asks no approval question. The decision message does not mark it "not approved".

If the words of the user hold a look-first word for a metadata request, the question session shows the exact command in
the pane. It also shows the undo step of the change. It asks no approval question, as the paragraph that starts "The
pane asks no approval question" says. The decision message gives the command and the undo step, and it marks the change
"not approved". The pane owner does not run it. The user can approve it later in a new pane message or in the tab of the
orchestrator.

A look-first word covers only the request that it names. The next metadata request of the same pane gets no second step
unless it holds its own look-first word. A look-first word that comes after the question session sent the request does
not stop the change. The change is already running.

A pick never approves a write action with an input file. After the send, the question session shows the text of the file
in the pane, from the talk or from the sender. After the user gives an approval word, the session sends a second message
with the text and the word, word for word. If the session has no text for the file, the decision message says that the
text is missing. The action then stays "not approved".

A question that leads to no write action shows no command, no undo step, no path and no text of a write. A request of
[Terms](#terms), for example a [title or body request](#terms), keeps its own form.

The reason: on 2026-11-20, the user said in a question pane: "No, the exact commands should be shown before the
choices". In the refine of the plan of #988, the user said about the approval: "Each choice should explicitly include in
the text if they approve the commands."

### The prompts

This subsection gives the rules of the opener prompt, the reuse prompt and the session prompt of a question pane. The
opener prompt is the prompt of the opener subagent. The reuse prompt is the prompt of the reuse subagent. The session
prompt is the prompt of the question session. These files hold the words of the three prompts:

- [`prompt-templates/question-pane/opener.md`](../../prompt-templates/question-pane/opener.md): the opener prompt.
- [`prompt-templates/question-pane/reuse.md`](../../prompt-templates/question-pane/reuse.md): the reuse prompt.
- [`prompt-templates/question-pane/session.md`](../../prompt-templates/question-pane/session.md): the session prompt.

[The prompt templates](prompt-templates.md) gives the form of each file. The `placeholders` list of each file gives the
meaning of each value.

The pane owner reads the opener file or the reuse file as [the doc-read rule](doc-reads.md#the-doc-read-rule) says, at
the step that sends the prompt. It takes the body, puts a value in place of each placeholder and gives the result as the
prompt of the subagent. It fills `{{FIRST_REPLY}}` last, because the first-reply text can hold text such as `{{NAME}}`.
It adds no other words. The pane owner does not write or fill the session prompt. No herdr output of a reuse goes into
the context of the pane owner, apart from the report of the reuse subagent.

The values of the prompts have these homes:

- The own name: [docs/dev/GLOSSARY.md](GLOSSARY.md).
- The local clone: [the doc-read rule](doc-reads.md#the-doc-read-rule).
- The question id: [Terms](#terms).
- The issue line of the first reply: [The question session](#the-question-session).

The opener subagent and the reuse subagent read `session.md` from `origin/main`, take its body and fill it. `session.md`
holds no single quote. Step 4 of the opener prompt writes each single quote of the first-reply text so that the shell
keeps it. Step 7 of the reuse prompt keeps each single quote. The send command types the text into the session, not into
a shell.

The three files are the only place of the words of the three prompts. The rules of "A question pane" stay the home of
each rule that the files state. Step 3 of [Start a session](operator-start.md#start-a-session),
[the seam of an agent kind](../config.md#the-seam-of-an-agent-kind), [`sessions`](../config.md#sessions),
[the doc-read rule](doc-reads.md#the-doc-read-rule) and `AGENTS.md` are also such homes. An issue that changes such a
rule also changes the file that states it. The files are the exception that
[The family issues](prompt-templates.md#the-family-issues) gives to [the one-home rule](rules.md#code).

The body of `session.md` is a short exception. It holds only the values, the first-reply rule, the start steps and a
pointer. The rules for the time after the first reply have their homes in the sections that the list of
[The question session](#the-question-session) links, for example [Send a decision](#send-a-decision). The body holds at
most 300 words and at most 2000 characters, with each placeholder unfilled. A change of the file keeps the body within
this limit. The body count is the output of this command:

```text
awk 'n>1; n<2 && /^---$/ {n++}' prompt-templates/question-pane/session.md | wc -wm
```

The question session runs with the model and the effort of the entry `sessions.models.question` of
[`sessions`](../config.md#sessions). If `sessions.models` has no entry `question`, the rule of that section for a role
with no entry applies.

The reason: on 2026-11-13, operator-docs wrote the prompt of the question session in its own words at each pane start,
and the words differed. The user said: "File an issue to make it a tracked doc rather than embedded in the operator
instructions". The user then decided on an opener subagent with two prompts in a tracked doc. The user also gave a
reason for the session prompt. A session prompt that the operator writes adds tokens to the context of the operator that
a real use does not have.

### Send a decision

The question session sends a message that reports a decision or a choice in three cases only. First, the user made a
direct pick. Second, the user said yes to a confirm question. Third, the user ends the question, closes the pane or ends
the run. The session sends **No decision** only in the third case. While a discussion is open, the session answers the
user and sends no such message.

A shown choice is a choice that the question session showed to the user in the pane. A direct pick is the letter, the
number or the exact words of one shown choice, a yes to one proposal of the session that is a shown choice, or words
that only let the sender decide, for example "you decide". A direct pick answers the question with no doubt. A reply
that holds a direct pick and also a request or a reading of the session is a discussion. The confirm question about the
guess comes first.

A discussion is each other reply. A choice with a reason, a condition, a question or a new idea is a discussion. Three
examples are "B, but first tell me the cost of A", "yes, but later" and "let me think about it". A yes to a guess or to
a reading in the middle of the talk is a discussion. A pause or silence is not a pick and does not end a discussion.

A guess is a reading of the question session that the user did not say or point to. The quoted words of the user are
never a guess. The judgment of a direct pick and of a guess is open on purpose. If the session is not sure, the words
are a discussion and the reading is a guess.

For a direct pick, the question session sends the decision message at once. It shows no evaluation and asks no confirm
question. The message has no part about a confirm question. The paragraph that starts "Take a decision message after a
direct pick" gives the one exception.

For a discussion, the question session shows the evaluation. The evaluation says for each shown choice whether the words
fit it and why. Then it names the choice that the words fit best, or says that no choice fits. It also says what stays
open.

Then the session asks one confirm question. The confirm question gives the planned decision as the reading of the
session, marked as a guess. It gives each other guess of the same message as a numbered reading. It asks one question
for the whole set: "Is this your final decision?". [The form of a reply](working-with-the-user.md#the-form-of-a-reply)
and the bullet "Define each term" of [A decision of the user](working-with-the-user.md#a-decision-of-the-user) apply to
it. For the confirm question, this paragraph wins over each rule of The form of a reply that asks for a list of choices,
for what a choice does or for a recommendation. The confirm question lists no choices and holds no other question.

After a yes, or after words that accept the decision, the question session sends the decision message. A reply about the
decision or the shown choices is more words, for example a reason, a condition or a question about a choice. After a no,
or after more words, the session drops the reading and sends nothing. It then judges the new words again, and a new
direct pick is sent at once. A no to a confirm question with a planned decision drops all its readings, also each guess,
and the discussion goes on. For a reply with a direct pick and a request or a reading, the guess goes in this one
confirm question, with the planned decision as reading 1.

If the user gives no answer, the session waits at its prompt, sets no timer and takes no silence as a yes. Only a reply
about another topic keeps the confirm question open. Then the session says in one line that the confirm question is open
and asks it again. If the session is not sure, the reply is more words.

The message after a confirm question gives what the page gives today. It also gives the words of the user that started
the discussion word for word, and the decision as the session read it. It gives the confirm question as shown and the
answer of the user word for word. It states that the user said yes to the confirm question and accepted the decision as
final. The pane owner reads this message under the current rules. This adds no step for the pane owner.

A request for a new issue, another request of [Terms](#terms), or a message with a doc proposal, each with no guess,
keeps its current rules and its time of sending. If such a message holds a guess, the session first asks one confirm
question about the guesses, with numbered readings and one yes or no question. After a yes, the message gives each guess
and says that the user accepted it. After a no, the message drops each guess and gives the words of the user word for
word. This holds only for a message with no planned decision, for example a message with a doc proposal or a request for
a new issue. If the user changes one guess, the session shows the changed set in a new confirm question.

The session still drafts no issue and asks for no approval of a draft. A word of the user that closes the pane needs no
confirm question.

Take the case that a discussion or a confirm question of a decision is open. The user then closes the pane or ends the
run. The session sends **No decision**. It also sends the question id, the words of the user word for word and the state
"discussion open, not confirmed". The message holds no decision that the session read and no guess. If a confirm
question about a guess of another message is open, the session sends that message. It gives the words of the user and no
guess. The pane owner reads **No decision** as no answer, under the current rules.

The reason for this rule comes from the user. On 2026-11-20, the user wrote: "whenever a question pane has a guess or
"own reading" then it should confirm with the user before sending the report back to the orchestrator". The user also
wrote: "I continue to encounter situations where I am having a discussion, but the question pane agent decides to send a
report to the orchestrator and the pane closes unexpected." The user added: "If a choice is picked by the user directly,
then that unabmiguously answers the question, but if the user types a longer sentence, it should be taken as a
discussion, evaluated against the choices and confirmed as a final decision before sending the report." A question
session reported that the user found an earlier report premature. A decision from a reading that the user never accepted
can start work that the user did not choose.

The decision message goes to the pane owner with the herdr path. It first gives the header
`QUESTION-PANE <own pane id> <question id> m<n>:` of [Terms](#terms), with its message number. It then gives the
decision and the user's settling words verbatim, each requested draft change, and each doc proposal. It also gives each
word of the user that closes the pane, ends the run or adds an issue to a set (a set scope, as the term Scope of
[the glossary](GLOSSARY.md) and [The scope](../orchestrator.md#the-scope) define it), word for word, also after the
close request.

A doc proposal is a part of a decision message or of a **No decision** message. It covers one rule, fact or preference
that the user stated for a tracked doc of the repo. It gives each word of the user that supports it, word for word. It
also names the tracked doc and the change. Words such as "add to `docs/dev/rules.md` that X" are a doc proposal, not a
request for a change of a tracked file. A change of a tracked file that states no rule, fact or preference stays a
request, for example a new allow rule in `.claude/settings.json`.

If the user said or pointed to the tracked doc and the change, the doc proposal names them with no guess. The session
asks no confirm question for it. If the user did not, the question session gives its reading of the doc and of the
change. Each such reading is a guess under the guess rule above. The message gives the reading only after the user
accepted it, and marks it as a guess that the user accepted.

For a discussion, the guess goes in the confirm question of the planned decision, as a numbered reading. For a decision
message after a direct pick, the paragraph that starts "Take a decision message after a direct pick" gives the confirm
question. For a message with no planned decision, the session asks the confirm question about the guesses before the
send, as the paragraph that starts "A request for a new issue, another request of" says.

After a no to the confirm question, the doc proposal gives the words of the user word for word. It names no part of a
doc and no change that the user did not say or point to. The same holds after a close of the pane, or an end of the run,
before a yes to the confirm question. In these cases, the guess rule wins over the rule that a doc proposal names the
doc and the change.

After a no, no later confirm question of the same question gives that guess again. Each later message of that question
gives that doc proposal as the paragraph before this one says. This rule wins over each rule of this section that asks a
confirm question about a guess of a doc proposal.

The question session combines similar doc proposals of one message into one doc proposal. The combined doc proposal
gives the words of the user of each part, word for word. Which doc proposals are similar is a judgment of the question
session. This judgment is open on purpose.

Take a decision message after a direct pick that holds a guess of a doc proposal from an earlier reply of the same
question. Before the send, the question session asks the confirm question about the guesses. It shows no evaluation. The
confirm question gives only the guesses, each as a numbered reading, and asks one yes or no question. It does not ask
about the direct pick, and the direct pick stays the decision. A reply that holds the direct pick and also a request or
a reading of the session stays a discussion, as the paragraph that starts "A shown choice" says.

After a yes, the message gives the direct pick as the decision and each guess as a guess that the user accepted. After a
no, the message gives the direct pick as the decision and drops each guess, as the paragraph that starts "After a no to
the confirm question, the doc proposal" says. If the user closes the pane or ends the run while that confirm question is
open, the message gives the direct pick as the decision and no guess, as the paragraph that starts "After a no to the
confirm question, the doc proposal" says. Each other answer follows the guess rule, for example a changed guess or a
reply about another topic.

A guess of a doc proposal can stand in the confirm question of an earlier discussion of the same question. The user can
answer that confirm question with a direct pick, not with a yes or a no. Then the session drops the planned decision of
that discussion. It keeps the guess and gives it in the confirm question about the guesses before the send of the direct
pick. For this case only, this paragraph and the two before it win over the paragraph that starts "For a direct pick"
and over the sentence "It then judges the new words again, and a new direct pick is sent at once". A decision message
after a direct pick with no guess still goes at once, with no confirm question.

The reason for the doc proposal: on 2026-11-21, in the question pane orchestrator-m31-135, the user accepted the rule,
as orchestrator-m31 relayed it.

For a measure that changes user state, the question session also gives the command and undo step verbatim. It gives the
same for each [write action](#terms). For an action with no undo step, it says that the action has no undo step. The
first reply already shows each command and its undo step, as
[The commands in the first reply](#the-commands-in-the-first-reply) says. The message gives each command or text that
the first reply did not show. It gives no text of an input file that the session does not have. The session sends that
text later with the approval word, as that subsection says. For a write action that is approved, it gives the words of
the user that approved it, word for word: the pick or the yes to the confirm question. It marks each other write action
"not approved", as that subsection says. The question session sends the message at once and asks no approval question.

A metadata request with no look-first word is an exception to the paragraph before. The paragraph that starts "A
metadata request goes to the pane owner" gives its message.

Each command of a write action is a [plain call](issues.md#the-reads-before-the-write). Each command names its target
itself, for example with `git -C <folder>` or `gh -R <repo>`. If a command takes a file as input, for example with
`--body-file`, the command names a new path under `/tmp/tasker/<slug>/drafts/`. The slug is the slug of the pane owner.
The message that gives the approval word then gives the text of the file verbatim, as
[The commands in the first reply](#the-commands-in-the-first-reply) says. The write subagent writes each input file at
that path, with the slug of the orchestrator.

For a write of a [user-level file](#terms), the question session first runs `sha256sum <path>` in its own call. It keeps
the output as the start hash. For a file that does not exist, the start hash is "no file". The question session reads
the whole file. The message gives the absolute path, the full new text, the undo step and the start hash. The undo step
gives the old text, or the delete of a new file.

This form has a cost. Each secret value of the file goes into the transcript of the question session, the pane and the
decision message. Examples are `apiToken` and `email` of the configuration file of tasker. `tasker show-config` hides
both, but this read does not.

For a path that ends with `.json`, the new text must be one JSON object. Before it shows the change, the question
session runs `printf '%s' '<new text>' | jq -s -e 'length == 1 and (.[0] | type == "object")'`. If the exit code is not
0, the change does not go to the user, and the question session tells the user the output.

The measure: on 2026-11-19, with jq 1.7, the text `{"a":1}` gave 0. The texts `{"a":1} {"b":2}` and `[1] {"b":2}` each
gave 1. An empty text gave 1, and `{"a":` gave 5. The form `jq -e 'type == "object"'` without `-s` gave 0 for both texts
with two values, so it does not serve.

A value that a `tasker` command sets goes through that command, not through a write of a file. An example is
`sessions.models`, which `tasker model` sets.

For a message to a session other than the pane owner, the message gives the name of the session and the text verbatim.
Such a message has no command and no undo step.

A [title or body request](#terms) goes to the pane owner in the form of a request for a new issue. The decision message
gives the words of the user word for word. The question session can add the issue reading and its guess that the words
are a change of the draft of the sender. Each one is a guess and goes through the confirm question of the guess rule
above. The message gives only the guesses that the user accepted, each marked as a guess. With no accepted issue
reading, the message gives no reading, and the planner finds the issue from the words. The question session reads no
title and no body of the issue for this request, and it keeps no start hash. It shows the user no new title, no new
body, no old body, no summary of a change and no path of a body file. It asks the user to approve no text, because the
words of the user approve the request. The message gives no exact new text, no start hash, no command, no undo step and
no input file.

A [metadata request](#terms) goes to the pane owner at the time of sending of a request for a new issue. This also holds
for a message of the kind **No decision**. The decision message gives the words of the user word for word. It gives the
exact command of each change, in the order of the words, as a [plain call](issues.md#the-reads-before-the-write) that
names its target itself. With no look-first word, the message gives no undo step and no text of an input file, because
the command takes no input file. A later decision message of the same question gives only the metadata requests that no
earlier message gave.

A metadata request needs no direct pick and no confirmed decision of the question. It does not end an open discussion,
and it does not close the pane.

For a request with no look-first word, the message says that the words of the user are the approval of the change. It
gives no word that approves a command, because the question session showed no command. It does not mark the change "not
approved". A move of an issue into the milestone "Future" keeps the command, the undo step and the approval of the other
write actions. The user can undo a change with a new metadata request.

If the words name each issue and each new value, the question session adds no guess and asks no confirm question for the
request. If the session reads a part into the words, for example which issue or which milestone a word names, that part
is a guess. The confirm question of the guess rule above then asks about the reading, not about the command. If the user
does not accept a guess, the message gives no command for that request. It gives the words of the user word for word.

The reason for the rule of a metadata request: on 2026-11-20, in a question pane, the user said: "changes to github meta
data are almost always requested by the user and should just be performed without any further approval unless
requested." A pane that asks again after the user asked for the change gives the user a second step for one request. The
look-first word is a choice of issue #997, not the words of the user.

For a comment on an issue, a change of a blocked-by link and a change of the field `Priority`, the question session
sends a request, in the form of a request for a new issue. When it first shows the text to the user, it reads the title
and the body, as [Before a post](issues.md#before-a-post) gives the read. It keeps that read as the start hash. The
message gives the exact text that the user approved and the start hash of that read. The question session runs the
self-check of Before a post over the text that it shows, with no file.

These rules cover only a change or a comment that the item did not propose. A requested change of the draft of the
sender stays with the sender.

The decision message also gives each [request for a new issue](#terms), with the words of the user word for word. The
question session can add its own reading of the words, for example which issue or milestone a word names. It marks each
such reading as a guess. Before the send, the session asks the confirm question of the guess rule above. The message
gives only the guesses that the user accepted. A later decision message of the same question gives only the requests
that no earlier message gave.

If the user ends without a decision, this is the third send case. The question session sends **No decision** and the
question id. If a discussion or a confirm question is open, the message also gives the words of the user word for word.
It also gives the state "discussion open, not confirmed". It holds no guess.

With **No decision**, the question session still sends each doc proposal, each request for a new issue and each metadata
request. None of them holds a guess that the user did not accept.

After the send, the question session waits at its prompt for the ack of the pane owner. It then waits for a message of
the pane owner: what stays open, or a [close request](#the-rounds-before-the-close). If the send fails, the question
session tells the user in the pane. The question stays open.

### The pane owner handles a decision

The pane owner accepts a decision message only with a header of its open pane id and its current question id. The header
has one of the two forms of [Terms](#terms), and the message number decides no accept. It then sends the ack, as
[Terms](#terms) says. For every other message, the pane owner tells the user in one line, sends nothing, and keeps the
state of each question. The header does not prove the sender, because any pane can type it.

The pane owner judges whether the quoted words fully settle that question, with or without choices. A settled message is
the user's decision without a second word in the tab of the orchestrator. The quoted words of an accepted message are a
word of the user for the orchestrator. They approve no permission prompt.

This includes approval of a post or comment, an answer to a planner draft, and approval of a measure that changes user
state. A measure approval carries its exact command and undo step. Words that let the sender decide count as a decline
of that measure.

The orchestrator sends the settled decision to the session that asked the question, at once. A question of a task
subagent goes back to that task subagent with the message path that the orchestration pages give for a task subagent. A
task subagent has no pane, so the herdr path does not reach it. A question of a session that tasker starts goes back
through the task subagent of its task. A question of the follow-up planner goes back to `planner-<slug>`. A planner
subagent is never the sender of a question of a pane. Its questions come in its result, and the orchestrator asks them
as its own open questions. See [The result](planner-subagent.md#the-result). Each such message starts `From the user:`.
The next line identifies question pane `<name>`. It gives the question id, the user's words, and requested draft
changes. The sender treats that message as any other `From the user:` message. A question of the orchestrator itself has
no sender, and the orchestrator acts on the decision.

When the pane owner accepts a decision message, it reads the [question file](#the-question-file) again. It judges from
that text whether the message settles the question. It also reads the question file again when a word of the user in its
tab names a question id. For a question with no file, it uses the text from its session.

A message with the marker `PANE-HANDOFF.` is a pane handoff, not a decision message. The pane owner accepts or refuses
it as [The pane handoff](#the-pane-handoff) says. A decision message that arrives before the pane handoff gets the usual
steps of this section, as [The pane handoff](#the-pane-handoff) says.

A settled decision for a question of a task subagent after its stopping-point message goes into the entry of the task
list, not to the task subagent, as [the stopping-point case](handoff-orchestrator.md#the-stopping-point-case) says.

If such a read fails, the fallback of [The orchestrator folder](limits.md#the-orchestrator-folder) applies, and the pane
owner uses the text from its session. If the session no longer holds the text, the pane owner still sends the ack for a
decision message. It treats the message as a message that does not settle the question, and it tells the user in its
tab. For a word of the user, it tells the user in its tab that it cannot read the question of that id.

Right after it sends the settled decision, or after that send fails, the pane owner deletes the question file, as The
question file says.

A settled message can give [write actions](#terms), as [Send a decision](#send-a-decision) says. The approval of the
user in the message covers one run of the command of each write action, word for word. Words of the user that let the
sender decide approve no write action. A write action marked "not approved" does not run, as words that let the sender
decide approve no write action. A message that does not settle the question starts no write subagent, apart from the
case of the next paragraph.

The words of the user that ask for a metadata change with no look-first word are the approval of its command. If a
message does not settle the question, the pane owner still starts one write subagent for its metadata requests. A
request with a guess that the user did not accept does not run. The pane owner starts no actor for another write action
of such a message. In a settled message, the metadata requests run in the order of the message, as the paragraph on the
order of the actors says.

#### The actor of each write action

Each kind of write or request of [Terms](#terms) has one actor.

| Kind of write or request                                                    | Actor                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new issue                                                                 | The planner of the orchestrator, as a request                                                                                                                                                                                                                                                                                                                                                                                                      |
| A change of the title or the body of an issue that the item did not propose | The planner of the orchestrator, as a request                                                                                                                                                                                                                                                                                                                                                                                                      |
| A comment on an issue that the item did not propose                         | The planner of the orchestrator, as a request                                                                                                                                                                                                                                                                                                                                                                                                      |
| A change of a blocked-by link or of the field `Priority`                    | The planner of the orchestrator, as a request                                                                                                                                                                                                                                                                                                                                                                                                      |
| A change of the metadata of an issue                                        | The write subagent                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A write of a user-level file                                                | The write subagent                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A change of a tracked file of the repo                                      | The planner of the orchestrator, as a request for a new issue                                                                                                                                                                                                                                                                                                                                                                                      |
| A permission rule of an actor in `$HOME/.claude/settings.json`              | The planner of the orchestrator, as a request for a new issue. No write subagent starts. See [A change of the rules](permissions.md#a-change-of-the-rules)                                                                                                                                                                                                                                                                                         |
| A `tasker` command, also `tasker model`                                     | A read-only command: the orchestrator. A task change: the task subagent of the task, after the orchestrator sends it. A task change of a task of a peer goes to the peer as a request of [the request rule](../orchestrator.md#the-request-rule). `tasker model` with a new model or `--effort`: the orchestrator, only on the words of the settled message. See [the orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule) |
| A message to another session                                                | The orchestrator. A message to a peer is a request of [the request rule](../orchestrator.md#the-request-rule)                                                                                                                                                                                                                                                                                                                                      |
| A `herdr` command                                                           | The orchestrator                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A git write                                                                 | No actor. The fetch and the pull of the doc-read rule are not write actions.                                                                                                                                                                                                                                                                                                                                                                       |
| Each other write                                                            | No actor                                                                                                                                                                                                                                                                                                                                                                                                                                           |

The order rule below covers only the rows with the write subagent or the orchestrator as the actor. The send of a task
change is an action of the orchestrator. The next actor starts only after the report of the task subagent.

The write subagent runs no other kind of write: no write to the text of an issue, no comment, no link, no git write, no
`herdr` command, no message to a session and no `tasker` command. A move of an issue into "Future" is a metadata change.
The write subagent also removes each link of the issue to an open issue in the same step, as the "Future" bullet of
[The blocked-by links](issue-subagents.md#the-blocked-by-links) says. For that removal, the write subagent runs only the
link-removal commands of step 7 of [the defer rule](pick-the-tickets.md#the-defer-rule). The other steps of the defer
rule, for a task in flight, are not a write action of the write subagent. The approval of the move covers that removal.

The answer to the sender names each write action and says that the orchestrator tells the user the result. The actors
start after the answer, also after a failed send of it. The write actions of one settled message run in the order of the
message. The write subagent and the orchestrator are the actors of this order. The orchestrator starts one
[write subagent](#terms) for each run of write-subagent actions in a row. It starts the next of these actors only after
the report of the actor before it. A request is not part of this order. The orchestrator sends it to the planner of the
orchestrator one time and does not wait for it, as the paragraph on requests says. A failure of any write action stops
each later write action. The orchestrator tells the user each action that did not run.

The metadata requests of a message that does not settle the question run in the order of the message. That message has
no answer to the sender, so the write subagent starts after the ack. A failure of one request stops each later request,
and the orchestrator tells the user each request that did not run.

The write subagent first writes each input file at its path, with the slug of the orchestrator. Then it does its actions
in order. It reports the exit code and the output of each command, and the orchestrator then tells the user the result
in one line.

Before each start of a write subagent, the orchestrator runs `tasker show-config --repo <repo key>` and reads
`.sessions.models.write`. With an entry, the `Agent` call gives its model and its effort. With no entry, the call gives
no model and no effort, as [Sessions](../config.md#sessions) says for a subagent role with no entry. A failed read
follows [the failure rule](limits.md#the-failure-rule). The write subagent then starts with no model and no effort,
because the user already approved the action. A failed start runs no write action. The orchestrator tells the user each
action that did not run.

Right before it writes a user-level file, the write subagent runs `sha256sum <path>` again in its own call. A hash that
differs from the start hash is a failed command. A file that exists when the start hash is "no file" is also a failed
command. The write subagent then writes nothing and reports the new hash. Otherwise, it writes the full new text.

After the report of a write subagent that wrote the configuration file of tasker, the orchestrator runs
`tasker show-config`. Exit code 1 opens no pane, because the opener subagent and the reuse subagent run
`tasker show-config --repo <repo key>`, and that command fails. The orchestrator tells the user in its own tab the
errors and the old text of the file. The user puts the file back by any means and tells the orchestrator. Then the
orchestrator runs `tasker show-config` again. With exit code 0, panes start again, as [Start](#start) says. Until then,
each `tasker` command fails, also the commands of each running task subagent.

The write subagent keeps each rule of the docs for that kind of write. Examples are
[The reads before the write](issues.md#the-reads-before-the-write) for the state of an issue and the "Future" bullet of
[The blocked-by links](issue-subagents.md#the-blocked-by-links). The approval of the user in the message covers each
write that such a rule adds to the action. If such a rule gives a step with the user, the write subagent stops before
that write and reports. The orchestrator then tells the user, and the action does not run.

The write subagent runs no `tasker` command. The orchestrator sends each task change to a task subagent. It runs
`tasker model` on the words of the settled message, and each read-only command, itself.
[The orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule) gives these rules. A message to
another session is a write action. The orchestrator sends it, not the write subagent. The message goes on the path that
the orchestration pages give for that session, for example the message to its task subagent, and it starts with
`From the user:`. A message to a peer from a settled decision is a request of
[the request rule](../orchestrator.md#the-request-rule), not a `From the user:` message. The peer asks its own user and
acts only on an accept. The herdr path is only for the messages between a question pane and its pane owner, as
[Terms](#terms) says. A failed send follows [the failure rule](limits.md#the-failure-rule).

The orchestrator runs each `herdr` command of a settled message itself, word for word, as a plain call of
[The reads before the write](issues.md#the-reads-before-the-write), at its place in the order. A failed command follows
[the failure rule](limits.md#the-failure-rule), and each later action does not run.

If a settled message gives a write action with no actor, or a request to a peer cannot go out, for example after a
failed find, the orchestrator tells the user in one line that the action does not run. The line names the action.
Examples are a commit in the local clone, a comment on a pull request and a change of `.claude/settings.local.json`.
tasker makes the git writes of a task, through the task subagent of the task.

If a command fails, the write subagent runs nothing more, also no undo step, and it reports the state that stays. A
failed command is a command that cannot start or that exits with an error. A write that "The reads before the write"
skips also counts as a failed command. The orchestrator then tells the user the command and the error, as
[the failure rule](limits.md#the-failure-rule) says. If the write subagent ends with no report, the orchestrator tells
the user that the results are not known.

A call of the write subagent can get a [tool block](tasker-commands.md#the-tool-block-rule). After a check failure of
that rule, the write subagent first runs the same call again one time, in the same form. After each other tool block,
and after a second check failure, the write subagent stops. It reports the exact call, the exact text of the denial, the
folder of the call and the purpose. The orchestrator then follows
[A denied command of the operator](operator-start.md#a-denied-command-of-the-operator) for that call.

The commands after the denied call wait for the answer of the user. If the denied call ran in any choice of that
section, the orchestrator starts a new write subagent. It runs the commands after the denied call, under the same
approval. If the user declines the call, or the result is "did not run", the orchestrator tells the user each command
that does not run.

The reason: on 2026-11-13, operator-docs reported that the question session question-move-522-822 ran two
`gh issue edit` calls itself. The calls moved #522 and #822 into the milestone "M31 — Orchestrator". The user then said:
"Write the rule in the positive voice: All write actions are sent back to the operator, including Github, (fill in
anything else that is appropriate). The operator spawns a subagent to perform the action." The user also approved the
list of write actions of [Terms](#terms). A message that starts with "From the user:" is a word of the user, as
[The operator](working-with-the-user.md#the-operator) says. So the pane owner relays a message to another session
itself.

The reason of issue #967: the user chose a closed list of user-level files. The user said: "A for now. Eventually I will
have a separate repo for agent config." The user also said: "The planner should run review loops and post without my
approval." So the planner runs its review loops on a request of a pane and posts the reviewed text with no new approval
of the user, as for a new issue.

If the words do not settle the question, the pane owner sends only the question session one message saying what remains
open. The message goes with the herdr path and starts with `PANE-OWNER <owner name> <question id>:`. The pane
conversation continues. The pane owner sends nothing to the sender. If the send fails, the failure rule applies and the
run stops until the user speaks.

A decision message covers only its question. It does not approve a Claude Code permission prompt or a `tasker` setting
outside its write actions. A write action of a settled message is a request of the user for its `tasker` command.
[The orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule) gives the rule of such a request for a
`tasker` command.

A **No decision** message leaves the question open. The pane owner closes the pane or gives it a reuse, as
[Close and continue](#close-and-continue) says. That question gets no automatic start, and only a word of the user that
names it starts its pane again.

The pane owner relays each [doc proposal](#send-a-decision) to the planner of the orchestrator as the message gave it.
The relay gives the words of the user word for word, each doc and change that the user said or pointed to, and each
guess that the user accepted, still marked as a guess. If the planner is the sender, the pane owner combines that relay
with the answer. A failed relay invokes the failure rule. The orchestrator sends each relay one time. The pane does not
wait for it.

The pane owner sends each [request for a new issue](#terms) of a decision message to the planner of the orchestrator. It
does the same for each other request of [Terms](#terms): a change of the title or the body of an issue, a comment, a
change of a blocked-by link or of the field `Priority`, and a change of a tracked file of the repo. It sends the request
one time, also when the message does not settle the question. The pane does not wait for it. The message starts with
`From the user:`. It names the question pane and the question id. It gives the words of the user word for word and each
guess of the question session that the user accepted, still marked as a guess. A message from a pane that the user
closed with a confirm question open holds no guess. For a title or body request, it gives the words of the user and each
guess that the user accepted, with no exact text and no start hash. For a comment, a change of a blocked-by link or a
change of the field `Priority`, it gives the exact text and the start hash.

If the planner is the sender and the message settles the question, the request goes in the answer to the planner. In
each other case, the request goes in a message of its own. Such a message is a relay to the planner of the orchestrator,
not an answer to the sender. So the rule that the pane owner sends nothing to the sender for a message that does not
settle the question does not stop it. For an orchestrator of the kind `claude`, the planner of the orchestrator is never
the sender. So the answer to the follow-up planner holds no relay and no request.

The pane owner drafts no issue and starts no write subagent for a request. After the send, the orchestrator tells the
user in one line in its tab that the planner of the orchestrator has the request. If the send fails,
[the failure rule](limits.md#the-failure-rule) applies, as for the relay of a doc proposal. The planner handles the
request as a proposed issue of the orchestrator, with its review loops and its post rules. The planner then reports the
post or the drop to the orchestrator. For a draft that waits for a decision of the user, it sends the question to
`orchestrator-<slug>`.

A planner subagent gives its report of the post or the drop and each question in its result instead, as
[The result](planner-subagent.md#the-result) says.

For a title or body request, the user approves the request, not a text. The planner drafts the change, runs its review
loops and posts the reviewed text, as for a new issue. It needs no approval of the user for the text. The draft starts
from a read of the issue, as [Before a post](issues.md#before-a-post) and
[A change of an open issue](issue-draft.md#a-change-of-an-open-issue) say. The planner finds the issue from the words
and from the issue reading, if the user accepted one. If they name no single issue, the planner posts nothing and asks
the user first. It sends the question to `orchestrator-<slug>`, in the way that
[The escape hatch](planner.md#the-escape-hatch) gives for a draft of the follow-up planner that waits for a decision of
the user.

For a comment, a change of a blocked-by link or a change of the field `Priority`, the planner runs its review loops on a
text that the user approved in a pane. If a loop changes the text, the planner posts the changed text with no new
approval of the user. It still runs each other rule of [Before a post](issues.md#before-a-post). This paragraph is a
reading of the answer of the user, not the words of the user.

The reason: the planner runs its review loops on each new issue that the user asks for, also from a question pane. On
2026-11-13, operator-docs relayed a proposal of the question session question-914-codex. In that pane, the user said
"file separate tickets for codex and pi. Put them in the appropriate milestones". The session sent the request to the
sender as a requested draft change, with no command.

The reason of issue #992: on 2026-11-20, in a question pane, the user said that a change to an issue goes through a
planner and a review, like a new issue. The user wrote: "A change to a github issue must go through a planner and review
process like always. If the review is approved, then it is posted. This is the same as drafting a new issue." The user
also wrote: "Under what scenario does an "old body" and a "new body" have anything to do with the question pane?" and
"This needs a change in design: a proposed title or body change must go to the planner to draft it." So a question pane
has no use for an old body and a new body. Issue #987 asked a pane to show a summary and two paths for an old and a new
body. It is closed as not planned, and this rule replaces its idea.

### The rounds before the close

Before the pane owner closes or reuses a question pane, it sends the question session a close request. The rule covers a
close and a reuse. It holds after a settled answer, a failed answer send, a **No decision** message and an answer typed
in the tab of the orchestrator.

The close request is this message with the herdr path:
`PANE-OWNER <owner name> <question id>: close. Run the rounds of docs/dev/session-review-rounds.md until a round finds nothing new, then report.`
It is a word of the pane owner, not a word of the user, so it does not start with "From the user:". The pane owner sends
at most one close request for each question of a pane. Each question of a pane gets its own rounds before its context
clear or its close. The report is not a later pane message that an answer in the tab of the orchestrator wins over.

The reason for the words "until a round finds nothing new": the words ", then report" alone can read as a report after
one round. On 2026-11-21, a question session got the earlier message and sent its report after round 1, before round 2
ran. Its report said that 2 rounds ran and that round 2 found nothing new. The question session corrected its report
later. The question session reported this case itself, and no one else measured it. The user chose the new words on the
same day.

After the close request, the question session does the steps of the list of
[Session-review rounds](session-review-rounds.md), with the user in its pane. The rounds keep each rule of
[The question session](#the-question-session). So the question session skips steps 2, 4 and 5 of `/session-review`, the
steps of the memory notes. Steps 4 and 5 delete notes, and step 2 serves only these steps. The question of the pane is
not open work of the rounds, because the pane owner already holds its state.

A report of a round is a message of the question session to the pane owner, sent with the herdr path before the next
round. Each round that finds something new has one, also a round with no decision of the user. A failed round has none,
and the final report gives its findings. The round in which the user ends the rounds has none, and the final report
gives its decisions.

The final report is the report of the rounds of a question session. The question session sends it one time, after its
rounds end. [Close and continue](#close-and-continue) reads the final report. In this subsection, "the report" with no
other word names each report of a round and the final report. So the paragraph that starts "The report leaves out"
covers each report.

The first target of each proposal of step 6 is the user in the pane. So each such proposal is a waiting decision of step
7 of `/session-review`. The user accepts, changes or drops it in the pane. The question session still drafts no issue
and posts nothing.

A proposal of step 6 is not a doc proposal of [Send a decision](#send-a-decision), and it already names the file and the
change. If such a proposal rests on words of the user, it gives those words word for word, beside the file and the
change. If the words are a decision of the user in the rounds, the words that the report already gives for that decision
meet this rule. The question session combines similar proposals of one report into one proposal, as Send a decision says
for doc proposals. The combined proposal gives the words of the user of each part, word for word.

A recurrence, as [A recurrence](issues.md#a-recurrence) defines it, also goes to the user in the pane first, as a
proposal of step 6. The reason: step 6 of `/session-review` sends the session to that section for a recurrence. The
report of its round names the open issue. It also gives the ticket, the date and the facts of the new case, as a
recurrence comment does. It gives the words of the user word for word, as for each accepted proposal. After an end by
the user, the final report gives it.

For a question session, step 2 of the list also holds the next round for each new open question, until its wait ends. A
new open question is an open question that no earlier round of the same rounds listed. As
[Session-review rounds](session-review-rounds.md) says, this hold has no time limit, and a pause or a silence of the
user ends no wait. The end of the rounds by the user covers each wait, also the wait of a new open question.

The wait of a new open question ends when the words of the user answer it, drop it, or say that it stays open. The wait
also ends when the question session drops it as moot work by step 7 (c) and names the drop in the pane. The question
session judges whether the words of the user end the wait, and this judgment is open on purpose. Unfinished work of step
7 does not hold the next round, because it needs no word of the user.

This is a hold rule, as [Session-review rounds](session-review-rounds.md) defines it. It holds the next round and the
end of the rounds until the wait of each waiting decision and each new open question ends. For this hold rule, the end
of a wait counts as settled, also a word that a question stays open. This meaning gives no state of the question. The
hold rule also holds the next round until the ack of the report of the round arrives. This hold rule permits the end of
the rounds by the user.

For a question session, step 2 of the list ends with the send of the report of the round. The question session sends it
after the wait of each finding of the round that needs a word of the user ends. If the report holds a guess, it first
asks the confirm question in the pane. After the send, it waits at its prompt for the ack, as [Terms](#terms) says, so
its turn ends. In the turn of the ack, it starts the next round at once, which wins over the words "in the same turn" of
step 3 of the list. A round that finds nothing new has no report of a round.

In a question session, this hold rule wins over the rule that other open work holds no round. It wins over the start at
once after a round with no waiting decision. So a round with a new open question and no waiting decision does not start
the next round at once. It wins over the end by the user, which this hold rule makes wider. It wins over the end rule of
step 3 of the list. The outcome stays the same, because each earlier wait ended before the round that finds nothing new.

Under this hold rule, "no more findings" in the words of the user means that a round finds nothing new. It also means
that each earlier finding that needs a word of the user has one. A repeat of an earlier finding is not new, as step 7
(e) of `/session-review` says.

Each waiting decision and each open question of steps 6, 7 and 8 goes to the user in the pane, not to the pane owner as
a question. The question session sends each report of a round and the final report to the pane owner with the herdr
path. Each report gives the header of [Terms](#terms), with the question id and the message number. It says its kind:
"the report of round N" or "the final report". A report with no such mark counts as the final report. For each decision
of the user in the rounds, a report gives the words of the user word for word.

The guess rule of [Send a decision](#send-a-decision) also applies to each report. A report can hold a guess, for
example in an accepted proposal. Then the session asks the confirm question in the pane before it sends the report. The
confirm question holds the next round until the user answers it. If the user closes the pane, ends the run or ends the
rounds with that question open, the report gives no guess. It gives the words of the user word for word.

The final report gives the count of the rounds that ran. For what a round found, it names the report of that round by
its number. It gives again only each open finding and each item that no report of a round gave. So the final report does
not give again an accepted proposal, a drop or a recurrence that a report of a round gave. For a question session, this
paragraph wins over the parts of the report of the rounds that [Session-review rounds](session-review-rounds.md) asks
for.

The count of the final report is 1 more than the number of reports of a round that the pane owner got. One case differs:
the user ends the rounds after the send of a report of a round and before the next round starts. Then the count equals
that number. So the pane owner and the user can compare the count with the reports. This adds no step of the pane owner.

An open finding is a finding of any round that is still open at the send of the final report. It is a finding of these
kinds:

- A waiting decision whose wait did not end
- An open question of step 7 that has no answer and no drop
- Unfinished work of step 7 that the question session did not finish or drop

The final report names each open finding. A report of a round also names each finding of its round that stays open, for
example a question that the user said stays open. An accepted proposal is a proposal that the user accepted or changed
in the pane. It is not an open finding. The report of its round gives it with the words of the user, word for word.
After an end by the user, the final report gives it.

A dropped proposal is a proposal that the user rejected or dropped in the pane. It is a handled finding, as
[Session-review rounds](session-review-rounds.md) says for a drop of the user. The report that gives the drop names it
and gives it to no one as a proposal.

The first sentence of the final report after the header says whether the work of the pane on the question is done. The
work is done if the last round found nothing new, the final report names no failed round, and it gives no open finding.
If a condition fails, the first sentence says that the work is not done. The final report names each open finding, the
failed round or failed send, or the end by the user before a round found nothing new. The first sentence names no state
of the question, and it does not say that the question is settled, decided or open. A report of a round has no such
first sentence.

The report leaves out each doc rule, fact, preference or request for a new issue that a decision message already gave.
It also leaves out each finding of a pane handoff that got the ack. The close after a pane handoff is a close of this
section, as [the stopping-point case](handoff-orchestrator.md#the-stopping-point-case) says. After the close request,
the question session sends no decision message. A message can still give a word of the user about the pane or the run.
If the user gives a new word on the question, the session tells the user to type it in the tab of the orchestrator.
Examples of such a word are a write action, a metadata request and a request for a new issue.

If a round fails, the question session tells the user in the pane, its rounds end, and the final report names the
failure. If the send of a report of a round fails, the failure rule of [Session-review rounds](session-review-rounds.md)
applies, as for a failed send of a finding. The question session tells the user in the pane, its rounds end, and it
sends the final report. The final report names the failed send and gives the decisions of that report again. If the send
of the final report fails, the question session tells the user in the pane.

The pane owner accepts a report only with the header of its open pane id and its current question id, after its close
request. It then sends the ack. For each other report, the pane owner tells the user in one line, sends nothing and
keeps the state of the question.

After it accepts a report of a round, the orchestrator sends each accepted proposal and recurrence of that report to the
planner of the orchestrator. It sends no open finding then. After the final report that it accepts, it sends each open
finding, and each accepted proposal and recurrence that only the final report gives. It gives the words of the user for
each one. So the orchestrator sends each finding one time. After each report that it accepts, the orchestrator tells the
user in one line how many findings it sent.

The paragraph of [The pane owner handles a decision](#the-pane-owner-handles-a-decision) that starts "The pane owner
relays each doc proposal" gives each such send and its failure. The pane owner decides between a reuse and a close only
after the final report, also after a failed relay, as [Close and continue](#close-and-continue) says. The question keeps
its state.

The pane owner changes no state of the question for the first sentence of the final report. The question keeps the state
that the decision message, the **No decision** message or the answer in the tab gave it.

While the pane owner waits for the final report, the pane is open, and the wait has no time limit. If the send of the
close request fails, the failure rule applies, the pane stays open, and the run stops until the user speaks. Before the
final report arrives, the user can tell the pane owner to close the pane, or that the pane is closed. If the pane is
still open, the pane owner then closes it with no final report. In both cases, the question keeps its state, and the run
waits for the next word of the user. This paragraph wins over the paragraph that starts "Before the pane owner closes or
reuses a question pane".

The reason for the first sentence of the final report: the decision message settles the question, and a **No decision**
message leaves it open. The close request also comes after a failed answer send and after an answer typed in the tab of
the orchestrator. So the question session cannot always know the state of the question. In the final report, "resolved"
in the words of the user means that the work of the pane on the question is done. For step 2 of the list, the send of
the report of a round counts as "resolved" for that round. The reason: the user tied "resolved" to one round, and step 2
of the list is a step of each round.

A word of the user that a new open question stays open ends its wait, because the user can have no answer yet. The final
report still gives the question as an open finding, so the work of the pane is not done. The reason for the open finding
of unfinished work: a reuse clears the context of the question session, so the unfinished work is lost. So unfinished
work makes the first sentence of the final report say "not done", blocks a reuse and goes to the planner of the
orchestrator. [Session-review rounds](session-review-rounds.md) already counts it as open: "A finding that is not
handled is open."

The reason for the report of each round: on 2026-11-22, the user said: "I misunderstood the timing of a report. Yes, you
can gather all decisions from a review round into a single report for the owner of the question pane." Each round that
finds something new has a report, also with no decision of the user. So each round has one message, and the pane owner
and the user can compare the count of the final report with the reports. The pane owner sends an open finding only after
the final report, because a later round can end the finding. Also, [Close and continue](#close-and-continue) reads one
list of open findings.

The reason: on 2026-11-13, the user said to operator-docs: "file an issue to run `/session-review` in question panes
before closing". No one measured the tokens of the rounds in a question pane.

### The pane handoff

The pane handoff gives the old orchestrator the talk of an open pane, so that the new orchestrator can ask the question
again. The old orchestrator asks for it in [the stopping-point case](handoff-orchestrator.md#the-stopping-point-case),
before step 3 of its handoff. The pane handoff leaves the question open. It settles nothing.

The old orchestrator sends the pane handoff request only when all of these hold:

- The pane shows the first reply.
- The question of the pane is open.
- No close request for it went out.

While an opener subagent or a reuse subagent of the pane runs, the request waits for its report. The old orchestrator
sends at most one request for each question, apart from a send again of the failure list below.

The pane handoff is one message, with the herdr path and the header of a message of the question session. The marker
stands right after the header. The message has five parts:

- The question id and the question that the session holds, with its full first-reply text
- The state of the talk, for example "no reply of the user yet", "a discussion is open", "a confirm question is open"
  with its text as shown, or "a decision message that does not settle the question went out"
- Each word of the user in the pane, word for word, in its order
- Each reading of the session, marked as a guess
- Each finding that no message to the pane owner gave yet, for example a stated doc rule, a fact, a preference, a
  request of [Terms](#terms), a write action or a metadata request, each with the words of the user word for word

No one measured a size limit of `herdr pane send-text` for a long message. If the send fails, the question session tells
the user in the pane, as for each failed send, and the failure of a missing pane handoff below applies.

The question session asks no confirm question for the pane handoff, because the pane handoff gives no decision. So the
user accepted no guess, and each reading stays marked as a guess. After the request, the question session sends no
decision message. After the pane handoff, the rule of [The rounds before the close](#the-rounds-before-the-close) for a
new word of the user on the question holds.

The old orchestrator accepts a message as the pane handoff only with the header of its open pane id and its current
question id and with the marker. It accepts it only after its request, while the question is open and before a close
request for it. Then it sends the ack, as [Terms](#terms) says. A message with the header and no marker is a decision
message or a report of the rounds, and it gets the usual steps. For each other message with the marker, the old
orchestrator does what [The pane owner handles a decision](#the-pane-owner-handles-a-decision) says for a message that
it refuses.

After the accept, the old orchestrator writes the pane handoff file. The file holds the pane handoff word for word, the
state of each send of this paragraph and each "not run" mark of the next paragraph. Then it sends each stated doc rule,
fact or preference, and each request of [Terms](#terms), to the planner of the orchestrator one time, as
[The pane owner handles a decision](#the-pane-owner-handles-a-decision) gives these sends for a decision message. Each
send gives the words of the user word for word and no guess. The question keeps its question file, because no decision
settled it.

Each write action and each metadata request of the pane handoff does not run, because the user answered no confirm
question for them. The pane handoff file marks each one "not run", with the words of the user. The handoff file gives
each one with the mark, as
[The handoff file of the orchestrator](handoff-orchestrator.md#the-handoff-file-of-the-orchestrator) says. The old
orchestrator tells the user in its tab. The user can ask for each such action again. A decision message that the old
orchestrator accepts before the pane handoff gets the usual steps of
[The pane owner handles a decision](#the-pane-owner-handles-a-decision), also its write subagent, for a settled message
and for a message that does not settle the question. The wait for the write subagent and the task change stay in
[The panes and the write subagents](handoff-orchestrator.md#the-panes-and-the-write-subagents).

Then the old orchestrator sends the close request. The rounds run, and the pane closes with no reuse. The report of the
rounds leaves out each finding of a pane handoff that got the ack and each finding of a decision message.

In each other state of the pane, the pane gets no pane handoff. The usual steps of this page run to the close of the
pane, with no reuse. Examples are a close request that already went out, a decision message that settles the question
(the old orchestrator then sends the close request and refuses a later pane handoff), and a pane that shows no first
reply. A pane that shows no first reply, or whose opener subagent ended with no report, counts as open until the user
says that it is closed.

The first-reply text of the new pane gives the question from the pane handoff. It names the path of the pane handoff
file as the place of the earlier talk, as the paragraph of [The question session](#the-question-session) that starts "If
a detail" gives such a place for a path of a report. Each reading of the old session stays marked as a guess. If the
pane handoff file has an action with the mark "not run", the first-reply text says so, and the user can ask for it
again. The words of the old talk are not a decision of the question. Only a decision message of the new pane decides it.

These failures can happen:

- The send of the pane handoff request fails. The old orchestrator tells the user. It sends no second request on its
  own. On a word of the user, it sends the request again. If the user tells it to go on, it writes the pane handoff file
  with the question id and the first-reply text. The file says that the talk is not known and gives the error. Then it
  sends the close request.
- No pane handoff arrives, and the user tells the old orchestrator to close the pane, or says that it is closed. The old
  orchestrator writes the pane handoff file as for the failed request, with the words of the user. It closes an open
  pane with no report, as [The rounds before the close](#the-rounds-before-the-close) says for this case.
- A message with a header that is not the header of the open pane and the current question gets the refusal of
  [The pane owner handles a decision](#the-pane-owner-handles-a-decision). The old orchestrator waits on.
- A failed send of the ack, of the close request or of a finding follows the rule of this page for that send.
- The write of the pane handoff file fails. The old orchestrator tells the user. The handoff file holds the pane handoff
  itself, in place of the link.
- A failed close other than `pane_not_found` follows
  [the stopping-point case](handoff-orchestrator.md#the-stopping-point-case).

### Close and continue

After a settled answer or **No decision**, the pane owner gets the final report of
[The rounds before the close](#the-rounds-before-the-close). Then it gives the pane a reuse or closes it, as the next
paragraphs say.

The pane owner makes a reuse only in one case, with each of these conditions:

- The kind of the pane owner is `claude`. No one measured a context clear in a pi session.
- The rounds ended with a round that found nothing new, and the report names no failed round.
- The report gives no open finding.
- A next open question exists, as [Start](#start) defines it.
- Each condition of an automatic start of [Start](#start) holds for that question, apart from the condition "No pane of
  this orchestrator is open".
- The user did not tell the pane owner to close the pane, or that it is closed.

In each other case, the pane owner closes the pane. Under a kind other than `claude`, the owner closes the pane, and the
next question gets a new pane. A close with no rounds stays a close. Examples are a close that the user asks for and the
close after a report that the pane owner refuses.

In this section, the report is the final report. An open finding has the meaning that
[The rounds before the close](#the-rounds-before-the-close) gives. An accepted proposal is no open finding, so it does
not stop a reuse.

For a reuse, the pane owner starts one reuse subagent with the reuse prompt of [The prompts](#the-prompts). The pane
stays open while the reuse subagent runs. The pane owner gives the first-reply text of the next question under the rules
of [The question session](#the-question-session), as for a new pane.

The reuse subagent waits, with a time limit, until the question session waits at its input prompt, in the state `idle`
or `done`. It sends no input to a session in a turn or in `blocked`. It runs the context clear and the after-clear read.
Only after a read that shows the context clear, it sends the session prompt of the next question. Then it reads the pane
for the first reply and reports to the pane owner.

After a reuse that ends with the first reply in the pane, the question session holds the next question. The rules of
[A question pane](#a-question-pane) for that question then hold, as for a pane of a new start. After the context clear,
the question session holds a clean context. The pane id, the Claude Code process and the own name of the session stay
the same. The clear changes no model and no effort.

A step of a reuse can fail or can find a session that is not ready. Then the outcome is one of these:

- The session is in `blocked`. The reuse subagent sends no input to the pane. The orchestrator tells the user the name
  of the session and its pane id. The other rules of [A blocked session](operator-start.md#a-blocked-session) hold. The
  pane stays open, and the run stops until the user speaks.
- The wait fails or reaches its time limit. The reuse subagent sends no input to the pane. The pane owner closes the
  pane. The next question gets a new pane with an opener subagent, as [Start](#start) says.
- The context clear fails, or the after-clear read fails or does not show the context clear. The reuse subagent sends no
  session prompt. The pane owner closes the pane. The next question gets a new pane with an opener subagent.
- The send of the session prompt fails, or the pane shows no first reply. Then the paragraphs of [Start](#start) for a
  pane that shows no first reply apply.
- The reuse subagent ends with no report. Then the paragraph of [Start](#start) for an opener subagent that ends with no
  report applies.
- The user tells the pane owner to close the pane, or that it is closed, before the reuse subagent ends. Then the pane
  owner waits for the report of the reuse subagent. If the pane is still open after the report, the pane owner closes
  it. The next question keeps its state, and the run waits for the next word of the user.
- The user ends the run before the pane owner starts the reuse subagent. Then the pane owner closes the pane. After that
  start, the reuse subagent runs to its end, and the pane continues until its close.
- A message for an earlier question of the pane arrives after the context clear, for example a late decision message.
  Then the pane owner refuses it, as [The pane owner handles a decision](#the-pane-owner-handles-a-decision) says.

This pane close has no tab-list entry, stop message or [Stop a session](operator-start.md#stop-a-session) procedure. Its
rounds of `/session-review` are the rounds of [The rounds before the close](#the-rounds-before-the-close). For a
question pane, this section wins over the sentence "The operator stops a session only on a request of the user" of
[Stop a session](operator-start.md#stop-a-session). The word of the user that starts the pane counts as that request.
For a pane of an automatic start, the rule of the user in the reason of [Start](#start) counts as that request. A
context clear is no stop of [Stop a session](operator-start.md#stop-a-session), and the same word counts as the request
for each context clear of that pane.

The close of a question pane closes a pane, not a tab. So the sentence of [the operator page](../operator.md) that
starts "The tab list is the list of the tabs" does not limit it.

If herdr reports `pane_not_found`, the pane is already gone and the pane owner proceeds. For another close failure, the
orchestrator tells the user and stops the run until the user speaks.

Before a later question, the pane owner reviews decisions so far and passes the relevant ones on. It does not change the
question of the sender or apply an earlier answer to it. The bullet of [The answer](operator-items.md#the-answer) that
starts "An answer of the user or an answer of the operator covers only" gives this rule. The user decides the later
question in the pane of that question, with the decisions so far in view.

The orchestrator writes the question file of the later question again with the decisions so far. It does this before the
pane start or the reuse, as [The question file](#the-question-file) says.

If no open question remains, the run ends and the orchestrator tells the user in one line in its tab.

The user can end a run with a word to the pane owner. An active pane continues until its close, as
[The rounds before the close](#the-rounds-before-the-close) says. "The run stops until the user speaks" means until the
next word of the user to the pane owner. If the pane is closed or shows no first reply, only the tab of the orchestrator
is left.

An answer typed in the tab of the orchestrator wins over a later pane message, and the pane gets its rounds and then a
reuse or a close.

If the user reports closing the pane with no decision, the question stays open and the run waits for the user's next
word. That question also gets no automatic start, as for a **No decision** message.

While a pane is open or a [write subagent](#terms) runs, the orchestrator starts no handoff. The go of a handoff that
arrives in a decision message waits for the close of its pane. Then the handoff starts, as
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says. The new session of a handoff starts its own
pane only after the old pane is gone. So two panes of one slug never run at once. The orchestrator also does not start
the rounds of [the end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator). If either is due, the
orchestrator tells the user in its tab. A write subagent can still run after the close of its pane. The close request,
the close of the pane and the next pane start do not wait for a write subagent.

[The stopping-point case](handoff-orchestrator.md#the-stopping-point-case) is the exception for an open pane. In that
case, the old orchestrator starts the handoff while a pane is open, after it gives the pane its pane handoff or its
usual close, as [The pane handoff](#the-pane-handoff) says. A running write subagent still holds the start. If the close
of the pane fails, the old orchestrator follows
[The panes and the write subagents](handoff-orchestrator.md#the-panes-and-the-write-subagents). It tells the user and
starts the new orchestrator only after the user says that the pane is closed.

The reason: on 2026-11-13, the user said, as operator-docs relayed it: "File an issue to modify the process for closing
a question. After the session review passes with no findings, clear the session instead of closing it entirely. Then
send the prompt for the next session. This needs a verification that each question still starts in a clean context."
These words change the words of the user "always chain another pane for the next open question" of [Start](#start).
After a reuse, the next question gets the same pane.

### State table

The user holds no state of its own in this table. The column "Who tells whom" gives each step of the user.

| Event                                                                                                      | Question session                     | Pane owner                                                                                                                                                                                                                                                                                                                                        | Sender               | Who tells whom                                               |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| A word of the user starts a pane or a run                                                                  | Not started                          | Starts the opener subagent for the pane and the session                                                                                                                                                                                                                                                                                           | Keeps working        | The user tells the pane owner                                |
| A word of the user asks for the tab or answers in the tab                                                  | Not started                          | Starts no pane. Handles an answer. A tab request stops the run                                                                                                                                                                                                                                                                                    |                      | The user tells the pane owner                                |
| No word of the user. The conditions of an automatic start hold                                             | Not started                          | Makes an automatic start for the next open question                                                                                                                                                                                                                                                                                               | Keeps working        |                                                              |
| A word of the user starts a pane while a pane is open                                                      | Running                              | Starts nothing                                                                                                                                                                                                                                                                                                                                    |                      | The pane owner tells the user                                |
| A question of a task subagent or of the follow-up planner arrives                                          | Not started                          | The question waits in the list order. It gets a pane at its turn                                                                                                                                                                                                                                                                                  | Keeps working        | The sender tells the pane owner                              |
| An open question arrives, and no bar of the fallback holds                                                 | Not started                          | Gives the question id. Writes the question file before any pane start or reuse. The question waits in the list order                                                                                                                                                                                                                              | Keeps working        | The sender tells the pane owner                              |
| A question arrives after the old orchestrator wrote its handoff file                                       | Not started                          | Writes no question file and gives no question id. Shows the full text of the question as a report in its tab                                                                                                                                                                                                                                      | Keeps working        | The pane owner tells the user                                |
| A second open question arrives while a pane is open                                                        | Running                              | The question waits in the list order                                                                                                                                                                                                                                                                                                              |                      |                                                              |
| No pane opens next to the pane owner                                                                       | Not started                          | No pane exists. A run stops                                                                                                                                                                                                                                                                                                                       |                      | The pane owner tells the user                                |
| The pane does not show the question                                                                        | Not started, reading, or at a prompt | The pane stays open. A run stops                                                                                                                                                                                                                                                                                                                  |                      | The pane owner tells the user                                |
| The opener subagent ends with no report                                                                    | Not started, reading, or at a prompt | The pane counts as open. A run stops                                                                                                                                                                                                                                                                                                              |                      | The pane owner tells the user                                |
| The pane owner cannot start an opener subagent, a reuse subagent or a write subagent                       | Not started, or waits at its prompt  | The failure rule applies. No pane starts, and a run stops. A write action does not run                                                                                                                                                                                                                                                            |                      | The pane owner tells the user                                |
| The notification of a pane start or a reuse fails                                                          | Any                                  | The failure rule applies. The pane stays open                                                                                                                                                                                                                                                                                                     |                      | The pane owner tells the user                                |
| A pane start or a reuse for a question with a question file                                                | Not started                          | Lists the questions folder. Reads the question file. Puts its text in the opener or reuse prompt as the first-reply text                                                                                                                                                                                                                          |                      | The pane owner tells the opener or reuse subagent            |
| The read of the question file fails at a pane start or a reuse                                             | Not started                          | The fallback holds. Uses the text from its session. If the session holds no text, starts no pane for the question. The question stays open                                                                                                                                                                                                        |                      | The pane owner tells the user                                |
| The list of the questions folder fails                                                                     | Not started                          | The fallback holds. Makes no automatic start until the next word of the user. Lists the folder again at that word                                                                                                                                                                                                                                 |                      | The pane owner tells the user                                |
| A call on the three folders fails or gets a denial                                                         | Any state                            | The fallback holds. Runs no later call on the three folders until the next word of the user. A pane starts with the text from the session                                                                                                                                                                                                         | Keeps working        | The pane owner tells the user                                |
| The next word of the user after a failed or denied call on the three folders                               | Any state                            | Ends the bar. Writes a question file for each open question with no file and a proposal file for each waiting request with no file                                                                                                                                                                                                                |                      | The user tells the pane owner                                |
| The session starts                                                                                         | Running. Start line, reads, question | The question stays open                                                                                                                                                                                                                                                                                                                           |                      | The question session tells the user                          |
| A message arrives with the header of the open pane and the current question                                | Waits for the ack                    | Accepts it. Sends the ack                                                                                                                                                                                                                                                                                                                         |                      | The question session tells the pane owner                    |
| A decision message arrives, and the read of the question file fails with no text in the session            | Waits for the ack                    | Sends the ack. The message does not settle the question. The question stays open                                                                                                                                                                                                                                                                  |                      | The pane owner tells the user                                |
| A message arrives without the right header                                                                 | Waits for the ack                    | Sends nothing. Tells the user. Each question keeps its state                                                                                                                                                                                                                                                                                      |                      | The pane owner tells the user                                |
| The decision message settles the question                                                                  | Waits for the close request          | Sends the ack. Sends the settled decision to the asking session and the draft changes. Sends the close request                                                                                                                                                                                                                                    | Decision restarts it | The question session tells the pane owner                    |
| The settled decision goes back to the asking session                                                       | Waits for the close request          | Sends it with `From the user:`. A task subagent gets it by the message path of the orchestration pages                                                                                                                                                                                                                                            | Decision restarts it | The pane owner tells the sender                              |
| The send of the decision to the asking session fails                                                       | Waits for the close request          | The question stays decided. Sends the close request                                                                                                                                                                                                                                                                                               |                      | The pane owner tells the user                                |
| A question stops being open, as The question file says                                                     | Any state                            | Deletes the question file right after that point                                                                                                                                                                                                                                                                                                  |                      |                                                              |
| The delete of a question file fails                                                                        | Any state                            | The question stops being open. Does not count the file as open in its session. The fallback holds                                                                                                                                                                                                                                                 |                      | The pane owner tells the user                                |
| The decision message does not settle it                                                                    | Running                              | Sends the ack. Sends what stays open. The question stays open                                                                                                                                                                                                                                                                                     |                      | The pane owner tells the question session                    |
| The send of what stays open fails                                                                          | Running                              | The question stays open. A run stops. The failure rule applies                                                                                                                                                                                                                                                                                    |                      | The pane owner tells the user                                |
| A send of the question session fails                                                                       | Running                              | The question stays open                                                                                                                                                                                                                                                                                                                           |                      | The question session tells the user                          |
| A send of the herdr path of the pane owner fails                                                           | Any                                  | The failure rule applies                                                                                                                                                                                                                                                                                                                          |                      | The pane owner tells the user                                |
| A "No decision" message                                                                                    | Waits for the close request          | Sends the ack. Sends the close request. The question stays open                                                                                                                                                                                                                                                                                   |                      | The question session tells the pane owner                    |
| A message gives a doc proposal                                                                             | Waits at its prompt                  | Sends each doc proposal to the planner of the orchestrator as the message gave it. The pane does not wait                                                                                                                                                                                                                                         |                      | The pane owner tells the planner                             |
| The send to the planner of the orchestrator fails                                                          | Waits at its prompt                  | The failure rule applies                                                                                                                                                                                                                                                                                                                          |                      | The pane owner tells the user                                |
| A decision message gives a request                                                                         | Waits at its prompt, or running      | Sends the request to the planner of the orchestrator. Starts no write subagent                                                                                                                                                                                                                                                                    |                      | The question session tells the pane owner                    |
| The send of a request to the planner of the orchestrator fails                                             | Waits at its prompt, or running      | The failure rule applies                                                                                                                                                                                                                                                                                                                          |                      | The pane owner tells the user                                |
| A decision message gives a metadata request                                                                | Waits at its prompt, or running      | Sends the ack. Runs the metadata requests of the message in the order of the message, with one write subagent for each run of them in a row. A message that does not settle the question starts that write subagent after the ack. A request with a guess that the user did not accept does not run. A request marked "not approved" does not run |                      | The question session tells the pane owner                    |
| A settled decision message gives a write action                                                            | Waits for the close request          | Starts each actor in the order of the message. Sends a message to another session itself                                                                                                                                                                                                                                                          |                      | The pane owner tells the user                                |
| A call of the write subagent gets a tool block that stops it                                               | Any                                  | Follows "A denied command of the operator"                                                                                                                                                                                                                                                                                                        |                      | The pane owner tells the user                                |
| A command of the write subagent fails, the write subagent ends with no report, or a send fails             | Any                                  | The failure rule applies                                                                                                                                                                                                                                                                                                                          |                      | The pane owner tells the user                                |
| A rule of the docs stops the write subagent before a step with the user                                    | Any                                  | Tells the user. The action does not run                                                                                                                                                                                                                                                                                                           |                      | The pane owner tells the user                                |
| The hash of a user-level file differs from the start hash                                                  | Any                                  | The write subagent writes nothing. Each later action does not run. The pane owner tells the user                                                                                                                                                                                                                                                  |                      | The pane owner tells the user                                |
| A settled decision message gives a write action with no actor                                              | Waits for the close request          | The action does not run. The pane owner tells the user in one line                                                                                                                                                                                                                                                                                |                      | The pane owner tells the user                                |
| `tasker show-config` exits with code 1 after a write of the configuration file of tasker                   | Any                                  | Opens no pane. Tells the user in its tab the errors and the old text of the file. After the word of the user, runs `tasker show-config` again. Each `tasker` command fails until then                                                                                                                                                             |                      | The pane owner tells the user. The user tells the pane owner |
| A `herdr` command of a settled message fails                                                               | Any                                  | The failure rule applies. Each later action does not run                                                                                                                                                                                                                                                                                          |                      | The pane owner tells the user                                |
| A handoff or the rounds of the end of an orchestrator is due while a pane is open or a write subagent runs | Any                                  | Starts neither while the pane is open or the write subagent runs. In the stopping-point case, the pane handoff or the usual close comes first, as The pane handoff says                                                                                                                                                                           |                      | The pane owner tells the user                                |
| A report arrives from the orchestrator or the follow-up planner                                            | Not started                          | Shows it as text in its tab. No pane starts                                                                                                                                                                                                                                                                                                       |                      | The pane owner tells the user                                |
| The question session gets the close request                                                                | Runs rounds. Sends the final report  | Waits for the final report. The pane stays open                                                                                                                                                                                                                                                                                                   |                      | The pane owner tells the question session                    |
| A round of the question session finds a finding that needs a word of the user                              | Holds the next round                 | Waits for the report. The pane stays open                                                                                                                                                                                                                                                                                                         |                      | The question session tells the user                          |
| A round finds something new and no finding needs a word of the user                                        | Sends the report of the round        | Waits for the report. The pane stays open                                                                                                                                                                                                                                                                                                         |                      | The question session tells the pane owner                    |
| The report of a round holds a guess                                                                        | Asks the confirm question first      | Waits for the report. The pane stays open                                                                                                                                                                                                                                                                                                         |                      | The question session tells the user                          |
| The wait of the last such finding ends                                                                     | Sends the report of the round        | Waits for the report. The pane stays open                                                                                                                                                                                                                                                                                                         |                      | The user tells the question session                          |
| A report of a round arrives                                                                                | Starts the next round after the ack  | Sends the ack. Sends the accepted proposals and recurrences of the report to the planner of the orchestrator                                                                                                                                                                                                                                      |                      | The question session tells the pane owner                    |
| The user ends the rounds before each wait ends                                                             | Ends its rounds. Reports at once     | Waits for the final report. The pane stays open                                                                                                                                                                                                                                                                                                   |                      | The user tells the question session                          |
| The send of the close request fails                                                                        | Running, or waits at its prompt      | The pane stays open. A run stops. The failure rule applies                                                                                                                                                                                                                                                                                        |                      | The pane owner tells the user                                |
| A round of the question session fails                                                                      | Rounds end. Sends the final report   | Waits for the final report                                                                                                                                                                                                                                                                                                                        |                      | The question session tells the user                          |
| The send of a report of a round fails                                                                      | Rounds end. Sends the final report   | Waits for the final report                                                                                                                                                                                                                                                                                                                        |                      | The question session tells the user                          |
| The send of the final report fails                                                                         | Waits at its prompt                  | Waits for the final report. The pane stays open                                                                                                                                                                                                                                                                                                   |                      | The question session tells the user                          |
| The report of the rounds arrives, and each condition of a reuse holds                                      | Waits at its prompt until the reuse  | Sends the ack. Sends findings to the planner of the orchestrator. Starts the reuse subagent                                                                                                                                                                                                                                                       |                      | The question session tells the pane owner                    |
| The report of the rounds arrives, and a condition of a reuse fails                                         | Waits at its prompt until the close  | Sends the ack. Sends findings to the planner of the orchestrator. Closes the pane. A run goes on                                                                                                                                                                                                                                                  |                      | The question session tells the pane owner                    |
| The kind of the pane owner is not `claude`, and a reuse is due                                             | Waits at its prompt until the close  | Closes the pane. The next question gets a new pane                                                                                                                                                                                                                                                                                                |                      |                                                              |
| The reuse subagent waits for the question session                                                          | Waits at its prompt                  | Waits for the report of the reuse subagent. The pane stays open                                                                                                                                                                                                                                                                                   |                      | The pane owner tells the reuse subagent                      |
| The question session is in `blocked` when the reuse subagent waits                                         | `blocked`                            | Tells the user the name and the pane id. The pane stays open                                                                                                                                                                                                                                                                                      |                      | The pane owner tells the user                                |
| The wait of the reuse subagent fails or reaches its time limit                                             | Any                                  | Closes the pane. The next question gets a new pane                                                                                                                                                                                                                                                                                                |                      | The reuse subagent tells the pane owner                      |
| The context clear fails, or the after-clear read fails or does not show the context clear                  | Waits at its prompt                  | Closes the pane. The next question gets a new pane                                                                                                                                                                                                                                                                                                |                      | The reuse subagent tells the pane owner                      |
| The send of the session prompt fails, or the pane shows no first reply                                     | Waits at its prompt, or running      | The pane stays open. A run stops                                                                                                                                                                                                                                                                                                                  |                      | The pane owner tells the user                                |
| The reuse subagent ends with no report                                                                     | Any                                  | The pane counts as open. A run stops                                                                                                                                                                                                                                                                                                              |                      | The pane owner tells the user                                |
| The reuse subagent ends, and the pane shows the first reply                                                | Running. Start line, reads, question | The question stays open. The rules of A question pane hold                                                                                                                                                                                                                                                                                        |                      | The question session tells the user                          |
| The user tells the pane owner to close the pane, or that it is closed, before the reuse subagent ends      | Any                                  | Closes an open pane after the report. A run waits for the user                                                                                                                                                                                                                                                                                    |                      | The user tells the pane owner                                |
| The user ends the run before the pane owner starts the reuse subagent                                      | Waits at its prompt                  | Closes the pane. The reuse subagent runs to its end                                                                                                                                                                                                                                                                                               |                      | The user tells the pane owner                                |
| A message for an earlier question of the pane arrives after the context clear                              | Any                                  | Sends nothing. Tells the user. Each question keeps its state                                                                                                                                                                                                                                                                                      |                      | The pane owner tells the user                                |
| A report that the pane owner refuses                                                                       | Any                                  | Sends nothing. The question keeps its state                                                                                                                                                                                                                                                                                                       |                      | The pane owner tells the user                                |
| The user tells the pane owner to close the pane, or that it is closed, before the final report             | Any                                  | Closes an open pane with no final report. A run waits for the user                                                                                                                                                                                                                                                                                |                      | The user tells the pane owner                                |
| The user asks the session for a step outside it                                                            | Running                              | No change                                                                                                                                                                                                                                                                                                                                         |                      | The question session tells the user                          |
| The fetch of the question session fails                                                                    | Running                              | No change                                                                                                                                                                                                                                                                                                                                         |                      | The question session tells the user                          |
| The branch check of the question session fails                                                             | Running                              | No change                                                                                                                                                                                                                                                                                                                                         |                      | The question session tells the user                          |
| The pull of the question session is denied                                                                 | Running                              | No change                                                                                                                                                                                                                                                                                                                                         |                      | The question session tells the user                          |
| A decision message that [the pane owner refuses](#the-pane-owner-handles-a-decision)                       | Any                                  | Sends nothing. The question keeps its state                                                                                                                                                                                                                                                                                                       |                      | The pane owner tells the user                                |
| The user answers in the tab of the orchestrator                                                            | Running until the close              | Handles the answer and sends the close request                                                                                                                                                                                                                                                                                                    | Answer restarts it   | The user tells the pane owner                                |
| The user closes the pane with no decision                                                                  | Ended                                | The question stays open with no automatic start                                                                                                                                                                                                                                                                                                   |                      | The user tells the pane owner                                |
| herdr reports that the pane is already gone                                                                | Ended                                | Goes on                                                                                                                                                                                                                                                                                                                                           |                      |                                                              |
| The close fails in another way                                                                             | Running or waits at its prompt       | A run stops until the word of the user                                                                                                                                                                                                                                                                                                            |                      | The pane owner tells the user                                |
| A handoff is due while a pane is open                                                                      | Running                              | Starts none. No automatic start. The go question of the handoff waits for the next start, by the rule of one open pane. A word of the user decides. In the stopping-point case, the pane gets its pane handoff or its usual close, and the handoff then starts                                                                                    |                      | The pane owner tells the user                                |
| In the stopping-point case, an opener subagent or a reuse subagent of the pane runs                        | Not started, reading, or at a prompt | Waits for its report before the pane handoff request                                                                                                                                                                                                                                                                                              |                      | The opener or reuse subagent tells the pane owner            |
| In the stopping-point case, the pane shows the first reply and no close request went out                   | Waits at its prompt, or running      | If the question is open, sends the pane handoff request. The question session then sends no decision message                                                                                                                                                                                                                                      |                      | The pane owner tells the question session                    |
| In the stopping-point case, the send of the pane handoff request fails                                     | Holds its question                   | Follows the failure list of The pane handoff                                                                                                                                                                                                                                                                                                      |                      | The pane owner tells the user in its tab                     |
| In the stopping-point case, the pane handoff arrives with the right header and the marker                  | Waits for the ack                    | Sends the ack. Writes the pane handoff file. Sends the findings to the planner of the orchestrator. Then sends the close request                                                                                                                                                                                                                  |                      | The question session tells the pane owner                    |
| In the stopping-point case, a decision message with no marker comes before the pane handoff                | Waits for the ack                    | The usual steps, also the write subagent. After a settled message, sends the close request and refuses a later pane handoff                                                                                                                                                                                                                       |                      | The question session tells the pane owner                    |
| In the stopping-point case, the close request went out before the handoff                                  | Runs the rounds                      | Sends no pane handoff request. Waits for the report of the rounds and closes the pane                                                                                                                                                                                                                                                             |                      | The question session tells the pane owner                    |
| In the stopping-point case, the pane shows no first reply, or the opener subagent ended with no report     | Not started, reading, or at a prompt | Sends no pane handoff request. The pane counts as open until the user says that it is closed                                                                                                                                                                                                                                                      |                      | The pane owner tells the user in its tab                     |
| After a handoff in the stopping-point case, the question of the pane gets its turn                         | New. Shows the question              | The new orchestrator reads the pane handoff file and starts a pane                                                                                                                                                                                                                                                                                |                      | The new orchestrator tells the user in the pane              |
| A handoff is due, and no pane is open                                                                      | Not started                          | Makes no automatic start, apart from the question that asks the go of the suggested handoff. That question gets an automatic start, as [Start](#start) says                                                                                                                                                                                       |                      |                                                              |
| The decision message gives the go of a suggested handoff                                                   | Waits for the close request          | Sends the ack. Sends the close request. Closes the pane after the rounds, with no reuse. Then starts the handoff                                                                                                                                                                                                                                  |                      | The question session tells the pane owner                    |
| The user ends the run                                                                                      | A running session keeps running      | Starts no next pane. A [stop of a run](#terms) holds                                                                                                                                                                                                                                                                                              |                      | The user tells the pane owner                                |
| No open question of the run is left                                                                        | Ended                                | The run ends. A new open question can get an automatic start                                                                                                                                                                                                                                                                                      |                      | The pane owner tells the user                                |

If two rows match, the rows of one bullet below follow its rule:

- The row "The user tells the pane owner to close the pane, or that it is closed, before the final report" wins over the
  rows "The report of the rounds arrives, and each condition of a reuse holds" and "The report of the rounds arrives,
  and a condition of a reuse fails".
- A row of a failed reuse step wins over the rows "The reuse subagent waits for the question session" and "The reuse
  subagent ends, and the pane shows the first reply".
- Among the rows "The question session is in `blocked` when the reuse subagent waits", "The wait of the reuse subagent
  fails or reaches its time limit", "The context clear fails, or the after-clear read fails or does not show the context
  clear" and "The send of the session prompt fails, or the pane shows no first reply", an earlier row wins over a later
  row.
- The row "The user tells the pane owner to close the pane, or that it is closed, before the reuse subagent ends" wins
  over each row of a failed reuse step.
- The row "The user ends the run before the pane owner starts the reuse subagent" wins over the row of a reuse.
- The row "A message for an earlier question of the pane arrives after the context clear" wins over the row of a
  decision message that the pane owner refuses.
- The row "The kind of the pane owner is not `claude`, and a reuse is due" wins over the row "The report of the rounds
  arrives, and each condition of a reuse holds".
- The row "A decision message gives a metadata request" wins over the rows "The decision message does not settle it" and
  "A "No decision" message" for the start of the write subagent of a metadata request. For a settled message, it follows
  the row "A settled decision message gives a write action".
- The row "The user ends the rounds before each wait ends" wins over the rows "A round of the question session finds a
  finding that needs a word of the user" and "The report of a round holds a guess".
- The row "The report of a round holds a guess" wins over the row "The wait of the last such finding ends" until the
  user answers the confirm question.
- The row "A report of a round arrives" wins over the row "A message arrives with the header of the open pane and the
  current question".
- The row "A report that the pane owner refuses" wins over the row "A report of a round arrives".
- The row "The user tells the pane owner to close the pane, or that it is closed, before the final report" wins over the
  row "A report of a round arrives". The pane owner still sends the accepted proposals and recurrences of that report to
  the planner of the orchestrator.
- The row "The report of a round holds a guess" wins over the row "A round finds something new and no finding needs a
  word of the user" until the user answers the confirm question.
- The row "An open question arrives, and no bar of the fallback holds" and the row "A question of a task subagent or of
  the follow-up planner arrives" both apply. The first row adds the write of the question file before the wait.
- The row "A question arrives after the old orchestrator wrote its handoff file" wins over the row "An open question
  arrives, and no bar of the fallback holds".
- The row "A call on the three folders fails or gets a denial" also applies after the rows "The read of the question
  file fails at a pane start or a reuse", "The list of the questions folder fails" and "The delete of a question file
  fails".
- The row "The list of the questions folder fails" wins over the row "No word of the user. The conditions of an
  automatic start hold" until the next word of the user.
- The row "A decision message arrives, and the read of the question file fails with no text in the session" wins over
  the rows "A message arrives with the header of the open pane and the current question" and "The decision message
  settles the question".
- The row "A question stops being open, as The question file says" follows the rows "The settled decision goes back to
  the asking session" and "The send of the decision to the asking session fails".
- The row "The delete of a question file fails" wins over the row "A question stops being open, as The question file
  says" for the state of the file.
- The rows "A "No decision" message" and "The user closes the pane with no decision" delete no question file. The row "A
  question stops being open, as The question file says" does not apply to them.
- A row that starts with "In the stopping-point case," holds during the handoff of the old orchestrator in
  [the stopping-point case](handoff-orchestrator.md#the-stopping-point-case). A row that starts with "After a handoff in
  the stopping-point case," holds for the new orchestrator after such a handoff. Each such row wins over an old row for
  the same event, for example the rows "The pane does not show the question", "The opener subagent ends with no report"
  and "A handoff is due while a pane is open".

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

On 2026-11-20, a session measured two problems of the herdr path on one machine. On that day, `claude --version` printed
`2.1.330` and `herdr --version` printed `0.9.3`.

- 2026-11-20: twice, a session ran `herdr pane send-text` and then `herdr pane send-keys <pane id> enter` in one call,
  and the Enter had no effect. The first target was the orchestrator pane, for a decision message of a question session.
  The second target was a question pane, for a close request of the orchestrator. In both cases the text went into the
  pane and the message stayed unsubmitted. A later Enter submitted each message.
- 2026-11-20: a quoted here-document does not fill in `$HERDR_PANE_ID`, so the header of a decision message went out
  with that literal text. The session then filled in the value with shell substitution after the here-document, and the
  header showed the real pane id.

The cause of the unsubmitted Enter is a guess. The guess is that the Enter arrives while the pasted text still comes in.
No one measured this cause, and no one measured the wait of one second.

On 2026-11-22, a session measured the `MSG` lines of the message number in a shell that sends nothing. On that machine,
`bash --version | head -1` printed `GNU bash, version 5.2.37(1)-release (x86_64-pc-linux-gnu)`. The command:

```sh
bash -c 'HERDR_PANE_ID=w1:p2; IFS= read -r BODY <<'"'"'EOF'"'"'
text with $HOME and `x`
EOF
MSG="QUESTION-PANE $HERDR_PANE_ID orchestrator-m31-1 m3: $BODY"; printf "%s\n" "$MSG"'
```

The output, with exit code 0:

```text
QUESTION-PANE w1:p2 orchestrator-m31-1 m3: text with $HOME and `x`
```

So `m3` stays literal, the shell fills in `$HERDR_PANE_ID`, and the shell expands nothing in the body. In this line, the
first colon that has a space after it is the colon after `m3`. The colon of `w1:p2` has no space after it. The same form
with the body `ACK m3. The report arrived.` and `MSG="PANE-OWNER orchestrator-m31 orchestrator-m31-1: $BODY"` printed
this line, with exit code 0:

```text
PANE-OWNER orchestrator-m31 orchestrator-m31-1: ACK m3. The report arrived.
```

The rules of this page no longer use `SendMessage`. The records above that name `SendMessage` and `ListAgents` stay as
facts of the old path. No one measured a send with `herdr pane send-text` into a session that is in a turn. No one
measured a send into a pi pane in either direction. No one measured a newline inside `send-text`, or the wait for the
ack. No one measured the header or the ack with the message number through `herdr pane send-text`. No one measured a
context clear in a pi session. No one measured that a pi orchestrator can start an opener subagent, a reuse subagent or
a write subagent.
