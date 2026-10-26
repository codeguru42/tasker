# Handoff of the orchestrator

[docs/dev/handoff.md](handoff.md) gives the common steps of a handoff. This page gives only what differs for the
orchestrator.

## The long-running orchestrator

A long-running orchestrator is the orchestrator of a milestone that stays open while other sessions add issues to it,
for example "Docs" (see [docs/dev/planner.md](planner.md)). In a handoff, the old orchestrator gives its work to a new
orchestrator in a new session.

The rules of this page cover only a long-running orchestrator. An orchestrator of a numbered milestone stops when the
Todo column of its milestone is empty, as [Pick the tickets](pick-the-tickets.md#pick-the-tickets) says. The rules of
this page do not cover it.

A long-running orchestrator also reads the board with one recurring job, the board watch job. A new issue can arrive
when no ticket of the milestone runs. Then no landing comes, and no read of the board follows. On 2026-10-25,
orchestrator-docs read the board with a job at minute 7 and minute 37 of each hour.

The description of the CronCreate tool of Claude Code 2.1.310 (read by planner-docs on 2026-10-25) gives these facts:

- A job lives only in its session.
- A job fires only while the session is idle.
- A recurring job expires after 7 days. It fires one last time, and then the tool deletes it.
- CronCreate returns a job id that CronDelete takes.
- CronList lists the jobs of the session.

The board watch rule has these parts:

- The orchestrator makes the board watch job with CronCreate at the start of its session. On a start from the start
  prompt, it does this after the first doc read. On a start after a handoff, it does this after the check of the handoff
  folder, as [The start of the new orchestrator](#the-start-of-the-new-orchestrator) says. The job fires two times each
  hour, for example with the cron `7,37 * * * *`.
- The prompt of the job starts with "Board watch:". The rest of the prompt says: read the board, as
  [Pick the tickets](pick-the-tickets.md#pick-the-tickets) says.
- When the job fires, the orchestrator reads the board as the prompt says. It starts each ticket that the rules of Pick
  the tickets allow. The job changes none of these rules.
- A read by the job is a read of the board. It counts for each rule of Pick the tickets that acts "at its next read of
  the board" or "each time it reads the board". The priority rule applies to each start of the job. A read by the job is
  not a landing. As a result, it does not count for a read that a rule ties to a landing. An example is the read of the
  state of the parent issue in [the parent-hold rule](pick-the-tickets.md#the-parent-hold-rule).
- Each rule that stops a start wins over the job. Examples are the ban of [A failed CI run](ci-wait.md#a-failed-ci-run),
  a hold of the user and step 1 of [The steps of the old orchestrator](#the-steps-of-the-old-orchestrator). Another
  example is the ban on a new ticket after the suggestion of a handoff in [The landing count](#the-landing-count). While
  such a rule holds, the job still fires, and it starts no ticket.
- The orchestrator has at most one board watch job. It keeps the id of the job and the time of its CronCreate. Before it
  makes the job, it lists its jobs with CronList. If the list holds the kept id, it makes no second job. A quota job has
  another id, so it is not a board watch job.
- The id and the time live from the CronCreate of the job until the orchestrator deletes the job with CronDelete or the
  job expires. Before the first CronCreate, the orchestrator keeps no id and no time. When the list of CronList does not
  hold the kept id, the job ended, and the orchestrator drops the id and the time before it makes a new job.
- If CronList or CronCreate fails, [the failure rule](limits.md#the-failure-rule) applies, and the orchestrator has no
  board watch job. At each later landing, it tries again, CronList and then CronCreate, until it has a board watch job.
  With no board watch job, it reads the board at the other moments that the docs give, for example after each landing.
- When the job fires 6 days or more after the kept time, the orchestrator deletes it with CronDelete. Then it makes a
  new job, with CronList first. If CronDelete fails, the failure rule applies, and the retry after a failure makes a new
  job after the old job expires.
- At the start of a handoff, as [The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says, the
  orchestrator deletes the job with CronDelete, before step 1 of The steps of the old orchestrator. If CronDelete fails,
  the failure rule applies. The new orchestrator makes its own job. A session that ends with no handoff loses the job
  with the session.
- The board watch job is not a job of [Quota](quota.md#quota). [Delete the job](quota.md#delete-the-job) does not cover
  it. The step "delete the jobs" of step 2 of The steps of the old orchestrator does not cover it either. The job takes
  no slot.

## The landing count

The old orchestrator counts the landings of its session. Each of these also counts as one landing:

- A quota resume
- A new issue that the user asks the old orchestrator to send for drafting
- A decision of the user that takes several question rounds

An event adds to the count before any other step of that event. For a landing, the final report of the agent brings the
count to 12 before the steps of the bullet "When the final report of the agent of a ticket says that the ticket landed"
of [Land the work](land-the-work.md#land-the-work). So the read of the board of that landing starts no new ticket. For a
decision of the user that takes several question rounds, the answer of the user that ends the decision brings the count
up.

At a count of 12, the old orchestrator suggests a handoff to the user in its report of that landing. The report of a
landing (a landing report) is the reply in which the old orchestrator tells the user that a ticket landed. If a counted
event that is not a landing brings the count to 12, the old orchestrator suggests a handoff in a later reply. That reply
is its next reply to the user that does not answer a question of the user, for example the next landing report.

From the count of 12, the old orchestrator starts no new ticket. A new ticket is a ticket with no task yet. The start of
a stacked ticket is also the start of a new ticket. The tasks in flight continue. A quota resume and a retry of a task
in flight are not a new ticket.

Below the count of 12, the landing count bans no new ticket. A handoff can start below the count of 12, for example at
[a request of the user](handoff.md#the-suggestion-of-a-handoff). From the count of 12, the ban holds also before the
suggestion of a handoff. The suggestion can come in a reply, as the paragraph that starts "At a count of 12" says. It
can also come in an item to the operator, as [The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says.

The ban on a new ticket holds until the start of the handoff, as
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says. From the start, step 1 of
[The steps of the old orchestrator](#the-steps-of-the-old-orchestrator) and the paragraph after the steps hold. The
reason for this ban: each task in flight must land before the handoff file, as step 2 of "The steps of the old
orchestrator" says. So a new ticket delays the handoff. On 2026-10-25, orchestrator-docs sent the suggestion at the
landing count of 12 and started no new ticket until the go.

The reason that the ban starts at the count of 12: the steps of a landing can read the board before the landing report
goes out. So a ban that starts with the reply comes too late. On 2026-10-25, review 1 of #530 found that the landing of
count 12 can start a new ticket before its landing report.

In a new session after a handoff, the count starts again at 0.

The reason for the count: it leaves room for the session review and the handoff file before an automatic compaction. An
automatic compaction loses context. On 2026-10-24, the context size of orchestrator-docs was about 175k tokens after the
doc reads at the start, and about 400k after 15 landings (about 15k for a quiet landing). Three more landings, a quota
resume, the filing of one issue and several question rounds brought it to about 507k (about 30k for a busy landing). An
automatic compaction ran right after, and the session review and the handoff file then used about 30k to 50k tokens.

In an answer to [a question of the user](working-with-the-user.md#a-question-of-the-user), the old orchestrator suggests
a handoff only when the suggestion is relevant to that question. In a list of open questions or open items, the rule of
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) wins. A landing report is not such an answer.

## The steps of the old orchestrator

After the start, the old orchestrator does these steps:

1. Start no new ticket.
2. Wait until each task in flight lands. For each landing, do the usual steps: delete the jobs (see
   [Delete the job](quota.md#delete-the-job)), do [the re-read rule](doc-reads.md#the-re-read-rule), do the memory step
   of the bullet "When the final report of the agent of a ticket says that the ticket landed" of
   [Land the work](land-the-work.md#land-the-work) and do [the notice rule](doc-reads.md#the-notice-rule). The reason: a
   job lives only in the session of the orchestrator (see [Terms](quota.md#terms)). If a task is still in flight at the
   handoff, nobody resumes it after a quota stop.
3. Run the review rounds of the last bullet of [Pick the tickets](pick-the-tickets.md#pick-the-tickets), until a round
   finds nothing new. The user asked for this rule on 2026-10-17. Then write the handoff file, as
   [The handoff file](handoff.md#the-handoff-file) says.
4. Send the path of the handoff file to `operator-<slug>` as an item, as
   [The form of an item](operator-items.md#the-form-of-an-item) of operator-items.md says.

The handoff ends in the operator, as [The end of a handoff](handoff.md#the-end-of-a-handoff) and
[The stop and the start](handoff.md#the-stop-and-the-start) of handoff.md say. Until the end, the old orchestrator
starts no new ticket, also after step 4. On 2026-10-17, the Docs orchestrator saw that its handoff started too early. It
then started a new ticket without the word of the user.

## The handoff file of the orchestrator

The handoff file of the orchestrator holds the items of
[The items of a handoff file](handoff.md#the-items-of-a-handoff-file). The old orchestrator also puts these items in the
handoff file:

- The prompt names the milestone, the session name and the first step: the start of the re-read rule. The prompt also
  names the docs to read and the state at the handoff. Its last step is to watch the board for new issues, as
  [the board watch rule](#the-long-running-orchestrator) says.
- The state at the handoff: the tasks in flight of other milestones that share a file with an open issue of the
  milestone, the parked tasks and the other sessions.
- The number of each open broken-test issue that the old orchestrator knows of (see the broken-test rule in
  [A failed CI run](ci-wait.md#a-failed-ci-run)).
- What the old orchestrator did.
- A table of the open issues of the milestone, with the columns issue, topic, blockers and files.
- Each finding of the review rounds, with its state, handled or open.

The docs that the prompt names are docs of the orchestrator of [the re-read rule](doc-reads.md#the-re-read-rule).

## The start of the new orchestrator

The new orchestrator is `orchestrator-<slug>`. [The stop and the start](handoff.md#the-stop-and-the-start) applies. The
new orchestrator then starts with the re-read rule. Right after the first doc read, the new orchestrator does the check
of [The check of the handoff folder](handoff.md#the-check-of-the-handoff-folder). After that check, it makes its board
watch job, as [the board watch rule](#the-long-running-orchestrator) says.
