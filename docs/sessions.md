# Sessions

This page gives the terms that name the operator, and the steps with which a session reads its own name.
[The glossary](dev/GLOSSARY.md) gives the other terms that the sessions use.

The sessions of a slug are `operator-<slug>`, `planner-<slug>` and `orchestrator-<slug>`.

An item is a message from a planner or an orchestrator to the operator about something that needs the user.

## The read of the own name

The [own name](dev/GLOSSARY.md) of a session of the kind `claude` is in the first line of the output of `ListAgents`, in
the form "This session is <name>". The own session ref comes from the first line of `ListAgents`.

A pi session gets its own name from `-n <name>` at the start. Before its role work, it reads the name with
`grep -m1 '"type":"session_info"' "$PI_SESSION_FILE"` and takes the value of `"name"`. Its role and its slug come from
that name, in the form that [the glossary](dev/GLOSSARY.md) gives for the own name. The own name and the herdr agent
name relate in this way:

- A planner, an orchestrator and a session of a topic handoff have the same text for both.
- A new operator in a handoff has the herdr agent name `operator-<slug>-<time>` and the own name `operator-<slug>`.
- The first operator has no herdr agent name.

If `PI_SESSION_FILE` is not set, the read fails, or the name is not the expected form, the pi session does no role work.
It tells the user in its own tab. This holds also for the first operator. The read uses the file form of pi 1.1.0 and
was measured with a bash tool. [docs/dev/pi-sessions.md](dev/pi-sessions.md) gives the limits.
