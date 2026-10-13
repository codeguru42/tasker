# Orchestration

This page gives the rules for an orchestrator. The orchestrator is the assistant session that picks tickets, starts one agent for each ticket, moves the cards, sets the landing order and writes memory.

A ticket is an issue on the project board. An agent is an assistant session that the orchestrator starts for one ticket. The agent runs the steps of "Run one ticket" for that ticket. The user is the person who runs the orchestrator. A task is the record that tasker keeps for one ticket. tasker moves the task from state to state, for example from `awaiting_plan_review` to `approved`.

Memory is the files where an assistant keeps notes between sessions. Memory is not in the repo.

tasker also starts its own sessions for plan, execute and review. They run in a worktree of the tasker clone. They are not agents and they do not run the steps on this page.

The orchestrator and its agents run tasker from the local clone of the orchestrator. For one ticket, the agent of that ticket is the operator that [docs/dev/rebase-conflicts.md](rebase-conflicts.md) names.

Every `tasker` command on this page is the installed `tasker`: the `tasker` command on the PATH from a global install. It is not the tasker that this repo builds. For this reason, `skills/tasker/SKILL.md` does not list its commands. See the `npm link` bullet under Limits.

## Pick the tickets

The orchestrator does all the steps of this section.

- Take tickets only from the Todo column of the project board, and only from the current milestone. Do not start a ticket from a later milestone.
- Start a ticket only when all the issues that block it are closed.
- Run at most 3 agents at the same time, one ticket for each agent.
- Do not run two tickets at the same time when both edit the same shared file, for example `test/helpers.ts` or `docs/dev/code-conventions.md`. Start the second ticket after the first one lands.
- When a ticket starts, the orchestrator moves its card to In progress. `tasker start` does not move the card. The board moves the card to Done when `tasker finish` closes the issue.
- When the Todo column of the milestone is empty, stop and tell the user. Do not write the issues of the next milestone.

## Run one ticket

The agent of the ticket runs steps 1 to 10. Each step gives the state of the task after its command succeeds.

1. Run `tasker doctor`.
2. Run `tasker start <issue>`. The task goes to `workspace_ready`. Then run `tasker plan <issue>`. The task goes to `awaiting_plan_review`.
3. Read the plan with `tasker show-plan` and `tasker show-questions`. Compare the plan with the Requirements and the Docs sections of the issue. Then do the quote check (see below).
4. If the plan needs changes, run `tasker refine <issue> "<feedback>"`. Add the repo-files rule to the feedback text. The task goes to `awaiting_plan_review` again. Then do steps 3 and 4 again until the plan needs no changes. Put the answers to the plan questions in the feedback text. `tasker plan` takes no feedback.
5. Run `tasker approve`. The task goes to `approved`. Run `tasker execute`. The task goes to `executed`. Run `tasker verify`. If the verify commands pass, the task goes to `awaiting_work_review`. If they fail, follow the verify-failure rule. Run `tasker review`. When the review has findings, the task goes to `reviewed`. When it has none, the task stays in `awaiting_work_review`. If the review has no findings, go to step 9.
6. Read the findings with `tasker show-review`. Decide for each finding if it is real. Then do the quote check (see below).
7. Dismiss each finding that is not real, with a reason: `tasker dismiss-review <issue> --finding N "<reason>"`. The task stays in `reviewed` while a finding is still open. If you dismiss all the findings, the task goes to `awaiting_work_review`, and you go to step 9.
8. If real findings are still open, run one `tasker refine <issue> "<feedback>"`. It acts on all the open findings. Add the repo-files rule to the feedback text. The task goes to `awaiting_plan_review`. After the refine, do steps 3 and 4 for the new plan. Then do steps 5 to 8 again, starting with `tasker approve`. The "Review findings" section limits the number of loops.
9. Run `tasker accept`. The task goes to `accepted`. `tasker accept` refuses when the branch does not contain the tip of `origin/main`. In that case, run `tasker update-branch`. The task goes to `executed`. Then run `tasker verify` and `tasker review` again as in step 5. If `tasker verify` fails, follow the verify-failure rule. If that review has findings, go to step 6. Otherwise, run `tasker accept` again. Run `tasker merge`. The task goes to `landed`. Run `tasker finish`. The task goes to `finished`, and the issue closes.
10. After `tasker finish`, post a comment on the issue that starts with `## Decisions made during implementation`. List the choices that the issue did not state, with the reasons. Name each detail that the issue did not give.

