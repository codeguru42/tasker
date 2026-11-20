# Orchestrator

[The orchestration pages](orchestrator.md) give the rules for an orchestrator. The orchestrator is the assistant session
that runs one [scope](dev/GLOSSARY.md). It picks tickets and starts one task subagent for each ticket. It moves the
cards and sets the landing order.

A ticket is an issue on the project board. A task subagent, as [GLOSSARY.md](dev/GLOSSARY.md) defines it, runs the steps
of ["Run one ticket"](dev/run-one-ticket.md#run-one-ticket) for that ticket. The user is the person who works with the
sessions, as [GLOSSARY.md](dev/GLOSSARY.md) says. The user starts the orchestrator, as
[The start of an orchestrator](#the-start-of-an-orchestrator) says. The user can type in the session of the
orchestrator, but most words of the user reach it through its question pane. No one measured how a session queues a text
that arrives during a turn. The user answers a permission prompt in the tab of the orchestrator, as
[A blocked session](dev/operator-start.md#a-blocked-session) says. The orchestrator of the kind `claude` reads its own
name and its slug from the first line of the output of `ListAgents`, as [sessions.md](sessions.md) says. A pi
orchestrator uses the read of [sessions.md](sessions.md) that names `PI_SESSION_FILE`. A task is the record that tasker
keeps for one ticket. tasker moves the task from state to state, for example from `awaiting_plan_review` to `approved`.

Memory is the files where an assistant keeps notes between sessions. Memory is not in the repo.

The orchestrator asks the user each open question in its own question pane, as [question-pane.md](dev/question-pane.md)
says. It shows each report as text in its own tab. It sends no item to an operator, and no answer of an operator ends a
wait. [The operator](dev/working-with-the-user.md#the-operator) of working-with-the-user.md says how "tell the user" or
"ask the user" reads. A report or a question to the user that a rule of the orchestration pages calls a reply follows
the same split: a report shows in the tab, and a question goes to the pane. When a rule waits for the user, the answer
of the question that the rule waits for ends the wait. The orchestrator sends each lesson, each finding of a session
review, each recurrence and each proposed issue only to `planner-<slug>` of its own slug, as the planner bullet of
[The prompt of a task subagent](dev/pick-the-tickets.md#the-prompt-of-a-task-subagent) says. The messages between
orchestrators that go straight are the doc notice of [the notice rule](dev/doc-reads.md#the-notice-rule), the
broken-test notice of [A failed CI run](dev/ci-wait.md#a-failed-ci-run), the messages of
[the hold rule](dev/land-the-work.md#the-hold-rule), a landing order of
[the overlap rule](dev/land-the-work.md#the-overlap-rule), a change to an issue in flight
([Land the work](dev/land-the-work.md#land-the-work)) and the messages of
[the hold before an install](dev/release.md#the-hold-before-an-install). [The request rule](#the-request-rule) covers
each other request between orchestrators that needs a decision of the user.

tasker also starts its own sessions for plan, execute and review. They run in a worktree of the tasker clone. They are
not task subagents and they do not run the steps on [the orchestration pages](orchestrator.md).

The orchestrator and its task subagents run tasker from the local clone of the orchestrator. For one ticket, the task
subagent of that ticket is the driver that [docs/dev/rebase-conflicts.md](dev/rebase-conflicts.md) names.

Every `tasker` command on [the orchestration pages](orchestrator.md) is the installed `tasker`: the `tasker` command on
the PATH from a global install. The installed `tasker` is a build of this repo, from a version that can be older than
`main`. For this reason, `skills/tasker/SKILL.md` does not list its commands (see
[The installed skill](dev/rules.md#the-installed-skill)). See the install bullet of [Limits](dev/limits.md#limits) in
`docs/dev/limits.md`. For the known behaviors of the installed `tasker`, see
[the facts of the installed tasker](dev/tasker-commands.md#the-facts-of-the-installed-tasker).

The start docs of the orchestrator are `docs/orchestrator.md`, the pages of the list "The pages" below,
[docs/dev/rules.md](dev/rules.md), [docs/dev/working-with-the-user.md](dev/working-with-the-user.md),
[docs/sessions.md](sessions.md) and [docs/dev/GLOSSARY.md](dev/GLOSSARY.md). At its start, the orchestrator makes a
complete read of each start doc before any other work, as [the doc-read rule](dev/doc-reads.md#the-doc-read-rule) says.

The orchestration pages are `docs/orchestrator.md` and the pages of this list, "The pages":

- [docs/dev/question-pane.md](dev/question-pane.md): "A question pane".
- [docs/dev/pick-the-tickets.md](dev/pick-the-tickets.md): "Pick the tickets", the stacking rule, the stacked-ticket
  rule, the parent-hold rule, the link offer, the open-question rule, the defer rule, "A ticket on hold" and "The prompt
  of a task subagent".
- [docs/dev/doc-reads.md](dev/doc-reads.md): the re-read rule, the notice rule, the task subagent notice and the
  doc-read rule.
- [docs/dev/run-one-ticket.md](dev/run-one-ticket.md): "Run one ticket", the final report, the comeback rule, the base
  rule, the add-work rule, the diff read and the measure rule.
- [docs/dev/plan-review.md](dev/plan-review.md): the repo-files rule, the fact test, the issue check, the stop rule, the
  change-of-scope comment, the design-gap rule and the quote check.
- [docs/dev/tasker-commands.md](dev/tasker-commands.md): the plain-form rule, the tool-block rule, the command rules,
  the facts of the installed tasker and the run times.
- [docs/dev/verify-failures.md](dev/verify-failures.md): the verify-failure rule, bisect diagnosis, the broken-commit
  steps, the session check, the manual fix and the commit check.
- [docs/dev/ci-wait.md](dev/ci-wait.md): the CI wait and "A failed CI run".
- [docs/dev/review-findings.md](dev/review-findings.md): "Review findings" and the docs-only update.
- [docs/dev/land-the-work.md](dev/land-the-work.md): "Land the work", the overlap rule, the Docs rule, the hold rule and
  the stuck-task rule.
- [docs/dev/quota.md](dev/quota.md): "Quota", "Terms", "The delay of each task subagent", "Schedule a job when a task
  subagent starts", the seven-day rule, "When there is no reset time yet", "When the job fires", "The next job", "What
  the task subagent does", "A pi stop", "The pi wait", "A Codex limit", "Delete the job" and "Do not use these".
- [docs/dev/handoff.md](dev/handoff.md): "The suggestion of a handoff", "The handoff file", "The items of a handoff
  file", "The last item id", "The check of the handoff folder", "The end of a handoff", "The stop and the start", "A
  topic handoff" and "The hold of the items".
- [docs/dev/handoff-orchestrator.md](dev/handoff-orchestrator.md): "The long-running orchestrator", "The landing count",
  "The steps of the old orchestrator", "The handoff file of the orchestrator" and "The start of the new orchestrator".
- [docs/dev/limits.md](dev/limits.md): "Limits", the own-worktree rule, the update rule, the local-commit rule, the
  shared-clone rule, the address rule, the answer-wait rule and the failure rule.

## The start of an orchestrator

This section gives the scope, the slug and the start of an orchestrator. [docs/dev/GLOSSARY.md](dev/GLOSSARY.md) defines
the scope, the slug and the own name.

### The scope

Each orchestrator works on one scope. A milestone scope is one milestone of the repo, and it holds the issues of that
milestone. A set scope is a set of issues that the first prompt names. The issues of a set scope can belong to any
milestone or to no milestone. The kind of the scope of an orchestrator does not change in its session, and no step of
the docs changes it.

The first prompt is the last argument of the start command of a session. The column "First prompt" of
[the seam of an agent kind](config.md#the-seam-of-an-agent-kind) gives this form.

Several orchestrators run at the same time, one for each scope. A milestone scope and a set scope can run at the same
time. No rule limits the count of orchestrators.

### The slug

The user gives the slug in the first prompt. The slug has only lowercase ASCII letters, digits and `-`. The slug of a
milestone scope is the first word of the milestone title in lowercase. The slug of a set scope is not the first word of
the title of an open milestone. The user starts no orchestrator with another slug, for example `M31` or `my scope`.

The own name of an orchestrator is `orchestrator-<slug>`. The role is the part before the first `-`, so a `-` in the
slug keeps the role. For example, `orchestrator-docs-fix` has the role `orchestrator` and the slug `docs-fix`. Each rule
of the docs that finds the orchestrator of a milestone uses the slug of that milestone.

No two orchestrators that run at the same time have the same slug. The reason: two sessions with one name break each
`SendMessage` to that name, as [A handoff](dev/operator-start.md#a-handoff) says. The kind `pi` has no tool that lists
sessions, as the column "Messages" of the seam gives it. So for a pi orchestrator, the user alone keeps the slugs apart.

### The steps of the user

The user starts each orchestrator in these steps. They take the form of step 2 of
[The order of a milestone](dev/operator-start.md#the-order-of-a-milestone).

1. Run `tasker show-config --repo <key>`. `<key>` is the repo key of the local clone, for example `codeguru42/tasker`.
2. If the command fails, start no orchestrator.
3. Read `sessions.kind` and the entry of `sessions.models.orchestrator` in the output.
4. Open a new herdr tab. The folder of the tab is the local clone.
5. In that tab, run the start command of the kind, with the own name and the first prompt.

For the kind `claude`, the start command is:

```sh
claude -n orchestrator-<slug> --model <model> --effort <effort> "<first prompt>"
```

For the kind `pi`, the start command is:

```sh
pi -n orchestrator-<slug> --provider <upstream> --model <model> --thinking <effort> "<first prompt>"
```

The row of the kind in [the seam of an agent kind](config.md#the-seam-of-an-agent-kind) gives each flag and the place of
the first prompt. If `sessions.models.orchestrator` has no entry, the user leaves out the model flags and the effort
flag. An example is `claude -n orchestrator-m31 "<first prompt>"`.

The tab list of the operator does not hold the tab of an orchestrator that the user starts.
[Stop a session](dev/operator-start.md#stop-a-session) covers such a tab. The operator tells the user, and it closes the
tab only on the word of the user. The user closes the tab of an orchestrator that the user starts. In a handoff, the old
orchestrator closes its own tab, as
[The start of the new orchestrator](dev/handoff-orchestrator.md#the-start-of-the-new-orchestrator) says.

In a handoff, the old orchestrator starts the new orchestrator, as
[The start of the new orchestrator](dev/handoff-orchestrator.md#the-start-of-the-new-orchestrator) says.

### The first prompt

The first prompt names the own name and the scope. It also names the fetch and the reads of `AGENTS.md` and
`docs/orchestrator.md` from `origin/main`, as [the doc-read rule](dev/doc-reads.md#the-doc-read-rule) gives them. It
also asks for a complete read of each start doc before any other work.

The first prompt of a milestone scope has this form. `<milestone>` is the title of the milestone.

```text
You are orchestrator-<slug>. Your scope is the milestone <milestone>. Run git fetch origin. Then run git show origin/main:AGENTS.md and git show origin/main:docs/orchestrator.md. Read each start doc in full before any other work. Then start.
```

The first prompt of a set scope has this form. Each `<key>` is an issue key in a form of
[docs/dev/issue-keys.md](dev/issue-keys.md).

```text
You are orchestrator-<slug>. Your scope is the issues <key>, <key> and <key>. Run git fetch origin. Then run git show origin/main:AGENTS.md and git show origin/main:docs/orchestrator.md. Read each start doc in full before any other work. Then start.
```

For example, the first prompt for the milestone `M31 — Orchestrator` is:

```text
You are orchestrator-m31. Your scope is the milestone M31 — Orchestrator. Run git fetch origin. Then run git show origin/main:AGENTS.md and git show origin/main:docs/orchestrator.md. Read each start doc in full before any other work. Then start.
```

An example of the scope part of a set scope is:

```text
Your scope is the issues codeguru42/tasker#756, codeguru42/tasker#522 and codeguru42/tasker#748.
```

### The start checks

After the complete start reads and before its role work, the orchestrator does these steps in order. If a step fails,
the orchestrator does no role work. It tells the user in its own tab, with the error if one exists.

1. Read your own name, as [docs/sessions.md](sessions.md) says.
2. For the kind `claude`, read the output of `ListAgents`. If the read fails, stop.
3. If any row of the output of `ListAgents` has your own name, stop. A second session with that name runs.
4. Make sure that the slug of your own name is the slug of the first prompt.
5. Make sure that the slug has only lowercase ASCII letters, digits and `-`.
6. Make sure that the first prompt names exactly one scope. A first prompt with no scope fails, and so does a first
   prompt with a milestone and a set.
7. Read the milestones with `gh api --paginate 'repos/codeguru42/tasker/milestones?state=all&per_page=100'`. If the read
   fails, stop.
8. For a milestone scope, make sure that the slug is the first word of the title of that milestone, in lowercase.
9. For a set scope, make sure that the slug is not the first word of the title of an open milestone, in lowercase.

In these steps, "stop" means: do no role work, and tell the user in your own tab. A pi orchestrator does not do steps 2
and 3. For a pi orchestrator, the user alone keeps the slugs apart.

If the first prompt names a handoff file, a row of `ListAgents` with the own name can be the old orchestrator. Then the
orchestrator runs `herdr agent list` and reads each row whose `terminal_title_stripped` is the own name. Its own row is
the row whose `pane_id` is `HERDR_PANE_ID`. Each other such row must have the `tab_id` that the handoff file gives as
the tab id of the old orchestrator.

If each other row has that tab id, the orchestrator tells the user in its own tab that the old orchestrator still runs.
Then it goes on with step 4. If a row has another tab id, step 3 stops the orchestrator. If `HERDR_PANE_ID` is not set,
or the handoff file gives no tab id, step 3 stops it. If `herdr agent list` fails, step 3 stops it, and it tells the
user the command and the error.

The first line of the output of `ListAgents` names the own session, as [docs/sessions.md](sessions.md) says. The rows
after it name the other sessions. The task subagent of #961 measured steps 2 and 3 on 2026-11-19, with Claude Code
2.1.329 and herdr 0.9.3, in one herdr workspace. It ran
`claude -n test-dup-961 "Run ListAgents and print its output, then stop."` in two tabs with `herdr agent start`.
`claude -n` did not refuse the second start, and both sessions ran with different session refs.

Each session did not list itself in `ListAgents`. Each session listed the other session as a row with the name
`test-dup-961`. The facts hold only with herdr as the start tool.

The measure had four possible outcomes:

- `claude -n` refuses the second start: the user sees the error, and no second session runs. Step 3 stays.
- Both sessions start, and `ListAgents` lists both: step 3 stops the new orchestrator. This outcome happened.
- Both sessions start, and `ListAgents` lists only one: step 3 cannot see the second session. The user alone then keeps
  the slugs apart, as for pi.
- No measure: the user alone keeps the slugs apart, as for pi, and the docs say that no one measured the case.

### The states of a start

| State                         | User                         | Orchestrator                       | Who tells whom                                 |
| ----------------------------- | ---------------------------- | ---------------------------------- | ---------------------------------------------- |
| The read of the configuration | Runs `tasker show-config`    |                                    |                                                |
| The read fails                | Starts no orchestrator       |                                    | The command tells the user                     |
| The start                     | Runs the command of the kind | Runs the fetch and the start reads |                                                |
| A start check fails           |                              | Does no role work                  | The orchestrator tells the user in its own tab |
| The start checks pass         |                              | Starts its role work               |                                                |

## The request rule

The terms of this rule:

- The sending orchestrator is the orchestrator that sends a request to another orchestrator.
- The receiving orchestrator is the orchestrator that gets the request.
- The requested change is the action that the request asks the receiving orchestrator to do.

The rules:

- The messages between orchestrators that go straight, as the intro of this page lists them, still go straight from
  orchestrator to orchestrator. Each one keeps its own rules. The hold before an install of tasker, in
  [the hold before an install](dev/release.md#the-hold-before-an-install), also goes straight and keeps its own rules.
- Each other request that needs a decision of the user goes through the question pane of the receiving orchestrator. An
  example is "our user wants X". The sending orchestrator judges whether a request needs a decision of the user. This
  judgment is open on purpose. The sending orchestrator sends the request to `orchestrator-<slug>` of the other
  milestone with `SendMessage`.
- The receiving orchestrator does not do the requested change. It asks the decision of the user in its own question
  pane, as [Start](dev/question-pane.md#start) says. The decision in the pane is the decision of the user. The
  recommendation mode of [A decision of the user](dev/working-with-the-user.md#a-decision-of-the-user) does not cover
  this question.
- After the answer, the receiving orchestrator does the requested change only if the user accepts it. Then it tells the
  sending orchestrator the decision of the user with `SendMessage`. The sending orchestrator does its own step that
  matches the request, if it has one, only after an accept. An example of such a step is a message to its own task
  subagent.
- A message of this rule fails when the send fails or when no session of the target name runs. Then
  [the failure rule](dev/limits.md#the-failure-rule) applies to the orchestrator that sends it.
- When the sending orchestrator sends a request that needs a decision of the user, it also shows one report for that
  request as text in its own tab. The same holds for each relayed change of a landing order under the bullet "Only the
  user changes a landing order of the overlap rule" of [Land the work](dev/land-the-work.md#land-the-work).

This table gives each change of a request of this rule:

| Change                | Sending orchestrator                                       | Receiving orchestrator                                     | Question pane                                                | Who tells whom                                                                |
| --------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| The request goes out  | Waits for the decision. Shows its report in its tab        | Does not do the requested change                           |                                                              | The sending orchestrator tells the receiving orchestrator and its own user    |
| The question goes out | Waits for the decision                                     | Waits for the answer                                       | The receiving orchestrator asks the question in its own pane | The receiving orchestrator tells its own user                                 |
| The user accepts      | Waits for the decision                                     | Does the requested change                                  | The pane closes by its rules                                 | The user tells the receiving orchestrator in the pane                         |
| The user rejects      | Waits for the decision                                     | Changes nothing                                            | The pane closes by its rules                                 | The user tells the receiving orchestrator in the pane                         |
| The decision goes out | Does its matching step only after an accept                |                                                            |                                                              | The receiving orchestrator tells the sending orchestrator, with `SendMessage` |
| A message fails       | The failure rule applies to the orchestrator that sends it | The failure rule applies to the orchestrator that sends it |                                                              | The orchestrator that sends it tells its own user                             |

The reasons for this rule:

- The notices and the hold before an install need no decision of the user, and they need speed.
- A message from another session is not a word of the user, as [The operator](dev/working-with-the-user.md#the-operator)
  says.
- The relay sentences of a landing order show their report in the tab of the orchestrator and ask the user in a pane.
- A change to an issue in flight keeps its own bullet, because the requester of that bullet asks its own user before the
  [change-of-scope comment](dev/plan-review.md#the-change-of-scope-comment).
