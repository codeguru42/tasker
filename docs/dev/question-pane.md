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

The pane owner (short form: owner) is the session that starts a question pane. An orchestrator of each kind is a pane
owner. Each pane owner has at most one open pane.

An open question of the orchestrator is a question for the user that the orchestrator or one of its sessions asks. The
sessions are, for example, a task subagent and the follow-up planner. The orchestrator asks it in its own question pane.

The question id is the name of one open question. The orchestrator gives each question the next free item id of its own
counter, in the form `orchestrator-<slug>-<n>`. Each progress report of
[The operator](working-with-the-user.md#the-operator) also takes the next number of that counter. The handoff file of
the orchestrator carries that counter, so the id stays unique through a handoff.

[The glossary](GLOSSARY.md) defines a question session.

A [question run](#a-question-pane) is a series of open questions, one at a time, in the order of [Start](#start). Each
question gets a new question pane or a reuse of the pane before.

An automatic start is the start of a question pane with no word of the user, as [Start](#start) says.

The herdr path is the way that a pane owner and its question session send messages to each other. It works for each kind
of session. The sender writes the message as one line. It writes the word `LINE-BREAK` with one space on each side in
place of each newline. It puts the line in a shell variable with a quoted here-document. Then it runs
`herdr pane send-text <receiver pane id> "$MSG"` and `herdr pane send-keys <receiver pane id> enter`. No one measured a
newline inside `send-text`, so the one-line form stays.

A message of the question session starts with the header `QUESTION-PANE <own pane id> <question id>:`. The own pane id
is `$HERDR_PANE_ID` in the shell of the question session. A message of the pane owner starts with
`PANE-OWNER <owner name> <question id>:`. A typed header does not prove its sender, because any pane can type it. The
user did not settle the form of the header. The form of this page is the choice of this page.

An ack is a short reply that says that a message arrived. For each message of the question session that it accepts, the
pane owner sends `PANE-OWNER <owner name> <question id>: ACK. The report arrived.` with the herdr path. It sends no ack
for a message that it refuses. After each send, the question session waits at its prompt for the ack. The wait has no
time limit. If no ack comes, the user can ask the question session to send again. No one measured this wait.

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
- A write of a file
- A git write, for example a commit, a branch or a push, apart from `git fetch origin`
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

A user-level file is one of three files: the configuration file of tasker at the path of
[Where the file is](../config.md#where-the-file-is), `$HOME/.claude/settings.json` and `$HOME/.claude/CLAUDE.md`. Each
such file is outside the local clone and outside each worktree. An untracked file of the local clone, for example
`.claude/settings.local.json`, is not a user-level file. Another file needs a doc change first, for example a skill in
`$HOME/.claude/skills/`. The user plans a separate repo for agent config. That repo can need a new write area, and this
waits for a later decision.

The planner of the orchestrator is `planner-<slug>`, with the slug of the orchestrator.

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
write-subagent actions in a row of one settled decision message. A write subagent writes no file other than a user-level
file and an input file. It writes no memory note, as [the memory rule](rules.md#docs) says.

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
stays open, and the handoff file holds it, as
[The handoff file of the orchestrator](handoff-orchestrator.md#the-handoff-file-of-the-orchestrator) says. A new pane
that opens during a handoff can stay open after the close of the old orchestrator. The new orchestrator accepts a
decision message only from the question session of its own open pane, as
[The pane owner handles a decision](#the-pane-owner-handles-a-decision) says. So no orchestrator then accepts the
decision of that pane.

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

### The question session

The pane owner gives each part of this paragraph through the opener prompt or the reuse prompt of
[The prompts](#the-prompts). This also holds for the paragraphs that start "The pane owner gives all offered choices",
"The pane owner gives relevant earlier decisions" and "The pane owner prepares first-reply text". Before the start, it
gives the question session its own name, the name of the pane owner, the pane id of the pane owner and the question id.
It also gives the full question. For a question of a task subagent or of the follow-up planner, the first reply names
the ticket and the session that asks.

The pane owner gives all offered choices and costs, the recommendation of the sender, and each draft or report path
named by the question.

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

For a measure that changes the state of the user, the first-reply text gives the command and its undo step word for
word. It also gives each other part of such a question that
[The state of the user](plan-review.md#the-state-of-the-user) asks for. An example is what the command and the undo step
each change. These parts do not count in the limit. The question session needs them for its decision message, as
[Send a decision](#send-a-decision) says.

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

The question session follows the general user-facing, simple-English, [memory](rules.md#docs), and
[doc-read](doc-reads.md#the-doc-read-rule) rules from its start.

After the first reply, the question session can read drafts and reports, use read-only commands other than `herdr`
commands, and run `git fetch origin`. If fetch fails, it tells the user and reads the last successful `origin/main`.

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

### The prompts

This subsection holds the opener prompt, the reuse prompt and the session prompt of a question pane. The opener prompt
is the prompt of the opener subagent. The reuse prompt is the prompt of the reuse subagent. The session prompt is the
prompt of the question session.

The pane owner puts a value in place of each placeholder of the lists that follow the opener prompt and the reuse
prompt. It adds no other words. The pane owner does not write or fill the session prompt. No herdr output of a reuse
goes into the context of the pane owner, apart from the report of the reuse subagent.

````text question-opener
You are the opener subagent of the question pane <name> of the pane owner <owner name>. Do the steps that follow in order. If a step fails, do no later step, unless the step says otherwise. Close no pane and send no message to a session.
1. Run git -C <local clone> fetch origin. If the fetch fails, go on with the last origin/main.
2. Run git -C <local clone> show origin/main:docs/dev/question-pane.md. In its output, find the fenced block whose first line, at the start of a line, is ```text question-session. That block is the session prompt.
3. In the session prompt, replace each placeholder with the value of the same name in the list of values. Replace <first reply> last. In its value, put one space, the word LINE-BREAK and one space in place of each newline. Change nothing else inside its value, apart from step 4.
4. Join the lines of the session prompt into one line, with one space between two lines. Write each single quote of the result as '\''. Then put the result in single quotes.
5. Run tasker show-config --repo <repo key>. Keep .sessions.kind and the entry .sessions.models.question of the output.
6. Run herdr pane split <owner pane id> --direction right --cwd <local clone>. Keep the new pane id from .result.pane.pane_id of the output.
7. Run herdr agent start <name> --kind <kind> --pane <new pane id> -- -n <name> <model flags> <quoted prompt>. If it fails, still do step 8.
In step 7, <kind> is the kind of step 5, and <new pane id> is the pane id of step 6. <model flags> are the flags of the row of the kind in the seam table of docs/config.md, with the values of the entry of step 5. For the kind claude, they are --model <model> --effort <effort>. For the kind pi, they are --provider <upstream> --model <model> --thinking <effort>, and <upstream> is the part of the model before the first /. With no entry, leave them out. <quoted prompt> is the result of step 4.
8. Run herdr pane read with the new pane id. If the pane shows no first reply, run timeout 20 bash -c 'sleep 10' and read it again. Read the pane at most 6 times. If the pane shows the first reply, the start worked. The typed prompt is not the first reply. The start line of the session prompt is also not the first reply.
Your final report gives the new pane id and each command with its exit code and its error. It also says whether the pane shows the first reply. Keep the report short.
The list of values: name <name>, owner name <owner name>, owner pane id <owner pane id>. The list goes on: question id <question id>, local clone <local clone>.
The value of first reply is all the text after the last word FIRST-REPLY of this prompt. FIRST-REPLY <first reply>
````

- `<name>`: the own name of the question session. It starts with `question-` and is unique.
- `<owner name>`: the own name of the pane owner, as [docs/dev/GLOSSARY.md](GLOSSARY.md) defines the own name.
- `<owner pane id>`: the pane id of the pane owner, the value of `$HERDR_PANE_ID` in its shell.
- `<local clone>`: the path of the local clone, as [the doc-read rule](doc-reads.md#the-doc-read-rule) uses it.
- `<repo key>`: the repo key of the repo of the local clone, for example `codeguru42/tasker`.
- `<question id>`: the question id of the question, as [Terms](#terms) defines it.
- `<first reply>`: the first-reply text, with its lines as the pane owner wrote them.

````text question-reuse
You are the reuse subagent of the question pane <pane id>. Its question session is <name>, for the pane owner <owner name>. Do the steps that follow in order. If a step fails, do no later step, unless the step says otherwise. Close no pane and send no message to a session. Send no input to the pane, apart from steps 4 and 7.
1. Run git -C <local clone> fetch origin. If the fetch fails, go on with the last origin/main.
2. Run git -C <local clone> show origin/main:docs/dev/question-pane.md. In its output, find the fenced block whose first line, at the start of a line, is ```text question-session. That block is the session prompt.
3. Run herdr agent wait <pane id> --timeout 600000. If it fails or reaches its time limit, do no later step. Read the state at .result.agent.agent_status. If the state is not idle and not done, do no later step.
4. Run herdr agent get <pane id>. Keep the value at .result.agent.agent_session.value as the old session value. Then run herdr pane send-text <pane id> '/clear'. Then run herdr pane send-keys <pane id> enter.
5. This step is the after-clear read. Run herdr agent get <pane id>. The read shows the context clear if .result.agent.agent_session.value differs from the old session value and .result.agent.agent_status is idle or done. If it does not show the context clear, run timeout 20 bash -c 'sleep 10' and read again. Read at most 6 times. If no read shows the context clear, do no later step.
6. In the session prompt, replace each placeholder with the value of the same name in the list of values. Replace <first reply> last. In its value, put one space, the word LINE-BREAK and one space in place of each newline. Change nothing else inside its value.
7. Join the lines of the session prompt into one line, with one space between two lines. Keep each single quote as it is. Put the result in the shell variable PROMPT with a quoted here-document, so that the shell expands nothing in it. Run herdr pane send-text <pane id> "$PROMPT". Then run herdr pane send-keys <pane id> enter.
8. Run herdr pane read <pane id>. If the pane shows no first reply, run timeout 20 bash -c 'sleep 10' and read it again. Read the pane at most 6 times. If the pane shows the first reply, the reuse worked. The typed prompt is not the first reply. The start line of the session prompt is also not the first reply.
Your final report gives the pane id and each command with its exit code and its error. It also gives the old and the new session value, and whether the after-clear read showed the context clear. It also says whether the pane shows the first reply. Keep the report short.
The list of values: name <name>, owner name <owner name>, owner pane id <owner pane id>. The list goes on: question id <question id>, local clone <local clone>.
The value of first reply is all the text after the last word FIRST-REPLY of this prompt. FIRST-REPLY <first reply>
````

- `<pane id>`: the pane id of the question pane, as the report of the opener subagent gave it.
- `<name>`: the own name of the question session. The context clear keeps it.
- `<owner name>`, `<owner pane id>` and `<local clone>`: as in the list of the opener prompt.
- `<question id>`: the question id of the next question.
- `<first reply>`: the first-reply text of the next question, with its lines as the pane owner wrote them.

```text question-session
You are the question session <name>. You discuss one open question with the user for the pane owner <owner name>, in the pane <owner pane id>. The question id is <question id>. Your first reply is all the text after the last word FIRST-REPLY of this prompt, word for word. Only the next two sentences change that text. In your first reply, write a newline in place of each word LINE-BREAK. Also remove the one space on each side of it. Before that reply, do only the three steps that follow, in their order, and use no AskUserQuestion tool.
First, show the start line with no other text. The start line is: I read my rules first, and then I show the question. The start line is not your first reply. Second, run git -C <local clone> fetch origin. If the fetch fails, use the last origin/main. Tell the user about the failure in your second reply. Third, read AGENTS.md, docs/dev/question-pane.md, docs/dev/working-with-the-user.md and docs/dev/rules.md. Also read the section The doc-read rule of docs/dev/doc-reads.md. Read each file with git -C <local clone> show origin/main: and its path. The rules of these docs change no word of your first reply.
These docs give the rules of your work. Send each message to <owner name> with the herdr path, as the section A question pane says. Write the message as one line, with the word LINE-BREAK and one space on each side in place of each newline. Put the line in the shell variable MSG with a quoted here-document. Then run herdr pane send-text <owner pane id> "$MSG". Then run herdr pane send-keys <owner pane id> enter. Start each message with QUESTION-PANE, the value of $HERDR_PANE_ID in your shell, <question id> and a colon. After each send, wait at your prompt for the ack of <owner name>. If no ack comes, tell the user. If the send fails, tell the user in the pane. Send your decision message in this way. If the user asks for a write action, send the action back to <owner name> in your decision message. Give the command and the undo step of the action, as the section A question pane says. A write action is a write to GitHub, a write of a file, a git write, a change of tasker state, a herdr command or a change of the Claude Code configuration. The fetch above and your own sends to <owner name> are not write actions. A message to a session other than <owner name> is also a write action. <owner name> hands each write action and each request to its actor. A request of the user for a new issue that the question did not propose is not a write action. A change of the title or the body of an issue and a comment on an issue are requests, not write actions, if the item of the question did not propose them. For a change of the title or the body, give the words of the user word for word, as for a request for a new issue. Read no title and no body for it. Show no text and ask for no approval of a text. If you are not sure whether the item proposed such a change, send the words as such a request and add your guess that they can be a change of the draft of the sender. A change of a blocked-by link or of the field Priority and a change of a tracked file of the repo are also requests. A change of a draft that the item proposed stays with the sender. Send each one in your decision message, as the section Send a decision says. Start no subagent that plans, drafts, reviews or posts an issue, and ask no other session for such work. Send each request for a new issue in your decision message. Also send each word of the user that closes the pane, ends the run or adds an issue to a set. Give the words of the user word for word in your decision message. Do not draft the issue, and ask for no approval. Give no command, no undo step and no input file for it, and show no blocked-by links. Send a message that reports a decision or a choice only in three cases. First, the user made a direct pick. A direct pick is only the letter, the number or the exact words of one shown choice, a yes to one proposal of yours that is a shown choice, or words that only let the sender decide. Send a direct pick at once, with no confirm question. A reply with a direct pick and also a request or a reading of yours is a discussion, and the confirm question comes first. That guess goes in the one confirm question of the discussion, with your planned decision as reading 1. Second, the user said yes to your confirm question. Third, the user ended the question, closed the pane or ended the run. Each other reply is a discussion, also a choice with a reason, a condition, a question or a new idea, and a yes to a reading of yours. If you are not sure, treat the reply as a discussion. During a discussion, answer the user and send nothing. A pause is not a pick. To end a discussion, show for each shown choice whether the words fit it and why, the best fit or no fit, and what stays open. Then ask one confirm question. Give your planned decision as your reading, marked as a guess, and each other guess of the message as numbered readings. Ask only: Is this your final decision? List no choices. If the user says yes, send the message. Give the words that started the discussion, your reading, the confirm question and the answer word for word. Also say that the user accepted the decision as final. If the user says no or adds words, drop the reading and send nothing. A no to a confirm question with a planned decision drops all its readings. A reply about the decision or a shown choice, also a reason, a condition or a question about a choice, adds words, and only a reply about another topic keeps the confirm question open. If the user gives no answer, wait and set no timer. If the user writes about something else, say in one line that the confirm question is open and ask it again. A guess is a reading of yours that the user did not say or point to. If you are not sure, it is a guess. Before you send any message with a guess, also a request for a new issue, another request, a rule, a fact, a preference or the report of the rounds, ask one confirm question about the guesses. If the user says no, send the words of the user word for word with no guess. This holds only for a message with no planned decision. If the user ends the question, closes the pane or ends the run while a discussion or a confirm question is open, send the words of the user word for word and no guess. For an open decision, send No decision with the state discussion open, not confirmed. FIRST-REPLY <first reply>
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
question. The message has no part about a confirm question.

For a discussion, the question session shows the evaluation. The evaluation names the choice that the words fit best, or
says that no choice fits. It also says what stays open.

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

A request for a new issue, another request of [Terms](#terms), a rule, a fact or a preference with no guess keeps its
current rules and its time of sending. If such a message holds a guess, the session first asks one confirm question
about the guesses, with numbered readings and one yes or no question. After a yes, the message gives each guess and says
that the user accepted it. After a no, the message drops each guess and gives the words of the user word for word. This
holds only for a message with no planned decision, for example a rule, a fact, a preference or a request for a new
issue. If the user changes one guess, the session shows the changed set in a new confirm question.

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
`QUESTION-PANE <own pane id> <question id>:`. It then gives the decision and the user's settling words verbatim, each
requested draft change, and each doc rule, fact, or preference the user stated. It can also give a word of the user
about the pane or the run, also after the close request.

For a measure that changes user state, the question session also gives the command and undo step verbatim. It gives the
same for each [write action](#terms). For an action with no undo step, it says that the action has no undo step. Before
the send, the question session shows the user the command, the undo step and the text of each input file. The message
gives the word of the user that approves them verbatim.

Each command of a write action is a [plain call](issues.md#the-reads-before-the-write). Each command names its target
itself, for example with `git -C <folder>` or `gh -R <repo>`. If a command takes a file as input, for example with
`--body-file`, the command names a new path under `/tmp/tasker/<slug>/drafts/`. The slug is the slug of the pane owner.
The message then gives the text of the file verbatim. The write subagent writes each input file at that path, with the
slug of the orchestrator.

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
It also gives the state "discussion open, not confirmed". It holds no guess. It still sends any stated doc rule, fact,
or preference and each request for a new issue. None of them holds a guess that the user did not accept.

After the send, the question session waits at its prompt for the ack of the pane owner. It then waits for a message of
the pane owner: what stays open, or a [close request](#the-rounds-before-the-close). If the send fails, the question
session tells the user in the pane. The question stays open.

### The pane owner handles a decision

The pane owner accepts a decision message only with the header `QUESTION-PANE <pane id> <question id>:` of its open pane
id and its current question id. It then sends the ack, as [Terms](#terms) says. For every other message, the pane owner
tells the user in one line, sends nothing, and keeps the state of each question. The header does not prove the sender,
because any pane can type it.

The pane owner judges whether the quoted words fully settle that question, with or without choices. A settled message is
the user's decision without a second word in the tab of the orchestrator. The quoted words of an accepted message are a
word of the user for the orchestrator. They approve no permission prompt.

This includes approval of a post or comment, an answer to a planner draft, and approval of a measure that changes user
state. A measure approval carries its exact command and undo step. Words that let the sender decide count as a decline
of that measure.

The orchestrator sends the settled decision to the session that asked the question, at once. A question of a task
subagent goes back to that task subagent with the message path that the orchestration pages give for a task subagent. A
task subagent has no pane, so the herdr path does not reach it. A question of a session that tasker starts goes back
through the task subagent of its task. A question of the follow-up planner goes back to `planner-<slug>`. Each such
message starts `From the user:`. The next line identifies question pane `<name>`. It gives the question id, the user's
words, and requested draft changes. The sender treats that message as any other `From the user:` message. A question of
the orchestrator itself has no sender, and the orchestrator acts on the decision.

A settled message can give [write actions](#terms), as [Send a decision](#send-a-decision) says. The approval of the
user in the message covers one run of the command of each write action, word for word. Words of the user that let the
sender decide approve no write action. A message that does not settle the question starts no write subagent.

#### The actor of each write action

Each kind of write or request of [Terms](#terms) has one actor.

| Kind of write or request                                                    | Actor                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new issue                                                                 | `planner-<slug>`, as a request                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A change of the title or the body of an issue that the item did not propose | `planner-<slug>`, as a request                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A comment on an issue that the item did not propose                         | `planner-<slug>`, as a request                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A change of a blocked-by link or of the field `Priority`                    | `planner-<slug>`, as a request                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A change of the metadata of an issue                                        | The write subagent                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A write of a user-level file                                                | The write subagent                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A change of a tracked file of the repo                                      | `planner-<slug>`, as a request for a new issue                                                                                                                                                                                                                                                                                                                                                                                                     |
| A `tasker` command, also `tasker model`                                     | A read-only command: the orchestrator. A task change: the task subagent of the task, after the orchestrator sends it. A task change of a task of a peer goes to the peer as a request of [the request rule](../orchestrator.md#the-request-rule). `tasker model` with a new model or `--effort`: the orchestrator, only on the words of the settled message. See [the orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule) |
| A message to another session                                                | The orchestrator. A message to a peer is a request of [the request rule](../orchestrator.md#the-request-rule)                                                                                                                                                                                                                                                                                                                                      |
| A `herdr` command                                                           | The orchestrator                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A git write                                                                 | No actor                                                                                                                                                                                                                                                                                                                                                                                                                                           |
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
the report of the actor before it. A request is not part of this order. The orchestrator sends it to `planner-<slug>`
one time and does not wait for it, as the paragraph on requests says. A failure of any write action stops each later
write action. The orchestrator tells the user each action that did not run.

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

The pane owner relays stated doc rules, facts, and preferences to `planner-<slug>`. If the planner is the sender, the
pane owner combines that relay with the answer. A failed relay invokes the failure rule. The orchestrator sends each
relay one time. The pane does not wait for it.

The pane owner sends each [request for a new issue](#terms) of a decision message to `planner-<slug>`. It does the same
for each other request of [Terms](#terms): a change of the title or the body of an issue, a comment, a change of a
blocked-by link or of the field `Priority`, and a change of a tracked file of the repo. It sends the request one time,
also when the message does not settle the question. The pane does not wait for it. The message starts with
`From the user:`. It names the question pane and the question id. It gives the words of the user word for word and each
guess of the question session that the user accepted, still marked as a guess. A message from a pane that the user
closed with a confirm question open holds no guess. For a title or body request, it gives the words of the user and each
guess that the user accepted, with no exact text and no start hash. For a comment, a change of a blocked-by link or a
change of the field `Priority`, it gives the exact text and the start hash.

If the planner is the sender and the message settles the question, the request goes in the answer to the planner. In
each other case, the request goes in a message of its own. Such a message is a relay to `planner-<slug>`, not an answer
to the sender. So the rule that the pane owner sends nothing to the sender for a message that does not settle the
question does not stop it.

The pane owner drafts no issue and starts no write subagent for a request. After the send, the orchestrator tells the
user in one line in its tab that `planner-<slug>` has the request. If the send fails,
[the failure rule](limits.md#the-failure-rule) applies, as for the relay of a doc rule of the user. The planner handles
the request as a proposed issue of the orchestrator, with its review loops and its post rules. The planner then reports
the post or the drop to the orchestrator. For a draft that waits for a decision of the user, it sends the question to
`orchestrator-<slug>`.

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
`PANE-OWNER <owner name> <question id>: close. Run the rounds of docs/dev/session-review-rounds.md, then report.` It is
a word of the pane owner, not a word of the user, so it does not start with "From the user:". The pane owner sends at
most one close request for each question of a pane. Each question of a pane gets its own rounds before its context clear
or its close. The report is not a later pane message that an answer in the tab of the orchestrator wins over.

After the close request, the question session runs the rounds of [Session-review rounds](session-review-rounds.md) with
the user in its pane. The rounds keep each rule of [The question session](#the-question-session). So the question
session skips steps 2, 4 and 5 of `/session-review`, the steps of the memory notes. Steps 4 and 5 delete notes, and step
2 serves only these steps. The question of the pane is not open work of the rounds, because the pane owner already holds
its state. Each proposal of step 6 goes to the pane owner in the report.

Each waiting decision and each open question of steps 6, 7 and 8 goes to the user in the pane, not to the pane owner as
a question. After its rounds end, the question session sends the report to the pane owner with the herdr path. The
report gives the header with the question id and the parts that [Session-review rounds](session-review-rounds.md) asks
for. For each decision of the user in the rounds, it gives the words of the user word for word. It gives each waiting
decision and each open question that has no answer as an open finding. The guess rule of
[Send a decision](#send-a-decision) also applies to the report. A report can hold a guess, for example in a proposal of
step 6. Then the session asks the confirm question in the pane before it sends the report. If the user closes the pane
or ends the run with that question open, the report gives the words of the user word for word. It gives no guess.

The report leaves out each doc rule, fact, preference or request for a new issue that a decision message already gave.
After the close request, the question session sends no decision message. A message can still give a word of the user
about the pane or the run. For a new word of the user on the question of the pane, for example a write action or a
request for a new issue, the question session tells the user to type it in the tab of the orchestrator. If a round
fails, the question session tells the user in the pane, its rounds end, and the report names the failure. If the send of
the report fails, the question session tells the user in the pane.

The pane owner accepts a report only with the header of its open pane id and its current question id, after its close
request. It then sends the ack. For each other report, the pane owner tells the user in one line, sends nothing and
keeps the state of the question. After a report that it accepts, the orchestrator sends each open finding to
`planner-<slug>`, with the words of the user for that finding. The paragraph of
[The pane owner handles a decision](#the-pane-owner-handles-a-decision) that starts "The pane owner relays stated doc
rules" gives this relay and its failure. Then the pane owner decides between a reuse and a close, also after a failed
relay, as [Close and continue](#close-and-continue) says. The orchestrator tells the user in one line how many findings
it sent, and the question keeps its state.

While the pane owner waits for the report, the pane is open, and the wait has no time limit. If the send of the close
request fails, the failure rule applies, the pane stays open, and the run stops until the user speaks. Before a report
arrives, the user can tell the pane owner to close the pane, or that the pane is closed. If the pane is still open, the
pane owner then closes it with no report. In both cases, the question keeps its state, and the run waits for the next
word of the user. This paragraph wins over the paragraph that starts "Before the pane owner closes or reuses a question
pane".

The reason: on 2026-11-13, the user said to operator-docs: "file an issue to run `/session-review` in question panes
before closing". No one measured the tokens of the rounds in a question pane.

### Close and continue

After a settled answer or **No decision**, the pane owner gets the report of the rounds of
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
the rounds of the empty Todo column of [Pick the tickets](pick-the-tickets.md#pick-the-tickets). If either is due, the
orchestrator tells the user in its tab. A write subagent can still run after the close of its pane. The close request,
the close of the pane and the next pane start do not wait for a write subagent.

The reason: on 2026-11-13, the user said, as operator-docs relayed it: "File an issue to modify the process for closing
a question. After the session review passes with no findings, clear the session instead of closing it entirely. Then
send the prompt for the next session. This needs a verification that each question still starts in a clean context."
These words change the words of the user "always chain another pane for the next open question" of [Start](#start).
After a reuse, the next question gets the same pane.

### State table

The user holds no state of its own in this table. The column "Who tells whom" gives each step of the user.

| Event                                                                                                 | Question session                     | Pane owner                                                                                                                                                                            | Sender               | Who tells whom                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| A word of the user starts a pane or a run                                                             | Not started                          | Starts the opener subagent for the pane and the session                                                                                                                               | Keeps working        | The user tells the pane owner                                |
| A word of the user asks for the tab or answers in the tab                                             | Not started                          | Starts no pane. Handles an answer. A tab request stops the run                                                                                                                        |                      | The user tells the pane owner                                |
| No word of the user. The conditions of an automatic start hold                                        | Not started                          | Makes an automatic start for the next open question                                                                                                                                   | Keeps working        |                                                              |
| A word of the user starts a pane while a pane is open                                                 | Running                              | Starts nothing                                                                                                                                                                        |                      | The pane owner tells the user                                |
| A question of a task subagent or of the follow-up planner arrives                                     | Not started                          | The question waits in the list order. It gets a pane at its turn                                                                                                                      | Keeps working        | The sender tells the pane owner                              |
| A second open question arrives while a pane is open                                                   | Running                              | The question waits in the list order                                                                                                                                                  |                      |                                                              |
| No pane opens next to the pane owner                                                                  | Not started                          | No pane exists. A run stops                                                                                                                                                           |                      | The pane owner tells the user                                |
| The pane does not show the question                                                                   | Not started, reading, or at a prompt | The pane stays open. A run stops                                                                                                                                                      |                      | The pane owner tells the user                                |
| The opener subagent ends with no report                                                               | Not started, reading, or at a prompt | The pane counts as open. A run stops                                                                                                                                                  |                      | The pane owner tells the user                                |
| The pane owner cannot start an opener subagent, a reuse subagent or a write subagent                  | Not started, or waits at its prompt  | The failure rule applies. No pane starts, and a run stops. A write action does not run                                                                                                |                      | The pane owner tells the user                                |
| The notification of a pane start or a reuse fails                                                     | Any                                  | The failure rule applies. The pane stays open                                                                                                                                         |                      | The pane owner tells the user                                |
| The session starts                                                                                    | Running. Start line, reads, question | The question stays open                                                                                                                                                               |                      | The question session tells the user                          |
| A message arrives with the header of the open pane and the current question                           | Waits for the ack                    | Accepts it. Sends the ack                                                                                                                                                             |                      | The question session tells the pane owner                    |
| A message arrives without the right header                                                            | Waits for the ack                    | Sends nothing. Tells the user. Each question keeps its state                                                                                                                          |                      | The pane owner tells the user                                |
| The decision message settles the question                                                             | Waits for the close request          | Sends the ack. Sends the settled decision to the asking session and the draft changes. Sends the close request                                                                        | Decision restarts it | The question session tells the pane owner                    |
| The settled decision goes back to the asking session                                                  | Waits for the close request          | Sends it with `From the user:`. A task subagent gets it by the message path of the orchestration pages                                                                                | Decision restarts it | The pane owner tells the sender                              |
| The send of the decision to the asking session fails                                                  | Waits for the close request          | The question stays decided. Sends the close request                                                                                                                                   |                      | The pane owner tells the user                                |
| The decision message does not settle it                                                               | Running                              | Sends the ack. Sends what stays open. The question stays open                                                                                                                         |                      | The pane owner tells the question session                    |
| The send of what stays open fails                                                                     | Running                              | The question stays open. A run stops. The failure rule applies                                                                                                                        |                      | The pane owner tells the user                                |
| A send of the question session fails                                                                  | Running                              | The question stays open                                                                                                                                                               |                      | The question session tells the user                          |
| A send of the herdr path of the pane owner fails                                                      | Any                                  | The failure rule applies                                                                                                                                                              |                      | The pane owner tells the user                                |
| A "No decision" message                                                                               | Waits for the close request          | Sends the ack. Sends the close request. The question stays open                                                                                                                       |                      | The question session tells the pane owner                    |
| A message gives a rule, a fact or a preference                                                        | Waits at its prompt                  | Sends each one to `planner-<slug>`. The pane does not wait                                                                                                                            |                      | The pane owner tells the planner                             |
| The send to `planner-<slug>` fails                                                                    | Waits at its prompt                  | The failure rule applies                                                                                                                                                              |                      | The pane owner tells the user                                |
| A decision message gives a request                                                                    | Waits at its prompt, or running      | Sends the request to `planner-<slug>`. Starts no write subagent                                                                                                                       |                      | The question session tells the pane owner                    |
| The send of a request to `planner-<slug>` fails                                                       | Waits at its prompt, or running      | The failure rule applies                                                                                                                                                              |                      | The pane owner tells the user                                |
| A settled decision message gives a write action                                                       | Waits for the close request          | Starts each actor in the order of the message. Sends a message to another session itself                                                                                              |                      | The pane owner tells the user                                |
| A call of the write subagent gets a tool block that stops it                                          | Any                                  | Follows "A denied command of the operator"                                                                                                                                            |                      | The pane owner tells the user                                |
| A command of the write subagent fails, the write subagent ends with no report, or a send fails        | Any                                  | The failure rule applies                                                                                                                                                              |                      | The pane owner tells the user                                |
| A rule of the docs stops the write subagent before a step with the user                               | Any                                  | Tells the user. The action does not run                                                                                                                                               |                      | The pane owner tells the user                                |
| The hash of a user-level file differs from the start hash                                             | Any                                  | The write subagent writes nothing. Each later action does not run. The pane owner tells the user                                                                                      |                      | The pane owner tells the user                                |
| A settled decision message gives a write action with no actor                                         | Waits for the close request          | The action does not run. The pane owner tells the user in one line                                                                                                                    |                      | The pane owner tells the user                                |
| `tasker show-config` exits with code 1 after a write of the configuration file of tasker              | Any                                  | Opens no pane. Tells the user in its tab the errors and the old text of the file. After the word of the user, runs `tasker show-config` again. Each `tasker` command fails until then |                      | The pane owner tells the user. The user tells the pane owner |
| A `herdr` command of a settled message fails                                                          | Any                                  | The failure rule applies. Each later action does not run                                                                                                                              |                      | The pane owner tells the user                                |
| A handoff or the rounds of the empty Todo column is due while a pane is open or a write subagent runs | Any                                  | Starts neither while the pane is open or the write subagent runs                                                                                                                      |                      | The pane owner tells the user                                |
| A report arrives from the orchestrator or the follow-up planner                                       | Not started                          | Shows it as text in its tab. No pane starts                                                                                                                                           |                      | The pane owner tells the user                                |
| The question session gets the close request                                                           | Runs the rounds. Sends the report    | Waits for the report. The pane stays open                                                                                                                                             |                      | The pane owner tells the question session                    |
| The send of the close request fails                                                                   | Running, or waits at its prompt      | The pane stays open. A run stops. The failure rule applies                                                                                                                            |                      | The pane owner tells the user                                |
| A round of the question session fails                                                                 | Its rounds end. Sends the report     | Waits for the report                                                                                                                                                                  |                      | The question session tells the user                          |
| The send of the report fails                                                                          | Waits at its prompt                  | Waits for the report. The pane stays open                                                                                                                                             |                      | The question session tells the user                          |
| The report of the rounds arrives, and each condition of a reuse holds                                 | Waits at its prompt until the reuse  | Sends the ack. Sends findings to `planner-<slug>`. Starts the reuse subagent                                                                                                          |                      | The question session tells the pane owner                    |
| The report of the rounds arrives, and a condition of a reuse fails                                    | Waits at its prompt until the close  | Sends the ack. Sends findings to `planner-<slug>`. Closes the pane. A run goes on                                                                                                     |                      | The question session tells the pane owner                    |
| The kind of the pane owner is not `claude`, and a reuse is due                                        | Waits at its prompt until the close  | Closes the pane. The next question gets a new pane                                                                                                                                    |                      |                                                              |
| The reuse subagent waits for the question session                                                     | Waits at its prompt                  | Waits for the report of the reuse subagent. The pane stays open                                                                                                                       |                      | The pane owner tells the reuse subagent                      |
| The question session is in `blocked` when the reuse subagent waits                                    | `blocked`                            | Tells the user the name and the pane id. The pane stays open                                                                                                                          |                      | The pane owner tells the user                                |
| The wait of the reuse subagent fails or reaches its time limit                                        | Any                                  | Closes the pane. The next question gets a new pane                                                                                                                                    |                      | The reuse subagent tells the pane owner                      |
| The context clear fails, or the after-clear read fails or does not show the context clear             | Waits at its prompt                  | Closes the pane. The next question gets a new pane                                                                                                                                    |                      | The reuse subagent tells the pane owner                      |
| The send of the session prompt fails, or the pane shows no first reply                                | Waits at its prompt, or running      | The pane stays open. A run stops                                                                                                                                                      |                      | The pane owner tells the user                                |
| The reuse subagent ends with no report                                                                | Any                                  | The pane counts as open. A run stops                                                                                                                                                  |                      | The pane owner tells the user                                |
| The reuse subagent ends, and the pane shows the first reply                                           | Running. Start line, reads, question | The question stays open. The rules of A question pane hold                                                                                                                            |                      | The question session tells the user                          |
| The user tells the pane owner to close the pane, or that it is closed, before the reuse subagent ends | Any                                  | Closes an open pane after the report. A run waits for the user                                                                                                                        |                      | The user tells the pane owner                                |
| The user ends the run before the pane owner starts the reuse subagent                                 | Waits at its prompt                  | Closes the pane. The reuse subagent runs to its end                                                                                                                                   |                      | The user tells the pane owner                                |
| A message for an earlier question of the pane arrives after the context clear                         | Any                                  | Sends nothing. Tells the user. Each question keeps its state                                                                                                                          |                      | The pane owner tells the user                                |
| A report that the pane owner refuses                                                                  | Any                                  | Sends nothing. The question keeps its state                                                                                                                                           |                      | The pane owner tells the user                                |
| The user tells the pane owner to close the pane, or that it is closed, before a report                | Any                                  | Closes an open pane with no report. A run waits for the user                                                                                                                          |                      | The user tells the pane owner                                |
| The user asks the session for a step outside it                                                       | Running                              | No change                                                                                                                                                                             |                      | The question session tells the user                          |
| The fetch of the question session fails                                                               | Running                              | No change                                                                                                                                                                             |                      | The question session tells the user                          |
| A decision message that [the pane owner refuses](#the-pane-owner-handles-a-decision)                  | Any                                  | Sends nothing. The question keeps its state                                                                                                                                           |                      | The pane owner tells the user                                |
| The user answers in the tab of the orchestrator                                                       | Running until the close              | Handles the answer and sends the close request                                                                                                                                        | Answer restarts it   | The user tells the pane owner                                |
| The user closes the pane with no decision                                                             | Ended                                | The question stays open with no automatic start                                                                                                                                       |                      | The user tells the pane owner                                |
| herdr reports that the pane is already gone                                                           | Ended                                | Goes on                                                                                                                                                                               |                      |                                                              |
| The close fails in another way                                                                        | Running or waits at its prompt       | A run stops until the word of the user                                                                                                                                                |                      | The pane owner tells the user                                |
| A handoff is due while a pane is open                                                                 | Running                              | Starts none. No automatic start. The go question of the handoff waits for the next start, by the rule of one open pane. A word of the user decides                                    |                      | The pane owner tells the user                                |
| A handoff is due, and no pane is open                                                                 | Not started                          | Makes no automatic start, apart from the question that asks the go of the suggested handoff. That question gets an automatic start, as [Start](#start) says                           |                      |                                                              |
| The decision message gives the go of a suggested handoff                                              | Waits for the close request          | Sends the ack. Sends the close request. Closes the pane after the rounds, with no reuse. Then starts the handoff                                                                      |                      | The question session tells the pane owner                    |
| The user ends the run                                                                                 | A running session keeps running      | Starts no next pane. A [stop of a run](#terms) holds                                                                                                                                  |                      | The user tells the pane owner                                |
| No open question of the run is left                                                                   | Ended                                | The run ends. A new open question can get an automatic start                                                                                                                          |                      | The pane owner tells the user                                |

If two rows match, the rows of one bullet below follow its rule:

- The row "The user tells the pane owner to close the pane, or that it is closed, before a report" wins over the rows
  "The report of the rounds arrives, and each condition of a reuse holds" and "The report of the rounds arrives, and a
  condition of a reuse fails".
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

The rules of this page no longer use `SendMessage`. The records above that name `SendMessage` and `ListAgents` stay as
facts of the old path. No one measured a send with `herdr pane send-text` into a session that is in a turn. No one
measured a send into a pi pane in either direction. No one measured a newline inside `send-text`, or the wait for the
ack. No one measured a context clear in a pi session. No one measured that a pi orchestrator can start an opener
subagent, a reuse subagent or a write subagent.
