# Handoff

The readers of this page are a long-running orchestrator, the follow-up planner, the operator and the session of [a topic handoff](#a-topic-handoff), which can be a session of any role. Each role has its own page:

- [The orchestrator](handoff-orchestrator.md)
- [The planner](handoff-planner.md)
- [The operator](handoff-operator.md)

## The suggestion of a handoff

When the old session suggests a handoff, the handoff starts with no further word of the user. The user can also ask the old session for a handoff at any time. After the start, the old session does the steps of its role page: [the steps of the old orchestrator](handoff-orchestrator.md#the-steps-of-the-old-orchestrator), [the steps of the old planner](handoff-planner.md#the-steps-of-the-old-planner) and [the steps of the old operator](handoff-operator.md#the-steps-of-the-old-operator). These steps hold the finish of its current tasks. Then the stop and the start of [The stop and the start](#the-stop-and-the-start) follow.

The old session can suggest a handoff to the user. The old session counts the events that its role page names: [the landing count of the orchestrator](handoff-orchestrator.md#the-landing-count), [the post count of the planner](handoff-planner.md#the-post-count) and [the close count of the operator](handoff-operator.md#the-close-count). At a count of 12, the old session suggests a handoff. The role page says in which reply.

The reason: the old session has no tool that shows its context use. The count of the role page stands in for a read of the context use.

On 2026-10-16, the Docs orchestrator guessed that about 20% of its context was used and started a handoff. The session used 6%.

The count starts at 0 at the start of the session. The count lives until the session ends.

## The handoff file

The old session writes the handoff file `$HOME/Documents/tasker/handoff/<date>-<time>-<role>.md`, for example `2026-10-17-1505-docs-orchestrator.md`. The time is the local time of the machine, to the minute. The command `date +%Y-%m-%d-%H%M` prints the date and the time. Take the date and the time when you write the file, not at the start of the handoff.

## The items of a handoff file

The old session puts these items in the handoff file:

- The prompt for the new session, in a code block. The first message of the new session always names the path of the handoff file.
- Each open item with its id, as [The form of an item](operator-items.md#the-form-of-an-item) gives the id.
- Each question to the user that has no answer yet, with its full text and its choices, as [A decision of the user](working-with-the-user.md#a-decision-of-the-user) says.
- Each decision of the user from the old session. The handoff file also keeps each decision of the user from the earlier handoff file of the role that still applies. As a result, a decision survives more than one handoff. The bullet of a relayed decision in [A decision of the user](working-with-the-user.md#a-decision-of-the-user) uses these decisions.

The reason: the old session puts the full text of each open question in the file, because the new session has no other source for it.

The old session puts no rule in the handoff file. The rules stay in the docs, and the prompt points to them.

## The last item id

The handoff file gives the last item id that the old session used. If the old session sends an item with the path of the handoff file, the last item id is the id of that item. The old session knows that id when it writes the file, because the item gets the next number of its count. The new session counts its item ids on from that id. When an answer names an id of the old session, the new session takes the item of that id from the handoff file.

## The check of the handoff folder

The new session does this check before any other step of the prompt. It lists the folder `$HOME/Documents/tasker/handoff/` with `ls`.

The files of its role are the files whose names [The handoff file](#the-handoff-file) gives for that role. A file with a later date and time in its name is newer.

The file of the first message is the handoff file whose path the first message names.

The new session then does the case of this list that applies:

- If the file of the first message is the newest file of the role, the new session works from that file.
- If the newest file of the role is newer than the file of the first message, the new session tells the user. Then it works from the newest file.
- If the list fails, for example because the folder is missing, [the failure rule](limits.md#the-failure-rule) applies. Then the new session works from the file of its first message.

[The failure rule](limits.md#the-failure-rule) covers each role in this check.

The reason: on 2026-10-16, the new Docs orchestrator got the handoff file of 01:12 in its first message. A newer handoff file of 09:09 for the same role existed. Most issues of the table of the old file had closed.

## The end of a handoff

If the operator started the old session, the handoff ends when the operator stops the old session and starts the new session. If the user started the old session, only the user ends the handoff.

Until the end, the old session starts no new work. The role page names that work: [the steps of the old orchestrator](handoff-orchestrator.md#the-steps-of-the-old-orchestrator), [the steps of the old planner](handoff-planner.md#the-steps-of-the-old-planner) and [the steps of the old operator](handoff-operator.md#the-steps-of-the-old-operator).

## The stop and the start

If the operator started the old session, the operator stops the old session, as [Stop a session](operator-start.md#stop-a-session) says. Then the operator starts the new session with the prompt of the handoff file as its first message, as [Start a session](operator-start.md#start-a-session) says. The first message names the path of the handoff file.

The item with the path of the handoff file starts the stop and the start by the operator, with no answer of the user.

If the user started the old session, [the start of the new operator](handoff-operator.md#the-start-of-the-new-operator) gives the end of the handoff.

## A topic handoff

A topic handoff moves one topic of a session to a new session, for example the planning of an npm publish to a new planner. The old session keeps its other work.

Only the user starts a topic handoff. The old session does not suggest one, and the counts of [The suggestion of a handoff](#the-suggestion-of-a-handoff) do not start one.

The handoff file holds only these parts of the topic:

- The prompt of the new session, as [The items of a handoff file](#the-items-of-a-handoff-file) gives it, with the first message that names the path of the file
- The decisions of the user on the topic
- The facts of the topic
- The open questions of the topic, in the form of [The items of a handoff file](#the-items-of-a-handoff-file)

The file does not hold the state of the milestone, the other sessions, the review findings or the table of open issues, unless the topic needs them. The other items of [The items of a handoff file](#the-items-of-a-handoff-file) and [The last item id](#the-last-item-id) do not apply. The rule of [The items of a handoff file](#the-items-of-a-handoff-file) that the file holds no rule does apply.

The file goes in the folder of [The handoff file](#the-handoff-file), with the name form of that section. The role part is the role of the new session with the topic as its slug, for example `2026-10-25-1430-npm-planner.md`. The new session does [The check of the handoff folder](#the-check-of-the-handoff-folder).

The old session sends the path of the file to `operator-<slug>` as an item, as [The form of an item](operator-items.md#the-form-of-an-item) says. The operator starts the new session with the prompt of the file as its first message, as [Start a session](operator-start.md#start-a-session) says. The operator does not stop the old session. The steps of the role page, [The end of a handoff](#the-end-of-a-handoff) and the stop of [The stop and the start](#the-stop-and-the-start) do not apply.

On 2026-10-25, the user asked orchestrator-m21 for "a handoff for a new session to plan publishing to NPM". The session first wrote the full orchestrator handoff. The user said: "we don't need to handoff this entire session. Just include what is necessary to continue a session for planning NPM publish."
