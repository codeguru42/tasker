# Quota jobs

The readers of this page are the orchestrator, and the agent for "What the agent does".

## Quota

The quota belongs to the whole account. If a task stops in `quota_blocked`, the orchestrator and all the agents also have no tokens. No session can act until the quota resets. For this reason, the orchestrator must plan the resume before the quota runs out. The orchestrator does this with up to two cron jobs for each agent: a five-hour job and a seven-day job.

### Terms

- The reset time is the time when the quota of the account becomes available again. The quota resets at the exact reset time.
- A cron job (a job, on [the orchestration pages](orchestration.md)) is a prompt that the orchestrator schedules for a time. A one-shot job fires one time and then deletes itself. A job fires only while the orchestrator is idle. A job lives only in the session of the orchestrator.
- The five-hour job is the job for the five-hour reset time. The seven-day job is the job for the seven-day reset time. On [the orchestration pages](orchestration.md), "an agent has a job", "has no job" and "an agent without a job" mean the five-hour job. A seven-day job alone does not count.
- An agent is running while it works on its turn. An agent has ended when its turn is over, for example after a tasker command stops in `quota_blocked` or `interrupted`. A message to an agent that has ended starts the agent again, and the agent keeps its context.
- `tasker show-quota` prints the last quota event of each repo as a JSON list. It has no `--json` flag. Each entry has `repo`, `provider`, `receivedAt` and `event`. `event` is the raw `rate_limit_event` of the assistant. For example:

  ```json
  [{"repo":"codeguru42/tasker","provider":"claude-code","receivedAt":"2026-10-12T00:23:23.713Z",
    "event":{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"five_hour","resetsAt":1791778800,
      "unifiedWindows":{"five_hour":{"utilization":0.39,"resetsAt":1791778800},"seven_day":{"utilization":0.39,"resetsAt":1792206000}}}}}]
  ```

- To read the reset time, the orchestrator takes the entry with the latest `receivedAt`, because all repos share the quota of the account. Then it reads `event.rate_limit_info.unifiedWindows.five_hour.resetsAt`. The value is in Unix seconds. The orchestrator converts it with `date -d @<seconds>`. For example:

  ```bash
  tasker show-quota | jq -r 'max_by(.receivedAt).event.rate_limit_info.unifiedWindows.five_hour.resetsAt'
  ```

- The orchestrator reads the seven-day reset time from the same entry, at `event.rate_limit_info.unifiedWindows.seven_day.resetsAt`. The value is in Unix seconds. For example:

  ```bash
  tasker show-quota | jq -r 'max_by(.receivedAt).event.rate_limit_info.unifiedWindows.seven_day.resetsAt'
  ```

- The event is the last one that tasker saw, so its reset time can be in the past. A reset time in the past, or no entry, means "no reset time yet". A seven-day reset time in the past, or no entry, means "no seven-day reset time yet".
- The assistant sends a quota event early in each run, also when the usage is low. As a result, a reset time is known soon after a run starts.
- If a task is in `quota_blocked`, `tasker show <issue>` prints the reset time of that stop in a line `resets at: <ISO time>`.

### The delay of each agent

Each running agent has a slot and a delay. The delay is the number of minutes between a reset time and the job of the agent for that reset. The delays prevent a resume of all the agents at the same time.

- There are 3 slots, one for each agent that can run at the same time. Slot 1 has a delay of 0 minutes. Slot 2 has a delay of 1 minute. Slot 3 has a delay of 2 minutes.
- If the reset time falls on :00 or :30, the delay of each slot is 1 minute longer: 1, 2 and 3 minutes. The cron scheduler can fire a one-shot job on :00 or :30 up to 90 seconds early. That fire is before the reset, so it has no tokens, and the job is then gone.
- The job time of a job is its reset time plus the delay of the agent. The reset time falls on a full 10 minutes, for example 11:30. So the job time is a full minute.
- If the reset time is not a full minute, the orchestrator must round the job time up to the next full minute.
- When the orchestrator starts an agent, the orchestrator must give the agent the free slot with the lowest number.
- When the orchestrator schedules a job for an agent, a five-hour job or a seven-day job, the agent keeps the same slot.
- The agent keeps its slot until the orchestrator frees it, as "Delete the job" says. Then the next agent that starts takes the slot.

