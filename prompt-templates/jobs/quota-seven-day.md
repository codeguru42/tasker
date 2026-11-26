---
name: quota-seven-day
description: Load this template when an orchestrator schedules a seven-day job of a ticket, or you change the prompt of that job.
placeholders:
  ISSUE: The issue of the ticket, in the form that tasker show <issue> takes in docs/dev/quota.md.
  TASK_SUBAGENT: The name of the task subagent, or the full issue key for a task subagent with no name.
---
Seven-day job of {{ISSUE}}, window seven_day, for the task subagent {{TASK_SUBAGENT}}: do the steps of "When the job fires" in docs/dev/quota.md.