# Operator

[The operator pages](operator.md) give the rules for the operator. The operator is the assistant session where the user
works.

At its start, the operator reads [docs/dev/working-with-the-user.md](dev/working-with-the-user.md).

Messages of the other sessions break into the conversation of the user, and open questions scroll out of view. A planner
or an orchestrator sends each item that needs the user to the operator. Then the user reads and answers the items in one
place.

[docs/sessions.md](sessions.md) defines the user, the slug, the sessions of a slug, an item and the own name of a
session. The operator is named `operator-<slug>`.

The tab list is the list of the tabs that an operator can close. Each entry gives the tab id and the session name of one
tab.

The operator runs only these `tasker` commands: `show-config`, `show-quota`, `show`, `show-bootstrap`, `show-plan`,
`show-questions`, `show-verify`, `show-review`, `status` and `doctor`. It runs no other `tasker` command and starts no
agent of a ticket.

When a step of the operator pages applies [the failure rule](dev/limits.md#the-failure-rule), the rule covers the
operator in the place of the orchestrator. When the operator gets a notice, the operator follows
[the notice rule](dev/doc-reads.md#the-notice-rule).

The operator pages are `docs/operator.md` and the pages of this list, "The pages":

- [docs/dev/operator-start.md](dev/operator-start.md): "The order of a milestone", "Start a session", "The start
  prompts", "Stop a session", "A handoff" and "A blocked session".
- [docs/dev/operator-items.md](dev/operator-items.md): "The form of an item", "The open items", "The answer" and "The
  states of an item".
- [docs/dev/operator-conversations.md](dev/operator-conversations.md): "A side conversation" and "The word of the user".
- [docs/dev/handoff.md](dev/handoff.md): "The suggestion of a handoff", "The handoff file", "The items of a handoff
  file", "The last item id", "The check of the handoff folder", "The end of a handoff" and "The stop and the start".
- [docs/dev/handoff-operator.md](dev/handoff-operator.md): "The handoff of the operator", "The close count", "The steps
  of the old operator", "The handoff file of the operator" and "The start of the new operator".
