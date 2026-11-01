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

When the count reaches 15, the user can still discuss a topic. Then the old operator suggests the handoff in the reply
that ends that topic. This rule wins over the sentence of this section that says "suggests a handoff in the reply in
which it closes the item". It also wins over the sentence of
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) that makes the recommendation "hand off now" at
the count of a suggestion. The old operator judges when the topic ends, and this judgment is open on purpose. On
2026-10-30, the user said: "I am still discussing how to resolve a question."

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
  is [the check of the handoff folder](handoff.md#the-check-of-the-handoff-folder). The third step of the prompt is step
  8 of [The start of the new operator](#the-start-of-the-new-operator), the read of the pane of the old operator. The
  fourth step of the prompt is the ready message of step 10 of that section, as
  [The hold of the items](handoff.md#the-hold-of-the-items) says.
- The step of the milestone in [The order of a milestone](operator-start.md#the-order-of-a-milestone).
- The kind of each planner, initial or follow-up.
- Each open item with its id, its sender and its full text ([The open items](operator-items.md#the-open-items)). The
  file marks each question of the item as open, answered or sent. The operator can keep a question open because the
  words of the user do not fully settle it, as [The answer](operator-items.md#the-answer) says. For such a question, the
  file gives what stays open and whether the ask to the user waits.
- Each sender of the slug that got the hold message, as [The hold of the items](handoff.md#the-hold-of-the-items) says.
  The new operator sends the ready message to each of these senders in step 10 of
  [The start of the new operator](#the-start-of-the-new-operator).
- Each entry of [the tab list](../operator.md) of the old operator. So the file holds the tabs that the old operator
  started and the tabs that it took over.
- The tab id and the pane id of the old operator. The tab id is `$HERDR_TAB_ID`, and the pane id is `$HERDR_PANE_ID`.
  The old operator gets the two ids before it writes the file. If it cannot get the pane id, the file says so. The close
  of step 4 of [The start of the new operator](#the-start-of-the-new-operator) uses the same ids.

The operator sends no item, so its file gives no last item id.

## The start of the new operator

The new operator starts in these steps:

1. The old operator starts the new operator, as [Start a session](operator-start.md#start-a-session) says. The role is
   `operator`. The label of the tab and the session name are `operator-<slug>`. The first message is the prompt of the
   handoff file. Step 2 of "Start a session" runs `herdr tab create` with no `--no-focus`, so that the user sees the new
   operator.
2. The herdr agent name is `operator-<slug>-<time>`. `<time>` is the time part of the name of the handoff file, for
   example `1530`. So the command of step 3 of "Start a session" is:

   ```sh
   herdr agent start operator-<slug>-<time> --kind <kind> --pane <pane id> -- -n operator-<slug> <model flags> "<prompt>"
   ```

   The error text of that step names the herdr agent name.

3. The old operator makes sure that the new operator runs. It runs `herdr pane read <pane id>` with the pane id that
   step 2 of "Start a session" kept. It does not look in `ListAgents` by the name, because two sessions have the name.
   In a handoff of the operator, this step wins over the sentence of step 3 of "Start a session" that starts "After one
   of these errors, the operator first looks for the new session in `ListAgents`".
4. If the new operator runs, the old operator runs `herdr tab get "$HERDR_TAB_ID"` in its shell. If
   `.result.tab.pane_count` is 1, it runs `herdr tab close "$HERDR_TAB_ID"`. If the count is more than 1, it closes only
   its own pane with `herdr pane close "$HERDR_PANE_ID"`. This close is its last action.
5. The old operator closes nothing and tells the user in each of these cases:

   - (a) `HERDR_TAB_ID` is not set.
   - (b) `HERDR_PANE_ID` is not set, so the old operator cannot get the id of its own pane.
   - (c) `herdr tab get`, `herdr tab close` or `herdr pane close` fails.

6. If the new operator does not run, or a step of "Start a session" fails, the old operator closes nothing. It tells the
   user, as the failure case of "Start a session" says.
7. The new operator does [the check of the handoff folder](handoff.md#the-check-of-the-handoff-folder). That section
   holds its cases and its failure case.
8. The new operator reads one time whether the pane of the old operator still exists. It runs `herdr pane get <pane id>`
   in its shell. The pane id comes from the handoff file. The read covers a close of the tab and a close of the pane
   alone. The reason: the pane is gone after each of them. The new operator does one of these cases:

   - (a) If the command exits with 1 and the error code `pane_not_found`, the pane is gone. The new operator says
     nothing about it and continues with its next steps.
   - (b) If the command exits with 0, the pane still exists. The old operator can still run its last steps, or its close
     failed. The new operator closes nothing and reads no second time. It tells the user in its first reply. The reply
     gives the tab id, the pane id and the output of the command. Then it continues with its next steps.
   - (c) A read fails when the command gives another exit code, another error code or no JSON. If the read fails,
     [the failure rule](limits.md#the-failure-rule) applies. If the handoff file gives no pane id, the new operator
     tells the user. In both cases, the new operator closes nothing and tells the user in its first reply. Then it
     continues with its next steps.

   The new operator does not close the old tab or pane. The user closes it in herdr.

9. The new operator keeps the open items of the file as its list of [the open items](operator-items.md#the-open-items).
   It also keeps each entry of the tab list of the file. These entries start the tab list of the new operator.
10. The new operator sends a ready message with `SendMessage` to each sender that the handoff file names.
    [The hold of the items](handoff.md#the-hold-of-the-items) gives the rules of the ready message. If the file names no
    sender, the new operator sends no ready message. The ready message gives the own ref of the new operator, from the
    first line of `ListAgents`. If `ListAgents` fails, [the failure rule](limits.md#the-failure-rule) applies.

In its first reply, the new operator gives the user the path of the handoff file. It also gives the notice of the hold
that step 1 of [the steps of the old operator](#the-steps-of-the-old-operator) gives the old operator. The reason: the
last reply of the old operator shows only in its closed tab.

`herdr agent start` refuses a herdr agent name that already runs. With no suffix `-<time>`, the start of the third
operator fails, because the second operator still runs.

On 2026-10-25, with herdr 0.9.3 and Claude Code 2.1.310, a test session in tab `wB:tG` ran
`herdr tab close "$HERDR_TAB_ID"`, and `herdr tab get wB:tG` then returned `tab_not_found`. In a first test (tab
`wB:tF`), the session closed before Claude Code wrote its assistant turn to the transcript.

The old operator cannot make sure that its close worked, because the close ends it. In the handoff of 16:03 on
2026-10-25, the old tab still existed at the check of the close, for an unknown cause.

The old and the new operator have the same name, and for two rows with one name,
[Stop a session](operator-start.md#stop-a-session) closes nothing.

These rules still apply, and the rule of this section does not cover them:

- "The operator does not close the tab without the user", in the failure case of
  [Start a session](operator-start.md#start-a-session)
- "Only the user answers a prompt of a session in `blocked`"

The new operator closes a tab of an earlier operator only as [Stop a session](operator-start.md#stop-a-session) says.
