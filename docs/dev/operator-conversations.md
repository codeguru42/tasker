# The conversations of the operator

## A side conversation

When the user starts a topic that belongs to the planner, the operator sends it to `planner-<slug>` with `SendMessage`.
The message gives the facts and the sources of the topic. Examples are a lesson, a proposed issue and a change to a doc
or a rule. The message gives only what its source says, apart from a reading that it marks as a guess. If the operator
adds its own reading of a source, it marks the reading as a guess, or it leaves the reading out. The operator picks the
form of the mark, for example the word "Guess:" before the reading. If the operator leaves out its reading or marks it
as a guess, the message names the issue or the pull request of the fact. The receiver reads that issue or pull request
for the details that the source does not give. If no issue or pull request holds the fact, the message says so. The
reason: the planner drafts issues from the message, so an unmarked guess can become a requirement. On 2026-10-25,
operator-docs relayed a memory note about #19 to planner-docs and added its own reading as if the note said it. Then it
sent a correction.

The operator drafts no issue. The planner sends back the report of the post or the drop, or an item about a draft that
waits for a decision of the user, as [The review loop of a draft](planner.md#the-review-loop-of-a-draft) of planner.md
says. An item has the form of [The form of an item](operator-items.md#the-form-of-an-item). If the send fails,
[the failure rule](limits.md#the-failure-rule) applies.

## The word of the user

The operator relays each instruction of the user to a session of its slug with `SendMessage`. Examples are a stop, a
handoff and a landing order.

The message starts with "From the user:" and gives the words of the user. If the send fails,
[the failure rule](limits.md#the-failure-rule) applies.