The add-work rule: if the task is in `awaiting_work_review` and the agent must add work, the agent runs `tasker review <issue> "<feedback>"`. The agent adds the repo-files rule to the feedback text. The task reaches `awaiting_work_review` after a review with no findings in step 5 or step 9, or after the agent dismisses all the findings in step 7. In this state, `tasker refine` refuses to run. The work can come from the orchestrator, for example. After `tasker review <issue> "<feedback>"`, the task goes to `refining`, and tasker makes a new plan revision. Then the task goes to `awaiting_plan_review`. Then the agent does steps 3 and 4 for the new plan, and steps 5 to 8 again, starting with `tasker approve`.

The repo-files rule: the agent adds this rule to the feedback text where a step, the add-work rule or the verify-failure rule says so. The rule tells the plan session (the session that tasker starts to make the plan) to read only the files in the worktree of the task. A file is outside the worktree when its path is not under the path on the `worktree:` line of `tasker show <issue>`. The plan session must not read or quote a file outside the worktree. If the plan session needs a detail that the issue, the feedback text and the files in the worktree do not give, it asks a plan question. It does not take the detail from another place. If the plan of step 2 needs no changes, the agent does not run a refine only to send this rule. The quote check covers that plan. The repo-files rule and the quote check cover only the plan session, the plans and the review findings. They do not cover the execute session or the diff.

The quote check: a plan or a finding quotes a file outside the worktree when it gives text from that file, or when it says that it read that file. "Outside the worktree" has the meaning of the repo-files rule. If a plan or a finding quotes a file outside the worktree, the agent tells the orchestrator. Then the orchestrator tells the user. After this report, the agent can still do the steps that come before `tasker approve` or `tasker accept`. For example, it can run a refine of step 4 or step 8, or dismiss a finding in step 7. If the next command of the agent is `tasker approve` or `tasker accept`, the agent stops and waits until the orchestrator answers. While the agent waits, the task stays in its state, for example `awaiting_plan_review` before `tasker approve`, or `awaiting_work_review` before `tasker accept`. After the orchestrator answers, the agent does the step that the answer gives. If the answer gives no step, the agent continues "Run one ticket" from the step where it stopped.

The verify-failure rule: this rule applies to each `tasker verify` on this page, in step 5, in step 9 and after `tasker update-branch` in "Land the work". If `tasker verify` fails, the task goes to `failed`. In `failed`, `tasker show <issue>` lists `refine`, `update-branch`, `retry` and `abort`. A fix of a failed `tasker verify` does not count as a loop of "Review findings". The limits of this rule count each refine and each retry after the last `tasker verify` that passed, for any cause. If the task is in `failed` after a command other than `tasker verify` or `tasker retry`, this rule does not apply. In that case, the agent follows the paragraph after this list, which starts "If a command fails". The agent reads the output of `tasker verify` and finds the cause of the failure. Next, the agent sends the orchestrator a run-end report. The report says that `tasker verify` failed and names the case of this list that the agent follows. If the `tasker verify` that `tasker retry` runs fails, the agent also sends this report. Then the agent does the first case of this list that applies:

