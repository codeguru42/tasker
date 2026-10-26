# Handoff

The readers of this page are a long-running orchestrator, the follow-up planner, the operator and the session of
[a topic handoff](#a-topic-handoff), which can be a session of any role. Each sender of the slug of any kind, for
example an initial planner or the orchestrator of a numbered milestone, also reads
[The hold of the items](#the-hold-of-the-items). Each role has its own page:

- [The orchestrator](handoff-orchestrator.md)
- [The planner](handoff-planner.md)
- [The operator](handoff-operator.md)

## The suggestion of a handoff

When the old session suggests a handoff, the handoff starts with no further word of the user. An orchestrator or a
follow-up planner sends its suggestion to the operator as an item. For such a session, the handoff starts when the go of
the operator arrives, as [A handoff](operator-start.md#a-handoff) says. The user can also ask the old session for a
handoff at any time. A request of the user for a handoff needs no go. The start of a handoff is the go of the operator,
the suggestion of the old operator or the request of the user. After the start, the old session does the steps of its
role page: [the steps of the old orchestrator](handoff-orchestrator.md#the-steps-of-the-old-orchestrator),
[the steps of the old planner](handoff-planner.md#the-steps-of-the-old-planner) and
[the steps of the old operator](handoff-operator.md#the-steps-of-the-old-operator). These steps hold the finish of its
current tasks. Then the stop and the start of [The stop and the start](#the-stop-and-the-start) follow.

The old session can suggest a handoff to the user. The old session counts the events that its role page names:
[the landing count of the orchestrator](handoff-orchestrator.md#the-landing-count),
[the post count of the planner](handoff-planner.md#the-post-count) and
[the close count of the operator](handoff-operator.md#the-close-count). Each role page gives the count at which the old
session suggests a handoff, the count of a suggestion. The role page says in which reply.

The reason: the old session does not see its own status line, and no rule tells it to read its context use. The count of
the role page stands in for that read.

In the setup of the user, the status line of each session shows its context use, for example `ctx:32%`. Another session
can read the status line with `herdr pane read <pane id>` (herdr 0.9.3, Claude Code 2.1.310, 2026-10-25).

On 2026-10-16, the Docs orchestrator guessed that about 20% of its context was used and started a handoff. The session
used 6%.

The count starts at 0 at the start of the session. The count lives until the session ends.

In each list of open questions or open items that the old session gives the user, the old session also gives a handoff
recommendation. [A decision of the user](working-with-the-user.md#a-decision-of-the-user) and
[The open items](operator-items.md#the-open-items) give the form of these lists. The recommendation says "hand off now"
or "not yet", with its reason. The reason gives the count of the session and the count of a suggestion of the role page
of the session. The count of the session is [the landing count](handoff-orchestrator.md#the-landing-count) of the
orchestrator, [the post count](handoff-planner.md#the-post-count) of the planner or
[the close count](handoff-operator.md#the-close-count) of the operator.

When the count of the session reaches the count of a suggestion, the recommendation is "hand off now", also in an answer
to [a question of the user](working-with-the-user.md#a-question-of-the-user). A recommendation "hand off now" is a
suggestion of a handoff, and the handoff then starts as [The suggestion of a handoff](#the-suggestion-of-a-handoff)
says.

On 2026-10-24, the user asked planner-docs to keep a handoff recommendation in each list of open questions.

## The handoff file

The old session writes the handoff file `$HOME/Documents/tasker/handoff/<date>-<time>-<role>.md`, for example
`2026-10-17-1505-docs-orchestrator.md`. The time is the local time of the machine, to the minute. The command
`date +%Y-%m-%d-%H%M` prints the date and the time. Take the date and the time when you write the file, not at the start
of the handoff.

## The items of a handoff file

The old session puts these items in the handoff file:

- The prompt for the new session, in a code block. The first message of the new session always names the path of the
  handoff file.
- Each open item with its id, as [The form of an item](operator-items.md#the-form-of-an-item) gives the id.
- Each question to the user that has no answer yet, with its full text and its choices, as
  [A decision of the user](working-with-the-user.md#a-decision-of-the-user) says.
- Each decision of the user from the old session. The handoff file also keeps each decision of the user from the earlier
  handoff file of the role that still applies. As a result, a decision survives more than one handoff. The bullet of a
  relayed decision in [A decision of the user](working-with-the-user.md#a-decision-of-the-user) uses these decisions.

The reason: the old session puts the full text of each open question in the file, because the new session has no other
source for it.

The old session puts no rule in the handoff file. The rules stay in the docs, and the prompt points to them.

## The last item id

The handoff file and the prompt for the new session name the first free item id. The first free item id is the number
after the last item id that the old session used. If the old session sends an item with the path of the handoff file,
that item has the last item id. The old session knows that id when it writes the file, because the item gets the next
number of its count. An example is "Your first item id is planner-docs-6." The new session counts its item ids from that
id. When an answer names an id of the old session, the new session takes the item of that id from the handoff file. The
reason: "Count your item ids on from planner-docs-5" can read as "start at planner-docs-5".

## The check of the handoff folder

The new session does this check before any other step of the prompt. It lists the folder
`$HOME/Documents/tasker/handoff/` with `ls`.

The files of its role are the files whose names [The handoff file](#the-handoff-file) gives for that role. A file with a
later date and time in its name is newer.

The file of the first message is the handoff file whose path the first message names.

The new session then does the case of this list that applies:

- If the file of the first message is the newest file of the role, the new session works from that file.
- If the newest file of the role is newer than the file of the first message, the new session tells the user. Then it
  works from the newest file.
- If the list fails, for example because the folder is missing, [the failure rule](limits.md#the-failure-rule) applies.
  Then the new session works from the file of its first message.

[The failure rule](limits.md#the-failure-rule) covers each role in this check.

The reason: on 2026-10-16, the new Docs orchestrator got the handoff file of 01:12 in its first message. A newer handoff
file of 09:09 for the same role existed. Most issues of the table of the old file had closed.

## The end of a handoff

In a handoff of an orchestrator or a follow-up planner, the handoff ends when the operator stops the old session and
starts the new session, as steps 4 and 5 of [A handoff](operator-start.md#a-handoff) say. This also covers an old
session that the user started.

The rule of the user of 2026-10-25 is the request of the user for these steps: "Then stop the orchestrator and start a
new one."

In a handoff of the operator, the user ends the handoff, as
[The start of the new operator](handoff-operator.md#the-start-of-the-new-operator) says. The user can also end the
handoff at the old operator, as [The end of the hold by the user](#the-end-of-the-hold-by-the-user) says.

Until the end, the old session starts no new work. The role page names that work:
[the steps of the old orchestrator](handoff-orchestrator.md#the-steps-of-the-old-orchestrator),
[the steps of the old planner](handoff-planner.md#the-steps-of-the-old-planner) and
[the steps of the old operator](handoff-operator.md#the-steps-of-the-old-operator).

## The stop and the start

In a handoff of an orchestrator or a follow-up planner, the operator stops the old session and starts the new session,
as [A handoff](operator-start.md#a-handoff) says. This step covers each old orchestrator and each old follow-up planner,
also one that the user started. The first message of the new session is the prompt of the handoff file. The first
message names the path of the handoff file.

The item with the path of the handoff file starts the stop and the start by the operator, with no answer of the user.

In a handoff of the operator, [the start of the new operator](handoff-operator.md#the-start-of-the-new-operator) gives
the end of the handoff. [The end of the hold by the user](#the-end-of-the-hold-by-the-user) gives a second end.

## A topic handoff

A topic handoff moves one topic of a session to a new session, for example the planning of an npm publish to a new
planner. The old session keeps its other work. A request of the user for a handoff of one topic to a new session is a
topic handoff.

Only the user starts a topic handoff. The old session does not suggest one, and the counts of
[The suggestion of a handoff](#the-suggestion-of-a-handoff) do not start one.

The handoff file holds only these parts of the topic:

- The prompt of the new session, as [The items of a handoff file](#the-items-of-a-handoff-file) gives it, with the first
  message that names the path of the file
- The decisions of the user on the topic
- The facts of the topic
- The open questions of the topic, in the form of [The items of a handoff file](#the-items-of-a-handoff-file)

The file does not hold the state of the milestone, the other sessions, the review findings or the table of open issues,
unless the topic needs them. The other items of [The items of a handoff file](#the-items-of-a-handoff-file) and
[The last item id](#the-last-item-id) do not apply. The rule of
[The items of a handoff file](#the-items-of-a-handoff-file) that the file holds no rule does apply.

The file goes in the folder of [The handoff file](#the-handoff-file), with the name form of that section. The role part
is the role of the new session with the topic as its slug, for example `2026-10-25-1430-npm-planner.md`. The new session
does [The check of the handoff folder](#the-check-of-the-handoff-folder).

The new session has the name `<role>-<topic>`, for example `planner-npm`. The topic is the topic of the file name.
[docs/sessions.md](../sessions.md) gives the form of the own name of a session. The old session puts this name in the
item and in the prompt of the handoff file. The prompt also names `operator-<slug>` of the old session as the operator
that the new session works with.

The old session sends the path of the file to `operator-<slug>` as an item, as
[The form of an item](operator-items.md#the-form-of-an-item) says. The operator starts the new session with the prompt
of the file as its first message, as [Start a session](operator-start.md#start-a-session) says. The operator does not
stop the old session. The steps of the role page, [The end of a handoff](#the-end-of-a-handoff) and the stop of
[The stop and the start](#the-stop-and-the-start) do not apply.

When the old session is the operator, it starts the new session itself, as
[Start a session](operator-start.md#start-a-session) says, and it sends no item.

On 2026-10-25, the user asked orchestrator-m21 for "a handoff for a new session to plan publishing to NPM". The session
first wrote the full orchestrator handoff. The user said: "we don't need to handoff this entire session. Just include
what is necessary to continue a session for planning NPM publish."

## The hold of the items

These terms apply in this section:

- A sender of the slug is `orchestrator-<slug>` or `planner-<slug>`, each one that runs, as `ListAgents` shows.
- The hold message is the message of the old operator that starts the hold.
- The ready message is the message of the new operator that ends the hold.
- The end message is the message of the old operator that ends the hold on the word of the user.
- A held item is an item that a sender of the slug keeps and does not send during the hold.

On 2026-10-25, the user said: "when the operator starts a handoff, it should notify its planner and orchestrator to hold
all messages until the handoff finishes. Then the new operator session notifies them to send when it is ready." Without
the hold, each sender of the slug sends items during the handoff. The old operator then writes a new handoff file for
each arrival.

### The start of the hold

In step 1 of [the steps of the old operator](handoff-operator.md#the-steps-of-the-old-operator), the old operator sends
each sender of the slug a hold message with `SendMessage`. As a result, the hold starts before the old operator writes
the handoff file in step 2. The hold message names this section. The old operator sends no hold message to a session
that does not run.

Right after the hold messages, the old operator tells the user one time that the hold stops the items. The old operator
names each sender of the slug that holds. The old operator also says that the hold ends when the new operator is ready
or when the user ends it.

### During the hold

During the hold, a sender of the slug sends no message to `operator-<slug>`. This covers each item, also each report
([The open items](operator-items.md#the-open-items)). The sender of the slug keeps each message as a held item, with its
id. The sender of the slug continues its other work.

A held item can ask for a choice that only the user makes, while an agent waits for the answer. A sender of the slug
also holds such an item. On 2026-10-25, during a handoff of operator-docs, the agent of #443 stopped for such a choice,
and orchestrator-docs asked the user in its own tab.

As [The operator](working-with-the-user.md#the-operator) says, an orchestrator or a follow-up planner asks the user only
through an item. So an orchestrator or a follow-up planner does not ask the user in its own tab. An initial planner
still works with the user in its tab, as that section says.

Each item that the old operator gets is in its newest handoff file, as the paragraph after
[the steps of the old operator](handoff-operator.md#the-steps-of-the-old-operator) says. A sender of the slug does not
send such an item again. If the old operator closes the item before the end of its session, the old operator sends the
answer. Otherwise the new operator sends the answer.

### The ready message

In step 5 of [The start of the new operator](handoff-operator.md#the-start-of-the-new-operator), the new operator sends
a ready message with `SendMessage` to each sender of the slug that the handoff file names. After the ready message, each
sender of the slug sends its held items to the new operator, in the order of their ids.

### The end of the hold by the user

The word of the user to the old operator to end the hold also ends the hold. Then the old operator sends an end message
with `SendMessage` to each sender of the slug that got the hold message. The end message has the effect of a ready
message. Each sender of the slug sends its held items to the old operator, in the order of their ids.

The end of the hold by the user also ends the handoff of the operator. The old operator is then the operator again, with
no handoff. A later handoff starts again at step 1 of
[the steps of the old operator](handoff-operator.md#the-steps-of-the-old-operator), with a new hold message.

On 2026-10-25, operator-docs started its handoff at 10:42 and sent the hold message to planner-docs and
orchestrator-docs. The user started no new operator, and both sessions held all items for hours, until the user said
"yes, end the hold on the operator".

### A failed message of the hold

[The failure rule](limits.md#the-failure-rule) applies to each failed message of the hold:

- If a hold message fails, the failure rule applies to the old operator. The sender of the slug that got no hold message
  keeps sending items. The old operator writes a new handoff file for each arrival, as the paragraph after the steps of
  the old operator says.
- If a ready message fails, the failure rule applies to the new operator. The sender of the slug keeps its held items
  until a ready message or an end message arrives. When the user tells it to, the new operator sends the ready message
  again.
- If an end message fails, the failure rule applies to the old operator. The sender of the slug keeps its held items
  until an end message or a ready message arrives. When the user tells it to, the old operator sends the end message
  again.

### The table of the hold

This table gives each change of the hold:

| Change                                                  | Old operator                                                   | New operator                                  | Sender of the slug                                                       | Who tells whom                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| The handoff of the operator starts                      | Sends the hold message in step 1                               |                                               | Sends items as usual                                                     | The old operator tells each sender of the slug                                                |
| The hold message arrives                                |                                                                |                                               | Holds its items, also an item that an agent waits for                    |                                                                                               |
| An item arrives at the old operator during the hold     | Writes a new handoff file                                      |                                               | Sent the item before the hold message arrived, and holds its other items | The sender of the slug tells the old operator, with `SendMessage`                             |
| The user starts the new operator                        |                                                                | Keeps the open items of the file              | Holds its items                                                          | The user ends the old operator and starts the new operator                                    |
| The new operator is ready                               |                                                                | Sends the ready message                       | Holds its items                                                          | The new operator tells each sender of the slug                                                |
| The ready message arrives                               |                                                                | Gets the held items                           | Sends its held items                                                     | Each sender of the slug tells the new operator                                                |
| The user ends the hold at the old operator              | Sends the end message. The handoff ends                        |                                               | Holds its items                                                          | The user tells the old operator. The old operator tells each sender that got the hold message |
| The end message arrives                                 | Gets the held items                                            |                                               | Sends its held items to the old operator                                 | Each sender of the slug tells the old operator                                                |
| A hold message, a ready message or an end message fails | The failure rule applies, for a hold message or an end message | The failure rule applies, for a ready message | Keeps sending, or keeps holding                                          | The operator that sends it tells the user                                                     |
