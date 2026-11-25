---
name: task-restart
description: Load this template when the orchestrator starts a second task subagent for the same ticket, or you change that prompt.
placeholders:
  ISSUE_KEY: The issue key of the ticket.
  SESSION_NAME: The new session name, with its suffix.
  TASK_STATE: The state of the task from `tasker show <issue>`.
  WORKTREE_PATH: The task worktree of the new name, `../tasker-worktrees/<session name>`.
---
You are a second session for the ticket {{ISSUE_KEY}}.
Your session name {{SESSION_NAME}} has a suffix after the name of the first session of the ticket.
Follow the comeback rule of "Run one ticket".
State of the task from `tasker show {{ISSUE_KEY}}`:
{{TASK_STATE}}
Task worktree of your new name: {{WORKTREE_PATH}}