- If the failure comes from the code and the agent already sent the refine of the next case, the agent stops. Its run-end report says that it stopped, and the task stays in `failed`.
- If the failure comes from the code, the agent runs one `tasker refine <issue> "<feedback>"`. `tasker refine` accepts a task in `failed` only when the task has a plan revision. The feedback gives the cause of the failure. It tells the plan to go through the commits of the task branch one at a time. It also tells the plan to fix each broken commit in that commit, not in a new commit on top. More than one commit can be broken, so the refine fixes all of them. The agent adds the repo-files rule to the feedback text. The task goes to `awaiting_plan_review`. Then the agent does steps 3 and 4 for the new plan, and steps 5 to 8 again, starting with `tasker approve`. As the other choice, the agent does not refine. It stops for a manual fix, and its run-end report says that it stopped. The task stays in `failed`. For a failure from the code, the agent does not run `tasker retry`, because the same check fails again on the same code. The agent also does not run `tasker retry --resume-execute`. That flag resumes execute with no new feedback, so the plan does not get the cause of the failure.
- If the agent already ran `tasker retry`, the agent stops, and its run-end report says that it stopped. If the `tasker verify` that `tasker retry` ran failed, the task stays in `failed`. If `tasker retry` itself failed, the task stays in the state that `tasker show <issue>` prints.
- If the failure does not come from the code, the agent runs `tasker retry <issue>` one time. For example, a test failed one time for a reason outside the code. `tasker retry` accepts a task in `failed`. By default, `tasker retry` runs `tasker verify` again on the same code. If that verify passes, the agent runs `tasker show <issue>`, and the task is in the state that it prints. Then the agent runs the command that comes after `tasker verify` in the place that ran it. In each place on this page, that command is `tasker review`.

If a command fails or the task is in another state, run `tasker show <issue>` and follow the commands that it prints.

To find the next command, use these:

- `tasker --help` lists the commands.
- `tasker <command> --help` shows the states where the command is valid.
- `tasker show <issue>` shows the state of the task and the next commands.

## Review findings

- One loop is one `tasker review` and the work on its findings. The agent runs at most 3 review loops. One 4th loop is permitted only to fix a small, real correctness bug.
- After the last loop, the agent stops and reports to the orchestrator. The orchestrator reports to the user.
- On the 3rd loop, the agent dismisses cosmetic findings with a reason.
- A refactor or duplication finding is not cosmetic. The agent refines it in the ticket that added the duplicated code.
- If such a finding is missed, the orchestrator adds it to a ticket that has not started (it edits the issue). Or the orchestrator tells the agent of a ticket in progress to add it to its next refine. If neither is possible, the orchestrator opens a new issue.
- When the agent sends a fix in the refine text, it writes "apply everywhere it fits". Otherwise the next review finds the same problem in other places.

## Land the work

The steps to land a ticket are in "Run one ticket". This section gives the rules between tickets.

