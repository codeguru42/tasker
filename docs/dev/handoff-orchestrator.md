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
the landing count has no end. For the orchestrator, the close starts with its report that the close started, as
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says.

The ban on a new ticket holds until the start of the handoff, as
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says. From the start, step 1 of
[The steps of the old orchestrator](#the-steps-of-the-old-orchestrator) and the paragraph after the steps hold. The
reason for this ban in the wait case: each task in flight, except a parked task, must land before the handoff file. Step
2 of "The steps of the old orchestrator" says this. So a new ticket delays the handoff. In the stopping-point case, a
new ticket adds a task to stop and to start again. The ban holds in both cases. On 2026-10-25, orchestrator-docs sent
the suggestion at the landing count of 12 and started no new ticket until the go.

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

After the start, the old orchestrator does these steps. Each step has one purpose and its own number, so that other docs
can name the step:

1. Start no new ticket.
2. Wait until each task in flight lands. This step leaves out a parked task. For each landing, do the usual steps:
   delete the jobs (see [Delete the job](quota.md#delete-the-job)), do
   [the re-read rule](doc-reads.md#the-re-read-rule), do the memory step of the bullet "When the final report of the
   task subagent of a ticket says that the ticket landed" of [Land the work](land-the-work.md#land-the-work), do
   [the notice rule](doc-reads.md#the-notice-rule) and do
   [the task subagent notice](doc-reads.md#the-task-subagent-notice). The reason: a job lives only in the session of the
   orchestrator (see [Terms](quota.md#terms)). If a task other than a parked task is still in flight at the handoff,
   nobody resumes it after a quota stop.

   In the stopping-point case, step 2 sends the stopping-point message in place of the wait for a landing, as
   [The stopping-point case](#the-stopping-point-case) says. In that case, the task subagent ends at its stopping point.
   The new task subagent gets its own jobs and its own slot at its start, as
   [The start of the new orchestrator](#the-start-of-the-new-orchestrator) says. The old jobs and the old slot end with
   the old orchestrator. A task subagent that did not end, for example after a failed send of the stopping-point
   message, stays under the wait case for its task, as [The failures](#the-failures) says. Before step 3, the old
   orchestrator also waits for each open pane and each write subagent, as
   [The panes and the write subagents](#the-panes-and-the-write-subagents) says.

3. Run the rounds of [Session-review rounds](session-review-rounds.md). The user asked for this rule on 2026-10-17.
4. After step 3 ended with a round that found nothing new, send each fact and each lesson, as the paragraph that starts
   "Before it writes the file" of [The items of a handoff file](handoff.md#the-items-of-a-handoff-file) says. Then, for
   an orchestrator of the kind `claude`, do the steps of
   [The wait before a handoff](planner-subagent.md#the-wait-before-a-handoff). Then write the handoff file in your own
   handoff folder, as [The handoff file](handoff.md#the-handoff-file) says.

   Before the write, read the data root and run `mkdir -p` on the folder, as
   [The orchestrator folder](limits.md#the-orchestrator-folder) says. If one of these calls or the write fails, follow
   [the failure rule](limits.md#the-failure-rule). Then start no new orchestrator, keep your tab open and tell the user.
   While the bar of the fallback holds, wait for the next word of the user before the write.

5. After step 4 wrote the file, start the new orchestrator, as
   [The start of the new orchestrator](#the-start-of-the-new-orchestrator) says. That section also covers a failed
   start.
6. Close your own tab, as [The start of the new orchestrator](#the-start-of-the-new-orchestrator) says. That section
   also covers a failed close.

The handoff ends after step 6. The operator has no part in it. Until the end, the old orchestrator starts no new ticket,
also after step 6. On 2026-10-17, the Docs orchestrator saw that its handoff started too early. It then started a new
ticket without the word of the user.

## The stopping-point case

A handoff has two cases. In the wait case, step 2 of
[The steps of the old orchestrator](#the-steps-of-the-old-orchestrator) waits for each task in flight to land. In the
stopping-point case, each task subagent for a whole ticket comes to a stopping point, and the question session of the
open pane gives its pane handoff. The new orchestrator then starts a new task subagent for each task and asks the
question of the pane again. The wait case is the default, and step 2 keeps its rule there.

The terms of this case are:

- A stopping point of a task subagent is step 1 of [the defer rule](pick-the-tickets.md#the-defer-rule). The task
  subagent ends its work after its current `tasker` command ends and runs no other `tasker` command. It removes the task
  worktree as [the own-worktree rule](limits.md#the-own-worktree-rule) says, and the task keeps its state. Then it gives
  its final report. The case reuses step 1 because that step ends the work and keeps the task in its state, and
  [the comeback rule](run-one-ticket.md#the-comeback-rule) starts from that state.
- A stopping point is not a stop of [the answer-wait rule](limits.md#the-answer-wait-rule), because after a stopping
  point the task subagent waits for no answer.
- The stopping-point message is the message of the old orchestrator that asks a task subagent to come to its stopping
  point.
- The stopping-point report is the final report of the task subagent after it came to its stopping point.

The old orchestrator moves no milestone and no card, posts no `## Parked task` comment and removes no link. The card
stays in In progress, so the task is not a parked task.

### The choice of the case

The old orchestrator judges whether words of the user ask for a stopping point. This judgment is open on purpose. If the
old orchestrator is not sure, the wait case holds, and it tells the user in its tab that it waits for each landing.

The word of the user can come in these ways:

- The user gives the word with the request for the handoff, or during step 2. Then the case holds from that word on, for
  each task that did not land yet and for each open pane. After step 2 ends, the word changes nothing for the tasks.
- The user gives the word in a decision message of a question pane. The message counts as a word of the user. The go of
  the handoff waits for the close of that pane. That pane closes after its rounds as today and gets no pane handoff.

The case covers each task subagent for a whole ticket and the open question pane. Each other subagent runs to its end,
for example a task subagent for one task change, a planner subagent and a write subagent.

A request for a handoff at the close of a milestone follows
[The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff). Its close rule also holds for a word of the
stopping-point case. The rules of this case hold for each kind of orchestrator that hands off. No one measured the
message to a task subagent for a Codex or a pi orchestrator, as the next sections say. With no open pane, the pane
handoff has nothing to do.

### The stopping-point message

In the stopping-point case, step 2 sends the stopping-point message to each task subagent for a whole ticket of a task
in flight. A parked task stays out. The task subagent reads the handoff docs at no step, so the message gives these
facts:

- The stopping point is a part of a handoff.
- The task subagent gets no answer and no next step after the message.
- The interim report of each stop names the stopping point and what stays behind.
- The stopping-point report lists the files that the work of the task changed so far.

In Claude Code, a message to a task subagent that ended its turn starts it again, as [Terms](quota.md#terms) says. So
the message also reaches a task subagent that waits for a quota job or for an answer. That task subagent runs no
`tasker` command and ends its work. A Codex orchestrator sends the message with its native subagent tools, as
[The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) says. No one measured whether such a
message starts an ended Codex task subagent again. No one measured the task subagents of a pi orchestrator.

### The wait and the reports

The old orchestrator waits for the stopping-point report of each task subagent with no time limit, as for a landing. An
interim report does not end the wait, apart from the interim report of the next paragraph. For each other interim
report, the old orchestrator frees no slot and deletes no job, as [the answer-wait rule](limits.md#the-answer-wait-rule)
says.

A step of the stopping point can stop, for example a failed remove of the task worktree or a failed delete of the local
task branch, at which the own-worktree rule stops. That interim report names the stopping point, ends the wait and
counts as the stopping-point report. The entry says that the task subagent stopped and gives what stays behind, for
example the path of the task worktree and the local task branch. The old orchestrator tells the user in its tab and
sends no next step.

A stopping-point report that says that the ticket landed is a landing. The steps of step 2 for a landing apply, and the
task gets no entry.

After each other stopping-point report, the old orchestrator deletes the jobs and frees the slot, as the bullet "If a
task subagent stops for another reason" of [Delete the job](quota.md#delete-the-job) says. From the send of the
stopping-point message on, no job of that task subagent sends a resume message and no job schedules a next job. When
such a job fires, the old orchestrator tells the user in one line in its tab. The reason: a job fires while the
orchestrator is idle, and a resume message starts the task subagent again after its stopping point.

Each fact and each lesson of a stopping-point report goes to the send of the paragraph that starts "Before it writes the
file" of [The items of a handoff file](handoff.md#the-items-of-a-handoff-file), as for each final report. The task keeps
its state, and the old orchestrator sends no task change for it.

From the send of the message on, the old orchestrator sends no answer and no next step to that task subagent. A settled
decision of a pane for a question of that task subagent goes into the entry with the words of the user. The same holds
for an answer that the user types in the tab of the old orchestrator. The question then stops being open. The reason: a
message starts the task subagent again, and it can then act on the answer after its stopping point.

### The end with no report

A task subagent can end with no stopping-point report, or no report can come at all. In Claude Code, the old
orchestrator learns of an end with no report from the end notification of Claude Code.
[The wait for a report](planner.md#the-wait-for-a-report) defines that notification for an agent that a planner or a
ticket subagent starts. No one measured it for a task subagent of an orchestrator, or for a Codex or a pi orchestrator.

At the end notification, the wait for that task ends. With no end notification, only a word of the user ends the wait.
If no report comes, the user can tell the old orchestrator to go on. The old orchestrator then tells the user that a
task subagent with no report can still run a `tasker` command. After each end of the wait, the old orchestrator does the
steps of [The wait and the reports](#the-wait-and-the-reports) for that task subagent. The entry says "no report". The
new task subagent of that entry follows the comeback rule from `tasker show <issue>`.

### The panes and the write subagents

Each pane of the old orchestrator that is open before step 3 gets its pane handoff or its usual close before step 3.
This also holds for a pane that a word of the user starts during step 2. The pane handoff is the handoff of the pane
that [The pane handoff](question-pane.md#the-pane-handoff) defines. The stopping-point messages and the pane handoff can
run at the same time.

The old orchestrator waits for the report of each write subagent of a decision message that it accepts before the pane
handoff. If such a write subagent ends with no report, the old orchestrator tells the user that the results are not
known, as [The pane owner handles a decision](question-pane.md#the-pane-owner-handles-a-decision) gives, and the handoff
goes on. A task change of such a message for a task after its stopping-point message does not go out. The entry gives it
with the words of the user, as for an answer. A running write subagent still holds the start of the handoff.

The pane must close before step 3. If the close fails with `pane_not_found`, the pane is gone. If the close fails in
another way, the old orchestrator tells the user in its tab. It starts the new orchestrator only after the user says
that the pane is closed.

During a handoff, each text of this case that waits for a word of the user goes in the tab of the old orchestrator. It
does not go to a question pane. [The operator](working-with-the-user.md#the-operator) gives the usual rule.

### The steps that are not new work

These steps are steps of the handoff, not new work, for the rule of
[The end of a handoff](handoff.md#the-end-of-a-handoff):

- The stopping-point messages
- The pane handoff request and the write of the pane handoff file
- The usual steps of a decision message that the old orchestrator accepts before the pane handoff, also its write
  subagent
- The close of the pane

### The failures

All failures follow [the failure rule](limits.md#the-failure-rule). Each failure has its home:

- The send of a stopping-point message fails. The old orchestrator tells the user. For that task, the wait case holds:
  step 2 waits until the task lands, and the old orchestrator answers the task subagent as today. It sends no second
  message on its own. On a word of the user, it sends the message again. The reason: the task subagent can still run
  `tasker` commands, so the task gets no entry and no new task subagent while it runs.
- A task subagent ends with no report. [The end with no report](#the-end-with-no-report) gives the steps.
- The delete of a job fails for a task subagent that came to a stopping point. The job stays, as
  [Delete the job](quota.md#delete-the-job) says. If it fires, the rule of
  [The wait and the reports](#the-wait-and-the-reports) applies. The job ends with the session of the old orchestrator.
- A pane fails. [The pane handoff](question-pane.md#the-pane-handoff) gives these failures. A failed close other than
  `pane_not_found` is in [The panes and the write subagents](#the-panes-and-the-write-subagents).
- The new orchestrator fails. [The start of the new orchestrator](#the-start-of-the-new-orchestrator) gives these
  failures.
- A step of the stopping point stops. [The wait and the reports](#the-wait-and-the-reports) gives the steps.

### The events

| Event                                                                        | Old orchestrator                                                                                                                                                                     | Task subagent                                       | New orchestrator                                               | Who tells whom                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A word of the user asks for a handoff                                        | Judges the case, then starts step 2                                                                                                                                                  | Running, or ended and waiting                       | Not started                                                    | The user tells the old orchestrator                                                                          |
| The old orchestrator is not sure of the case                                 | Uses the wait case and tells the user in its tab                                                                                                                                     | Runs its work                                       | Not started                                                    | The old orchestrator tells the user                                                                          |
| The stopping-point message goes out                                          | Waits for the stopping-point report. Sends no answer to that task subagent                                                                                                           | Ends its current `tasker` command and runs no other | Not started                                                    | The old orchestrator tells the task subagent                                                                 |
| The send of the stopping-point message fails                                 | Keeps the wait case for that task and answers the task subagent as today, as The failures says                                                                                       | Running                                             | Not started                                                    | The old orchestrator tells the user in its tab                                                               |
| An interim report names the stopping point                                   | Ends the wait. Deletes the jobs and frees the slot. Makes the entry that says that the task subagent stopped and what stays behind. Tells the user in its tab and sends no next step | Stopped                                             | Not started                                                    | The task subagent tells the old orchestrator. The old orchestrator tells the user                            |
| Another interim report arrives after the message                             | Frees no slot, deletes no job and keeps the wait                                                                                                                                     | Ends its turn                                       | Not started                                                    | The task subagent tells the old orchestrator                                                                 |
| A job of the task subagent fires after the message                           | Sends no resume message. Schedules no next job. Tells the user in one line                                                                                                           | Gets nothing                                        | Not started                                                    | The old orchestrator tells the user in its tab                                                               |
| The stopping-point report arrives                                            | Deletes the jobs, frees the slot, makes the entry, sends the facts                                                                                                                   | Ended                                               | Not started                                                    | The task subagent tells the old orchestrator, and the old orchestrator tells the planner of the orchestrator |
| The stopping-point report says that the ticket landed                        | Does the steps of step 2 for a landing. Makes no entry                                                                                                                               | Ended                                               | Not started                                                    | The task subagent tells the old orchestrator                                                                 |
| A task subagent ends with no report, or the user says to go on               | Deletes the jobs and frees the slot. Makes the entry "no report". Tells the user that the task subagent can still run a `tasker` command                                             | Ended, or not known                                 | Not started                                                    | Claude Code or the user tells the old orchestrator. The old orchestrator tells the user                      |
| A settled answer arrives for a question of a task subagent after the message | Sends nothing to the task subagent. Puts the answer in the entry with the words of the user                                                                                          | Gets nothing                                        | Not started                                                    | The question session or the user tells the old orchestrator                                                  |
| Step 3 and the write of the handoff file end                                 | Starts the new orchestrator, then closes its own tab                                                                                                                                 | Ended                                               | Starts                                                         | The old orchestrator tells the new orchestrator, with the file                                               |
| The new orchestrator ends its start steps                                    | Closed                                                                                                                                                                               | Ended                                               | Starts a new task subagent for each entry                      | The new orchestrator tells the new task subagent                                                             |
| A new task subagent starts                                                   | Closed                                                                                                                                                                               | New. Follows the comeback rule                      | Gives it its own jobs and the free slot with the lowest number | The new orchestrator tells the new task subagent, with the entry in the prompt                               |

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
- In the stopping-point case, [the task list](#the-task-list).
- For each question that got a pane handoff, the link to the pane handoff file next to the question id. The link is
  relative, and its target is only the name of the file. If the write of the pane handoff file failed, the handoff file
  holds the pane handoff itself in place of the link. Each write action and metadata request of a pane handoff that did
  not run stands in the handoff file with the mark "not run", as a decision of the user that still applies. A question
  with a question file stays in its question file. A question with no file keeps its full text in the handoff file, as
  [The items of a handoff file](handoff.md#the-items-of-a-handoff-file) says.
- The list of the questions with no automatic start. The list gives the question id and the reason of each open question
  with no automatic start, as [Terms](question-pane.md#terms) defines it. The reason is the rule that gives the question
  no automatic start, for example a **No decision** message or a close of the pane with no decision. If a question of
  the same list in the handoff file of the own start is still open, the list also gives that question. The list gives no
  text of a question. For a question with no file, the handoff file already holds its full text, and the list adds its
  reason.

The handoff file holds no text and no list of the open questions that have a
[question file](question-pane.md#the-question-file), apart from one list. That list holds only the question id and the
reason of each question with no automatic start. It holds no list of the requests that have a
[proposal file](planner-subagent.md#the-proposal-file). It holds the full text of each question with no file. It gives
no path of the three folders. The new orchestrator makes that path itself from the data root, the repo key and its own
slug.

After the write of its handoff file, the old orchestrator writes no new file in the three folders and gives no new
question id. A question that reaches it after the write gets no question file. The old orchestrator shows the full text
of that question as a report in its tab.

A close of a pane by the old orchestrator is not a close by the user with no decision. An example is the close of a pane
at its pane handoff, as [The pane handoff](question-pane.md#the-pane-handoff) says. Such a question does not go in the
list. The mark of no automatic start lives only in the handoff file. No question file and no other record of the
questions gets the mark.

The list of the questions with no automatic start follows the time at which a question gets its reason:

- Before the write of the handoff file, the question goes in the list.
- After the write and before the close of the old orchestrator, the old orchestrator does not change its handoff file.
  The new orchestrator already reads the file. A pane that opened during the handoff gets a **No decision** message or a
  close with no decision in some cases. For such a question, the old orchestrator shows the question id and the reason
  as a report in its tab. It does the same for a question that reaches it after the write. The new orchestrator does not
  get this mark, and this is a known limit: such a question gets an automatic start again after the handoff.
- After the close of the old orchestrator, no orchestrator accepts a decision message of that pane, as
  [Start](question-pane.md#start) says. Nothing goes in a list, and nobody shows a report.

### The task list

The task list is a part of the handoff file in the stopping-point case only. In the wait case, the handoff file holds no
task list. It has one entry for each task in flight that is not a parked task, at the write of the handoff file. A task
that landed has no entry.

An entry gives these items:

- The issue key
- The state of the task from its stopping-point report
- Each item of the stopping-point report apart from the lessons, because the lessons already went to the send: each
  dismissed finding, each edge case, each claim of the issue that was no longer true and each `tasker retry` of the
  verify-failure rule
- Each task worktree or local task branch that stays, with its path
- For a stacked task, the start base of the last read, or the words that the task subagent held no start base
- Each answer of [The wait and the reports](#the-wait-and-the-reports), also a task change of
  [The panes and the write subagents](#the-panes-and-the-write-subagents), with the words of the user
- The files that the work of the task changed so far

If the report gives no list of files, the entry says that the diff of the task branch gives the files, as
[The overlap rule](land-the-work.md#the-overlap-rule) reads the files of a task. The reason: the new task subagent and
the user see the scope of the work so far. If an entry has no stopping-point report, it says "no report", as
[The end with no report](#the-end-with-no-report) says.

The new orchestrator sends no message to a task subagent of the old orchestrator. Each task subagent of an entry ended
before the write, or the user told the old orchestrator to go on. An entry names no session. A path of a task worktree
in an entry is a place in the file system, not a name of a session.

## The start of the new orchestrator

After step 4 of [The steps of the old orchestrator](#the-steps-of-the-old-orchestrator), the old orchestrator does the
steps below. Steps 1 to 5 and 8 below are step 5 of The steps of the old orchestrator. Steps 6 and 7 below are step 6 of
The steps of the old orchestrator. The steps are:

1. The old orchestrator reads the configuration, as steps 1 to 3 of
   [The steps of the user](../orchestrator.md#the-steps-of-the-user) say.
2. It opens a new herdr tab with `herdr tab create`, as step 2 of
   [The start of a herdr session](../sessions.md#the-start-of-a-herdr-session) says. The label is `orchestrator-<slug>`.
3. It keeps `.result.tab.tab_id` and `.result.root_pane.pane_id` of the output. They are the tab id and the pane id of
   the new orchestrator.
4. It starts the new orchestrator in the new pane with `herdr agent start`, as step 3 of
   [The start of a herdr session](../sessions.md#the-start-of-a-herdr-session) says.
5. The old orchestrator makes sure that the new orchestrator runs. It runs `herdr pane read <pane id>` with the pane id
   of step 3.

   If the kind is `pi`, run the reads of [The start gate of a pi session](../sessions.md#the-start-gate-of-a-pi-session)
   after the `herdr pane read`. While the state is Pending, the old orchestrator closes nothing.

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

The start checks can read the handoff file of the first message with a Read call. This read can come before the read of
the data root, as [The orchestrator folder](limits.md#the-orchestrator-folder) says.

The new orchestrator then starts with the re-read rule. Right after the first doc read of the re-read rule, the new
orchestrator does the check of [The check of the handoff folder](handoff.md#the-check-of-the-handoff-folder). Right
after that check, at the end of its start steps, it lists `questions/` and `proposals/`, as
[The orchestrator folder](limits.md#the-orchestrator-folder) says. It reads no question file at its start.

After these lists, it reads the tasks in flight with `tasker status`, also
[the parked tasks](pick-the-tickets.md#the-defer-rule). It reads the other sessions with `ListAgents`. Then, if all
[the start checks](../orchestrator.md#the-start-checks) passed, it makes its board watch job, as
[the board watch rule](../orchestrator.md#the-board-watch-job) says. The first read of the board can delete the job, as
[A ticket that waits for a slot](../orchestrator.md#a-ticket-that-waits-for-a-slot) says. If a start check stopped it,
it makes no job. An example is a stop by step 3 for a row of `herdr agent list` with the own name and a tab id that is
not the tab id of the handoff file. Then, before the pick of the first ticket, it reads the record of
[the outside-Todo find](pick-the-tickets.md#pick-the-tickets) from the handoff file and runs that find.

The record then lives in the session of the new orchestrator. The first find compares each issue outside Todo with that
record, as [the outside-Todo find](pick-the-tickets.md#pick-the-tickets) says.

If the handoff file holds [the task list](#the-task-list), the new orchestrator starts one new task subagent for each
entry. It does this after its start steps and before the pick of its first new ticket. The reason: an orchestrator has
three slots, as [The delay of each task subagent](quota.md#the-delay-of-each-task-subagent) says. A task of the list
already holds work, so a new ticket does not take its slot. The new orchestrator asks the user nothing about the entry,
as the exception of "The In progress case" in [Pick the tickets](pick-the-tickets.md#pick-the-tickets) says. The steps
are:

1. If `tasker status` does not list the task of an entry in flight, start no task subagent for it, and tell the user in
   one line in the tab.
2. Read `tasker show <issue>` for the ticket of the entry.
3. Make the session name from the issue key, as the naming bullet "One task subagent runs one ticket" of
   [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) gives it. An example is
   `codeguru42-tasker-108` for `codeguru42/tasker#108`. Then add the suffix `-h<date><time>`. The digits come from the
   date and the time in the name of the handoff file. An example is `codeguru42-tasker-108-h202611221505`. The prompt
   says that the name has a suffix.
4. The task worktree of the new name is `../tasker-worktrees/<session name>`, as the folder bullet of
   [Limits](limits.md#limits) says. Compare it with each path of a task worktree that the entry gives. If two paths are
   the same, add `-2` to the suffix. The new suffix gives a new name and so a new path. The comeback rule finds a task
   worktree that stays through the branch-exists case of [the own-worktree rule](limits.md#the-own-worktree-rule).
5. Start the task subagent. The prompt gives the context of the first bullet of "The prompt of a task subagent", the
   state from `tasker show <issue>`, the entry and each answer of the entry. The task subagent follows
   [the comeback rule](run-one-ticket.md#the-comeback-rule). If the base holds a template file for the prompt of a
   second task subagent for the same ticket, the entry reaches the prompt through that template.
6. Give the new task subagent the free slot with the lowest number, as "The delay of each task subagent" says. Schedule
   its jobs as [Schedule a job when a task subagent starts](quota.md#schedule-a-job-when-a-task-subagent-starts) says. A
   rule that passes the slot and the jobs of an old session to a second session does not apply across a handoff, for
   example the second-session bullet of [Delete the job](quota.md#delete-the-job) and the sentence of the naming bullet
   that moves the quota jobs. The old jobs and the old slot end with the old orchestrator, because a job lives only in
   the session of the orchestrator ([Terms](quota.md#terms)).

An open question of a task subagent that came to a stopping point stays open in the handoff file, or in its question
file. The new orchestrator sends its answer to the new task subagent of the same ticket. If that task subagent did not
start yet, its prompt gives the answer.

If the entry says "no report", the new task subagent starts from the state that `tasker show <issue>` gives. If the read
of `tasker status` or of `tasker show <issue>` for an entry fails, the new orchestrator starts no task subagent for that
entry. It asks the user in its pane whether it starts it, as an open question of [Start](question-pane.md#start). If the
start of a new task subagent fails, for example a refused Agent call, the task stays in flight with no task subagent.
The new orchestrator asks the user in its pane whether it starts it again, in the same way.

If the handoff file links a pane handoff file next to a question id, the question of the pane stays open in its question
file, or in the handoff file for a question with no file. During the handoff, it gets no automatic start. The new
orchestrator asks the question in its own pane under the rules of [Start](question-pane.md#start). Before the pane
start, it reads the pane handoff file. [The pane handoff](question-pane.md#the-pane-handoff) gives the first-reply text.
If it cannot read the pane handoff file, it starts the pane with the full text from the question file or the handoff
file. The first-reply text then says that the talk of the old pane is not known.

The new orchestrator gives no automatic start to any open question of the list, as the old orchestrator did. A word of
the user that names such a question still starts its pane. A [start word](question-pane.md#terms) for a ticket that the
question holds also starts its pane, as [Start](question-pane.md#start) says.

An answer can name the id of a question of the old session, as [The last item id](handoff.md#the-last-item-id) says.
Then the new orchestrator takes the question from its [question file](question-pane.md#the-question-file). A question
with no file comes from the handoff file. If no question file has that id and the handoff file does not hold it, the
question is not open. The new orchestrator then tells the user.

If the read of the question file fails, the fallback of The orchestrator folder applies. The new orchestrator then tells
the user that it cannot read the question of that id.

### The report of the questions with no automatic start

After its start steps, the new orchestrator tells the user about each open question with no automatic start. It does
this only if each of [the start checks](../orchestrator.md#the-start-checks) passed. A session whose start check failed
makes no report. The report comes before the first pane start and before the pick of the first ticket. If the
orchestrator finds no open question with no automatic start, it makes no report.

The report covers each open question of the list of the questions with no automatic start in the handoff file. It also
covers each other open question with no automatic start that [The question file](question-pane.md#the-question-file)
gives. For each question, the report gives the question id, the question in a few words and the reason. If the question
holds the start of a ticket, the report names that [held ticket](question-pane.md#terms). The report also says that a
word of the user that names the question starts its pane. A start word for the held ticket also starts it.

The report is a progress report, as [The operator](working-with-the-user.md#the-operator) says. The report starts no
pane and no wait. It does not lift the rule of no automatic start of a question.

For the report, the new orchestrator lists `questions/` and reads the question file of each question of the report.
These reads come after its start steps. So they are no exception to the sentence "It reads no question file at its
start" above. For a question with no file, the orchestrator uses the text of the handoff file. An id of the list that is
not an open question at the read stays out of the report.

If a read for the report fails, the fallback of [The orchestrator folder](limits.md#the-orchestrator-folder) applies.
The report then names each question whose read failed, with its id. A failed read drops no question from the report.

The reason: on 2026-11-22, the user asked orchestrator-m31 to start a ticket next. An open question held the start of
that ticket, and that question got no automatic start. The handoff file of that day named the question as a question
with no automatic start. But no rule told the new orchestrator to tell the user. So the list alone does not fix the
case. The case also needs this report and the start-word rule of [Start](question-pane.md#start).

The user said: "oh, I didn't know there was an open question about 973". The user also said: "and you didn't open that
question first after the handoff...".
