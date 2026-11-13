# Quota jobs

The readers of this page are the orchestrator, and the task subagent for "What the task subagent does" and "A Codex
limit".

## Quota

The quota of Claude Code belongs to the whole account. If a `claude-code` task stops in `quota_blocked`, the
orchestrator and all the task subagents also have no tokens. No session can act until the quota resets. For this reason,
the orchestrator must plan the resume before the quota runs out. The orchestrator does this with cron jobs. A task
subagent can have a five-hour job and a seven-day job.

A `pi` task in `quota_blocked` does not stop the orchestrator and the task subagents. A pi stop can give its ticket a
third job, the pi job. [A pi stop](#a-pi-stop) and [The pi wait](#the-pi-wait) give its steps.

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
  tasker command stops in `quota_blocked` or `interrupted`. A message to a subagent that has ended starts the subagent
  again, and the subagent keeps its context. A login expiry also ends the session of the subagent itself, with the error
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
- When the orchestrator starts a task subagent, the orchestrator must give the task subagent the free slot with the
  lowest number.
- When the orchestrator schedules a job for a task subagent, the task subagent keeps the same slot. This holds for a
  five-hour job, a seven-day job and a [pi job](#a-pi-stop).
- The task subagent keeps its slot until the orchestrator frees it, as "Delete the job" says. Then the next task
  subagent that starts takes the slot.

### Schedule a job when a task subagent starts

1. When the orchestrator starts a task subagent, the orchestrator must run `tasker show-quota` and read the reset time,
   as [Terms](#terms) says. The orchestrator also applies [the seven-day rule](#the-seven-day-rule).
2. If there is a reset time, the orchestrator must schedule a one-shot five-hour job for the job time of that task
   subagent. The orchestrator also follows [the schedule-all rule](#when-there-is-no-reset-time-yet). The orchestrator
   applies the [future-time rule](#schedule-a-job-when-a-task-subagent-starts) of this section.
3. If the task subagent has no job after steps 1 and 2, the orchestrator starts the task subagent without a job. The
   orchestrator tells the task subagent that it has no job. For example, there is no reset time before the first run in
   the project. "When there is no reset time yet" gives the next steps.
4. If a seven-day job alone counts as the job, the orchestrator starts the task subagent. The orchestrator tells the
   task subagent that it has a job.

- The future-time rule: right before each CronCreate, the orchestrator reads the current time with `date`. The rule
  covers each schedule of a five-hour job, a seven-day job or a [pi job](#a-pi-stop) (each job is a one-shot job). The
  nine places are these:

  - Step 2 of this section.
  - [The schedule-all rule](#when-there-is-no-reset-time-yet).
  - [The seven-day rule](#the-seven-day-rule).
  - [The earlier-reset rule](#when-there-is-no-reset-time-yet).
  - [The interrupted rule](#when-there-is-no-reset-time-yet).
  - The case of [When the job fires](#when-the-job-fires) for a task in `quota_blocked` whose `resets at:` time is in
    the future.
  - The case of a pi stop in [When the job fires](#when-the-job-fires).
  - [A pi stop](#a-pi-stop).
  - [The next job](#the-next-job).

  If the job time is later than the current time, the orchestrator schedules the job. If the job time is not later than
  the current time, the orchestrator schedules no job. Instead, it does the step that read the reset time again, one
  time: a new `tasker show-quota`, and [Terms](#terms) for the new reading. In the second run, each job time that is not
  later than the current time means "no reset time yet" for that five-hour job, or "no seven-day reset time yet" for
  that seven-day job. The step has no third run. The rules of that case apply, as each place says.

  The rule acts on one job at a time. The other jobs of the step that have a job time in the future get their job. If
  the second `tasker show-quota` fails, [the failure rule](limits.md#the-failure-rule) applies, and the orchestrator
  schedules no further job of that step.

- The step that read the reset time is one of three. The first is step 1 of this section, with steps 2 to 4. The second
  is the read of [The next job](#the-next-job) and the schedules after it, not the resume rule and not the CronDelete
  paragraph before it. The third is a read of [When there is no reset time yet](#when-there-is-no-reset-time-yet) after
  a run report, with the schedule-all rule and the seven-day rule. The second run skips each job that the first run
  made. Steps 3 and 4 run one time, after the last run of the step. Each job of the second run keeps the result that the
  future-time rule gives. A five-hour job gets "no reset time yet", and a seven-day job gets "no seven-day reset time
  yet". Then steps 3 and 4 test the job that the task subagent has at that time.
- Six places have their own order. The `resets at:` case reads no reset time with `tasker show-quota`, so it has no
  second run. Instead, a job time that is not later than the current time means that the stop has already reset, as that
  case says. The earlier-reset rule takes its job time from the `resets at:` line, so it has no second run. A job time
  that is not later than the current time means that the stop has already reset, as that rule says. The interrupted rule
  takes its reset time from the `date` read of the future-time rule, so it has no second run. In the replace path of the
  seven-day rule, the check runs before the CronDelete of the old job, as that rule says.

  [A pi stop](#a-pi-stop) and the case of a pi stop in [When the job fires](#when-the-job-fires) schedule the pi job. If
  the job time of a pi job is not later than the current time, the stop counts as a full stop, as A pi stop says. So a
  pi job has no second run.

- The reason for this rule: on 2026-10-24 at 18:01:22, the orchestrator scheduled the five-hour job of #416 for 18:01,
  and the job did not fire (#431).
- When the orchestrator schedules a job, the prompt of the job must name the issue and the task subagent. The prompt
  must tell the orchestrator to do the steps of "When the job fires".
- The orchestrator must keep the id of each job of a ticket. A ticket has at most one five-hour job, one seven-day job
  and one [pi job](#a-pi-stop).
- For a seven-day job, the orchestrator must keep the seven-day reset time of the job with its id.
- Each id, and the time stored with it, lives until its one-shot job fires or until CronDelete deletes it. A one-shot
  job deletes itself when it fires. After that, the ticket has no job of that kind.
- A job that has not fired is a job whose id still lives.

### The seven-day rule

Each time the orchestrator runs `tasker show-quota` and reads the reset time, as [Terms](#terms) says, the orchestrator
also reads the seven-day reset time and applies this rule. This holds whether or not a five-hour reset time exists.

- If the seven-day reset time is in the future, the orchestrator schedules a seven-day job for each task subagent that
  has none, except a task subagent that the schedule-all rule leaves out (see
  [When there is no reset time yet](#when-there-is-no-reset-time-yet)), however far away the reset is. The job is a
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

- Each task subagent must tell the orchestrator each time a tasker run ends. If a task subagent has no job, the task
  subagent must also tell the orchestrator each time a tasker run starts. The runs are `tasker plan`, `tasker refine`,
  `tasker execute`, `tasker review`, `tasker retry` and `tasker resume`.
- If the orchestrator gets a run-start report and the ticket already has a job that has not fired, the orchestrator does
  not schedule another job.
- While any task subagent has no job and the schedule-all rule does not leave it out, the orchestrator runs
  `tasker show-quota` and reads the reset time, as [Terms](#terms) says, each time a task subagent without a job reports
  that a tasker run starts. The orchestrator also does this each time any task subagent reports that a tasker run ends.
  If there is no reset time, nothing else changes.
- The schedule-all rule has two parts. The first part: each time the orchestrator runs `tasker show-quota` and reads a
  reset time, the orchestrator also schedules a job for each task subagent without a job. The
  [future-time rule](#schedule-a-job-when-a-task-subagent-starts) applies before each schedule. The second part says
  which task subagent the rule leaves out, and until when. The rule leaves out a task subagent whose last job fired in a
  case of [When the job fires](#when-the-job-fires) that scheduled no new job for that task subagent. The orchestrator
  schedules no job for a left-out task subagent under the schedule-all rule or under the seven-day rule. A fire of
  either job, in a case that schedules no new job, leaves the task subagent out. If a case of "When the job fires" says
  that the orchestrator schedules the next job, the task subagent of the fired job is no longer left out. This applies
  from the start of [The next job](#the-next-job). As a result, that section schedules the next five-hour job, and the
  seven-day rule covers the task subagent at the read of that section. The task subagent stays left out until the
  orchestrator starts it as "Schedule a job when a task subagent starts" says, or until the end condition above. A
  message to the task subagent does not end this. The rule also leaves out a task subagent whose slot the orchestrator
  freed, as [Delete the job](#delete-the-job) says, until the orchestrator starts it again, as "Schedule a job when a
  task subagent starts" says.

  The rule also leaves out the task subagent of a task of a full stop in [the pi wait](#the-pi-wait). The resume message
  of that task ends each leave-out of this bullet for its task subagent. This applies from the start of
  [The next job](#the-next-job), as for a case of "When the job fires" that schedules the next job. This wins over the
  sentence "A message to the task subagent does not end this." of this bullet.

- When the orchestrator schedules the job of a task subagent that had no job, the orchestrator tells the task subagent
  that it has a job. If the task subagent gets this message, the task subagent stops the run-start reports. The task
  subagent keeps the run-end reports. With no five-hour window, the seven-day rule can give a job to a task subagent
  with no job. Then the orchestrator also tells the task subagent that it has a job.
- The earlier-reset rule applies to each run-end report of a task in `quota_blocked`, while the seven-day job of its
  task subagent counts as the job. It does not apply to the report of a [pi stop](#a-pi-stop). The report can be the
  final answer that ends the turn of the task subagent. The orchestrator runs `tasker show-quota` and
  `tasker show <issue>`, in this order. If another rule of this section already read `tasker show-quota` for this
  report, the orchestrator uses that read. Then exactly one of these cases applies:
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
  | Not known           | No five-hour window | The orchestrator applies the seven-day rule first. If the task subagent then has a seven-day job, the orchestrator tells the task subagent that it has a job.                                        |
  | Not known           | Five-hour window    | The present rules apply.                                                                                                                                                                             |
  | No five-hour window | Five-hour window    | The first sentences of this bullet apply.                                                                                                                                                            |
  | Five-hour window    | No five-hour window | A five-hour job that has not fired stays. A seven-day job that has not fired counts as the job. The orchestrator tells each task subagent that had no job and has a seven-day job that it has a job. |

- If the orchestrator must tell a task subagent that it has a job or that it has no job, and the task subagent is
  running, the orchestrator tells the task subagent at once. If the task subagent has ended, the orchestrator does not
  send a message only for this. The orchestrator puts this information in the next message that it sends to that task
  subagent, for example the resume message.
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

When a job of a ticket fires, a five-hour job, a seven-day job or a [pi job](#a-pi-stop), the orchestrator runs
`tasker status --issue <issue>` and `tasker show <issue>`. Apart from the CronList step of the paragraph above, the
steps are the same for each kind of job. Then exactly one of these cases applies:

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
- If the task is in `quota_blocked` and the stop is a [pi stop](#a-pi-stop), this case wins over the first two cases of
  this list. If the list of [the pi wait](#the-pi-wait) does not hold the task, the orchestrator first does the steps of
  A pi stop. If the task waits in a full stop, the orchestrator does not resume the task subagent and schedules no new
  job.

  If the task waits in a timed stop, the orchestrator reads the current time with `date`. If the `resets at:` time is
  not later than that time, the orchestrator does the steps of the first case. In each other case, the orchestrator does
  not resume the task subagent, and it schedules the pi job, as A pi stop says. The pi job of the ticket counts as the
  job that this case schedules, also when the orchestrator keeps an existing pi job. As a result, this case never leaves
  the task subagent out of [the schedule-all rule](#when-there-is-no-reset-time-yet).

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
orchestrator first applies the resume rule. The resume rule: if the case sent no resume message, the task subagent has
ended (see "Terms"), and the task subagent does not wait for an answer or a next step from the orchestrator, the
orchestrator sends the task subagent a resume message, as in the first case of "When the job fires". The task subagent
waits for the orchestrator after a stop, a question or a request for the next step, until the orchestrator sends the
answer or the next step. The reason: the quota can end the session of the task subagent between two `tasker` commands,
and then no other case resumes the task subagent.

A resume message can come from one of these places:

- The first case.
- The hand-over of the `resets at:` case to the steps of the first case.
- The interrupted case.
- The earlier-reset rule.
- The resume rule.
- The resume of a task of [the pi wait](#the-pi-wait).

After each one, the orchestrator deletes with CronDelete each other job of the ticket that has not fired. After the
delete, the ticket has no job of that kind, as
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
- If the orchestrator tells the task subagent to resume, the task subagent runs `tasker status --issue <issue>`.
- If the task is in `quota_blocked` or `interrupted`, the task subagent runs `tasker resume <issue>`. The task goes back
  to the state before the run that stopped, and tasker runs the same command again. After that command, the task reaches
  the state that ["Run one ticket"](run-one-ticket.md#run-one-ticket) gives for its step. Then the task subagent
  continues with the next step of "Run one ticket".
- If the task is in `awaiting_quota_approval`, the task subagent does not run `tasker resume` or
  `tasker approve-credits`. The task subagent [stops](limits.md#the-answer-wait-rule).
- If the task is in a different state, the task subagent does not run `tasker resume`. The task subagent continues from
  that state.

### A pi stop

A pi stop is a stop of a task in `quota_blocked` with the cause `rate_limit`, in a repo whose `assistant.provider` is
`pi`. The `pi` provider gives this stop at an HTTP 402 answer of the upstream. The upstream is the model service that pi
calls, for example `openrouter`. A 402 means that the account of the upstream has no budget left. A pi stop does not use
up the quota of Claude Code, so the orchestrator still has tokens.

To find a pi stop, the orchestrator reads the `repo:`, `cause:` and `resets at:` lines of `tasker show <issue>`. Then it
reads the provider of that repo:

```bash
tasker show-config --repo <repo> | jq -r '.assistant.provider'
```

Each rule of this page that names a pi stop uses this test. If a read of the test fails,
[the failure rule](limits.md#the-failure-rule) applies, and the orchestrator goes on as for a full stop. The test reads
the provider of the configuration, not the provider of the stopped run. If the user changed `assistant.provider` after
the start of the session of the run, the two can differ, because a continued session keeps its provider.

A pi stop has one of two kinds. At the report, right after the test, the orchestrator reads the current time with
`date`. A timed stop is a pi stop whose `resets at:` time is later than that time. A full stop is each other pi stop,
for example a stop whose `resets at:` line prints `-`. A `resets at:` time in the past gives a full stop, because a
resume at once can get the same 402 again.

The orchestrator does the test at each run-end report of a task in `quota_blocked`, before each other rule of this page
for that report. The report can be the final answer that ends the turn of the task subagent. Each other rule of this
page for this report uses the `tasker show <issue>` read of the test. If the stop is a pi stop, the orchestrator sends
no resume message for the report. The task joins [the pi wait](#the-pi-wait). Each job of the ticket that has not fired
stays.

At a timed stop, the orchestrator schedules the pi job of the ticket. The pi job is a one-shot job for the job time of
the `resets at:` time, with the delay and the rounding of
[The delay of each task subagent](#the-delay-of-each-task-subagent). The
[future-time rule](#schedule-a-job-when-a-task-subagent-starts) applies right before the CronCreate. If the job time is
not later than the `date` read of that rule, the orchestrator schedules no pi job. Then the stop counts as a full stop.

If the ticket has a pi job that has not fired, the orchestrator schedules no second one. The prompt of the job names the
issue, the task subagent and the words "pi job". It tells the orchestrator to do the steps of
[When the job fires](#when-the-job-fires).

At a full stop, the orchestrator schedules no job. The task stays in `quota_blocked` until the word of the user, as
[The pi wait](#the-pi-wait) says.

The resume message of a task of the pi wait is the resume message of the first case of "When the job fires". If the task
is not in `quota_blocked` any more, the orchestrator still sends it, for example after the user ran `tasker resume`. The
task subagent then does the steps of [What the task subagent does](#what-the-task-subagent-does). Then the orchestrator
schedules the next job, as [The next job](#the-next-job) says. If the resumed run stops in a pi stop again, the task
joins the pi wait again.

### The pi wait

The pi wait is the pause of the new `pi` tickets after a pi stop. It lasts while at least one task waits in it. A task
waits from the report of its [pi stop](#a-pi-stop) until its resume message or another step of the user. While the pi
wait lasts, the orchestrator starts no new ticket of a repo whose `assistant.provider` is `pi`, as
[Pick the tickets](pick-the-tickets.md#pick-the-tickets) says. The tasks in flight of each repo continue. The tickets of
each other repo start as the other rules say.

The orchestrator keeps the list of the pi wait in its session. For each waiting task, the list holds the issue key, the
kind of the stop and the `resets at:` time. While its task waits, the task subagent keeps its slot until the
orchestrator frees it, as [The delay of each task subagent](#the-delay-of-each-task-subagent) says.

A task of a timed stop leaves the pi wait at its resume message from the case of a pi stop in
[When the job fires](#when-the-job-fires). A task of a full stop leaves the pi wait on
[the word of the user](operator-conversations.md#the-word-of-the-user). The word of the user can also end the pi wait of
a task of a timed stop before its reset. A task also leaves the pi wait in each case of
[Delete the job](#delete-the-job). After the last task leaves the pi wait, the pi wait ends. Then the orchestrator does
the steps of [Pick the tickets](pick-the-tickets.md#pick-the-tickets) again.

At each stop of the pi wait, the orchestrator sends a new item, the item of the stop. The item names each waiting task.
A full stop gives the item one question, for its own task. A timed stop gives the item no question, so the item is a
report with the mark "Report:" of [The form of an item](operator-items.md#the-form-of-an-item). Each earlier item keeps
its open questions.

For each waiting task, the item names the issue key and the `paused from:` and `resets at:` values. It also names the
upstreams of the repo of that task. The orchestrator reads the upstreams with this command:

```bash
tasker show-config --repo <repo> | jq -r '[.assistant.models[].model | split("/")[0]] | unique | join(", ")'
```

The upstream of a model is the part of the model before the first `/`. If a read of the test or of the upstreams failed,
the item also names the failed read.

For a full stop, the question gives the user two steps. In the first step, the user adds credits to the account of each
upstream of the repo of the task. If the account has a limit that resets at a set time, the user can wait for that reset
instead. In the second step, the user runs `tasker resume <key>` and answers after that run ends. The choices are (a)
resume and (b) another step. For a timed stop, the item says that the task resumes at its reset with no answer.

An answer of the user to the question of a task has one of these outcomes:

- Resume: the orchestrator sends the resume message, as [A pi stop](#a-pi-stop) says. The task leaves the pi wait.
- Another step, for example a defer: the rule of that step applies, for example
  [the defer rule](pick-the-tickets.md#the-defer-rule) with its delete of the jobs. The task leaves the pi wait.
- Words that pick no choice: the question stays open, as [The answer](operator-items.md#the-answer) says. The task stays
  in the pi wait.

### A Codex limit

A Codex run can stop at a usage limit whose form tasker does not know. The task then ends as `failure`. These steps
capture a real stop for the issue that adds the Codex quota outcome. No session forces a limit or runs extra work to
reach one.

A possible Codex limit is a task in `failed` whose `repo:` has provider `codex`. Its `failed in:` is `planning`,
`refining`, `executing`, or `reviewing`. Its `error:` can come from a usage limit. Test the provider with
`tasker show-config --repo <repo> | jq -r '.assistant.provider'`. A plausible error can contain `limit`, `quota`,
`rate`, `usage`, or `429`. The error `<phase> timed out after <N> min` is also possible because Codex can wait until the
deadline. No one has measured this case. The task subagent makes this judgment. After the orchestrator answers "no," the
report is no longer a possible Codex limit for that failure.

#### The task subagent

Before any `tasker` command that changes the task, keep the `repo:`, `attempt:`, `failed in:`, and `error:` lines from
`tasker show <issue>`. Run `date -u +%FT%TZ` and `codex --version`. Keep each output, or the name of a failed read. Send
the lines and outputs to the orchestrator with the words "a possible Codex limit." Wait under the
[answer-wait rule](limits.md#the-answer-wait-rule). The task stays in `failed`.

These steps take priority over retry instructions in [verify failures](verify-failures.md),
[tasker commands](tasker-commands.md), and the comeback rule of [Run one ticket](run-one-ticket.md#the-comeback-rule). A
retry can append a new run to the same transcript. On the orchestrator's answer, follow the existing "If a command
fails" paragraph, wait, or run `tasker retry <issue>`, as directed. Keep the slot while waiting.

#### The orchestrator's data root and questions

1. Read the data root with `tasker show-config | jq -r '.dataRoot'`.
2. Send the user one item with two questions. The first question asks whether the run stopped at a Codex usage limit.
   The choices are (a) yes, (b) no and (c) not known.
3. The second question asks for the permission to read the transcript of the failed run. It gives the path of the
   transcript folder of the attempt and the two commands of
   [The permitted transcript read](#the-permitted-transcript-read). The choices are (a) yes and (b) no. The item gives
   the lines and the outputs of the report.
4. If the data-root read fails, name the failed read in the item and ask only the first question. Such a capture has no
   transcript copy.

#### The permitted transcript read

Use `<dataRoot>/artifacts/<issue slug>/attempt-<N>/transcripts/`, with `<N>` from `attempt:`. Form the issue slug by
replacing each run of characters other than letters and digits with `-`. For example, `codeguru42/tasker#837` becomes
`codeguru42-tasker-837`.

Use `plan-v*.jsonl` for `planning` or `refining`, `execute-v*.jsonl` for `executing`, and `review-*.jsonl` for
`reviewing`. Select the newest file of its kind with `ls -t <folder>/execute-v*.jsonl | head -1`, substituting the right
pattern.

Make the copy with this exact filter:

```bash
jq -c -s '(map(.type) | rindex("thread.started") // 0) as $i | .[$i:][] | select(((.type | tostring) | startswith("item.") | not) or ((.item.type? // "") | IN("agent_message", "reasoning", "command_execution", "file_change", "mcp_tool_call", "web_search", "todo_list") | not))' <file>
```

The copy begins at the last `thread.started` and keeps every other event, including an item of an unknown type. Remove
personal data, such as a user-name path, email address, or account id. The orchestrator judges what else is personal
data. State whether the copy ends with `error` or `turn.failed`.

If the copy does not end with either event, state that it can come from an earlier appended run. In that case, `error:`
is the only stop record. If either command fails or prints no line, tell the user and make no copy by other means.

#### The answers

| First answer             | Second answer                                    | Outcome                                                                                                                                               |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| (b) no                   | Any                                              | No capture. Tell the task subagent to follow "If a command fails" in `docs/dev/verify-failures.md`. This failure is no longer a possible Codex limit. |
| (a) yes or (c) not known | (a) yes                                          | Read the copy as above. Keep it with the report lines and outputs in the capture.                                                                     |
| (a) yes or (c) not known | (b) no                                           | Keep only the report lines and outputs in the capture.                                                                                                |
| (a) yes or (c) not known | No second question after a failed data-root read | Keep only the report lines and outputs, and name the failed read.                                                                                     |

A "no" to the first question ends the item without a second answer. Every other row needs an answer to each question
presented. Until then, read nothing and tell the task subagent nothing. An answer that picks no choice leaves its
question open. The task stays in `failed`.

#### The capture and the next step

Make the capture a proposed comment with the date, `codex --version` output, first user answer, report lines, and any
permitted copy in a code block. If an open issue adds the Codex quota outcome, propose the comment there; on 2026-11-11
that issue was #662. Otherwise send the capture to `planner-<slug>` as a proposed issue.

If the issue-state read fails, post nothing, tell the user, and keep the capture only in the item. Show the comment
draft in a new item. Post only after user approval, using any changes the user requests. If the user rejects or drops
it, post nothing and keep it only in the item.

Do not edit a document to claim the form of the stop; the later quota-outcome issue owns that work. An answer of (b) no
is not a capture, so this paragraph does not apply to that answer. For a capture, keep this task in `failed`. The reset
time is unknown. After the answers of a capture, tell the task subagent to wait. Tell it to run `tasker retry <issue>`
only on the word of the user. Say this in the capture item.

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