- After `tasker approve`, each agent sends the orchestrator the list of files that the plan changes. `tasker refine` and `tasker approve` also print a warning when another task in progress changes the same file.
- If the edit of a shared file is not required, the agent removes it in a refine. If it is required, the orchestrator sets the landing order.
- When the orchestrator sets the landing order, it tells the later agent which ticket must land first. The earlier ticket is the ticket that must land first. The later agent is the agent of the ticket that lands after it. The earlier agent is the agent of the earlier ticket.
- The later agent does the steps of "Run one ticket" up to `tasker accept` in step 9. Before it runs `tasker accept`, it waits until the issue of the earlier ticket is closed. While the later agent waits, the task is in `awaiting_work_review`.
- To wait, the later agent reads the state of the issue of the earlier ticket one time: `gh issue view <number> --json state -q .state`. If the state is `OPEN`, the later agent reads it again every 30 seconds until it is `CLOSED`. The later agent waits at most 60 minutes from the first read.
- If the state is still `OPEN` 60 minutes after the first read, the later agent stops waiting. To stop waiting means that the later agent stops reading the issue state.
- If the earlier agent stops before the earlier ticket lands, the orchestrator tells the later agent to stop waiting. Then the later agent stops waiting. For example, the earlier agent stops after its last loop of "Review findings". Or it asks the user through the orchestrator about a detail that the issue does not give. Or it reports a rebase conflict that it does not fix (see [docs/dev/rebase-conflicts.md](rebase-conflicts.md)).
- If the later agent stops waiting, for either reason, it does not run `tasker accept`. The task stays in `awaiting_work_review`. The later agent reports to the orchestrator that it stopped waiting, and why. Then the later agent runs no other `tasker` command until the orchestrator tells it the next step.
- After the later agent reports that it stopped waiting, the orchestrator decides the next step and tells the user. The orchestrator tells the later agent to wait again, or it changes the landing order so that the later ticket lands first.
- If the orchestrator tells the later agent to wait again, the later agent starts a new wait as in the "To wait" bullet. The new limit is 60 minutes from the new first read. The task stays in `awaiting_work_review`.
- If the orchestrator changes the landing order, it tells both agents the new order. Then the two tickets swap roles. The ticket that was the later ticket becomes the earlier ticket, and its agent becomes the earlier agent. The ticket that was the earlier ticket becomes the later ticket, and its agent becomes the later agent. From then on, "earlier" and "later" name the roles in the new landing order. The task of the new earlier ticket is in `awaiting_work_review`, and the earlier agent continues step 9 of "Run one ticket" from `tasker accept`. Step 9 gives the state after each command. Before the new later agent runs `tasker accept` in step 9, it follows the wait rules of this section, from the bullet "The later agent does the steps of ...".
- When the issue of the earlier ticket is closed, the later agent runs `tasker update-branch`. The task goes from `awaiting_work_review` to `executed`. Then the later agent continues step 9 of "Run one ticket" from its `tasker verify`. If `tasker verify` fails, the later agent follows the verify-failure rule of "Run one ticket".
- If a refine, or the `tasker review <issue> "<feedback>"` of the add-work rule, must change a file that another ticket changed and landed after this task started, the agent runs `tasker update-branch` first. Otherwise the new work uses the old text of the file, and the rebase at landing can conflict.
- If the task is in `reviewed` (a refine of step 8) or in `awaiting_work_review` (work for the add-work rule), `tasker update-branch` moves the task to `executed`. Then the agent runs `tasker verify`. If the verify passes, the task goes to `awaiting_work_review`, and the agent runs `tasker review`. If it fails, the agent follows the verify-failure rule of "Run one ticket".
- The new review is a full review pass. It reports the open findings again as still open, and it can also report new findings.
- If the new review has findings, the task goes to `reviewed`, and the agent goes to step 6. Steps 6 to 8 then read, dismiss and refine all the open findings. If the agent must also add work (the task was in `awaiting_work_review`), the agent puts that work in the feedback of the refine of step 8. If the agent dismisses all the findings in step 7 instead, the task goes to `awaiting_work_review`, and the agent follows the add-work rule instead of going to step 9.
- If the new review has no findings, the task stays in `awaiting_work_review`, and `tasker refine` refuses to run. In that case, if the agent still must make the change, it follows the add-work rule of "Run one ticket". Otherwise, the agent goes to step 9.
- If the task was in `reviewed`, the review before `tasker update-branch` and the review after it count as one loop of "Review findings".
- If the task is in `awaiting_plan_review` (a refine of step 4), `tasker update-branch` keeps the task in `awaiting_plan_review`. Then the agent runs the refine of step 4.
- If `tasker update-branch` reports a rebase conflict, the agent follows [docs/dev/rebase-conflicts.md](rebase-conflicts.md). The agent does not copy that procedure.

## Quota

The quota belongs to the whole account. If a task stops in `quota_blocked`, the orchestrator and all the agents also have no tokens. No session can act until the quota resets. For this reason, the orchestrator must plan the resume before the quota runs out. The orchestrator does this with one cron job for each agent.

### Terms

- The reset time is the time when the quota of the account becomes available again. The quota resets at the exact reset time.
- A cron job (a job, on this page) is a prompt that the orchestrator schedules for a time. A one-shot job fires one time and then deletes itself. A job fires only while the orchestrator is idle. A job lives only in the session of the orchestrator.
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

- The event is the last one that tasker saw, so its reset time can be in the past. A reset time in the past, or no entry, means "no reset time yet".
- The assistant sends a quota event early in each run, also when the usage is low. As a result, a reset time is known soon after a run starts.
- If a task is in `quota_blocked`, `tasker show <issue>` prints the reset time of that stop in a line `resets at: <ISO time>`.

### The delay of each agent

Each running agent has a slot and a delay. The delay is the number of minutes between the reset time and the job of the agent. The delays prevent a resume of all the agents at the same time.

