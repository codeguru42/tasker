# Handoff

The readers of this page are a long-running orchestrator and the follow-up planner.

## The handoff

A long-running orchestrator is the orchestrator of a milestone that stays open while other sessions add issues to it, for example "Docs" (see [docs/dev/planner.md](planner.md)). In a handoff, the old orchestrator gives its work to a new orchestrator in a new session.

The rules of this section cover only a long-running orchestrator. An orchestrator of a numbered milestone stops when the Todo column of its milestone is empty, as [Pick the tickets](pick-the-tickets.md#pick-the-tickets) says. The rules of this section do not cover it.

Only the user starts a handoff. The user can ask the old orchestrator for a handoff at any time. The reason: the old orchestrator has no tool that shows its context use. The landing count that follows stands in for a read of the context use. On 2026-10-16, the Docs orchestrator guessed that about 20% of its context was used and started a handoff. The session used 6%.

The old orchestrator can suggest a handoff to the user. The old orchestrator counts the landings of its session. Each of these also counts as one landing:

- A quota resume
- A new issue that the user asks the old orchestrator to send for drafting
- A decision of the user that takes several question rounds

At a count of 12, the old orchestrator suggests a handoff to the user in its report of that landing. The report of a landing (a landing report) is the reply in which the old orchestrator tells the user that a ticket landed. If a counted event that is not a landing brings the count to 12, the old orchestrator suggests a handoff in a later reply. That reply is its next reply to the user that does not answer a question of the user, for example the next landing report.

The suggestion does not start the handoff. The work continues until the user answers. If the user does not answer, the old orchestrator suggests the handoff again in the report of each later landing.

The count starts at 0 at the start of the session. The count lives until the session ends. In a new session after a handoff, the count starts again at 0. During the session, the count starts again at 0 only when the user says no to a suggestion. When the count reaches 12 again, the old orchestrator suggests a handoff again.

The reason for the count: it leaves room for the session review and the handoff file before an automatic compaction. An automatic compaction loses context. On 2026-10-24, the context size of orchestrator-docs was about 175k tokens after the doc reads at the start, and about 400k after 15 landings (about 15k for a quiet landing). Three more landings, a quota resume, the filing of one issue and several question rounds brought it to about 507k (about 30k for a busy landing). An automatic compaction ran right after, and the session review and the handoff file then used about 30k to 50k tokens.

The handoff starts only when the user agrees to the suggestion or asks for a handoff. In an answer to [a question of the user](working-with-the-user.md#a-question-of-the-user), the old orchestrator suggests a handoff only when the suggestion is relevant to that question. A landing report is not such an answer.

After the start, the old orchestrator does these steps:

1. Start no new ticket.
2. Wait until each task in flight lands. For each landing, do the usual steps: delete the jobs (see [Delete the job](quota.md#delete-the-job)), do [the re-read rule](doc-reads.md#the-re-read-rule), do the memory step of the bullet "When the final report of the agent of a ticket says that the ticket landed" of [Land the work](land-the-work.md#land-the-work) and do [the notice rule](doc-reads.md#the-notice-rule). The reason: a job lives only in the session of the orchestrator (see [Terms](quota.md#terms)). If a task is still in flight at the handoff, nobody resumes it after a quota stop.
3. Run the review rounds of the last bullet of [Pick the tickets](pick-the-tickets.md#pick-the-tickets), until a round finds nothing new. The user asked for this rule on 2026-10-17. Then write the handoff file `$HOME/Documents/tasker/handoff/<date>-<time>-<role>.md`, for example `2026-10-17-1505-docs-orchestrator.md`. The time is the local time of the machine, to the minute. The command `date +%Y-%m-%d-%H%M` prints the date and the time. Take the date and the time when you write the file, not at the start of the handoff.
4. Give the path of the file in the reply to the user.

Only the user ends a handoff that started. The handoff ends when the user clears the old session and starts the new session with the prompt of the handoff file. Until then, the old orchestrator starts no new ticket, also after step 4. On 2026-10-17, the Docs orchestrator saw that its handoff started too early. It then started a new ticket without the word of the user.

The old orchestrator puts these items in the handoff file:

- The prompt for the new session, in a code block. The prompt names the milestone, the session name and the first step: the start of the re-read rule. The prompt also names the docs to read and the state at the handoff. Its last step is to watch the board for new issues.
- The state at the handoff: the tasks in flight of other milestones that share a file with an open issue of the milestone, the parked tasks and the other sessions.
- The number of each open broken-test issue that the old orchestrator knows of (see the broken-test rule in [A failed CI run](ci-wait.md#a-failed-ci-run)).
- What the old orchestrator did, and each decision of the user from its session. The handoff file also keeps each decision of the user from the earlier handoff file of the role that still applies. As a result, a decision survives more than one handoff. The bullet of a relayed decision in [A decision of the user](working-with-the-user.md#a-decision-of-the-user) uses these decisions.
- A table of the open issues of the milestone, with the columns issue, topic, blockers and files.
- Each finding of the review rounds, with its state, handled or open.

The docs that the prompt names are docs of the orchestrator of [the re-read rule](doc-reads.md#the-re-read-rule).

The old orchestrator puts no rule in the handoff file. The rules stay in the docs, and the prompt points to them.

The user pastes the prompt as the first message of the new session. The first message always names the path of the handoff file. The user names the session `orchestrator-<milestone>`, for example `orchestrator-docs`, as [the notice rule](doc-reads.md#the-notice-rule) says. The new orchestrator then starts with the re-read rule. Right after the first doc read, the new orchestrator does the check of the handoff folder that follows.

The new orchestrator does this check before any other step of the prompt. It lists the folder `$HOME/Documents/tasker/handoff/` with `ls`.

The files of its role are the files whose names step 3 gives for that role. A file with a later date and time in its name is newer.

The file of the first message is the handoff file whose path the first message names.

The new orchestrator then does the case of this list that applies:

- If the file of the first message is the newest file of the role, the new orchestrator works from that file.
- If the newest file of the role is newer than the file of the first message, the new orchestrator tells the user. Then it works from the newest file.
- If the list fails, for example because the folder is missing, [the failure rule](limits.md#the-failure-rule) applies. Then the new orchestrator works from the file of its first message.

The reason: on 2026-10-16, the new Docs orchestrator got the handoff file of 01:12 in its first message. A newer handoff file of 09:09 for the same role existed. Most issues of the table of the old file had closed.

## The handoff of a planner

In a handoff of a planner, the old planner gives its work to a new planner in a new session. Both are follow-up planners, as [The initial planner and the follow-up planner](planner.md#the-initial-planner-and-the-follow-up-planner) of planner.md defines.

The rules of this section cover only the follow-up planner. They do not cover the initial planner.

An open draft is a draft that the follow-up planner did not post or drop yet. It can be a draft in its review loops, a draft that waits for a decision of the user, or a draft of a comment that waits for the approval of the user. [The review loop of a draft](planner.md#the-review-loop-of-a-draft) of planner.md gives these cases.

[The handoff](#the-handoff) says that its rules cover only a long-running orchestrator. As an exception, the parts of "The handoff" that follow also cover the follow-up planner, with "planner" in place of "orchestrator":

- The paragraph "Only the user starts a handoff." For the planner, the post count of this section stands in for the landing count.
- The paragraph "The old orchestrator can suggest a handoff to the user.", except its count of landings. The exception also covers the list of the events that also count as one landing. The landing count and that list stay for the orchestrator only.
- Only the first two sentences of the paragraph "The count starts at 0 at the start of the session." The other sentences of that paragraph do not cover the planner.
- Only the first sentence of the paragraph "The handoff starts only when the user agrees to the suggestion or asks for a handoff." The other sentences of that paragraph do not cover the planner.
- The paragraph "Only the user ends a handoff that started." For the old planner, "starts no new ticket, also after step 4" means step 1 of the steps of this section, also after step 3. For the planner, the handoff ends when the operator stops the old planner and starts the new planner, on the request of the user. The last paragraph of this section gives the steps of the operator.
- The paragraph "The old orchestrator puts no rule in the handoff file."
- The check of the handoff folder by the new session, with its cases. For the new planner, the files of its role are the files whose names step 2 of the steps of this section gives.

The planner counts the issues that it posts in its session. Each change of the body of an open issue also counts as one post. At a count of 12, the planner suggests a handoff to the user after that post. The suggestion does not start the handoff. The planner continues its work until the user answers. If the user does not answer, the planner suggests the handoff again after each later post. The follow-up planner tells the user each suggestion as [The operator](working-with-the-user.md#the-operator) of working-with-the-user.md says.

After the first suggestion, the suggestion of the planner stays. If the user says no, the planner still suggests the handoff again after each later post. The count of the planner does not start again at 0. The planner also gives the suggestion again in each item that lists the open questions to the user. The planner stops the suggestion only when the user starts the handoff.

The reason for the count: most of the context of a planner comes from the drafts of each issue and their rewrites.

After the start, the old planner does these steps:

1. Post nothing new and start no new draft.
2. Write the handoff file `$HOME/Documents/tasker/handoff/<date>-<time>-<role>.md`, as step 3 of [The handoff](#the-handoff) says. An example is `2026-10-24-1530-docs-planner.md`.
3. Send the path of the handoff file to `operator-<slug>` as an item, as [The form of an item](operator-items.md#the-form-of-an-item) of operator-items.md says.

The old planner puts these items in the handoff file:

- The prompt for the new session, in a code block. The prompt names the milestone and the session name `planner-<slug>`. The first step of the prompt is a read of `AGENTS.md`, `docs/dev/planner.md`, `docs/dev/issues.md` and `docs/dev/working-with-the-user.md`. The second step of the prompt is the check of the handoff folder.
- The path of each open draft, not its text, its source, and the decision of the user that it waits for, if any.
- Each lesson or proposed issue that another session sent and that has no draft yet. Each item names its sender, its facts and its sources.
- Each question to the user that has no answer yet, with its full text and its choices, as [A decision of the user](working-with-the-user.md#a-decision-of-the-user) says.
- The number of each issue that the old planner posted in its session.
- Each decision of the user from the session of the old planner. The old planner also keeps in the file each decision of the user from the earlier handoff file of the role that still applies.

The reason: the old planner puts the full text of each open question in the file, because the new planner has no other source for it.

The operator stops the old planner, as [Stop a session](operator-start.md#stop-a-session) of operator-start.md says. Then the operator starts the new planner `planner-<slug>` with the prompt of the handoff file as its first message, as [Start a session](operator-start.md#start-a-session) says. The first message names the path of the handoff file.
