# Session-review rounds

This page gives the rounds of `/session-review` that a session runs before it stops. An orchestrator runs them before
its end reads and the close, as [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) says.
[The close of a milestone](operator-start.md#the-close-of-a-milestone) gives the order of the rounds of each session at
the end of a milestone. The orchestrator runs its rounds first. The operator runs its rounds after the end of the
orchestrator. The planner runs its rounds after the end of the role of the operator. This page covers only an
orchestrator, a planner, an operator and a [question session](question-pane.md#a-question-pane). A task subagent runs no
round, as [Limits](limits.md#limits) says.

For a question session, [The rounds before the close](question-pane.md#the-rounds-before-the-close) gives the target of
the report and the steps of a failure. It also gives the first target of each proposal, what an open finding is, and the
hold rule of a question session. That subsection also defines the report of each round and the final report. That
subsection wins over this page.

A round is one run of `/session-review`. A memory change, a new proposal and new open work that no earlier round listed
each count as something new. A round can find a lesson that an earlier round missed, or a new fact from the answers of
the user.

Each session that this page covers does these steps for its rounds:

1. Run one round.
2. Give the findings of the round to the user. Ask the user about each waiting decision. Use the path that the docs of
   the session give for a question to the user. Before the next round, settle with the user each waiting decision of the
   round whose wait did not end.
3. Do steps 1 and 2 again until a round finds nothing new. After step 2 ends, start the next round at once, in the same
   turn. Do not wait for a word of the user.
4. Send the report of the rounds to the target that this page gives for the session.

The user asked for these steps, word for word: "Run a session review round", "Resolve all findings with the user",
"Repeat steps 1 and 2 until a review returns no more findings" and "Report to the question pane owner that the question
is resolved." The list does not copy these words, because a general list names no pane owner. The report to the question
pane owner is the case of a question session.

The reason for the place: on 2026-11-22, the user said: "Issue #1033 needs to modify docs/dev/session-review-rounds.md.
as a general procedure for review rounds. It isn't specific to the question pane". So the list is on this page, which
the close request of a question pane already names. On 2026-11-21, the user said: "don't wait for me to tell you to run
the next review round". This is the reason for the start at once in step 3.

If a round or a send of a finding fails, [the failure rule](limits.md#the-failure-rule) applies to that session, and its
rounds end. A failed round is not a round that finds nothing new. In the close, the close then stops at this stage, as
[The close of a milestone](operator-start.md#the-close-of-a-milestone) says.

A waiting decision is the term of step 7 of [the session-review skill](../../.claude/skills/session-review/SKILL.md).
Its wait ends as step 8 of the skill says. A pause or a silence of the user ends no wait. The hold of step 2 of the list
has no time limit, and it stops only the next round.

Other open work does not hold the next round, unless a hold rule says so. Examples are an open question and unfinished
work of step 7 of the skill. A finding that goes to another target holds no round, unless it is a waiting decision. An
example is a proposal to the planner, which stays open until the planner handles it, as this page says. A round can find
something new with no waiting decision. Then the session also starts the next round at once.

Step 7 (e) of the skill says: "Open work with no answer does not keep the rounds running." That sentence keeps its
meaning for such open work. For a waiting decision, step 2 of the list wins over it. The reason: the hold of step 2 of
the list delays only a next round that step 3 of the list already starts.

The user can end the rounds before each wait ends, with a word to the session. Then the session runs no next round and
sends the report of the rounds at once. The report gives each open finding. A close of a question pane by the user keeps
the rules of [The rounds before the close](question-pane.md#the-rounds-before-the-close).

A hold rule is a rule that holds the end of the rounds until each open question or decision of its scope is settled. A
hold rule also says whether this open work holds the next round. Each rule that meets this definition is a hold rule,
also a rule that the list of hold rules below does not name.

For the rounds of its scope, a hold rule wins over the rules of other open work, as far as it says. It also wins over
the end by the user and over steps 3 and 4 of the list, as far as it says. While a hold rule holds the rounds, a round
that finds nothing new does not end them. A word of the user ends such rounds only as the hold rule permits. Steps 1 and
2 of the list still hold under a hold rule. These places give a hold rule:

- Steps 7 and 11 of [The steps that end each role](operator-start.md#the-steps-that-end-each-role)
- [The rounds before the close](question-pane.md#the-rounds-before-the-close), for a question session

A finding is handled when it is posted as an issue or added to an open issue. It is also handled when the user decided
to drop it, or when a follow-up planner or a [planner subagent](planner-subagent.md) dropped it, as
[The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner) says. A write to memory does not
handle a finding. A session that is not a planner sends each finding to the planner as a proposal. That finding stays
open until the planner handles it. A finding that is not handled is open.

A question session first gives each proposal to the user, as
[The rounds before the close](question-pane.md#the-rounds-before-the-close) says.

After the rounds, each planner and each orchestrator of a milestone scope sends the report of the rounds to
[its operator](../operator.md). After the end of the role of its operator, a planner gives the report of its rounds to
the user directly, as [The operator](working-with-the-user.md#the-operator) says. The report gives how many rounds ran,
what each round found, and the state of each finding. An initial planner sends it with `SendMessage`. Each other
orchestrator or planner sends it as a report, as [The form of an item](operator-items.md#the-form-of-an-item) says. An
operator gives it to the user in a reply.

An orchestrator of a set scope has no operator. So its report of the rounds is a progress report in its own tab, as
[The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) says for its last report.

In the close of a milestone, the operator and the planner each resolve each open question and each open decision first.
Steps 6, 7, 10 and 11 of [The steps that end each role](operator-start.md#the-steps-that-end-each-role) give this rule.
It also covers an open decision about work outside the milestone. Open work with no answer still does not keep the
rounds running, as step 7 (e) of [the session-review skill](../../.claude/skills/session-review/SKILL.md) says.

The rounds of an orchestrator end only after each open question and each waiting decision of the rounds is settled.
After the last answer, the orchestrator runs one more round, and that round must find nothing new. It runs that round
also with no work after its earlier rounds. This rule wins over the paragraph that starts "If the rounds of a session
already ended". An answer that asks for work is work after the rounds. [Terms](question-pane.md#terms) gives the path of
each such question to the user.

In the close of a milestone, the operator and the planner each run the round of step 7 or of step 11. They run it also
with no work after their earlier rounds. This rule wins over the next paragraph. The close report of the operator or the
planner holds its report of the rounds to the user.

If the rounds of a session already ended and the session did no work after them, it runs no new round. It gives the
report again. The steps that a doc gives after the rounds and before the stop, apart from the run of a ticket, are not
work after them. Examples are the posts and the drops of the findings of the rounds and the write of a handoff file.
Other examples are the item with the path of the handoff file and the close of a milestone. Each other judgment of work
after the rounds is open on purpose, and the session makes it. In the close, an answer of the user that asks for more
work is work after the rounds. See [The question gate of the close](operator-items.md#the-question-gate-of-the-close).

For an orchestrator, the report that the milestone is done holds the report of the rounds. A new ticket that the
orchestrator runs after its rounds is work after its rounds. So the orchestrator runs its rounds again at its next end,
as [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) says. A pi orchestrator of a milestone
scope stops at the stop of the operator in [The close of a milestone](operator-start.md#the-close-of-a-milestone). If it
did no work after its rounds, it runs no new round there and only gives the report again. The report again is not a
second report that the milestone is done.

A restart of the end during the wait is no work after its rounds. So it runs no new round and sends no second report of
the rounds.