- There are 3 slots, one for each agent that can run at the same time. Slot 1 has a delay of 0 minutes. Slot 2 has a delay of 1 minute. Slot 3 has a delay of 2 minutes.
- If the reset time falls on :00 or :30, the delay of each slot is 1 minute longer: 1, 2 and 3 minutes. The cron scheduler can fire a one-shot job on :00 or :30 up to 90 seconds early. That fire is before the reset, so it has no tokens, and the job is then gone.
- The job time is the reset time plus the delay of the agent. The reset time falls on a full 10 minutes, for example 11:30. So the job time is a full minute.
- If the reset time is not a full minute, the orchestrator must round the job time up to the next full minute.
- When the orchestrator starts an agent, the orchestrator must give the agent the free slot with the lowest number.
- When the orchestrator schedules the next job for an agent, the agent keeps the same slot.
- The agent keeps its slot until the orchestrator frees it, as "Delete the job" says. Then the next agent that starts takes the slot.

### Schedule a job when an agent starts

1. When the orchestrator starts an agent, the orchestrator must run `tasker show-quota` and read the reset time, as "Terms" says.
2. If there is a reset time, the orchestrator must schedule a one-shot job for the job time of that agent. The orchestrator also follows the schedule-all rule in "When there is no reset time yet".
3. If there is no reset time yet, the orchestrator starts the agent without a job and tells the agent that it has no job. For example, there is no reset time before the first run in the project. "When there is no reset time yet" gives the next steps.

- When the orchestrator schedules a job, the prompt of the job must name the issue and the agent. The prompt must tell the orchestrator to do the steps of "When the job fires".
- The orchestrator must keep the job id for each ticket.

### When there is no reset time yet

- Each agent must tell the orchestrator each time a tasker run ends. If an agent has no job, the agent must also tell the orchestrator each time a tasker run starts. The runs are `tasker plan`, `tasker refine`, `tasker execute`, `tasker review` and `tasker resume`.
- If the orchestrator gets a run-start report and the ticket already has a job that has not fired, the orchestrator does not schedule another job.
- While any agent has no job and the schedule-all rule does not leave it out, the orchestrator runs `tasker show-quota` and reads the reset time each time an agent without a job reports that a tasker run starts. The orchestrator also does this each time any agent reports that a tasker run ends. If there is no reset time, nothing else changes.
- The schedule-all rule: each time the orchestrator runs `tasker show-quota` and reads a reset time, as "Terms" says, the orchestrator also schedules a job for each agent without a job. The rule leaves out an agent whose last job fired in a case of "When the job fires" that scheduled no new job for that agent. The agent stays left out until the orchestrator starts it as "Schedule a job when an agent starts" says. A message to the agent does not end this.
- When the orchestrator schedules the job of an agent that had no job, the orchestrator tells the agent that it has a job. If the agent gets this message, the agent stops the run-start reports. The agent keeps the run-end reports.
- If the orchestrator must tell an agent that it has a job or that it has no job, and the agent is running, the orchestrator tells the agent at once. If the agent has ended, the orchestrator does not send a message only for this. The orchestrator puts this information in the next message that it sends to that agent, for example the resume message.
- If the quota runs out before the orchestrator schedules a job, no job resumes the agent. In that case, the orchestrator tells the user when the orchestrator has tokens again.

### When the job fires

When the job of a ticket fires, the orchestrator runs `tasker status --issue <issue>` and `tasker show <issue>`. Then exactly one of these cases applies:

