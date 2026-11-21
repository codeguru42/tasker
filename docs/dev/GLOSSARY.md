# Glossary

This page gives the terms that the sessions of this repo use. [docs/sessions.md](../sessions.md) keeps the terms that
name the operator.

## Language

**Issue-draft subagent**: A subagent that writes one draft of an issue. It follows
[issue-subagents.md](issue-subagents.md) and [issue-draft.md](issue-draft.md).

**Issue-post subagent**: A subagent that posts one approved issue on GitHub. It follows
[issue-subagents.md](issue-subagents.md) and [issue-post.md](issue-post.md).

**Issue-review subagent**: A subagent that reviews one draft of an issue. It follows
[issue-subagents.md](issue-subagents.md) and [issue-review.md](issue-review.md). A review agent of a ticket subagent is
not an issue-review subagent.

**Orchestrator**: A top-level session that runs one scope. It picks tickets and starts task subagents.

**Own name**: The name of a session. The role is the part of the own name before the first `-`, and the slug is the part
after it.

**Question session**: The Claude Code session in a [question pane](question-pane.md#a-question-pane). It has no role and
no slug, although its name starts with `question-`.

**Scope**: The issues that one orchestrator is responsible for, one milestone or a set of issues that the user names.
[The start of an orchestrator](../orchestrator.md#the-start-of-an-orchestrator) gives the kinds of a scope. _Avoid_:
Group, batch

**Session ref**: The id in brackets after the name of a session in the output of `ListAgents`, for example `[bc2d80]`.
After a handoff of the session, its session ref is stale.

**Slug**: The slug of an orchestrator is the slug of its scope, as
[The start of an orchestrator](../orchestrator.md#the-start-of-an-orchestrator) says. The slug of a milestone is the
first word of the milestone title in lowercase. For example, the slug of the milestone M9 is `m9`. `operator-<slug>` and
`planner-<slug>` use the slug of a milestone. The slug is not the path slug or the title slug of the code, for example
in `src/issue-key/path-slug.ts` and `src/vcs/git/worktree.ts`.

**Socket address**: The `uds:` value in the `from` field of a message from a session, for example
`uds:/run/user/30033/cc-socks/2406691.sock`. After a handoff of the session, its socket address is stale.

**Task subagent**: A subagent that the orchestrator starts for one ticket, or for one task change of a task, with the
[native subagent tools](pick-the-tickets.md#the-prompt-of-a-task-subagent) of its session. _Avoid_: Agent

**Ticket subagent**: A subagent that a planner starts with the Agent tool for the work on one draft of an issue. A
review agent is not a ticket subagent.

**User**: The person who works with the sessions.
