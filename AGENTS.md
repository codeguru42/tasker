# Index of the docs

Each assistant session reads this index first. It does not follow each link of the index at its start. At its start, a
session of a role reads the role index of its role and the start docs that the index names. The task subagent of a
ticket reads the docs that its prompt names. Each other session, for example a session that tasker starts, reads the
docs that its task needs. A session that works with the user and has no role also reads
[the issue-link rule](docs/dev/working-with-the-user.md#the-issue-link-rule) and
[the tracked-change rule](docs/dev/rules.md#changes) at its start.

After its start, a session reads another doc only for a step of its work that needs the doc. A link that the session
follows for a step is a doc read, as [the doc-read rule](docs/dev/doc-reads.md#the-doc-read-rule) says.

- [docs/orchestrator.md](docs/orchestrator.md): the role index of the orchestrator.
- [docs/planner.md](docs/planner.md): the role index of the planner.
- [docs/operator.md](docs/operator.md): the role index of the operator.
- [docs/sessions.md](docs/sessions.md): the terms that name the operator, and the read of the own name.
- [docs/dev/GLOSSARY.md](docs/dev/GLOSSARY.md): the terms that the sessions use.
- [docs/dev/rules.md](docs/dev/rules.md): the rules of the repo.
- [CONTRIBUTING.md](CONTRIBUTING.md): how a contributor starts work.
- [docs/dev/code-conventions.md](docs/dev/code-conventions.md): the conventions of the code.
- [docs/config.md](docs/config.md): the configuration.
- [docs/statemachine.md](docs/statemachine.md): the task states and their edges.
- [docs/dev/data-root.md](docs/dev/data-root.md): the data root and the database.
- [docs/dev/version-control.md](docs/dev/version-control.md): the git code.
- [docs/dev/doctor.md](docs/dev/doctor.md): the code that all doctor checks share.
- [docs/dev/rebase-conflicts.md](docs/dev/rebase-conflicts.md): the steps for a rebase conflict.
- [docs/dev/pick-the-tickets.md](docs/dev/pick-the-tickets.md): how the orchestrator picks the tickets.
- [docs/dev/doc-reads.md](docs/dev/doc-reads.md): when a session reads a doc.
- [docs/dev/run-one-ticket.md](docs/dev/run-one-ticket.md): how the task subagent runs one ticket.
- [docs/dev/plan-review.md](docs/dev/plan-review.md): the review of a plan.
- [docs/dev/tasker-commands.md](docs/dev/tasker-commands.md): how a session runs the tasker commands.
- [docs/dev/permissions.md](docs/dev/permissions.md): the permission model of the actors of the orchestration.
- [docs/dev/allowed-commands.md](docs/dev/allowed-commands.md): the commands that the orchestrator sends to each actor.
- [docs/dev/verify-failures.md](docs/dev/verify-failures.md): the steps after a failed verify run.
- [docs/dev/ci-wait.md](docs/dev/ci-wait.md): the wait for CI.
- [docs/dev/review-findings.md](docs/dev/review-findings.md): the steps for review findings.
- [docs/dev/land-the-work.md](docs/dev/land-the-work.md): how the orchestrator lands the work.
- [docs/dev/quota.md](docs/dev/quota.md): the steps when a quota stops a task subagent.
- [docs/dev/handoff.md](docs/dev/handoff.md): the handoff of a session.
- [docs/dev/handoff-orchestrator.md](docs/dev/handoff-orchestrator.md): the handoff of the orchestrator.
- [docs/dev/handoff-planner.md](docs/dev/handoff-planner.md): the handoff of the planner.
- [docs/dev/handoff-operator.md](docs/dev/handoff-operator.md): the handoff of the operator.
- [docs/dev/limits.md](docs/dev/limits.md): the limits of the orchestrator and the task subagents.
- [docs/dev/planner.md](docs/dev/planner.md): the rules of a planner.
- [docs/dev/planner-subagent.md](docs/dev/planner-subagent.md): the rules of a planner subagent of the orchestrator.
- [docs/dev/issue-subagents.md](docs/dev/issue-subagents.md): the rules that each draft, review and post subagent of a
  planner follows.
- [docs/dev/issue-draft.md](docs/dev/issue-draft.md): the rules of an issue-draft subagent.
- [docs/dev/issue-review.md](docs/dev/issue-review.md): the rules of an issue-review subagent.
- [docs/dev/issue-post.md](docs/dev/issue-post.md): the rules of an issue-post subagent and of each post of a planner.
- [docs/dev/issues.md](docs/dev/issues.md): the steps to file issues on GitHub.
- [docs/dev/working-with-the-user.md](docs/dev/working-with-the-user.md): how a session works with the user.
- [docs/dev/operator-start.md](docs/dev/operator-start.md): how the operator starts and stops sessions.
- [docs/dev/operator-items.md](docs/dev/operator-items.md): the items of the operator.
- [docs/dev/operator-conversations.md](docs/dev/operator-conversations.md): the side conversations of the operator.
- [docs/dev/question-pane.md](docs/dev/question-pane.md): a question pane.
- [docs/dev/session-review-rounds.md](docs/dev/session-review-rounds.md): the rounds of `/session-review`.
- [docs/dev/first-refine.md](docs/dev/first-refine.md): the hints for the first refine of a ticket.
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
- [docs/dev/setup.md](docs/dev/setup.md): the setup of a new machine for an orchestrator.