- If the task is in `quota_blocked` and the `resets at:` line is missing or in the past, the orchestrator sends the agent a resume message with SendMessage. Then the orchestrator schedules the next job, as the paragraph after this list says. The task stays in `quota_blocked` until the agent runs `tasker resume`.
- If the task is in `quota_blocked` and its `resets at:` time is in the future, the stop is in a longer window, for example `seven_day`. The orchestrator does not resume the agent. The orchestrator tells the user. Then the orchestrator schedules a job for the job time of that `resets at:` time. The task stays in `quota_blocked`.
- If the task is in `interrupted`, the orchestrator sends the agent a resume message, as in the first case. Then the orchestrator schedules the next job, as the paragraph after this list says. The task stays in `interrupted` until the agent runs `tasker resume`.
- If the task is in `awaiting_quota_approval`, the quota use passed the approval threshold. The orchestrator tells the user and does not resume the task. The orchestrator does not run `tasker approve-credits` (see "Limits"). The orchestrator does not schedule another job for that task. The task stays in `awaiting_quota_approval` until the user decides.
- If the task is in `failed`, the orchestrator reads the last run-end report of the agent. If the report says that `tasker verify` failed and the agent runs a refine or a retry of the verify-failure rule, the agent still works. In that case, the orchestrator schedules the next job, as the paragraph after this list says. Otherwise, the orchestrator schedules no new job and asks the agent for its report. The orchestrator frees the slot only in a case of "Delete the job".
- If the task is in `landed`, `finishing`, `cleanup_failed`, `finished` or `cancelled`, or `tasker status --issue <issue>` lists no task, the orchestrator schedules no new job. The orchestrator frees the slot of the agent, as "Delete the job" says. By default, `tasker status` lists only the tasks in flight, so it does not list a `finished` or `cancelled` task.
- If the task is in a state that no other case names, the task did not stop for the quota. For example, the task is in `planning`, `executing`, `awaiting_plan_review` or `reviewed`. The orchestrator schedules the next job, as the paragraph after this list says. The agent keeps its slot.

If a case says that the orchestrator schedules the next job, the orchestrator runs `tasker show-quota` and reads the reset time, as "Terms" says. If there is a reset time, the orchestrator schedules the next job for the job time of that agent. The orchestrator also follows the schedule-all rule in "When there is no reset time yet". If there is no reset time yet, the orchestrator tells the agent that it has no job. Then "When there is no reset time yet" applies to that agent.

### What the agent does

- If a tasker command of the agent stops in `quota_blocked` or `interrupted`, the agent ends its turn. The agent does not wait, sleep or schedule anything. The task stays in that state.
- If the orchestrator tells the agent to resume, the agent runs `tasker status --issue <issue>`.
- If the task is in `quota_blocked` or `interrupted`, the agent runs `tasker resume <issue>`. The task goes back to the state before the run that stopped, and tasker runs the same command again. After that command, the task reaches the state that "Run one ticket" gives for its step. Then the agent continues with the next step of "Run one ticket".
- If the task is in `awaiting_quota_approval`, the agent does not run `tasker resume` or `tasker approve-credits`. The agent reports to the orchestrator.
- If the task is in a different state, the agent does not run `tasker resume`. The agent continues from that state.

### Delete the job

- When the ticket lands, the orchestrator must delete the job of that ticket with CronDelete.
- When the orchestrator cancels an agent, the orchestrator must delete the job of that agent with CronDelete.
- If an agent stops for another reason and the orchestrator does not start it again, the orchestrator must delete the job of that agent with CronDelete.
- In each of these cases, the orchestrator frees the slot of the agent. This also applies when the agent has no job.

### Do not use these

- The orchestrator must not use `/loop` or ScheduleWakeup for the wait. One wake-up waits at most one hour. A wake-up before the reset has no tokens to act.
- An agent cannot make a job, because the agent does not have the tool for that. Only the orchestrator schedules jobs.
- The orchestrator and the agents must not read the files that tasker keeps in its data folder.

## Limits

These limits apply to the orchestrator and to the agents, except where a bullet names one actor.

- Do not change the repo or the worktrees of tasker by hand. Only `tasker` commands change them.
- If the issue does not give a detail that the work needs, the agent asks the user through the orchestrator.
- If tasker stops for a quota, follow "Quota". Never run `tasker approve-credits`.
- Do not run `npm link` or a global install from a task worktree. The global `tasker` runs the tickets, and the install replaces it.
- Only the orchestrator writes memory, so that two agents do not write the same file. Agents report what they learn to the orchestrator in their final report.
- The orchestrator and each agent load the simple-english skill. Then they follow the rules of the skill for all the text that they write. This text includes the replies to the user and the final report of an agent to the orchestrator. It also includes the messages of the orchestrator to an agent, and the feedback text of `tasker refine` and of `tasker review <issue> "<feedback>"`. It also includes the text that they post on GitHub, for example the comment of step 10 and the body of an issue. This rule does not apply to the sessions that tasker starts for plan, execute and review.
