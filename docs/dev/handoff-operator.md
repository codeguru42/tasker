# Handoff of the operator

[docs/dev/handoff.md](handoff.md) gives the common steps of a handoff. This page gives only what differs for the
operator.

## The handoff of the operator

In a handoff of the operator, the old operator gives its work to a new operator in a new session. The reason: only the
operator knows the step of the milestone, the kind of each planner and its open items.

## The close count

The old operator counts the items that it closes. An item closes as [The answer](operator-items.md#the-answer) says. The
send of a partial answer that leaves a question not sent is not a close, so the old operator does not count it. A report
closes as [The open items](operator-items.md#the-open-items) says, and each report that the operator closes counts as
one close. The reason: the count stands in for a read of the context use, and each report that the operator shows also
fills its context.

At a count of 15, the old operator suggests a handoff in the reply in which it closes the item. The suggestion starts
the handoff, as [The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says. On 2026-10-25, the user
said: "I think we are handing off too often. Bump the required operator count to 15 before making a handoff
recommendation."

## The steps of the old operator

After the start, the old operator does these steps:

1. Send each sender of the slug a hold message with `SendMessage`, as
   [The hold of the items](handoff.md#the-hold-of-the-items) says. Then tell the user one time that the hold stops the
   items. Name each sender of the slug that holds. Say that the hold ends when the new operator is ready or when the
   user [ends the hold](handoff.md#the-end-of-the-hold-by-the-user).
2. Run the review rounds of the last bullet of [Pick the tickets](pick-the-tickets.md#pick-the-tickets), until a round
   finds nothing new. Send each finding that proposes a change of the docs to `planner-<slug>` with `SendMessage`. The
   orchestrator does the same, as the planner bullet of
   [The prompt of an agent](pick-the-tickets.md#the-prompt-of-an-agent) says. If a round or a send fails,
   [the failure rule](limits.md#the-failure-rule) applies, and the rounds end. This sentence wins over the words "until
   a round finds nothing new". Then write the handoff file, as [The handoff file](handoff.md#the-handoff-file) says. If
   the write or the `date` command fails, [the failure rule](limits.md#the-failure-rule) applies.
3. Do the steps of the old operator in [The start of the new operator](#the-start-of-the-new-operator).

No wait follows the write of the file. After the write of the file, the old operator shows no report and sends no
answer. If an item arrives after the write, the old operator sends a message to the sender with `SendMessage`. The
message tells the sender to send the item again after the ready message of the new operator.

The reason: on 2026-10-25, the user said: "If you start a handoff and write the doc but then wait for my approval, it
may be minutes or hours before I see the request. Then the handoff doc is stale, so you have to redraft the whole thing
again. This costs unnecessary tokens."

A handoff that the user asks for has the same steps as a handoff after a suggestion.

## The handoff file of the operator

The handoff file of the operator holds the items of
[The items of a handoff file](handoff.md#the-items-of-a-handoff-file). The old operator also puts these items in the
handoff file:

- The prompt names the slug and the session name `operator-<slug>`. The first step of the prompt is a read of
  `AGENTS.md` and `docs/operator.md`. The prompt names no other doc for the start reads. The second step of the prompt
  is [the check of the handoff folder](handoff.md#the-check-of-the-handoff-folder). The third step of the prompt is the
  ready message of step 5 of [The start of the new operator](#the-start-of-the-new-operator), as
  [The hold of the items](handoff.md#the-hold-of-the-items) says.
- The step of the milestone in [The order of a milestone](operator-start.md#the-order-of-a-milestone).
- The kind of each planner, initial or follow-up.
- Each open item with its id, its sender and its full text ([The open items](operator-items.md#the-open-items)). The
  file marks each question of the item as open, answered or sent. The operator can keep a question open because the
  words of the user do not fully settle it, as [The answer](operator-items.md#the-answer) says. For such a question, the
  file gives what stays open and whether the ask to the user waits.
- Each sender of the slug that got the hold message, as [The hold of the items](handoff.md#the-hold-of-the-items) says.
  The new operator sends the ready message to each of these senders in step 5 of
  [The start of the new operator](#the-start-of-the-new-operator).
- Each entry of [the tab list](../operator.md) of the old operator. So the file holds the tabs that the old operator
  started and the tabs that it took over.
- The tab id and the pane id of the old operator. The tab id is `$HERDR_TAB_ID`, and the pane id is `$HERDR_PANE_ID`.
  The old operator gets the two ids before it writes the file. If it cannot get the pane id, the file says so. The close
  of step 4 of [The start of the new operator](#the-start-of-the-new-operator) uses the same ids.

The operator sends no item, so its file gives no last item id.

## The start of the new operator

The new operator starts in these steps:

1. The user ends the old operator session.
2. The user starts the new operator, as step 2 of [The order of a milestone](operator-start.md#the-order-of-a-milestone)
   says. Step 2 holds its failure case. The prompt of the handoff file is the first message.
3. The new operator does [the check of the handoff folder](handoff.md#the-check-of-the-handoff-folder). That section
   holds its cases and its failure case.
4. The new operator keeps the open items of the file as its list of [the open items](operator-items.md#the-open-items).
   It also keeps each entry of the tab list of the file. These entries start the tab list of the new operator.
5. The new operator sends a ready message with `SendMessage` to each sender that the handoff file names.
   [The hold of the items](handoff.md#the-hold-of-the-items) gives the rules of the ready message. If the file names no
   sender, the new operator sends no ready message.

The new operator closes a tab of an earlier operator only as [Stop a session](operator-start.md#stop-a-session) says.
The tab list gives the tab id of that tab.
