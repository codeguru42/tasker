# Index of the docs

Each assistant session reads this index first. It does not follow each link of the index at its start. At its start, a
session of a role reads the role index of its role and the start docs that the index names. The task subagent of a
ticket reads the docs that its prompt names. Each other session, for example a session that tasker starts, reads the
docs that its task needs. A session that works with the user and has no role also reads
[the issue-link rule](docs/dev/working-with-the-user.md#the-issue-link-rule) and
[the tracked-change rule](docs/dev/rules.md#changes) at its start.

After its start, a session reads another doc only for a step of its work that needs the doc. A link that the session
follows for a step is a doc read, as [the doc-read rule](docs/dev/doc-reads.md#the-doc-read-rule) says.

## Repository root

- [CONTRIBUTING.md](CONTRIBUTING.md): how a contributor starts work.

## docs/

- [docs/orchestrator.md](docs/orchestrator.md): the role index of the orchestrator.
- [docs/planner.md](docs/planner.md): the role index of the planner.
- [docs/sessions.md](docs/sessions.md): the terms that name the sessions of a slug, the read of the own name, the start
  of a session by the user, the start of a herdr session, the herdr agent name in a handoff, the start gate of a pi
  session, two sessions with one name and a blocked session.
- [docs/config.md](docs/config.md): the configuration.
- [docs/statemachine.md](docs/statemachine.md): the task states and their edges.

## docs/dev/

- [docs/dev/GLOSSARY.md](docs/dev/GLOSSARY.md): the terms that the sessions use.
- [docs/dev/rules.md](docs/dev/rules.md): the rules of the repo.
- [docs/dev/doc-layout.md](docs/dev/doc-layout.md): the folders of the docs and the rule for a new doc or a move.
- [docs/dev/code-conventions.md](docs/dev/code-conventions.md): the conventions of the code.
- [docs/dev/data-root.md](docs/dev/data-root.md): the data root and the database.
- [docs/dev/version-control.md](docs/dev/version-control.md): the git code.
- [docs/dev/doctor.md](docs/dev/doctor.md): the code that all doctor checks share.
- [docs/dev/doc-reads.md](docs/dev/doc-reads.md): when a session reads a doc.
- [docs/dev/tasker-commands.md](docs/dev/tasker-commands.md): how a session runs the tasker commands.
- [docs/dev/handoff.md](docs/dev/handoff.md): the handoff of a session.
- [docs/dev/limits.md](docs/dev/limits.md): the limits of the orchestrator and the task subagents.
- [docs/dev/planner.md](docs/dev/planner.md): the rules of a planner.
- [docs/dev/issue-subagents.md](docs/dev/issue-subagents.md): the rules that each draft, review and post subagent of a
  planner follows.
- [docs/dev/issue-draft.md](docs/dev/issue-draft.md): the rules of an issue-draft subagent.
- [docs/dev/issue-review.md](docs/dev/issue-review.md): the rules of an issue-review subagent.
- [docs/dev/issue-post.md](docs/dev/issue-post.md): the rules of an issue-post subagent and of each post of a planner.
- [docs/dev/issues.md](docs/dev/issues.md): the steps to file issues on GitHub.
- [docs/dev/working-with-the-user.md](docs/dev/working-with-the-user.md): how a session works with the user.
- [docs/dev/items.md](docs/dev/items.md): the form of a message, the terms of the questions and the answer.
- [docs/dev/question-pane.md](docs/dev/question-pane.md): a question pane.
- [docs/dev/session-review-rounds.md](docs/dev/session-review-rounds.md): the rounds of `/session-review`.
- [docs/dev/workspaces.md](docs/dev/workspaces.md): the base branch and the workspace of a task.
- [docs/dev/issue-trackers.md](docs/dev/issue-trackers.md): the issue tracker code.
- [docs/dev/github.md](docs/dev/github.md): the shared GitHub code.
- [docs/dev/forge.md](docs/dev/forge.md): the forge code.
- [docs/dev/jira.md](docs/dev/jira.md): the Jira tracker code.
- [docs/dev/issue-keys.md](docs/dev/issue-keys.md): the issue keys.
- [docs/dev/tasks.md](docs/dev/tasks.md): the task commands.
- [docs/dev/phases.md](docs/dev/phases.md): the phases.
- [docs/dev/assistants.md](docs/dev/assistants.md): the assistant providers.
- [docs/dev/prompt-templates.md](docs/dev/prompt-templates.md): the prompt templates.
- [docs/dev/codex-sessions.md](docs/dev/codex-sessions.md): the measured facts of Codex sessions.
- [docs/dev/pi-sessions.md](docs/dev/pi-sessions.md): measured pi tools and limits for a pi session in a herdr pane.
- [docs/dev/release.md](docs/dev/release.md): the releases.

## docs/dev/planner-subagent/

- [docs/dev/planner-subagent/planner-subagent.md](docs/dev/planner-subagent/planner-subagent.md): the rules of a planner
  subagent of the orchestrator.

## docs/dev/task-subagent/

- [docs/dev/task-subagent/rebase-conflicts.md](docs/dev/task-subagent/rebase-conflicts.md): the steps for a rebase
  conflict.
- [docs/dev/task-subagent/run-one-ticket.md](docs/dev/task-subagent/run-one-ticket.md): how the task subagent runs one
  ticket.
- [docs/dev/task-subagent/plan-review.md](docs/dev/task-subagent/plan-review.md): the review of a plan.
- [docs/dev/task-subagent/verify-failures.md](docs/dev/task-subagent/verify-failures.md): the steps after a failed
  verify run.
- [docs/dev/task-subagent/ci-wait.md](docs/dev/task-subagent/ci-wait.md): the wait for CI.
- [docs/dev/task-subagent/review-findings.md](docs/dev/task-subagent/review-findings.md): the steps for review findings.
- [docs/dev/task-subagent/first-refine.md](docs/dev/task-subagent/first-refine.md): the hints for the first refine of a
  ticket.

## docs/dev/orchestrator/

- [docs/dev/orchestrator/pick-the-tickets.md](docs/dev/orchestrator/pick-the-tickets.md): how the orchestrator picks the
  tickets.
- [docs/dev/orchestrator/permissions.md](docs/dev/orchestrator/permissions.md): the permission model of the actors of
  the orchestration.
- [docs/dev/orchestrator/allowed-commands.md](docs/dev/orchestrator/allowed-commands.md): the commands that the
  orchestrator sends to each actor.
- [docs/dev/orchestrator/land-the-work.md](docs/dev/orchestrator/land-the-work.md): how the orchestrator lands the work.
- [docs/dev/orchestrator/quota.md](docs/dev/orchestrator/quota.md): the steps when a quota stops a task subagent.
- [docs/dev/orchestrator/handoff-orchestrator.md](docs/dev/orchestrator/handoff-orchestrator.md): the handoff of the
  orchestrator.
- [docs/dev/orchestrator/milestone-close.md](docs/dev/orchestrator/milestone-close.md): the shared parts of the close of
  a milestone and the own-session closure.
- [docs/dev/orchestrator/setup.md](docs/dev/orchestrator/setup.md): the setup of a new machine for an orchestrator.
