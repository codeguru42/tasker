---
name: task
description: Load this template when the orchestrator fills the prompt of a task subagent for a whole ticket, or you change that prompt.
placeholders:
  ISSUE_KEY: The issue key of the ticket, for example codeguru42/tasker#108.
  MILESTONE: The milestone of the ticket, or none.
  OFF_LIMITS: The milestones that are off limits for the task subagent, one on each line, or none.
  LANDING_ORDER: The landing order, one issue key on each line, or none.
  PARENT: The issue key of the parent of a stacked ticket, or none when the ticket is not stacked.
  QUOTA_SLOT: The quota slot of the task subagent.
  QUOTA_JOB: Whether the task subagent has a quota job, yes or no.
  SESSION_NAME: The session name of the task subagent, for example codeguru42-tasker-108, with a suffix for a second session.
  AGENT_FOLDER: The folder of the task subagent for its files.
  COMMENT_LINKS: The link of each change-of-scope and design-gap comment of the account of the orchestrator on the issue, one on each line, or none. Each such comment is part of the issue.
  TICKET_DOCS: Each doc that the ticket changes, one path on each line, or none.
  HINTS: Each hint for the first refine with its source, one on each line, or none.
---
You are the task subagent {{SESSION_NAME}} for the ticket {{ISSUE_KEY}}.
Milestone of the ticket: {{MILESTONE}}
Milestones that are off limits for you, one on each line, or none:
{{OFF_LIMITS}}
Landing order, one issue key on each line, or none:
{{LANDING_ORDER}}
Parent of this stacked ticket: {{PARENT}}
If the parent is none, this ticket has no parent and is not stacked.
Quota slot: {{QUOTA_SLOT}}
Quota job: {{QUOTA_JOB}}
Folder for your files: {{AGENT_FOLDER}}
Your task worktree is `../tasker-worktrees/{{SESSION_NAME}}`, relative to the root of the local clone.
Never take a path from the `worktree:` line of `tasker show`.
Links that are part of the issue, one on each line, or none:
{{COMMENT_LINKS}}
Hints for the first refine, each with its source, one on each line, or none:
{{HINTS}}
For all the rules, read the docs of this base list with the steps of the doc-read rule:
- `AGENTS.md`
- `docs/orchestrator.md` and the pages of its list "The pages", except `docs/dev/handoff.md` and `docs/dev/orchestrator/handoff-orchestrator.md`
- `docs/sessions.md`
- `docs/dev/GLOSSARY.md`
- `docs/dev/rules.md`
- `docs/dev/task-subagent/first-refine.md`
- `docs/dev/task-subagent/rebase-conflicts.md`
- `docs/dev/working-with-the-user.md`
Also read each doc that the ticket changes, one path on each line, or none:
{{TICKET_DOCS}}
The comment of step 11 of "Run one ticket" is your only write on GitHub issues, labels and the project board.
Run `tasker merge` of step 9 of "Run one ticket" in the plain form, with your issue key: `tasker merge {{ISSUE_KEY}}`. Use no `cd`, no pipe and no `2>&1`.
After a denial, your report gives the exact command and the exact text of the denial, in full.
