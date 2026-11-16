# Sessions

This page gives the terms that each role uses.

The user is the person who works with the sessions.

The slug is the first word of the milestone title in lowercase, as [the notice rule](dev/doc-reads.md#the-notice-rule)
says. For example, the slug of "M9 — Pauses and recovery" is `m9`.

The sessions of a slug are `operator-<slug>`, `planner-<slug>` and `orchestrator-<slug>`.

An item is a message from a planner or an orchestrator to the operator about something that needs the user.

A task subagent is a subagent that the orchestrator starts for one ticket with the
[native subagent tools](dev/pick-the-tickets.md#the-prompt-of-a-task-subagent) of its session. A ticket subagent is a
subagent that a planner starts with the Agent tool for the work on one draft of an issue. A review agent is not a ticket
subagent.

The own name of a session of the kind `claude` is in the first line of the output of `ListAgents`, in the form "This
session is <name>". The role is the part of the name before the first `-`. The slug is the part after it. A
[question session](dev/question-pane.md#a-question-pane) has no role and no slug, although its name starts with
`question-`.

A pi session gets its own name from `-n <name>` at the start. Before its role work, it reads the name with
`grep -m1 '"type":"session_info"' "$PI_SESSION_FILE"` and takes the value of `"name"`. Its role and its slug come from
that name, in the same form as above. The own name and the herdr agent name relate in this way:

- A planner, an orchestrator and a session of a topic handoff have the same text for both.
- A new operator in a handoff has the herdr agent name `operator-<slug>-<time>` and the own name `operator-<slug>`.
- The first operator has no herdr agent name.

If `PI_SESSION_FILE` is not set, the read fails, or the name is not the expected form, the pi session does no role work.
It tells the user in its own tab. This holds also for the first operator. The read uses the file form of pi 1.1.0 and
was measured with a bash tool. [docs/dev/pi-sessions.md](dev/pi-sessions.md) gives the limits.

The session ref is the id in brackets after the name of a session in the output of `ListAgents`, for example `[bc2d80]`.
The own session ref comes from the first line of `ListAgents`.

The socket address of a session is the `uds:` value in the `from` field of a message from that session, for example
`uds:/run/user/30033/cc-socks/2406691.sock`.

When a session hands off, its session ref and its socket address go stale.
