# Session-review rounds

This page gives the rounds of `/session-review` that a session runs before it stops. An orchestrator runs them before
its report that the milestone is done, as [Pick the tickets](pick-the-tickets.md#pick-the-tickets) says.
[The close of a milestone](operator-start.md#the-close-of-a-milestone) gives the order of the rounds of each session at
the end of a milestone. The orchestrator runs its rounds first. The operator runs its rounds after the stop of the
orchestrator. The planner runs its rounds after the end of the role of the operator. This page covers only an
orchestrator, a planner and an operator. A task subagent runs no round, as [Limits](limits.md#limits) says.

A round is one run of `/session-review`. A session runs a round again after each round that found something. A memory
change, a new proposal and new open work that no earlier round listed each count as something. A round can find a lesson
that an earlier round missed, or a new fact from the answers of the user. The rounds end when a round finds nothing new.
If a round or a send of a finding fails, [the failure rule](limits.md#the-failure-rule) applies to that session, and its
rounds end.

A failed round is not a round that finds nothing new. In the close, the close then stops at this stage, as
[The close of a milestone](operator-start.md#the-close-of-a-milestone) says.

A finding is handled when it is posted as an issue or added to an open issue. It is also handled when the user decided
to drop it, or when a follow-up planner dropped it, as
[The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner) says. A write to memory does not
handle a finding. A session that is not a planner sends each finding to the planner as a proposal. That finding stays
open until the planner handles it. A finding that is not handled is open.

After the rounds, each orchestrator and each planner sends the report of the rounds to [its operator](../operator.md).
After the end of the role of its operator, a planner gives the report of its rounds to the user directly, as
[The operator](working-with-the-user.md#the-operator) says. The report gives how many rounds ran, what each round found,
and the state of each finding. An initial planner sends it with `SendMessage`. Each other orchestrator or planner sends
it as a report, as [The form of an item](operator-items.md#the-form-of-an-item) says. An operator gives it to the user
in a reply.

In the close, the planner keeps each open decision about later work in its last report to the user. An open item about
work outside the milestone does not keep the rounds running, as
[The close duties of the follow-up planner](planner.md#the-close-duties-of-the-follow-up-planner) says.

If the rounds of a session already ended and the session did no work after them, it runs no new round. It gives the
report again. The steps that a doc gives after the rounds and before the stop, apart from the run of a ticket, are not
work after them. Examples are the posts and the drops of the findings of the rounds and the write of a handoff file.
Other examples are the item with the path of the handoff file and the close of a milestone. Each other judgment of work
after the rounds is open on purpose, and the session makes it. In the close, an answer of the user that asks for more
work is work after the rounds. See [The question gate of the close](operator-items.md#the-question-gate-of-the-close).

For an orchestrator, the report that the milestone is done holds the report of the rounds. The report again is not a
second report that the milestone is done. At its stop in
[The close of a milestone](operator-start.md#the-close-of-a-milestone), an orchestrator that did no work after its
rounds runs no new round. It only gives the report again. A new ticket that the orchestrator runs after its report is
work after its rounds. So the orchestrator runs its rounds again before its next report that the milestone is done.
