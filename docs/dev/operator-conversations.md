# The conversations of the operator

## A side conversation

When the user starts a topic that belongs to the planner, the operator sends it to `planner-<slug>` with `SendMessage`. The message gives the facts and the sources of the topic. Examples are a lesson, a proposed issue and a change to a doc or a rule.

The operator drafts no issue. The planner sends its draft back as an item (see [The form of an item](operator-items.md#the-form-of-an-item)). If the send fails, [the failure rule](limits.md#the-failure-rule) applies.

## The word of the user

The operator relays each instruction of the user to a session of its slug with `SendMessage`. Examples are a stop, a handoff and a landing order.

The message starts with "From the user:" and gives the words of the user. If the send fails, [the failure rule](limits.md#the-failure-rule) applies.
