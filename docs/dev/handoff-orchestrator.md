# Handoff of the orchestrator

[docs/dev/handoff.md](handoff.md) gives the common steps of a handoff. This page gives only what differs for the orchestrator.

## The long-running orchestrator

A long-running orchestrator is the orchestrator of a milestone that stays open while other sessions add issues to it, for example "Docs" (see [docs/dev/planner.md](planner.md)). In a handoff, the old orchestrator gives its work to a new orchestrator in a new session.

The rules of this page cover only a long-running orchestrator. An orchestrator of a numbered milestone stops when the Todo column of its milestone is empty, as [Pick the tickets](pick-the-tickets.md#pick-the-tickets) says. The rules of this page do not cover it.

## The landing count

The old orchestrator counts the landings of its session. Each of these also counts as one landing:

- A quota resume
- A new issue that the user asks the old orchestrator to send for drafting
- A decision of the user that takes several question rounds

At a count of 12, the old orchestrator suggests a handoff to the user in its report of that landing. The report of a landing (a landing report) is the reply in which the old orchestrator tells the user that a ticket landed. If a counted event that is not a landing brings the count to 12, the old orchestrator suggests a handoff in a later reply. That reply is its next reply to the user that does not answer a question of the user, for example the next landing report.

In a new session after a handoff, the count starts again at 0.

The reason for the count: it leaves room for the session review and the handoff file before an automatic compaction. An automatic compaction loses context. On 2026-10-24, the context size of orchestrator-docs was about 175k tokens after the doc reads at the start, and about 400k after 15 landings (about 15k for a quiet landing). Three more landings, a quota resume, the filing of one issue and several question rounds brought it to about 507k (about 30k for a busy landing). An automatic compaction ran right after, and the session review and the handoff file then used about 30k to 50k tokens.

In an answer to [a question of the user](working-with-the-user.md#a-question-of-the-user), the old orchestrator suggests a handoff only when the suggestion is relevant to that question. In a list of open questions or open items, the rule of [The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) wins. A landing report is not such an answer.

## The steps of the old orchestrator

After the start, the old orchestrator does these steps:

1. Start no new ticket.
2. Wait until each task in flight lands. For each landing, do the usual steps: delete the jobs (see [Delete the job](quota.md#delete-the-job)), do [the re-read rule](doc-reads.md#the-re-read-rule), do the memory step of the bullet "When the final report of the agent of a ticket says that the ticket landed" of [Land the work](land-the-work.md#land-the-work) and do [the notice rule](doc-reads.md#the-notice-rule). The reason: a job lives only in the session of the orchestrator (see [Terms](quota.md#terms)). If a task is still in flight at the handoff, nobody resumes it after a quota stop.
3. Run the review rounds of the last bullet of [Pick the tickets](pick-the-tickets.md#pick-the-tickets), until a round finds nothing new. The user asked for this rule on 2026-10-17. Then write the handoff file, as [The handoff file](handoff.md#the-handoff-file) says.
4. Send the path of the handoff file to `operator-<slug>` as an item, as [The form of an item](operator-items.md#the-form-of-an-item) of operator-items.md says.

The handoff ends in the operator, as [The end of a handoff](handoff.md#the-end-of-a-handoff) and [The stop and the start](handoff.md#the-stop-and-the-start) of handoff.md say. Until the end, the old orchestrator starts no new ticket, also after step 4. On 2026-10-17, the Docs orchestrator saw that its handoff started too early. It then started a new ticket without the word of the user.

## The handoff file of the orchestrator

The handoff file of the orchestrator holds the items of [The items of a handoff file](handoff.md#the-items-of-a-handoff-file). The old orchestrator also puts these items in the handoff file:

- The prompt names the milestone, the session name and the first step: the start of the re-read rule. The prompt also names the docs to read and the state at the handoff. Its last step is to watch the board for new issues.
- The state at the handoff: the tasks in flight of other milestones that share a file with an open issue of the milestone, the parked tasks and the other sessions.
- The number of each open broken-test issue that the old orchestrator knows of (see the broken-test rule in [A failed CI run](ci-wait.md#a-failed-ci-run)).
- What the old orchestrator did.
- A table of the open issues of the milestone, with the columns issue, topic, blockers and files.
- Each finding of the review rounds, with its state, handled or open.

The docs that the prompt names are docs of the orchestrator of [the re-read rule](doc-reads.md#the-re-read-rule).

## The start of the new orchestrator

The new orchestrator is `orchestrator-<slug>`. [The stop and the start](handoff.md#the-stop-and-the-start) applies. The new orchestrator then starts with the re-read rule. Right after the first doc read, the new orchestrator does the check of [The check of the handoff folder](handoff.md#the-check-of-the-handoff-folder).
