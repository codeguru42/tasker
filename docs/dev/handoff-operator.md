# Handoff of the operator

[docs/dev/handoff.md](handoff.md) gives the common steps of a handoff. This page gives only what differs for the operator.

## The handoff of the operator

In a handoff of the operator, the old operator gives its work to a new operator in a new session. The reason: only the operator knows the step of the milestone, the kind of each planner and its open items.

## The close count

The old operator counts the items that it closes. An item closes as [The answer](operator-items.md#the-answer) says. At a count of 12, the old operator suggests a handoff in the reply in which it closes the item. The suggestion starts the handoff, as [The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says.

## The steps of the old operator

After the start, the old operator does these steps:

1. Start and stop no session.
2. Write the handoff file, as [The handoff file](handoff.md#the-handoff-file) says. If the write or the `date` command fails, [the failure rule](limits.md#the-failure-rule) applies.
3. Give the path of the file to the user in the reply.

After step 2, each change of the open items gives a new handoff file. A change is an arrival or a close. For each change, the old operator writes a new handoff file with the time of that write and gives the new path to the user. If the write fails, [the failure rule](limits.md#the-failure-rule) applies. Then [The check of the handoff folder](handoff.md#the-check-of-the-handoff-folder) by the new operator finds the newest file.

## The handoff file of the operator

The handoff file of the operator holds the items of [The items of a handoff file](handoff.md#the-items-of-a-handoff-file). The old operator also puts these items in the handoff file:

- The prompt names the slug and the session name `operator-<slug>`. The first step of the prompt is a read of `AGENTS.md`, `docs/dev/operator.md`, the pages of its list "The pages", `docs/dev/handoff.md` and `docs/dev/handoff-operator.md`. The second step of the prompt is [the check of the handoff folder](handoff.md#the-check-of-the-handoff-folder).
- The step of the milestone in [The order of a milestone](operator-start.md#the-order-of-a-milestone).
- The kind of each planner, initial or follow-up.
- Each open item with its id, its sender and its full text ([The open items](operator-items.md#the-open-items)).
- The tab id of each session that the old operator started, with the name of the session.

The operator sends no item, so its file gives no last item id.

## The start of the new operator

The new operator starts in these steps:

1. The user ends the old operator session.
2. The user starts the new operator, as step 2 of [The order of a milestone](operator-start.md#the-order-of-a-milestone) says. Step 2 holds its failure case. The prompt of the handoff file is the first message.
3. The new operator does [the check of the handoff folder](handoff.md#the-check-of-the-handoff-folder). That section holds its cases and its failure case.
4. The new operator keeps the open items of the file as its list of [the open items](operator-items.md#the-open-items).

The new operator closes a tab of the old operator only as [Stop a session](operator-start.md#stop-a-session) says.
