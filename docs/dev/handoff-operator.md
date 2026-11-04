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
one close. The reason: the count stands in for a read of the context use, and the text of each report enters the context
of the operator when the report arrives. This also holds when the operator shows only the arrival line. A reply with the
full text on request is not a close and does not count.

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

1. Before the hold messages, complete each handoff of a sender whose path item arrived. A sender is
   `orchestrator-<slug>` or `planner-<slug>`, as [The hold of the items](handoff.md#the-hold-of-the-items) says. A
   handoff of a sender is a handoff of an orchestrator or a follow-up planner, as
   [A handoff](operator-start.md#a-handoff) gives it. The old sender is the sender that hands off, and the new sender
   takes its work. A path item is the item of step 2 of "A handoff". It gives the path of the handoff file of the old
   sender.

   For each such handoff, do "A handoff" from step 3 to step 5. This includes the read of `docs/dev/operator-start.md`
   at the start of that section. This rule covers a path item that arrived before this step. It also covers a path item
   that arrives while you do these handoffs.

   If a step of "A handoff" fails, the failure cases of "A handoff" apply as they are. Then do the rest of these steps
   of the old operator. Name the failure in the handoff file, as
   [The handoff file of the operator](#the-handoff-file-of-the-operator) says.

   This step covers only a handoff of an orchestrator or a follow-up planner. It does not cover a handoff of a sender
   that starts after the hold messages, or [a topic handoff](handoff.md#a-topic-handoff). It does not change the failure
   cases of "A handoff" and of "Stop a session".

   Do not wait for a path item that did not arrive. Each other handoff of a sender follows these rules:

   - The go of step 1 of "A handoff" goes out at once. This also holds for a recommendation that arrives before the hold
     messages, also in the reply that starts the handoff of the operator. After the hold messages, a sender holds a
     recommendation, as [The hold of the items](handoff.md#the-hold-of-the-items) says, and the new operator sends the
     go. A recommendation that arrives after the write of the file follows
     [the paragraph "No wait follows the write of the file"](#the-steps-of-the-old-operator).
   - A handoff of a sender can start with no path item before the hold messages. Then the sender holds its path item, as
     [The hold of the items](handoff.md#the-hold-of-the-items) says. After the ready message, the new operator does "A
     handoff" from step 3 to step 5.

   This table gives each state of a handoff of a sender at the hold messages. The rows do not overlap.

   | State at the hold messages                                          | Old operator                                                                                                        | Sender of the slug                                                                                                                                                                                  | New sender                    | New operator                                                   | User                                                            | Who tells whom                                                                                                     |
   | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
   | The handoff of the sender did not start, or it ended                | Sends the hold messages                                                                                             | Holds its items                                                                                                                                                                                     |                               | If a recommendation arrives later, sends the go                |                                                                 | The old operator tells each sender of the slug                                                                     |
   | The path item arrived, and "A handoff" works                        | Sends the report of the rounds, and its pane closes                                                                 | Reads "stop", and its pane closes                                                                                                                                                                   | Runs, and gets a hold message |                                                                |                                                                 | The old operator tells the old sender "stop". The old sender tells the old operator, with the report of the rounds |
   | The path item arrived, and a step of "A handoff" fails              | The failure cases of "A handoff" apply. It names the failure in its handoff file and does the rest of its own steps | As the failure case leaves it                                                                                                                                                                       | As the failure case leaves it | Tells the user in its first reply                              | Decides on the failure, as the failure case of "A handoff" says | The old operator and then the new operator tell the user                                                           |
   | The handoff of the sender started, and the path item did not arrive | Sends the hold messages                                                                                             | Holds its path item, as [The hold of the items](handoff.md#the-hold-of-the-items) says, or sends it as [the paragraph "No wait follows the write of the file"](#the-steps-of-the-old-operator) says |                               | Does "A handoff" from step 3 to step 5 after the ready message |                                                                 | The old sender tells the new operator, with the path item                                                          |

   On 2026-10-25, the close count reached 15 at planner-m22-67, orchestrator-m22-46 gave a path right after it, and
   planner-m22-68 gave a path later. The old operator first stopped and started orchestrator-m22 and planner-m22.

   The reasons: An old sender with a path item already wrote its handoff file and waits. A wait for the new operator
   leaves the slug with no orchestrator or no planner that works. A wait for a path item that did not arrive can hold
   the handoff of the operator for hours. An orchestrator first finishes its current tasks.

   After the last start of the handoffs above, send each sender of the slug a hold message with `SendMessage`, as
   [The hold of the items](handoff.md#the-hold-of-the-items) says. Read the senders from `ListAgents` after the last
   start. As a result, each new sender is in the list and gets a hold message. Then tell the user one time that the hold
   stops the items. Name each sender of the slug that holds. Say that the hold ends when the new operator is ready or
   when the user [ends the hold](handoff.md#the-end-of-the-hold-by-the-user).

2. Run the rounds of [Session-review rounds](session-review-rounds.md). Send each finding to `planner-<slug>` with
   `SendMessage`. The orchestrator does the same, as the planner bullet of
   [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) says. Then wait until each finding
   is handled or waits for an answer of the user. Do not wait in a loop.

   If a send fails, or the user asks during the wait, tell the user the state of each finding. The word of the user then
   decides. After the wait, give the user the report of the rounds in a reply. Then write the handoff file, as
   [The handoff file](handoff.md#the-handoff-file) says. Put each finding that waits for the user in the file, as
   [The items of a handoff file](handoff.md#the-items-of-a-handoff-file) says. If the write or the `date` command fails,
   [the failure rule](limits.md#the-failure-rule) applies.

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

- The prompt names the slug and the session name `operator-<slug>`. The first step of the prompt is the prompt read of
  [The items of a handoff file](handoff.md#the-items-of-a-handoff-file). The prompt names no other doc for the start
  reads. The second step of the prompt is steps 7 to 10 of
  [The start of the new operator](#the-start-of-the-new-operator).
- The step of the milestone in [The order of a milestone](operator-start.md#the-order-of-a-milestone).
- The kind of each planner, initial or follow-up.
- Each open item with its id, its sender and its full text ([The open items](operator-items.md#the-open-items)). The
  file marks each question of the item as open, answered, sent or moved. The operator can keep a question open because
  the words of the user do not fully settle it, as [The answer](operator-items.md#the-answer) says. For such a question,
  the file gives what stays open and whether the ask to the user waits. For an answered question with an answer of the
  operator, the file gives that answer.
- Each item that the operator answered and did not yet show, with its id, its sender and the first line of the item. For
  each question, the file gives the answer that the operator sent and the number of the sender.
- Each sender of the slug that got the hold message, as [The hold of the items](handoff.md#the-hold-of-the-items) says.
  The new operator sends the ready message to each of these senders in step 10 of
  [The start of the new operator](#the-start-of-the-new-operator).
- Each handoff of a sender that failed in step 1 of [the steps of the old operator](#the-steps-of-the-old-operator),
  with its step and its error.
- Each entry of [the tab list](../operator.md) of the old operator. So the file holds the tabs that the old operator
  started and the tabs that it took over.
- The name, the tab id and the pane id of the old operator. The tab id is `$HERDR_TAB_ID`, and the pane id is
  `$HERDR_PANE_ID`. The old operator gets the two ids before it writes the file. If it cannot get the pane id, the file
  says so. The close of step 4 of [The start of the new operator](#the-start-of-the-new-operator) uses the same ids. The
  file gives no session ref of the old operator.

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
    sender, the new operator sends no ready message. The ready message gives the own session ref of the new operator,
    from the first line of `ListAgents`. If `ListAgents` fails, [the failure rule](limits.md#the-failure-rule) applies.

In its first reply, the new operator gives the user the path of the handoff file. It also shows each answered item of
the file that the old operator did not show, as [The open items](operator-items.md#the-open-items) says. It also gives
the notice of the hold that step 1 of [the steps of the old operator](#the-steps-of-the-old-operator) gives the old
operator. It also tells the user about each failed handoff of a sender that the handoff file names. The reason: the last
reply of the old operator shows only in its closed tab.

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
