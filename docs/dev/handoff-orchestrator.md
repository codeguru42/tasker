# Handoff of the orchestrator

[docs/dev/handoff.md](handoff.md) gives the common steps of a handoff. This page gives only what differs for the
orchestrator.

## The long-running orchestrator

A long-running orchestrator is the orchestrator of a milestone that stays open while other sessions add issues to it,
for example "Docs" (see [docs/dev/issue-subagents.md](issue-subagents.md)). In a handoff, the old orchestrator gives its
work to a new orchestrator in a new session.

The rules of this page cover only a long-running orchestrator. An orchestrator of a numbered milestone stops at the stop
of the orchestrator in [The close of a milestone](operator-start.md#the-close-of-a-milestone). The rules of this page do
not cover it. A long-running orchestrator stops there too, after its close starts on the word of the user. A stop with
no handoff is not a handoff, and the rules of this page do not cover it, as
[A stop with no handoff](../orchestrator.md#a-stop-with-no-handoff) says.

The rules of this page also cover an orchestrator of a set scope, with the same landing count.
[The start of an orchestrator](../orchestrator.md#the-start-of-an-orchestrator) defines a set scope.

## The landing count

The old orchestrator counts the landings of its session. Each of these also counts as one landing:

- A quota resume
- A new issue that the user asks the old orchestrator to send for drafting
- A decision of the user that takes several question rounds

An event adds to the count before any other step of that event. For a landing, the final report of the task subagent
brings the count to 12. It does this before the steps of the bullet "When the final report of the task subagent of a
ticket says that the ticket landed" of [Land the work](land-the-work.md#land-the-work). So the read of the board of that
landing starts no new ticket. For a decision of the user that takes several question rounds, the answer of the user that
ends the decision brings the count up.

At the event that brings the count to 12, the old orchestrator asks the go question of a handoff in its question pane,
as [The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says. For a landing, it also shows its landing
report in its own tab. A landing report is the progress report in which the old orchestrator tells the user that a
ticket landed. A landing report carries no suggestion and no "hand off now", and it starts no handoff. If a counted
event that is not a landing brings the count to 12, for example a quota resume, the old orchestrator asks the go
question at that event. No progress report carries the suggestion.

From the count of 12, the old orchestrator starts no new ticket. A new ticket is a ticket with no task yet. The start of
a stacked ticket is also the start of a new ticket. The tasks in flight continue. A quota resume and a retry of a task
in flight are not a new ticket.

Below the count of 12, the landing count bans no new ticket. While the rule of
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) that starts "If the user says that no more
handoffs come" lasts, the landing count bans no new ticket, at any count. A handoff can start below the count of 12, for
example at [a request of the user](handoff.md#the-suggestion-of-a-handoff). From the count of 12, the ban holds also
before the suggestion of a handoff. The suggestion comes as a question in the question pane of the orchestrator, as
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says. The go of the user then comes in a decision
of that pane, and the handoff starts after the close of the pane.

During the close of a milestone, the landing count bans no new ticket, at any count. The reason:
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) bans each handoff during the close, so the ban of
the landing count has no end.

The ban on a new ticket holds until the start of the handoff, as
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says. From the start, step 1 of
[The steps of the old orchestrator](#the-steps-of-the-old-orchestrator) and the paragraph after the steps hold. The
reason for this ban: each task in flight, except a parked task, must land before the handoff file, as step 2 of "The
steps of the old orchestrator" says. So a new ticket delays the handoff. On 2026-10-25, orchestrator-docs sent the
suggestion at the landing count of 12 and started no new ticket until the go.

The reason that the ban starts at the count of 12: the steps of a landing can read the board before the landing report
goes out. So a ban that starts with the reply comes too late. On 2026-10-25, review 1 of #530 found that the landing of
count 12 can start a new ticket before its landing report.

In a new session after a handoff, the count starts again at 0.

The reason for the count: it leaves room for the session review and the handoff file before an automatic compaction. An
automatic compaction loses context. On 2026-10-24, the context size of orchestrator-docs was about 175k tokens after the
doc reads at the start, and about 400k after 15 landings (about 15k for a quiet landing). Three more landings, a quota
resume, the filing of one issue and several question rounds brought it to about 507k (about 30k for a busy landing). An
automatic compaction ran right after, and the session review and the handoff file then used about 30k to 50k tokens.

The old orchestrator shows each answer to [a question of the user](working-with-the-user.md#a-question-of-the-user) as a
progress report in its own tab. This also covers a question that reaches it with `From the user:`. The answer carries no
"hand off now", also at the count of 12. At that count, the go question of the paragraph that starts "At the event that
brings the count to 12" carries the suggestion. A landing report is not such an answer.

## The steps of the old orchestrator

After the start, the old orchestrator does these steps:

1. Start no new ticket.
2. Wait until each task in flight lands. This step leaves out a parked task. For each landing, do the usual steps:
   delete the jobs (see [Delete the job](quota.md#delete-the-job)), do
   [the re-read rule](doc-reads.md#the-re-read-rule), do the memory step of the bullet "When the final report of the
   task subagent of a ticket says that the ticket landed" of [Land the work](land-the-work.md#land-the-work), do
   [the notice rule](doc-reads.md#the-notice-rule) and do
   [the task subagent notice](doc-reads.md#the-task-subagent-notice). The reason: a job lives only in the session of the
   orchestrator (see [Terms](quota.md#terms)). If a task other than a parked task is still in flight at the handoff,
   nobody resumes it after a quota stop.
3. Run the rounds of [Session-review rounds](session-review-rounds.md). The user asked for this rule on 2026-10-17. Then
   write the handoff file, as [The handoff file](handoff.md#the-handoff-file) says.
4. Start the new orchestrator, and then close your own tab, as
   [The start of the new orchestrator](#the-start-of-the-new-orchestrator) says.

The handoff ends after step 4. The operator has no part in it. Until the end, the old orchestrator starts no new ticket,
also after step 4. On 2026-10-17, the Docs orchestrator saw that its handoff started too early. It then started a new
ticket without the word of the user.

## The handoff file of the orchestrator

The handoff file of the orchestrator holds the parts of
[The items of a handoff file](handoff.md#the-items-of-a-handoff-file). The old orchestrator also puts these parts in the
handoff file:

- The prompt names the scope, the path of the file, the session name, the first free item id (the number after the last
  id of a question or a progress report, as [The last item id](handoff.md#the-last-item-id) says) and
  [The start of the new orchestrator](#the-start-of-the-new-orchestrator). The first step of the prompt is the prompt
  read of [The items of a handoff file](handoff.md#the-items-of-a-handoff-file). The prompt also names each extra doc.
  An extra doc is a doc that the prompt of the old orchestrator named and that the fixed list of
  [the re-read rule](doc-reads.md#the-re-read-rule) does not hold.
- For a set scope, the prompt names each open issue of the set as it stands at the handoff. It uses the form of the
  first prompt of [The start of an orchestrator](../orchestrator.md#the-start-of-an-orchestrator).
- The number of each open broken-test issue that the old orchestrator knows of (see the broken-test rule in
  [A failed CI run](ci-wait.md#a-failed-ci-run)).
- A table of the open issues of the scope, with the columns issue, topic, blockers and files.
- The record of [the outside-Todo find](pick-the-tickets.md#pick-the-tickets), with one entry for each raised issue.
  Each entry gives the issue and its facts at the raise.
- Each open finding of the review rounds. A handled finding, as [Session-review rounds](session-review-rounds.md)
  defines it, leaves the file.
- The name, the tab id and the pane id of the old orchestrator. The tab id is `$HERDR_TAB_ID`, and the pane id is
  `$HERDR_PANE_ID`. The old orchestrator gets the two ids before it writes the file. If it cannot get the pane id, the
  file says so. The close of step 6 of [The start of the new orchestrator](#the-start-of-the-new-orchestrator) uses the
  same ids. The file gives no session ref of the old orchestrator.

## The start of the new orchestrator

After step 3 of [The steps of the old orchestrator](#the-steps-of-the-old-orchestrator), the old orchestrator does these
steps:

1. The old orchestrator reads the configuration, as steps 1 to 3 of
   [The steps of the user](../orchestrator.md#the-steps-of-the-user) say.
2. It opens a new herdr tab with `herdr tab create`, as step 2 of [Start a session](operator-start.md#start-a-session)
   says. The label is `orchestrator-<slug>`.
3. It keeps `.result.tab.tab_id` and `.result.root_pane.pane_id` of the output. They are the tab id and the pane id of
   the new orchestrator.
4. It starts the new orchestrator in the new pane with `herdr agent start`, as step 3 of "Start a session" says.
5. The old orchestrator makes sure that the new orchestrator runs. It runs `herdr pane read <pane id>` with the pane id
   of step 3.

   If the kind is `pi`, run the reads of
   [The start gate of a pi session](operator-start.md#the-start-gate-of-a-pi-session) after the `herdr pane read`. While
   the state is Pending, the old orchestrator closes nothing.

6. If the new orchestrator runs, the old orchestrator runs `herdr tab get "$HERDR_TAB_ID"` in its shell. If
   `.result.tab.pane_count` is 1, it runs `herdr tab close "$HERDR_TAB_ID"`. If the count is more than 1, it closes only
   its own pane with `herdr pane close "$HERDR_PANE_ID"`. This close is its last action. If the kind is `pi`, step 6
   starts only after the state Done.
7. The old orchestrator closes nothing, keeps its tab open and tells the user in each of these cases:

   - (a) `HERDR_TAB_ID` is not set.
   - (b) `HERDR_PANE_ID` is not set, so the old orchestrator cannot get the id of its own pane.
   - (c) `herdr tab get`, `herdr tab close` or `herdr pane close` fails.

8. If the new orchestrator does not run, the old orchestrator closes nothing. The same holds if a step of the start
   fails or the state of the gate is Failed. It tells the user in its own tab, with the command and the error.

In step 4, the herdr agent name is `orchestrator-<slug>-<time>`, and `-n` takes `orchestrator-<slug>`. `<time>` is the
time part of the name of the handoff file. Step 2 of
[The start of the new operator](handoff-operator.md#the-start-of-the-new-operator) gives this form and its reason. The
first prompt is the prompt of the handoff file, in one line. Step 5 uses `herdr pane read` and not `ListAgents`, because
two sessions have the name.

The old orchestrator keeps two tab ids: its own tab id, `$HERDR_TAB_ID`, and the tab id of the new orchestrator from
step 3. It closes itself by its own tab id. It does not use
[The own-session closure](operator-start.md#the-own-session-closure) or
[the pi row check](operator-start.md#the-pi-row-check) for this close. During a handoff, two rows have the own name, so
the row check of that section cannot pass.

In a handoff of an orchestrator, this rule wins over the bullet of "The own-session closure" about a session that the
user opened in a pane. That bullet says that such a session cannot close itself. So the old orchestrator that the user
started also closes itself by its tab id.

The new orchestrator is `orchestrator-<slug>`. Under `pi`, the name comes from `-n` and the session reads it before its
role work, so the prompt holds no name step. The new orchestrator does
[the start checks](../orchestrator.md#the-start-checks), with the rule for a first prompt that names a handoff file.

The new orchestrator then starts with the re-read rule. Right after the first doc read of the re-read rule, the new
orchestrator does the check of [The check of the handoff folder](handoff.md#the-check-of-the-handoff-folder). After that
check, it reads the tasks in flight with `tasker status`, also [the parked tasks](pick-the-tickets.md#the-defer-rule).
It reads the other sessions with `ListAgents`. Then it makes its board watch job, as
[the board watch rule](../orchestrator.md#the-board-watch-job) says. Then, before the pick of the first ticket, it reads
the record of [the outside-Todo find](pick-the-tickets.md#pick-the-tickets) from the handoff file and runs that find.

The record then lives in the session of the new orchestrator. The first find compares each issue outside Todo with that
record, as [the outside-Todo find](pick-the-tickets.md#pick-the-tickets) says.
