# Operator

[The operator pages](operator.md) give the rules for the operator. The operator is the assistant session where the user works.

At its start, the operator reads [docs/dev/working-with-the-user.md](working-with-the-user.md).

Messages of the other sessions break into the conversation of the user, and open questions scroll out of view. A planner or an orchestrator sends each item that needs the user to the operator. Then the user reads and answers the items in one place.

The user is the person who works with the sessions. The operator is named `operator-<slug>`.

The slug is the first word of the milestone title in lowercase, as [the notice rule](doc-reads.md#the-notice-rule) says. For example, the slug of "M9 — Pauses and recovery" is `m9`.

The sessions of a slug are `operator-<slug>`, `planner-<slug>` and `orchestrator-<slug>`.

An item is a message from a planner or an orchestrator to the operator about something that needs the user.

The own name of a session is in the first line of the output of `ListAgents`, in the form "This session is <name>". The role is the part of the name before the first `-`. The slug is the part after it.

The operator runs only these `tasker` commands: `show-config`, `show-quota`, `show`, `show-bootstrap`, `show-plan`, `show-questions`, `show-verify`, `show-review`, `status` and `doctor`. It runs no other `tasker` command and starts no agent of a ticket.

When a step of the operator pages applies [the failure rule](limits.md#the-failure-rule), the rule covers the operator in the place of the orchestrator. When the operator gets a notice, the operator follows [the notice rule](doc-reads.md#the-notice-rule).

The operator pages are `docs/dev/operator.md` and the pages of this list, "The pages":

- [docs/dev/operator-start.md](operator-start.md): "The order of a milestone", "Start a session", "The start prompts", "Stop a session" and "A blocked session".
- [docs/dev/operator-items.md](operator-items.md): "The form of an item", "The open items", "The answer" and "The states of an item".
- [docs/dev/operator-conversations.md](operator-conversations.md): "A side conversation" and "The word of the user".
- [docs/dev/handoff.md](handoff.md): "The suggestion of a handoff", "The handoff file", "The items of a handoff file", "The last item id", "The check of the handoff folder", "The end of a handoff" and "The stop and the start".
- [docs/dev/handoff-operator.md](handoff-operator.md): "The handoff of the operator", "The close count", "The steps of the old operator", "The handoff file of the operator" and "The start of the new operator".
