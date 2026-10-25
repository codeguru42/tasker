# Sessions

This page gives the terms that each role uses.

The user is the person who works with the sessions.

The slug is the first word of the milestone title in lowercase, as [the notice rule](dev/doc-reads.md#the-notice-rule)
says. For example, the slug of "M9 — Pauses and recovery" is `m9`.

The sessions of a slug are `operator-<slug>`, `planner-<slug>` and `orchestrator-<slug>`.

An item is a message from a planner or an orchestrator to the operator about something that needs the user.

The own name of a session is in the first line of the output of `ListAgents`, in the form "This session is <name>". The
role is the part of the name before the first `-`. The slug is the part after it.
