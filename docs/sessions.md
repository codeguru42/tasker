# Sessions

This page gives the terms that each role uses.

The user is the person who works with the sessions.

The slug is the first word of the milestone title in lowercase, as [the notice rule](dev/doc-reads.md#the-notice-rule)
says. For example, the slug of "M9 — Pauses and recovery" is `m9`.

The sessions of a slug are `operator-<slug>`, `planner-<slug>` and `orchestrator-<slug>`.

An item is a message from a planner or an orchestrator to the operator about something that needs the user.

A task subagent is a subagent that the orchestrator starts with the Agent tool for one ticket. A ticket subagent is a
subagent that a planner starts with the Agent tool for the work on one draft of an issue. A review agent is not a ticket
subagent.

The own name of a session is in the first line of the output of `ListAgents`, in the form "This session is <name>". The
role is the part of the name before the first `-`. The slug is the part after it.

The session ref is the id in brackets after the name of a session in the output of `ListAgents`, for example `[bc2d80]`.
The own session ref comes from the first line of `ListAgents`.

The socket address of a session is the `uds:` value in the `from` field of a message from that session, for example
`uds:/run/user/30033/cc-socks/2406691.sock`.

When a session hands off, its session ref and its socket address go stale.
