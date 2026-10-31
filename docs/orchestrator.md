# Orchestrator

[The orchestration pages](orchestrator.md) give the rules for an orchestrator. The orchestrator is the assistant session
that picks tickets, starts one agent for each ticket, moves the cards, sets the landing order and writes memory.

A ticket is an issue on the project board. An agent is an assistant session that the orchestrator starts for one ticket.
The agent runs the steps of ["Run one ticket"](dev/run-one-ticket.md#run-one-ticket) for that ticket. The user is the
person who works with the sessions, as [sessions.md](sessions.md) says. The operator starts the orchestrator, as
[Start a session](dev/operator-start.md#start-a-session) of operator-start.md says. The user does not type in the
session of the orchestrator. The user answers a permission prompt in the tab of the orchestrator, as
[A blocked session](dev/operator-start.md#a-blocked-session) says. The orchestrator reads its own name and its slug from
the first line of the output of `ListAgents`, as [sessions.md](sessions.md) says. A task is the record that tasker keeps
for one ticket. tasker moves the task from state to state, for example from `awaiting_plan_review` to `approved`.

Memory is the files where an assistant keeps notes between sessions. Memory is not in the repo.

The orchestrator works with the user only through `operator-<slug>` of its own slug. The orchestrator sends each open
question and each other item that needs the user to that session, in the form of
[The form of an item](dev/operator-items.md#the-form-of-an-item).
[The operator](dev/working-with-the-user.md#the-operator) of working-with-the-user.md says how "tell the user" or "ask
the user" reads. A report or a question to the user that a rule of the orchestration pages calls a reply is also an
item. When a rule waits for the user, the answer of the item ends the wait, as
[The answer](dev/operator-items.md#the-answer) of operator-items.md says. The orchestrator sends each lesson, each
finding of a session review, each recurrence and each proposed issue only to `planner-<slug>` of its own slug, as the
planner bullet of [The prompt of an agent](dev/pick-the-tickets.md#the-prompt-of-an-agent) says. The messages between
orchestrators that go straight are the doc notice of [the notice rule](dev/doc-reads.md#the-notice-rule), the
broken-test notice of [A failed CI run](dev/ci-wait.md#a-failed-ci-run), the messages of
[the hold rule](dev/land-the-work.md#the-hold-rule), a landing order of
[the overlap rule](dev/land-the-work.md#the-overlap-rule), a change to an issue in flight
([Land the work](dev/land-the-work.md#land-the-work)) and the messages of
[the hold before an install](dev/release.md#the-hold-before-an-install). [The request rule](#the-request-rule) covers
each other request between orchestrators that needs a decision of the user.

tasker also starts its own sessions for plan, execute and review. They run in a worktree of the tasker clone. They are
not agents and they do not run the steps on [the orchestration pages](orchestrator.md).

The orchestrator and its agents run tasker from the local clone of the orchestrator. For one ticket, the agent of that
ticket is the driver that [docs/dev/rebase-conflicts.md](dev/rebase-conflicts.md) names.

Every `tasker` command on [the orchestration pages](orchestrator.md) is the installed `tasker`: the `tasker` command on
the PATH from a global install. The installed `tasker` is a build of this repo, from a version that can be older than
`main`. For this reason, `skills/tasker/SKILL.md` does not list its commands (see
[The installed skill](dev/rules.md#the-installed-skill)). See the install bullet of [Limits](dev/limits.md#limits) in
`docs/dev/limits.md`. For the known behaviors of the installed `tasker`, see
[the facts of the installed tasker](dev/tasker-commands.md#the-facts-of-the-installed-tasker).

The start docs of the orchestrator are `docs/orchestrator.md`, the pages of the list "The pages" below,
[docs/dev/rules.md](dev/rules.md), [docs/dev/working-with-the-user.md](dev/working-with-the-user.md) and
[docs/sessions.md](sessions.md). The orchestrator reads them at its start.

The orchestration pages are `docs/orchestrator.md` and the pages of this list, "The pages":

- [docs/dev/pick-the-tickets.md](dev/pick-the-tickets.md): "Pick the tickets", the stacking rule, the stacked-ticket
  rule, the parent-hold rule, the link offer, the defer rule and "The prompt of an agent".
- [docs/dev/doc-reads.md](dev/doc-reads.md): the re-read rule, the notice rule, the agent notice and the doc-read rule.
- [docs/dev/run-one-ticket.md](dev/run-one-ticket.md): "Run one ticket", the final report, the comeback rule, the base
  rule, the add-work rule, the diff read and the measure rule.
- [docs/dev/plan-review.md](dev/plan-review.md): the repo-files rule, the fact test, the issue check, the stop rule, the
  change-of-scope comment, the design-gap rule and the quote check.
- [docs/dev/tasker-commands.md](dev/tasker-commands.md): the plain-form rule, the tool-block rule, the command rules,
  the facts of the installed tasker and the run times.
- [docs/dev/verify-failures.md](dev/verify-failures.md): the verify-failure rule, the broken-commit steps, the session
  check, the manual fix and the commit check.
- [docs/dev/ci-wait.md](dev/ci-wait.md): the CI wait and "A failed CI run".
- [docs/dev/review-findings.md](dev/review-findings.md): "Review findings".
- [docs/dev/land-the-work.md](dev/land-the-work.md): "Land the work", the overlap rule, the Docs rule, the hold rule and
  the stuck-task rule.
- [docs/dev/quota.md](dev/quota.md): "Quota", "Terms", "The delay of each agent", "Schedule a job when an agent starts",
  the seven-day rule, "When there is no reset time yet", "When the job fires", "The next job", "What the agent does",
  "Delete the job" and "Do not use these".
- [docs/dev/handoff.md](dev/handoff.md): "The suggestion of a handoff", "The handoff file", "The items of a handoff
  file", "The last item id", "The check of the handoff folder", "The end of a handoff", "The stop and the start", "A
  topic handoff" and "The hold of the items".
- [docs/dev/handoff-orchestrator.md](dev/handoff-orchestrator.md): "The long-running orchestrator", "The landing count",
  "The steps of the old orchestrator", "The handoff file of the orchestrator" and "The start of the new orchestrator".
- [docs/dev/limits.md](dev/limits.md): "Limits", the own-worktree rule, the update rule, the local-commit rule, the
  shared-clone rule, the address rule, the answer-wait rule and the failure rule.

## The request rule

The terms of this rule:

- The sending orchestrator is the orchestrator that sends a request to another orchestrator.
- The receiving orchestrator is the orchestrator that gets the request.
- The requested change is the action that the request asks the receiving orchestrator to do.

The rules:

- The messages between orchestrators that go straight, as the intro of this page lists them, still go straight from
  orchestrator to orchestrator. Each one keeps its own rules. The hold before an install of tasker, in
  [the hold before an install](dev/release.md#the-hold-before-an-install), also goes straight and keeps its own rules.
- Each other request that needs a decision of the user goes through the operator of the receiving orchestrator. An
  example is "our user wants X". The sending orchestrator judges whether a request needs a decision of the user. This
  judgment is open on purpose. The sending orchestrator sends the request to `orchestrator-<slug>` of the other
  milestone with `SendMessage`.
- The receiving orchestrator does not do the requested change. It sends an item to its own `operator-<slug>`, in the
  form of [The form of an item](dev/operator-items.md#the-form-of-an-item). The answer of the item is the decision of
  the user. The recommendation mode of [A decision of the user](dev/working-with-the-user.md#a-decision-of-the-user)
  does not cover this item.
- After the answer, the receiving orchestrator does the requested change only if the user accepts it. Then it tells the
  sending orchestrator the decision of the user with `SendMessage`. The sending orchestrator does its own step that
  matches the request, if it has one, only after an accept. An example of such a step is a message to its own agent.
- A message of this rule fails when the send fails or when no session of the target name runs. Then
  [the failure rule](dev/limits.md#the-failure-rule) applies to the orchestrator that sends it.
- When the sending orchestrator sends a request that needs a decision of the user, it also sends its own
  `operator-<slug>` one report for that request. The report is in the form of The form of an item. The same holds for
  each relayed change of a landing order under the bullet "Only the user changes a landing order of the overlap rule" of
  [Land the work](dev/land-the-work.md#land-the-work).

This table gives each change of a request of this rule:

| Change                | Sending orchestrator                                       | Receiving orchestrator                                     | Operators                                                      | Who tells whom                                                                 |
| --------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| The request goes out  | Waits for the decision                                     | Does not do the requested change                           | The operator of the sending orchestrator gets the report       | The sending orchestrator tells the receiving orchestrator and its own operator |
| The item goes out     | Waits for the decision                                     | Waits for the answer                                       | The operator of the receiving orchestrator holds the item open | The receiving orchestrator tells its own operator                              |
| The user accepts      | Waits for the decision                                     | Does the requested change                                  | The item closes                                                | The operator tells the receiving orchestrator                                  |
| The user rejects      | Waits for the decision                                     | Changes nothing                                            | The item closes                                                | The operator tells the receiving orchestrator                                  |
| The decision goes out | Does its matching step only after an accept                |                                                            |                                                                | The receiving orchestrator tells the sending orchestrator, with `SendMessage`  |
| A message fails       | The failure rule applies to the orchestrator that sends it | The failure rule applies to the orchestrator that sends it |                                                                | The orchestrator that sends it tells its own user                              |

The reasons for this rule:

- The notices and the hold before an install need no decision of the user, and they need speed.
- A message from another session is not a word of the user, as [The operator](dev/working-with-the-user.md#the-operator)
  says.
- The relay sentences of a landing order already ask the user through the operator.
- A change to an issue in flight keeps its own bullet, because the requester of that bullet asks its own user before the
  [change-of-scope comment](dev/plan-review.md#the-change-of-scope-comment).
