# Quota jobs

The readers of this page are the orchestrator, and the task subagent for "What the task subagent does".

## Quota

The quota belongs to the whole account. If a task stops in `quota_blocked`, the orchestrator and all the task subagents
also have no tokens. No session can act until the quota resets. For this reason, the orchestrator must plan the resume
before the quota runs out. The orchestrator does this with up to two cron jobs for each task subagent: a five-hour job
and a seven-day job.

### Terms

- The reset time is the time when the quota of the account becomes available again. The quota resets at the exact reset
  time.
- A cron job (a job, on [the orchestration pages](../orchestrator.md)) is a prompt that the orchestrator schedules for a
  time. A one-shot job fires one time and then deletes itself. A job fires only while the orchestrator is idle. A job
  lives only in the session of the orchestrator. The board watch job of a long-running orchestrator is not a job of
  these rules (see [the board watch rule](handoff-orchestrator.md#the-long-running-orchestrator)).
- The five-hour job is the job for the five-hour reset time, or the job of
  [the interrupted rule](#when-there-is-no-reset-time-yet). The seven-day job is the job for the seven-day reset time.
  On [the orchestration pages](../orchestrator.md), "a task subagent has a job", "has no job" and "a task subagent
  without a job" mean the five-hour job. With no five-hour window (see the bullet below that starts "The case of the
  account"), a seven-day job that has not fired also counts as the job. In the other two cases, a seven-day job alone
  does not count.
- A subagent is running while it works on its turn. A subagent has ended when its turn is over, for example after a
  tasker command stops in `quota_blocked` or `interrupted`. A message to an ended subagent starts it again, and the
  subagent keeps its context. A login expiry also ends the session of the subagent itself, with the error
  `Login expired · Please run /login`. After the user logs in again, the orchestrator resumes the task subagent with a
  message.
- `tasker show-quota` prints the last quota event of each repo as a JSON list. It has no `--json` flag. Each entry has
  `repo`, `provider`, `receivedAt` and `event`. `event` is the raw `rate_limit_event` of the assistant. For example:

  ```json
  [{"repo":"codeguru42/tasker","provider":"claude-code","receivedAt":"2026-10-12T00:23:23.713Z",
    "event":{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"five_hour","resetsAt":1791778800,
      "unifiedWindows":{"five_hour":{"utilization":0.39,"resetsAt":1791778800},"seven_day":{"utilization":0.39,"resetsAt":1792206000}}}}}]
  ```

- To read the reset time, the orchestrator takes the entry with the latest `receivedAt`, because all repos share the
  quota of the account. Then it reads `event.rate_limit_info.unifiedWindows.five_hour.resetsAt`. The value is in Unix
  seconds. The orchestrator converts it with `date -d @<seconds>`. For example:

  ```bash
  tasker show-quota | jq -r 'max_by(.receivedAt).event.rate_limit_info.unifiedWindows.five_hour.resetsAt'
  ```

- The orchestrator reads the seven-day reset time from the same entry, at
  `event.rate_limit_info.unifiedWindows.seven_day.resetsAt`. The value is in Unix seconds. For example:

  ```bash
  tasker show-quota | jq -r 'max_by(.receivedAt).event.rate_limit_info.unifiedWindows.seven_day.resetsAt'
  ```

- The case of the account: each read of the reset time also reads the case, from the keys of `unifiedWindows` in the
  same entry. For example:

  ```bash
  tasker show-quota | jq -c '(max_by(.receivedAt).event.rate_limit_info.unifiedWindows // {}) | keys'
  ```

  | Latest entry                                                                | Case                                                                                                             |
  | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
  | No entry, or `unifiedWindows` has no `seven_day` key and no `five_hour` key | Not known. The present rules apply.                                                                              |
  | `unifiedWindows` has a `five_hour` key                                      | Five-hour window. The present rules apply. A `five_hour` reset time in the past still means "no reset time yet". |
  | `unifiedWindows` has a `seven_day` key and no `five_hour` key               | No five-hour window.                                                                                             |

  On 2026-10-31, on an account with no five-hour limit, the keys were `["seven_day"]`. The orchestrator keeps the case
  of its last read in its session, until the next read that gives a case. The handoff file does not hold it.

- The event is the last one that tasker saw, so its reset time can be in the past. A reset time in the past, a missing
  `five_hour` value, or no entry, means "no reset time yet". A seven-day reset time in the past, or no entry, means "no
  seven-day reset time yet".
- The assistant sends a quota event early in each run, also when the usage is low. As a result, a reset time of each
  window of the account is known soon after a run starts.
- If a task is in `quota_blocked`, `tasker show <issue>` prints the reset time of that stop in a line
  `resets at: <ISO time>`.

### The delay of each task subagent

Each running task subagent has a slot and a delay. The delay is the number of minutes between a reset time and the job
of the task subagent for that reset. The delays prevent a resume of all the task subagents at the same time.

- There are 3 slots, one for each task subagent that can run at the same time. Slot 1 has a delay of 0 minutes. Slot 2
  has a delay of 1 minute. Slot 3 has a delay of 2 minutes.
- If the reset time falls on :00 or :30, the delay of each slot is 1 minute longer: 1, 2 and 3 minutes. The cron
  scheduler can fire a one-shot job on :00 or :30 up to 90 seconds early. That fire is before the reset, so it has no
  tokens, and the job is then gone.
- The job time of a job is its reset time plus the delay of the task subagent. The reset time falls on a full 10
  minutes, for example 11:30. So the job time is a full minute.
- If the reset time is not a full minute, the orchestrator must round the job time up to the next full minute.
- When the orchestrator starts a task subagent, the orchestrator must give it the free slot with the lowest number.
- When the orchestrator schedules a job for a task subagent, a five-hour job or a seven-day job, it keeps the same slot.
- The task subagent keeps its slot until the orchestrator frees it, as "Delete the job" says. Then the next task
  subagent that starts takes the slot.

### Schedule a job when a task subagent starts

1. When the orchestrator starts a task subagent, the orchestrator must run `tasker show-quota` and read the reset time,
   as [Terms](#terms) says. The orchestrator also applies [the seven-day rule](#the-seven-day-rule).
2. If there is a reset time, the orchestrator must schedule a one-shot five-hour job for the job time of that task
   subagent. The orchestrator also follows [the schedule-all rule](#when-there-is-no-reset-time-yet). The orchestrator
   applies the [future-time rule](#schedule-a-job-when-a-task-subagent-starts) of this section.
3. If the task subagent has no job after steps 1 and 2, the orchestrator starts it without a job. The orchestrator tells
   the task subagent that it has no job. For example, there is no reset time before the first run in the project. "When
   there is no reset time yet" gives the next steps.
4. If a seven-day job alone counts as the job, the orchestrator starts the task subagent. The orchestrator tells it that
   it has a job.

- The future-time rule: right before each CronCreate, the orchestrator reads the current time with `date`. The rule
  covers each schedule of a five-hour job or a seven-day job (each job is a one-shot job). The seven places are step 2
  of this section, [the schedule-all rule](#when-there-is-no-reset-time-yet), [the seven-day rule](#the-seven-day-rule),
  [the earlier-reset rule](#when-there-is-no-reset-time-yet), [the interrupted rule](#when-there-is-no-reset-time-yet),
  the case of [When the job fires](#when-the-job-fires) for a task in `quota_blocked` whose `resets at:` time is in the
  future, and [The next job](#the-next-job). If the job time is later than the current time, the orchestrator schedules
  the job. If the job time is not later than the current time, the orchestrator schedules no job. Instead, it does the
  step that read the reset time again, one time: a new `tasker show-quota`, and [Terms](#terms) for the new reading. In
  the second run, each job time that is not later than the current time means "no reset time yet" for that five-hour
  job, or "no seven-day reset time yet" for that seven-day job. The step has no third run. The rules of that case apply,
  as each place says. The rule acts on one job at a time. The other jobs of the step that have a job time in the future
  get their job. If the second `tasker show-quota` fails, [the failure rule](limits.md#the-failure-rule) applies, and
  the orchestrator schedules no further job of that step.
- The step that read the reset time is one of three. The first is step 1 of this section, with steps 2 to 4. The second
  is the read of [The next job](#the-next-job) and the schedules after it, not the resume rule and not the CronDelete
  paragraph before it. The third is a read of [When there is no reset time yet](#when-there-is-no-reset-time-yet) after
  a run report, with the schedule-all rule and the seven-day rule. The second run skips each job that the first run
  made. Steps 3 and 4 run one time, after the last run of the step. Each job of the second run keeps the result that the
  future-time rule gives. A five-hour job gets "no reset time yet", and a seven-day job gets "no seven-day reset time
  yet". Then steps 3 and 4 test the job that the task subagent has at that time.
- Four places have their own order. The `resets at:` case reads no reset time with `tasker show-quota`, so it has no
  second run. Instead, a job time that is not later than the current time means that the stop has already reset, as that
  case says. The earlier-reset rule takes its job time from the `resets at:` line, so it has no second run. A job time
  that is not later than the current time means that the stop has already reset, as that rule says. The interrupted rule
  takes its reset time from the `date` read of the future-time rule, so it has no second run. In the replace path of the
  seven-day rule, the check runs before the CronDelete of the old job, as that rule says.
- The reason for this rule: on 2026-10-24 at 18:01:22, the orchestrator scheduled the five-hour job of #416 for 18:01,
  and the job did not fire (#431).
- When the orchestrator schedules a job, the prompt of the job must name the issue and the task subagent. The prompt
  must tell the orchestrator to do the steps of "When the job fires".
- The orchestrator must keep the id of each job of a ticket. A ticket has at most one five-hour job and one seven-day
  job.
- For a seven-day job, the orchestrator must keep the seven-day reset time of the job with its id.
- Each id, and the time stored with it, lives until its one-shot job fires or until CronDelete deletes it. A one-shot
  job deletes itself when it fires. After that, the ticket has no job of that kind.
- A job that has not fired is a job whose id still lives.

### The seven-day rule

Each time the orchestrator runs `tasker show-quota` and reads the reset time, as [Terms](#terms) says, the orchestrator
also reads the seven-day reset time and applies this rule. This holds whether or not a five-hour reset time exists.

- If the seven-day reset time is in the future, the orchestrator schedules a seven-day job for each task subagent that
  has none. The exception is a task subagent that the schedule-all rule leaves out (see
  [When there is no reset time yet](#when-there-is-no-reset-time-yet)). The reset can be far in the future. The job is a
  one-shot job for the job time of the seven-day reset. The delay and the rounding come from
  [The delay of each task subagent](#the-delay-of-each-task-subagent). The
  [future-time rule](#schedule-a-job-when-a-task-subagent-starts) applies before each schedule.
- The reason: after the seven-day quota runs out, no session has tokens for a later read. As a result, the orchestrator
  schedules the job at the first read that gives the time.
- The prompt of the job names the issue, the task subagent and the window `seven_day`. The prompt tells the orchestrator
  to do the steps of "When the job fires".
- If the ticket has a seven-day job that has not fired, and the seven-day reset time did not change, the orchestrator
  schedules no second one. To compare, the orchestrator uses the seven-day reset time that it stored with the job id.
- If the seven-day reset time changed, the orchestrator first applies the
  [future-time rule](#schedule-a-job-when-a-task-subagent-starts) to the new job time. If the orchestrator can schedule
  the new job, it deletes the old seven-day job with CronDelete, and then it schedules the new one. If not, the old job
  stays.

The rule has three failure cases:

- If `tasker show-quota` fails, or the `jq` read of `seven_day` gives `null`, there is no seven-day reset time yet. No
  seven-day job changes. If `tasker show-quota` itself fails, [the failure rule](limits.md#the-failure-rule) applies.
- If CronCreate of a seven-day job fails, the failure rule applies. The task subagent has no seven-day job. The next
  read tries again, because the rule schedules a seven-day job for each task subagent that has none.
- If CronDelete of the old seven-day job fails, the failure rule applies. The old job and its id stay. The orchestrator
  does not schedule the new job at that read. The next read tries again, because the time still differs.

### When there is no reset time yet

- Each task subagent must tell the orchestrator each time a tasker run ends. If a task subagent has no job, it must also
  tell the orchestrator each time a tasker run starts. The runs are `tasker plan`, `tasker refine`, `tasker execute`,
  `tasker review`, `tasker retry` and `tasker resume`.
- If the orchestrator gets a run-start report and the ticket already has a job that has not fired, the orchestrator does
  not schedule another job.
- While a task subagent has no job and the schedule-all rule does not leave it out, the orchestrator reads the reset
  time each time it reports a tasker run start. [Terms](#terms) gives the read steps. The orchestrator also reads the
  reset time each time any task subagent reports a tasker run end. If there is no reset time, nothing else changes.
- The schedule-all rule has two parts. The first part: the orchestrator schedules a job for each task subagent without a
  job. It does this each time it runs `tasker show-quota` and reads a reset time. The
  [future-time rule](#schedule-a-job-when-a-task-subagent-starts) applies before each schedule. The second part says
  which task subagent the rule leaves out, and until when. The rule leaves out a task subagent whose last job fired in a
  case of [When the job fires](#when-the-job-fires) that scheduled no new job for that task subagent. The orchestrator
  schedules no job for a left-out task subagent under the schedule-all rule or under the seven-day rule. A fire of
  either job, in a case that schedules no new job, leaves the task subagent out. If a case of "When the job fires" says
  that the orchestrator schedules the next job, the rule no longer leaves out the task subagent of the fired job. This
  applies from the start of [The next job](#the-next-job). As a result, that section schedules the next five-hour job,
  and the seven-day rule covers the task subagent at the read of that section. The task subagent stays left out until
  the orchestrator starts it or until the end condition above. "Schedule a job when a task subagent starts" covers a new
  start. A message to the task subagent does not end this. The rule also leaves out a task subagent whose slot the
  orchestrator freed, as [Delete the job](#delete-the-job) says. This lasts until the orchestrator starts it again, as
  "Schedule a job when a task subagent starts" says.
- When a task subagent had no job, the orchestrator tells it after it schedules a job. If the task subagent gets this
  message, it stops the run-start reports. It keeps the run-end reports. With no five-hour window, the seven-day rule
  can give a job to a task subagent with no job. Then the orchestrator also tells the task subagent that it has a job.
- The earlier-reset rule applies to each run-end report of a task in `quota_blocked`, while the seven-day job of its
  task subagent counts as the job. The report can be the final answer that ends the turn of the task subagent. The
  orchestrator runs `tasker show-quota` and `tasker show <issue>`, in this order. If another rule of this section
  already read `tasker show-quota` for this report, the orchestrator uses that read. Then exactly one of these cases
  applies:
  - If the case changed to a five-hour window, the bullet below that starts "A read can change" applies.
  - If the `resets at:` time is earlier than the seven-day reset time stored with the job id, the orchestrator schedules
    a five-hour job. The job time comes from that `resets at:` time and the delay of the task subagent. If the ticket
    has a five-hour job that has not fired, the orchestrator schedules no second one. The future-time rule applies, in
    its own order. If the job time is not later than the current time, the stop has already reset. Then the orchestrator
    does the steps of the first case of "When the job fires": the resume message, then "The next job".
  - In each other case, nothing changes.
- The interrupted rule applies to each report that a `tasker` command stopped in `interrupted`, while the seven-day job
  of the task subagent counts as the job. The report can be the final answer that ends the turn of the task subagent.
  The orchestrator runs `tasker show <issue>`. If `tasker show` fails, [the failure rule](limits.md#the-failure-rule)
  applies, and the orchestrator goes on as if the task is in `interrupted`. If the task is not in `interrupted`, nothing
  changes. If the ticket has a five-hour job that has not fired, the orchestrator schedules no second one.

  In each other case, the orchestrator schedules a five-hour job. The reset time of this job is five hours after the
  `date` read of the future-time rule. The job time comes from that time and the delay of the task subagent. The case of
  `interrupted` in [When the job fires](#when-the-job-fires) then sends the resume message. A task in `interrupted`
  waits for no reset. As a result, one five-hour job is enough.

- A read can change the case of the account. If a read shows that the case changed from no five-hour window to a
  five-hour window, a seven-day job alone does not count any more. The orchestrator tells each task subagent with no
  five-hour job that it has no job. Then the schedule-all rule applies to the read.

  | Before the read     | After the read      | Result                                                                                                                                                                                               |
  | ------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Not known           | No five-hour window | The orchestrator applies the seven-day rule first. If the task subagent then has a seven-day job, the orchestrator tells it that it has a job.                                                       |
  | Not known           | Five-hour window    | The present rules apply.                                                                                                                                                                             |
  | No five-hour window | Five-hour window    | The first sentences of this bullet apply.                                                                                                                                                            |
  | Five-hour window    | No five-hour window | A five-hour job that has not fired stays. A seven-day job that has not fired counts as the job. The orchestrator tells each task subagent that had no job and has a seven-day job that it has a job. |

- If the orchestrator must tell a task subagent that it has a job or that it has no job, and the task subagent is
  running, the orchestrator tells it at once. If the task subagent has ended, the orchestrator does not send a message
  only for this. The orchestrator puts this information in the next message that it sends to that task subagent, for
  example the resume message.
- If the quota runs out before the orchestrator schedules a job, no job resumes the task subagent. In that case, the
  orchestrator tells the user when the orchestrator has tokens again.

### When the job fires

When a seven-day job fires, the orchestrator first runs CronList. The orchestrator deletes with CronDelete each job of
the ticket whose time is in the past. After the delete, the ticket has no job of that kind, as
[Schedule a job when a task subagent starts](#schedule-a-job-when-a-task-subagent-starts) says for a deleted id. Then
the orchestrator does the steps of this section one time. The reason is that the time of such a job can fall inside a
stop of the seven-day window. No session has tokens then, so the job does not fire. Such a job can fire late, next to
the seven-day job, and send a second resume message. If CronList or CronDelete fails,
[the failure rule](limits.md#the-failure-rule) applies. Then the orchestrator does the steps of this section.

When a job of a ticket fires, a five-hour job or a seven-day job, the orchestrator runs `tasker status --issue <issue>`
and `tasker show <issue>`. Apart from the CronList step of the paragraph above, the steps are the same for both jobs.
Then exactly one of these cases applies:

- If the task is in `quota_blocked` and the `resets at:` line is missing or in the past, the orchestrator sends the task
  subagent a resume message with SendMessage. Then the orchestrator schedules the next job, as
  [The next job](#the-next-job) says. The task stays in `quota_blocked` until the task subagent runs `tasker resume`.
- If the task is in `quota_blocked` and its `resets at:` time is in the future, the stop is in a longer window, for
  example `seven_day`. The job of this case is the seven-day job for the job time of that `resets at:` time. If the
  ticket has no seven-day job for that time, the orchestrator applies the
  [future-time rule](#schedule-a-job-when-a-task-subagent-starts) right before the CronCreate of that job. If the job
  time is not later than the current time, the stop has already reset. Then this case hands over to the steps of the
  first case: the resume message, then [The next job](#the-next-job). The orchestrator does not tell the user that the
  task subagent stays stopped, and the rest of this case does not apply. If the job time is still in the future, or the
  ticket already has a seven-day job for that time, the orchestrator does not resume the task subagent, and it tells the
  user. The orchestrator schedules the job one time. If the ticket already has a seven-day job for that time, no
  CronCreate runs, so no check runs, and that job stays. For a seven-day job of the ticket that has not fired,
  [the seven-day rule](#the-seven-day-rule) applies: the same time means no new job, and another time means delete and
  replace. The seven-day job of the ticket for that `resets at:` time counts as the job that this case schedules, also
  when the orchestrator keeps an existing job. As a result, this case never leaves the task subagent out of
  [the schedule-all rule](#when-there-is-no-reset-time-yet). The task stays in `quota_blocked`.
- If the task is in `interrupted`, the orchestrator sends the task subagent a resume message, as in the first case of
  "When the job fires". Then the orchestrator schedules the next job, as [The next job](#the-next-job) says. The task
  stays in `interrupted` until the task subagent runs `tasker resume`.
- If the task is in `awaiting_quota_approval`, the quota use passed the approval threshold. The orchestrator tells the
  user and does not resume the task. The orchestrator does not run `tasker approve-credits` (see
  ["Limits"](limits.md#limits)). The orchestrator does not schedule another job for that task. The task stays in
  `awaiting_quota_approval` until the user decides.
- If the task is in `failed` or `landed`, the orchestrator reads the last report of the task subagent. In `landed`, the
  task subagent does [the CI wait](ci-wait.md#the-ci-wait). If that report does not say that the task subagent stopped,
  the orchestrator schedules the next job, as [The next job](#the-next-job) says. The task subagent keeps its slot. A
  report of a failed run (step 11 of the CI wait) is not a stop, so the task subagent keeps its slot also then. If the
  task subagent stopped, the orchestrator schedules no new job and tells the user. The orchestrator frees the slot only
  in a case of "Delete the job".
- If the task is in `finishing`, `cleanup_failed`, `finished` or `cancelled`, or `tasker status --issue <issue>` lists
  no task, the orchestrator schedules no new job. The orchestrator frees the slot of the task subagent, as "Delete the
  job" says. By default, `tasker status` lists only the tasks in flight, so it does not list a `finished` or `cancelled`
  task.
- If the task is in a state that no other case names, the task did not stop for the quota. For example, the task is in
  `planning`, `executing`, `awaiting_plan_review` or `reviewed`. The orchestrator schedules the next job, as
  [The next job](#the-next-job) says. The task subagent keeps its slot.

#### The next job

If a case of [When the job fires](#when-the-job-fires) says that the orchestrator schedules the next job, the
orchestrator first applies the resume rule. The resume rule: if the case sent no resume message, the subagent has ended
(see "Terms"), and the task subagent does not wait for an answer or a next step from the orchestrator, the orchestrator
sends the task subagent a resume message, as in the first case of "When the job fires". The task subagent waits for the
orchestrator after a stop, a question or a request for the next step, until the orchestrator sends the answer or the
next step. The reason: the quota can end the session of the task subagent between two `tasker` commands, and then no
other case resumes it.

A resume message can come from the first case, the hand-over of the `resets at:` case to the steps of the first case,
the interrupted case, the earlier-reset rule or the resume rule. After each one, the orchestrator deletes with
CronDelete each other job of the ticket that has not fired. After the delete, the ticket has no job of that kind, as
[Schedule a job when a task subagent starts](#schedule-a-job-when-a-task-subagent-starts) says for a deleted id. The
reason: after a resume message, this section schedules the next job, so an older job of the ticket sends only a second
resume message. Review 1 of #249 found that a late five-hour job can resume the task subagent before the seven-day job,
which then sends a second resume message. The CronList step of the first paragraph of "When the job fires" covers the
fire of a seven-day job, and this step covers each job. If CronDelete fails,
[the failure rule](limits.md#the-failure-rule) applies, and the job and its id stay.

Then the orchestrator schedules the next job: it runs `tasker show-quota` and reads the reset time, as [Terms](#terms)
says. The orchestrator also applies [the seven-day rule](#the-seven-day-rule). If there is a reset time, the
orchestrator schedules the next five-hour job for the job time of that task subagent, but only if the ticket has no
five-hour job that has not fired. The [future-time rule](#schedule-a-job-when-a-task-subagent-starts) applies before the
schedule. The orchestrator also follows [the schedule-all rule](#when-there-is-no-reset-time-yet). If there is no reset
time yet and the task subagent has no job, the orchestrator tells the task subagent that it has no job. Then "When there
is no reset time yet" applies to that task subagent. If a seven-day job alone counts as the job, the orchestrator does
not tell the task subagent that it has no job.

### What the task subagent does

- If a tasker command of the task subagent stops in `quota_blocked` or `interrupted`, the task subagent ends its turn.
  The task subagent does not wait, sleep or schedule anything. The task stays in that state. This end of the turn is a
  wait point of [the answer-wait rule](limits.md#the-answer-wait-rule).
- If the orchestrator tells the task subagent to resume, it runs `tasker status --issue <issue>`.
- If the task is in `quota_blocked` or `interrupted`, the task subagent runs `tasker resume <issue>`. The task goes back
  to the state before the run that stopped, and tasker runs the same command again. After that command, the task reaches
  the state that ["Run one ticket"](run-one-ticket.md#run-one-ticket) gives for its step. Then the task subagent
  continues with the next step of "Run one ticket".
- If the task is in `awaiting_quota_approval`, the task subagent does not run `tasker resume` or
  `tasker approve-credits`. The task subagent [stops](limits.md#the-answer-wait-rule).
- If the task is in a different state, the task subagent does not run `tasker resume`. It continues from that state.

### Delete the job

- When the task subagent reports that it ran `tasker finish`, for example in its final report, the orchestrator must
  delete each job of that ticket whose id still lives with CronDelete. A task in `landed` keeps its jobs and its slot
  until then, unless another bullet of this section applies, for example after a stop in
  [the CI wait](ci-wait.md#the-ci-wait). A report of a failed run is not a stop, so the jobs stay until `tasker finish`.
- When the orchestrator cancels a task subagent, the orchestrator must delete each job of that task subagent whose id
  still lives with CronDelete.
- If a task subagent stops for another reason and the orchestrator does not start it again, the orchestrator must delete
  each job of that task subagent whose id still lives with CronDelete.
- When the user defers a ticket that has a task in flight (see [the defer rule](pick-the-tickets.md#the-defer-rule)),
  the orchestrator must delete each job of that task subagent whose id still lives with CronDelete.
- In each of these cases, the orchestrator frees the slot of the task subagent. This also applies when the task subagent
  has no job. [The schedule-all rule](#when-there-is-no-reset-time-yet) also leaves out this task subagent.
- The bullet that starts "One task subagent runs one ticket" of
  [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) can start a second session for a
  ticket. Then the orchestrator deletes each job of the ticket whose id still lives with CronDelete. The new session
  takes the slot of the old session, in place of the free slot with the lowest number of
  [The delay of each task subagent](#the-delay-of-each-task-subagent). This case does not free the slot. For the old
  session, this case is also a case of the bullet that starts "If a task subagent stops for another reason". For this
  case, this bullet wins over the sentence "In each of these cases, the orchestrator frees the slot of the task
  subagent." of the bullet before this one. [The schedule-all rule](#when-there-is-no-reset-time-yet) still leaves out
  the old session, as the bullet before this one says. The old session keeps its slot from the failed SendMessage until
  the orchestrator starts the new session. At that start, the slot passes to the new session. Then the orchestrator
  schedules the jobs for the new session name, as
  [Schedule a job when a task subagent starts](#schedule-a-job-when-a-task-subagent-starts) says. The reason: a job
  lives in the session of the orchestrator, and its prompt names the old task subagent. On 2026-10-24, the jobs survived
  a restart of that session.
- If CronDelete fails, [the failure rule](limits.md#the-failure-rule) applies. The job stays. When the job fires, the
  case of "When the job fires" for its state applies. An example is the case of a finished task, which schedules
  nothing.

### Do not use these

- The orchestrator must not use `/loop` or ScheduleWakeup for the wait. One wake-up waits at most one hour. A wake-up
  before the reset has no tokens to act.
- A subagent cannot make a job, because a subagent does not have the tool for that. Only the orchestrator schedules
  jobs.
