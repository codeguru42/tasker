# Session-review rounds

This page gives the rounds of `/session-review` that a session runs before it stops. An orchestrator runs them before
its end reads and the close, as [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) says.
[The close of a milestone](milestone-close.md) gives the order of the rounds of each session at the end of a milestone.
The orchestrator runs its rounds first. This page covers only an orchestrator, a planner and a
[question session](question-pane.md#a-question-pane). A task subagent runs no round, as [Limits](limits.md#limits) says.

For a question session, [The rounds before the close](question-pane.md#the-rounds-before-the-close) gives the target of
the report and the steps of a failure. It also gives the first target of each proposal, what an open finding is, and the
hold rule of a question session. That subsection also defines the report of each round and the final report. That
subsection wins over this page.

A round is one full run of `/session-review`. A memory change, a new proposal and new open work that no earlier round
listed each count as something new. A round can find a lesson that an earlier round missed, or a new fact from the
answers of the user.

A round ran only after a call of the session-review skill for it. The report of the rounds names only the rounds that
ran, and its count of rounds is the count of the rounds that ran. It names no round that the session plans or did not
start. This rule holds for each session that this page covers. The user and the pane owner can then trust the count.

The reason: on 2026-11-21, a question session sent its report after round 1, before round 2 ran, and its report said
that 2 rounds ran, as [The rounds before the close](question-pane.md#the-rounds-before-the-close) says. On 2026-11-22,
in the question panes of the questions orchestrator-m31-157 and orchestrator-m31-161, a report of the rounds again named
rounds that did not run. The user made sure of each count.

In each round, the session runs each step of `/session-review`. A question session still skips the steps that
[The rounds before the close](question-pane.md#the-rounds-before-the-close) lets a question session skip. A check in the
thinking of the session, with no summary to the user, is not a round.

Each round reviews at least the whole transcript since the end of the last round of the session. If no round of the
session ran before, the round reviews at least the whole transcript since the start of the session. This part of the
transcript includes the answers of the user to the earlier round. Steps 1 and 7 of
[the session-review skill](../../.claude/skills/session-review/SKILL.md) name no part of the transcript. This rule gives
steps 1 and 7 a lower bound and takes nothing away from these steps. For a question session,
[The rounds before the close](question-pane.md#the-rounds-before-the-close) still wins over this page and names no part
of the transcript.

Each round also reads the list of the summary of the last earlier round of the session. The lower bound of the
transcript removes no open entry of that list from the summary of the round. A repeat of such an entry is still not a
new finding, as step 7 (e) of the skill says.

The reason for the full run and the summary of each round: the user can then trust the count of the rounds. The user can
also trust the claim that the last round found nothing new. On 2026-11-22, the user said, word for word: "you must run
an entire session review of the transcript since the last review" and "1. This is general for session review rounds, not
specific to the question pane." On the same day, a round was only a check in the thinking of a session. The round gave
no summary to the user.

Each session that this page covers does these steps for its rounds:

1. Run one round.
2. Give the summary of step 8 of the skill for the round to the user. Give the summary also for a round that finds
   nothing new. The paragraph that starts "The summary of a round goes" gives the path of the summary. Ask the user
   about each waiting decision. Before the next round, settle with the user each waiting decision of the round whose
   wait did not end.
3. Do steps 1 and 2 again until a round finds nothing new. After step 2 ends, start the next round at once, in the same
   turn. Do not wait for a word of the user. For an orchestrator,
   [The gate of the rounds of an orchestrator](question-pane.md#the-gate-of-the-rounds-of-an-orchestrator) holds the
   next round and wins over this start at once.
4. Send the report of the rounds to the target that this page gives for the session.

The user asked for these steps, word for word: "Run a session review round", "Resolve all findings with the user",
"Repeat steps 1 and 2 until a review returns no more findings" and "Report to the question pane owner that the question
is resolved." The list does not copy these words, because a general list names no pane owner. The report to the question
pane owner is the case of a question session.

The reason for the place: on 2026-11-22, the user said: "Issue #1033 needs to modify docs/dev/session-review-rounds.md.
as a general procedure for review rounds. It isn't specific to the question pane". So the list is on this page, which
the close request of a question pane already names. On 2026-11-21, the user said: "don't wait for me to tell you to run
the next review round". This is the reason for the start at once in step 3.

The summary of a round goes on the path that the docs of the session give for the user:

- If the summary holds a waiting decision or a [new open question](question-pane.md#the-rounds-before-the-close), the
  summary goes on the path for a question to the user.
- If the summary holds neither, the summary goes on the path for a report to the user. For an orchestrator, this path is
  a progress report in its own tab, as
  [Reports and questions of a session](working-with-the-user.md#reports-and-questions-of-a-session) says. The `Report:`
  line and the id of the progress report come before the summary. The first line of step 8 of the skill stays the first
  line of the summary.
- For a question session, both paths are its pane.

This split is a choice of issue #1053, and the user can change the split. For an orchestrator, the rule of
[Terms](question-pane.md#terms) for the waiting decisions and the open questions of the rounds wins over the split.

The summary of a round comes before the next round. The summary of the last round comes before the report of the rounds.
For a question session, the report of the rounds is the final report, as
[The rounds before the close](question-pane.md#the-rounds-before-the-close) says. A failed round needs no summary,
because the paragraph that starts "If a round or a send of a finding fails" applies to the failed round. If the user
ends the rounds by the paragraph that starts "The user can end the rounds", no next summary comes.

The summary of a round is not a report of a round of
[The rounds before the close](question-pane.md#the-rounds-before-the-close). A question session gives the summary of a
round that finds nothing new in the pane of the question session. The question session sends the pane owner no report of
that round, as that subsection says.

If a round or a send of a finding fails, [the failure rule](limits.md#the-failure-rule) applies to that session, and its
rounds end. A failed round is not a round that finds nothing new. In the close, the close then stops at this stage.

A waiting decision is the term of step 7 of [the session-review skill](../../.claude/skills/session-review/SKILL.md).
Its wait ends as step 8 of the skill says. A pause or a silence of the user ends no wait. The hold of step 2 of the list
has no time limit, and it stops only the next round.

Other open work does not hold the next round, unless a hold rule says so. Examples are an open question and unfinished
work of step 7 of the skill. A finding that goes to another target holds no round, unless it is a waiting decision. An
example is a proposal to the planner, which stays open until the planner handles it, as this page says. A round can find
something new with no waiting decision. Then the session also starts the next round at once.

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

- [The rounds before the close](question-pane.md#the-rounds-before-the-close), for a question session

A finding is handled when it is posted as an issue or added to an open issue. It is also handled when the user decided
to drop it, or when a [planner subagent](planner-subagent.md) dropped it, as
[The post of a draft](planner.md#the-post-of-a-draft) says. A write to memory does not handle a finding. A session that
is not a planner sends each finding to the planner as a proposal. That finding stays open until the planner handles it.
A finding that is not handled is open.

A question session first gives each proposal to the user, as
[The rounds before the close](question-pane.md#the-rounds-before-the-close) says.

After the rounds, the initial planner gives the report of the rounds to the user in its own tab. An orchestrator gives
its report of the rounds in the report that the milestone is done, a progress report in its own tab. The report gives
how many rounds ran, as the rule of a round that ran says, what each round found, and the state of each finding.

The report of the rounds of an orchestrator of a set scope is a progress report in its own tab, as
[The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) says for its last report.

The rounds of an orchestrator end only after each open question and each waiting decision of the rounds is settled.
After the last answer, the orchestrator runs one more round, and that round must find nothing new. It runs that round
also with no work after its earlier rounds. This rule wins over the paragraph that starts "If the rounds of a session
already ended". An answer that asks for work is work after the rounds. [Terms](question-pane.md#terms) gives the path of
each such question to the user.

If the rounds of a session already ended and the session did no work after them, it runs no new round. It gives the
report again. The steps that a doc gives after the rounds and before the stop, apart from the run of a ticket, are not
work after them. Examples are the posts and the drops of the findings of the rounds and the write of a handoff file.
Other examples are the message with the path of the handoff file and the close of a milestone. Each other judgment of
work after the rounds is open on purpose, and the session makes it. In the close, an answer of the user that asks for
more work is work after the rounds.

For an orchestrator, [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) gives the condition
for a new round. This condition holds in place of the rule and the judgment of work after the rounds.

For an orchestrator, the report that the milestone is done holds the report of the rounds. At each start of its end, the
orchestrator runs a round by the rule of [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator).

A start of the end whose transcript has nothing new since the last rounds runs no new round and sends no second report
of the rounds. [The end of an orchestrator](pick-the-tickets.md#the-end-of-an-orchestrator) gives this rule.
