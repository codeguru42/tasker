---
name: quota-pi
description: Load this template when an orchestrator schedules a pi job of a ticket, or you change the prompt of that job.
placeholders:
  ISSUE: The issue of the ticket, in the form that tasker show <issue> takes in docs/dev/orchestrator/quota.md.
  TASK_SUBAGENT: The name of the task subagent, or the full issue key for a task subagent with no name.
---
This is the pi job of {{ISSUE}} for the task subagent {{TASK_SUBAGENT}}: do the steps of "When the job fires" in docs/dev/orchestrator/quota.md.