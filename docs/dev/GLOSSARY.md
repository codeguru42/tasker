# Glossary

This page gives the terms that the sessions of this repo use. [docs/sessions.md](../sessions.md) keeps the terms that
name the operator.

## Language

**Own name**: The name of a session. The role is the part of the own name before the first `-`, and the slug is the part
after it.

**Question session**: The Claude Code session in a [question pane](question-pane.md#a-question-pane). It has no role and
no slug, although its name starts with `question-`.

**Session ref**: The id in brackets after the name of a session in the output of `ListAgents`, for example `[bc2d80]`.
After a handoff of the session, its session ref is stale.

**Slug**: The first word of the milestone title in lowercase, as [the notice rule](doc-reads.md#the-notice-rule) says.
For example, the slug of the milestone M9 is `m9`.

**Socket address**: The `uds:` value in the `from` field of a message from a session, for example
`uds:/run/user/30033/cc-socks/2406691.sock`. After a handoff of the session, its socket address is stale.

**Task subagent**: A subagent that the orchestrator starts for one ticket with the
[native subagent tools](pick-the-tickets.md#the-prompt-of-a-task-subagent) of its session. _Avoid_: Agent

**Ticket subagent**: A subagent that a planner starts with the Agent tool for the work on one draft of an issue. A
review agent is not a ticket subagent.

**User**: The person who works with the sessions.