### Schedule a job when an agent starts

1. When the orchestrator starts an agent, the orchestrator must run `tasker show-quota` and read the reset time, as "Terms" says. The orchestrator also applies [the seven-day rule](#the-seven-day-rule).
2. If there is a reset time, the orchestrator must schedule a one-shot five-hour job for the job time of that agent. The orchestrator also follows the schedule-all rule in "When there is no reset time yet".
3. If there is no reset time yet, the orchestrator starts the agent without a job and tells the agent that it has no job. For example, there is no reset time before the first run in the project. "When there is no reset time yet" gives the next steps.

- When the orchestrator schedules a job, the prompt of the job must name the issue and the agent. The prompt must tell the orchestrator to do the steps of "When the job fires".
- The orchestrator must keep the id of each job of a ticket. A ticket has at most one five-hour job and one seven-day job.
- For a seven-day job, the orchestrator must keep the seven-day reset time of the job with its id.
- Each id, and the time stored with it, lives until its one-shot job fires or until CronDelete deletes it. A one-shot job deletes itself when it fires. After that, the ticket has no job of that kind.
- A job that has not fired is a job whose id still lives.

### The seven-day rule

Each time the orchestrator runs `tasker show-quota` and reads the reset time, as "Terms" says, the orchestrator also reads the seven-day reset time and applies this rule. This holds whether or not a five-hour reset time exists.

- If the seven-day reset time is in the future, the orchestrator schedules a seven-day job for each agent that has none, except an agent that the schedule-all rule leaves out (see [When there is no reset time yet](#when-there-is-no-reset-time-yet)), however far away the reset is. The job is a one-shot job for the job time of the seven-day reset. The delay and the rounding come from [The delay of each agent](#the-delay-of-each-agent).
- The reason: after the seven-day quota runs out, no session has tokens for a later read. As a result, the orchestrator schedules the job at the first read that gives the time.
- The prompt of the job names the issue, the agent and the window `seven_day`. The prompt tells the orchestrator to do the steps of "When the job fires".
- If the ticket has a seven-day job that has not fired, and the seven-day reset time did not change, the orchestrator schedules no second one. To compare, the orchestrator uses the seven-day reset time that it stored with the job id.
- If the seven-day reset time changed, the orchestrator deletes the old seven-day job with CronDelete. Then the orchestrator schedules the new one.

The rule has three failure cases:

- If `tasker show-quota` fails, or the `jq` read of `seven_day` gives `null`, there is no seven-day reset time yet. No seven-day job changes. If `tasker show-quota` itself fails, the orchestrator tells the user the command and the error.
- If CronCreate of a seven-day job fails, the orchestrator tells the user the tool and the error. The agent has no seven-day job. The next read tries again, because the rule schedules a seven-day job for each agent that has none.
- If CronDelete of the old seven-day job fails, the orchestrator tells the user the tool and the error. The old job and its id stay. The orchestrator does not schedule the new job at that read. The next read tries again, because the time still differs.

### When there is no reset time yet

- Each agent must tell the orchestrator each time a tasker run ends. If an agent has no job, the agent must also tell the orchestrator each time a tasker run starts. The runs are `tasker plan`, `tasker refine`, `tasker execute`, `tasker review` and `tasker resume`.
- If the orchestrator gets a run-start report and the ticket already has a job that has not fired, the orchestrator does not schedule another job.
- While any agent has no job and the schedule-all rule does not leave it out, the orchestrator runs `tasker show-quota` and reads the reset time each time an agent without a job reports that a tasker run starts. The orchestrator also does this each time any agent reports that a tasker run ends. If there is no reset time, nothing else changes.
- The schedule-all rule: each time the orchestrator runs `tasker show-quota` and reads a reset time, as "Terms" says, the orchestrator also schedules a job for each agent without a job. The rule leaves out an agent whose last job fired in a case of "When the job fires" that scheduled no new job for that agent. The orchestrator schedules no job for a left-out agent under the schedule-all rule or under the seven-day rule. A fire of either job, in a case that schedules no new job, leaves the agent out. If a case of "When the job fires" says that the orchestrator schedules the next job, the agent of the fired job is no longer left out. This applies from the start of the paragraph after the list. As a result, that paragraph schedules the next five-hour job, and the seven-day rule covers the agent at the read of that paragraph. The agent stays left out until the orchestrator starts it as "Schedule a job when an agent starts" says, or until the end condition above. A message to the agent does not end this.
- When the orchestrator schedules the job of an agent that had no job, the orchestrator tells the agent that it has a job. If the agent gets this message, the agent stops the run-start reports. The agent keeps the run-end reports.
- If the orchestrator must tell an agent that it has a job or that it has no job, and the agent is running, the orchestrator tells the agent at once. If the agent has ended, the orchestrator does not send a message only for this. The orchestrator puts this information in the next message that it sends to that agent, for example the resume message.
- If the quota runs out before the orchestrator schedules a job, no job resumes the agent. In that case, the orchestrator tells the user when the orchestrator has tokens again.

### When the job fires

When a seven-day job fires, the orchestrator first runs CronList. The orchestrator deletes with CronDelete each job of the ticket whose time is in the past. After the delete, the ticket has no job of that kind, as [Schedule a job when an agent starts](#schedule-a-job-when-an-agent-starts) says for a deleted id. Then the orchestrator does the steps of this section one time. The reason is that the time of such a job can fall inside a stop of the seven-day window. No session has tokens then, so the job does not fire. Such a job can fire late, next to the seven-day job, and send a second resume message. If CronList or CronDelete fails, the orchestrator tells the user the tool and the error. Then it does the steps of this section.

When a job of a ticket fires, a five-hour job or a seven-day job, the orchestrator runs `tasker status --issue <issue>` and `tasker show <issue>`. Apart from the CronList step of the paragraph above, the steps are the same for both jobs. Then exactly one of these cases applies:

- If the task is in `quota_blocked` and the `resets at:` line is missing or in the past, the orchestrator sends the agent a resume message with SendMessage. Then the orchestrator schedules the next job, as the paragraph after this list says. The task stays in `quota_blocked` until the agent runs `tasker resume`.
- If the task is in `quota_blocked` and its `resets at:` time is in the future, the stop is in a longer window, for example `seven_day`. The orchestrator does not resume the agent. The orchestrator tells the user. The job of this case is the seven-day job for the job time of that `resets at:` time, and the orchestrator schedules it one time. For a seven-day job of the ticket that has not fired, [the seven-day rule](#the-seven-day-rule) applies: the same time means no new job, and another time means delete and replace. The seven-day job of the ticket for that `resets at:` time counts as the job that this case schedules, also when the orchestrator keeps an existing job. As a result, this case never leaves the agent out of the schedule-all rule. The task stays in `quota_blocked`.
- If the task is in `interrupted`, the orchestrator sends the agent a resume message, as in the first case. Then the orchestrator schedules the next job, as the paragraph after this list says. The task stays in `interrupted` until the agent runs `tasker resume`.
- If the task is in `awaiting_quota_approval`, the quota use passed the approval threshold. The orchestrator tells the user and does not resume the task. The orchestrator does not run `tasker approve-credits` (see ["Limits"](limits.md#limits)). The orchestrator does not schedule another job for that task. The task stays in `awaiting_quota_approval` until the user decides.
- If the task is in `failed` or `landed`, the orchestrator reads the last report of the agent. In `landed`, the agent does [the CI wait](ci-wait.md#the-ci-wait). If that report does not say that the agent stopped, the orchestrator schedules the next job, as the paragraph after this list says. The agent keeps its slot. A report of a failed run (step 11 of the CI wait) is not a stop, so the agent keeps its slot also then. If the agent stopped, the orchestrator schedules no new job and tells the user. The orchestrator frees the slot only in a case of "Delete the job".
- If the task is in `finishing`, `cleanup_failed`, `finished` or `cancelled`, or `tasker status --issue <issue>` lists no task, the orchestrator schedules no new job. The orchestrator frees the slot of the agent, as "Delete the job" says. By default, `tasker status` lists only the tasks in flight, so it does not list a `finished` or `cancelled` task.
- If the task is in a state that no other case names, the task did not stop for the quota. For example, the task is in `planning`, `executing`, `awaiting_plan_review` or `reviewed`. The orchestrator schedules the next job, as the paragraph after this list says. The agent keeps its slot.

If a case says that the orchestrator schedules the next job, the orchestrator first applies the resume rule. The resume rule: if the case sent no resume message, the agent has ended (see "Terms"), and the agent does not wait for an answer or a next step from the orchestrator, the orchestrator sends the agent a resume message, as in the first case. The agent waits for the orchestrator after a stop, a question or a request for the next step, until the orchestrator sends the answer or the next step. The reason: the quota can end the session of the agent between two `tasker` commands, and then no other case resumes the agent. Then the orchestrator runs `tasker show-quota` and reads the reset time, as "Terms" says. The orchestrator also applies [the seven-day rule](#the-seven-day-rule). If there is a reset time, the orchestrator schedules the next five-hour job for the job time of that agent, but only if the ticket has no five-hour job that has not fired. The orchestrator also follows the schedule-all rule in "When there is no reset time yet". If there is no reset time yet, the orchestrator tells the agent that it has no job. Then "When there is no reset time yet" applies to that agent.

### What the agent does

- If a tasker command of the agent stops in `quota_blocked` or `interrupted`, the agent ends its turn. The agent does not wait, sleep or schedule anything. The task stays in that state. This end of the turn is a wait point of [the answer-wait rule](limits.md#the-answer-wait-rule).
- If the orchestrator tells the agent to resume, the agent runs `tasker status --issue <issue>`.
- If the task is in `quota_blocked` or `interrupted`, the agent runs `tasker resume <issue>`. The task goes back to the state before the run that stopped, and tasker runs the same command again. After that command, the task reaches the state that ["Run one ticket"](run-one-ticket.md#run-one-ticket) gives for its step. Then the agent continues with the next step of "Run one ticket".
- If the task is in `awaiting_quota_approval`, the agent does not run `tasker resume` or `tasker approve-credits`. The agent [stops](limits.md#the-answer-wait-rule).
- If the task is in a different state, the agent does not run `tasker resume`. The agent continues from that state.

### Delete the job

- When the agent reports that it ran `tasker finish`, for example in its final report, the orchestrator must delete each job of that ticket whose id still lives with CronDelete. A task in `landed` keeps its jobs and its slot until then, unless another bullet of this section applies, for example after a stop in [the CI wait](ci-wait.md#the-ci-wait). A report of a failed run is not a stop, so the jobs stay until `tasker finish`.
- When the orchestrator cancels an agent, the orchestrator must delete each job of that agent whose id still lives with CronDelete.
- If an agent stops for another reason and the orchestrator does not start it again, the orchestrator must delete each job of that agent whose id still lives with CronDelete.
- When the user defers a ticket that has a task in flight (see [the defer rule](pick-the-tickets.md#the-defer-rule)), the orchestrator must delete each job of that agent whose id still lives with CronDelete.
- In each of these cases, the orchestrator frees the slot of the agent. This also applies when the agent has no job. The schedule-all rule also leaves out this agent until the orchestrator starts it again, as "Schedule a job when an agent starts" says.
- If CronDelete fails, the orchestrator tells the user the tool and the error. The job stays. When the job fires, the case of "When the job fires" for its state applies. An example is the case of a finished task, which schedules nothing.

### Do not use these

- The orchestrator must not use `/loop` or ScheduleWakeup for the wait. One wake-up waits at most one hour. A wake-up before the reset has no tokens to act.
- An agent cannot make a job, because the agent does not have the tool for that. Only the orchestrator schedules jobs.
