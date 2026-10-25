# Pick the tickets

The reader of this page is the orchestrator.

## Pick the tickets

The orchestrator does all the steps of this section.

- Take tickets only from the Todo column of the project board, and only from the current milestone. Do not start a
  ticket from a later milestone.
- The earlier-blocker offer: a ticket of the milestone can wait on an open blocker of an earlier milestone that no
  orchestrator runs. An earlier milestone is a numbered milestone with a lower number, for example M19 before M20. The
  number is the number in the title of the milestone, for example 19 in "M19 — Polish". A blocker of "Docs", of "Future"
  or of no milestone is not of an earlier milestone. Then the orchestrator tells the user and offers to run those
  blockers, as [A decision of the user](working-with-the-user.md#a-decision-of-the-user) says. The orchestrator runs
  them only on the word of the user. The blockers keep their milestone. For such a blocker, the word of the user wins
  over the words "only from the current milestone" of the first bullet of this section. The sentence "Do not start a
  ticket from a later milestone" does not cover such a blocker, because the blocker is of an earlier milestone. Each
  other bullet of this section still applies to the start of such a blocker, for example
  [the stacking rule](#the-stacking-rule) and the limit of 3 agents. If the user says no, the orchestrator makes no new
  offer for that ticket and those blockers. The user can still ask the orchestrator to run them at any time. No
  orchestrator runs a blocker when two facts are true. First, the output of `tasker status` lists no task for the full
  issue key of the blocker. Second, the session list of the tools, for example `ListAgents`, has no session
  `orchestrator-<milestone>` for the milestone of the blocker. [The notice rule](doc-reads.md#the-notice-rule) gives the
  form of the name. `gh issue view <blocker> --json milestone -q '.milestone.title'` gives the milestone of the blocker.
  A missing match is an answer and not a failure: no task for the key means "no task", and no such session means "no
  session". If `tasker status` fails, [the failure rule](limits.md#the-failure-rule) applies, and the orchestrator makes
  no offer at that moment. If the session list fails, the failure rule applies, and the orchestrator makes no offer at
  that moment. If the read of the milestone fails, the failure rule applies, and the orchestrator makes no offer at that
  moment. After a failure, the orchestrator does the check again at its next read of the board. On 2026-10-18, each
  ticket of M20 waited on a ticket of M19 (#137, #61, #63, #47 and #236) that no orchestrator ran, and the user told
  orchestrator-m20: "Go ahead and work on the issues from M19 that block M20 issues."
- Start a ticket only as [the stacking rule](#the-stacking-rule) says. No orchestrator that knows of an open broken-test
  issue starts a ticket, except that issue itself (see the broken-test rule in
  [A failed CI run](ci-wait.md#a-failed-ci-run)).
- The priority rule: among the tickets that can start, the orchestrator starts a ticket with `priority: high` first.
  Then it starts a ticket with `priority: medium`, then a ticket with no priority label, then a ticket with
  `priority: low`. Two tickets of the same priority have no order. To read the labels, run
  `gh issue list --milestone "<milestone>" --state open --label "priority: high" --limit 1000 --json number`. Run the
  same command for the other labels. If a command fails, [the failure rule](limits.md#the-failure-rule) applies, and the
  orchestrator starts no ticket until the read works. A ticket that is on none of the three lists has no priority label.
  The rule covers the tickets of the milestone of the orchestrator. It changes no other rule of this section: a ticket
  with a label still waits as [the stacking rule](#the-stacking-rule) says, and it still waits for the shared-file rule
  and the move rule. A rule that stops a start still wins, for example the ban of
  [A failed CI run](ci-wait.md#a-failed-ci-run), step 1 of
  [The steps of the old orchestrator](handoff-orchestrator.md#the-steps-of-the-old-orchestrator) or a hold of the user.
  The ticket of a parked task that comes back to Todo of the current milestone takes its place by its label (see
  [the defer rule](#the-defer-rule)). When the orchestrator reads the board again after a landing, it applies the rule
  again. Then a ticket with `priority: high` or `priority: medium` that joined the milestone and can start takes the
  next free agent before the tickets with no label.
- Each time a ticket lands, read the board again: the open issues of the milestone and the issues that block them. A new
  issue can join a milestone while a run is in progress. In one milestone, a new issue stayed in Todo for hours, because
  the orchestrator read the board only at the start. The bullet "When the final report of the agent of a ticket says
  that the ticket landed" of [Land the work](land-the-work.md#land-the-work) gives the place of this read among the
  landing steps.
- Run at most 3 agents at the same time, one ticket for each agent.
- Do not run two tickets at the same time when both edit the same shared file, for example a file under `test/helpers/`
  or `docs/dev/code-conventions.md`. Start the second ticket after the first one lands. This bullet and
  [the link offer](#the-link-offer) count two kinds of files of a ticket before its start: the files that the issue
  names, and each file that a hint of the orchestrator for the first refine asks the ticket to change. Examples are
  `AGENTS.md` for the index entry of a page and `docs/dev/orchestrator.md` for the list "The pages". On 2026-10-19, the
  orchestrator gave #339 and #314 a hint to change their index entries in `AGENTS.md` and in the list "The pages", and
  #382 already changed `AGENTS.md`. As a result, the three tickets shared files, and the orchestrator had to set the
  landing order #382, #314, #339. If a ticket can start except for this bullet, because it shares a file with a task in
  flight of the same milestone, [the link offer](#the-link-offer) applies. This bullet covers two tickets of the
  milestone of the orchestrator. For a task in flight of another milestone,
  [the overlap rule](land-the-work.md#the-overlap-rule) applies instead. For a stacked ticket and its parent,
  [the stacking rule](#the-stacking-rule) wins.
- The move rule: a moving ticket is a ticket that moves or splits a whole shared file, for example the split of
  `test/helpers.ts` into the folder `test/helpers/` on #140. The orchestrator starts a moving ticket only after each
  task in flight that changes that file has landed. This rule covers the tasks of every milestone, except a parked task
  (see [the defer rule](#the-defer-rule)). For the start of a moving ticket, this rule wins over the last sentence of
  the bullet before it. [The overlap rule](land-the-work.md#the-overlap-rule) gives the steps that list the tasks in
  flight and their files. The reason: a moving ticket changes each line of the file. As a result, a ticket that lands
  later in that file causes a rebase conflict in each commit, or one more refine before `tasker approve`.
  [The stacking rule](#the-stacking-rule) gives one exception for a parent.
- If a task in flight that changes the file of a moving ticket is far from landing, for example in
  `awaiting_plan_review`, the orchestrator asks the user. The user decides whether the orchestrator waits or starts the
  moving ticket now. The orchestrator follows [A decision of the user](working-with-the-user.md#a-decision-of-the-user).
  If the user answers "start now", the orchestrator sets a landing order between the moving ticket and that task in
  flight, as [Land the work](land-the-work.md#land-the-work) says. For a moving ticket of the milestone "Docs" and a
  task in flight of a numbered milestone, [the Docs rule](land-the-work.md#the-docs-rule) sets no landing order. For
  that moving ticket and that task in flight, the answer of the user wins over the sentence "Start the second ticket
  after the first one lands." of the shared-file bullet above. For a task in flight of another milestone,
  [the overlap rule](land-the-work.md#the-overlap-rule) applies.
- When a ticket starts, the orchestrator moves its card to In progress. `tasker start` does not move the card. The board
  moves the card to Done when `tasker finish` closes the issue.
- When the Todo column of the milestone is empty, the orchestrator waits until the last ticket of the milestone closes
  and no task of the milestone is in flight. Then the orchestrator runs `/session-review` before it stops and tells the
  user. Do not write the issues of the next milestone. A round is one run of `/session-review`. The orchestrator runs
  `/session-review` again after each round that found something. The rounds end when a round finds nothing new. A round
  can find a lesson that an earlier round missed, or a new fact from the answers of the user. A finding is handled when
  the orchestrator sent it to the planner, as the planner bullet of [The prompt of an agent](#the-prompt-of-an-agent)
  says. A finding is also handled when the planner filed it as an issue or added it to an open issue. A finding is also
  handled when the orchestrator wrote it to memory, for a fact that the rules keep out of the tracked docs. A finding is
  also handled when the user decided to drop it. A finding that is not handled is open. When each finding is handled,
  the orchestrator tells the user one time that the milestone is done, and it lists each finding with its state. The
  orchestrator does not ask the user to close the milestone, and it does not bring the milestone up again in later
  replies. On 2026-10-25, orchestrator-m21 asked the user several times whether to ask the planner to close M21, and the
  user said: "I will decide when to close M21". The milestone closes only when the user says so, as
  [Milestones](issues.md#milestones) of issues.md says. The stop of this bullet does not cover a long-running
  orchestrator (see [The long-running orchestrator](handoff-orchestrator.md#the-long-running-orchestrator)). The review
  rounds of this bullet, the list of the findings and the report that the milestone is done cover a long-running
  orchestrator, before it moves to the next milestone.

### The stacking rule

A blocker is an issue that blocks the ticket. The orchestrator can start a ticket when each blocker is closed or is
ready to stack. A blocker of another milestone counts the same way. A chain is a row of tickets in which each ticket
blocks the next one.

The stack is the default. The orchestrator starts a ticket at the first moment that this rule allows. That moment comes
when these facts are true:

- Each blocker of the ticket is closed or is ready to stack.
- The checks of this rule pass: the wait cases, the check of the tip of the base of the parent and the wait for a fix
  round of the parent.
- A [slot](quota.md#the-delay-of-each-agent) is free, or the orchestrator keeps a slot for the ticket, as
  [the parent-hold rule](#the-parent-hold-rule) says.

The other rules of [Pick the tickets](#pick-the-tickets) still apply. The orchestrator does not wait for the landing of
the parent. The reason: on 2026-10-17, the Docs orchestrator waited for each parent to land through most of the day. The
chain ran slower than the user wanted. The user said: "Stack one as soon as you can". On 2026-10-18, #322 to #336 ran
stacked with no rebase conflict.

The user can tell the orchestrator to wait for each landing, for example to test a new version of tasker on a few
tickets. Then the word of the user wins over the default stack until the user ends it. On 2026-10-24, the user said: "we
are going slow right now to dogfood a couple of issues to test the new version".

A ready state is one of these states: `awaiting_work_review`, `reviewing`, `reviewed` or `accepted`. A blocker is ready
to stack when its issue is open, its task is in the same repo, and `tasker show <blocker issue>` prints a ready state.
`tasker start` then bases the new task on the branch of the blocker.

The orchestrator waits in these cases:

- The blocker is in `executed`, `verifying`, `merging`, `landed`, `finishing` or `cleanup_failed`. Such a blocker is
  minutes from a ready state or from its close. A start now makes a task without the work of the blocker.
- The blocker is in any other state.
- Two or more blockers of the ticket are open. The ticket waits until at most one is open, because `tasker start`
  refuses two ready blockers.

Before the orchestrator starts a stacked ticket, it makes sure that the branch of the parent contains the tip of the
base of the parent. The orchestrator first runs `git fetch --multiple tasker origin` in its local clone. Then the
orchestrator reads `<parent tip>` with `git rev-parse --verify tasker/<parent branch>`, as
[the shared-clone rule](limits.md#the-shared-clone-rule) says. The orchestrator reads `<base tip>` the same way with
`git rev-parse --verify origin/<base branch>`, with the base of [the base rule](run-one-ticket.md#the-base-rule) for the
parent. The orchestrator then runs the `git merge-base --is-ancestor` step of
[the diff read](run-one-ticket.md#the-diff-read) as `git merge-base --is-ancestor <base tip> <parent tip>`.

If the exit code is 1, the orchestrator tells the agent of the parent to run `tasker update-branch`.

The commands of the check are the fetch, the two hash reads and `git merge-base --is-ancestor`. If a command of the
check fails, or the exit code of `git merge-base --is-ancestor` is not 0 and not 1,
[the failure rule](limits.md#the-failure-rule) applies to the orchestrator. Then the stacked ticket does not start at
that moment.

If the review loop 1 of the parent has findings, or the diff read of the parent finds work, the orchestrator waits. It
waits until the agent of the parent ends that round and the parent is in a ready state again. The orchestrator tells the
agent of the parent to do that round. A fix as a new commit on top of the parent is better than a fixup, because a fixup
rewrites the commits under the stacked ticket. While the parent ends its update or its fix round, the orchestrator
starts no stacked ticket on this parent. Other tickets start as the other rules say.

The order of the orchestrator wins over the hold of [the parent-hold rule](#the-parent-hold-rule) for the
`tasker update-branch` of the check and for the fix round. For the findings of review loop 1, the fix round is the
refine of step 8 of [Run one ticket](run-one-ticket.md#run-one-ticket). It includes the commands after it, up to the
next ready state. For the work of the diff read, the fix round is `tasker review <issue> "<feedback>"` of
[the add-work rule](run-one-ticket.md#the-add-work-rule) and the commands after it, up to the next ready state. After
the next ready state, the hold stays for each later command.

On 2026-10-17, the user decided for #172: "do the `update-branch` before starting stacked children".

If the orchestrator plans to start a ticket on a blocker that is not ready to stack yet,
[the parent-hold rule](#the-parent-hold-rule) applies.

The orchestrator reads the states at these moments:

- Each time it reads the board
- Before each start
- After a report of a ready state
- After a new link of [the link offer](#the-link-offer)
- When it frees a slot for a reason other than a landing, as [Delete the job](quota.md#delete-the-job) says

A report of a ready state says that a task is in a ready state of [the stacking rule](#the-stacking-rule). The report
can come from an agent or from another orchestrator. A report from another orchestrator comes through the messages of
[the hold rule](land-the-work.md#the-hold-rule) or of [the stacked-ticket rule](#the-stacked-ticket-rule). The sender
sends only the reports that those rules already give, and a refused message or a missing answer is out of scope (#164).

After a report of a ready state, the orchestrator lists the open issues that the task blocks:
`gh issue view <issue> --json blocking -q '.blocking.nodes[] | select(.state == "OPEN") | .number'`. If the output is
empty, no ticket waits on the task, and the step is complete. For each issue of the list, the orchestrator reads the
milestone: `gh issue view <blocked issue> --json milestone -q '.milestone.title'`. The orchestrator keeps the tickets of
its own milestone. If such a ticket can start by this rule and by the other rules of
[Pick the tickets](#pick-the-tickets), the orchestrator starts it. If a command fails,
[the failure rule](limits.md#the-failure-rule) applies. Then no ticket starts at that moment. The tickets wait until the
next read of the board or the next start.

The broken-test ban of the second bullet of [Pick the tickets](#pick-the-tickets) still wins. See
[A failed CI run](ci-wait.md#a-failed-ci-run).

Two exceptions apply to a stacked ticket and its parent:

- The shared-file bullet does not stop the start, because the stacked task builds on the change of the parent. For each
  other task in flight, the bullet stays.
- The move rule still wins. A moving ticket does not start while another task in flight changes its file. The parent
  alone does not block a stacked moving ticket, because the stacked task holds the change of the parent.

### The stacked-ticket rule

A stacked ticket is a ticket that `tasker start` based on the branch of a blocker. Its parent is the ticket of that
blocker. The stacked orchestrator is the orchestrator of the stacked ticket. The parent orchestrator is the orchestrator
of the parent.

Before a stacked ticket starts, [the parent-hold rule](#the-parent-hold-rule) can hold the parent. For the output of
`tasker start` when the parent is not ready to stack, see
[the facts of the installed tasker](tasker-commands.md#the-facts-of-the-installed-tasker).

When a stacked ticket starts, the stacked orchestrator does these steps:

1. Set a landing order with the parent as the earlier ticket, as [Land the work](land-the-work.md#land-the-work) says.
   Do this also when the parent belongs to another orchestrator.
2. Tell the stacked agent that the ticket is stacked, and name the parent.
3. For a file that the parent changes, tell the stacked agent that the fourth case of
   [the stop rule](plan-review.md#the-stop-rule) does not apply, because the stacked task builds on that change.

These rules apply to a stacked ticket and its parent. The user decided them on 2026-10-16.

- This rule wins over [the Docs rule](land-the-work.md#the-docs-rule) and over the sentence "A ticket of an earlier
  milestone lands first" of [the overlap rule](land-the-work.md#the-overlap-rule). The stacked orchestrator sets the
  landing order with the parent first, and the wait rules of [Land the work](land-the-work.md#land-the-work) apply. The
  Docs rule still covers each other shared file.
- The pair has no swap, because `tasker merge` refuses a stacked task. The bullet "If the orchestrator changes the
  landing order" and the bullet "Only the user changes a landing order of the overlap rule" do not apply to the pair.
- If the user postpones the parent (see [the defer rule](#the-defer-rule)), the stacked task cannot land. The stacked
  orchestrator then asks the user to choose: wait, or run `tasker abort` on the stacked task.
- At the start of a stacked ticket, the parent is in `awaiting_work_review` or a later state, so
  [the hold rule](land-the-work.md#the-hold-rule) does not apply at once. If a refine of step 8 of
  [Run one ticket](run-one-ticket.md#run-one-ticket) moves the parent back to `awaiting_plan_review`, the hold rule
  applies as written.
- If the parent belongs to another orchestrator, the stacked orchestrator uses the messages of the hold rule. When the
  stacked ticket starts, the stacked orchestrator sends one message with `SendMessage` to the parent orchestrator, as
  the hold rule does when the hold starts. Then the parent orchestrator sends two reports to the stacked orchestrator
  with `SendMessage`. The first report comes when the parent task is in `awaiting_work_review` or a later state. The
  second report comes when the issue of the parent closes. A refused request or a missing answer is out of scope (#164).

### The parent-hold rule

This rule covers the parent of a stacked ticket before the stacked ticket starts.
[The stacking rule](#the-stacking-rule) gives the ready states. The agent of the parent moves its task out of a ready
state with the refine of step 8 of [Run one ticket](run-one-ticket.md#run-one-ticket),
`tasker review <issue> "<feedback>"` of [the add-work rule](run-one-ticket.md#the-add-work-rule), `tasker update-branch`
or `tasker merge`. `tasker merge` moves the task from `accepted` to `merging` and `landed`. On #215, a refine of step 8
moved the parent out of a ready state before the agents of two stacked tickets ran `tasker start`. `tasker start`
refused both of them (see [the facts of the installed tasker](tasker-commands.md#the-facts-of-the-installed-tasker)).

When the orchestrator plans to start a stacked ticket on a parent that is not ready yet, the orchestrator tells the
agent of the parent to hold. The hold of a parent that belongs to another orchestrator is out of scope. The hold lasts
until the orchestrator tells the agent of the parent that the hold ended. A message to an agent that has ended starts
the agent again (see ["Terms" in "Quota"](quota.md#terms)). If the agent of the parent gets the message while a command
runs, the agent lets the command end and keeps the hold. If the agent of the parent gets the message while it waits for
an answer or a next step, it keeps the hold. Then the agent of the parent ends its turn again, as
[the answer-wait rule](limits.md#the-answer-wait-rule) says.

The orchestrator sends the hold only when a [slot](quota.md#the-delay-of-each-agent) is free for the stacked ticket. If
no slot is free, the orchestrator sends no hold (see the bullet "Run at most 3 agents at the same time" of
[Pick the tickets](#pick-the-tickets)). The reason: a hold with no free slot stalls a fix round of the parent and starts
nothing. On 2026-10-18, orchestrator-docs held #279 for #282 while all 3 slots were in use, and it ended the hold at
once.

When the orchestrator sends the hold, it keeps that free slot for the planned stacked ticket. A kept slot is not free
for another hold or for the start of another ticket. While the hold runs, the orchestrator counts the kept slot as one
of the 3 agents of the bullet "Run at most 3 agents at the same time" of [Pick the tickets](#pick-the-tickets). As a
result, the orchestrator sends at most one hold for one free slot. For a second planned stacked ticket, on the same
parent or on another parent, the orchestrator needs one more free slot.

When the orchestrator starts the agent of the stacked ticket, it gives that agent the kept slot. From then on, the slot
is the slot of that agent and no longer a kept slot. While the hold runs, the kept slot wins over the bullet "When the
orchestrator starts an agent" and over the sentence "Then the next agent that starts takes the slot." of
[The delay of each agent](quota.md#the-delay-of-each-agent). If the hold ends before the orchestrator starts the agent
of the stacked ticket, the kept slot is free again. The user decided this on 2026-10-24.

If no slot is free, the orchestrator keeps no record of the planned start. After the orchestrator frees a slot, as
[Delete the job](quota.md#delete-the-job) says, it applies the stacking rule and this rule again. It does this at its
next read of the states of [the stacking rule](#the-stacking-rule). If the parent is still not ready to stack then, the
orchestrator sends the hold at that moment.

While the hold runs, the agent of the parent continues ["Run one ticket"](run-one-ticket.md#run-one-ticket). After
`tasker verify` passes, the agent of the parent continues with `tasker review`, because `reviewing` and `reviewed` are
ready states. The agent of the parent also runs `tasker dismiss-review` and `tasker accept`, because the task stays in a
ready state.

Before a command that moves the task out of a ready state, the agent of the parent
[stops](limits.md#the-answer-wait-rule). The report gives the state of the task and says that the agent holds. If
`SendMessage` fails, the agent of the parent puts the report in its final answer.

This report is a report of a ready state of the stacking rule. The orchestrator then does the steps of the paragraph of
[the stacking rule](#the-stacking-rule) that starts "After a report of a ready state".

While the hold runs, the agent of the parent waits in place of the command at each of these places:

- The refine of step 8 of [Run one ticket](run-one-ticket.md#run-one-ticket)
- `tasker review <issue> "<feedback>"` of the add-work rule, also when [the diff read](run-one-ticket.md#the-diff-read)
  finds work
- `tasker update-branch` of step 9 and of the diff read
- The early update of [Review findings](review-findings.md#review-findings)
- `tasker update-branch` of the bullet of [Land the work](land-the-work.md#land-the-work) that starts "If a refine, or
  the `tasker review <issue> "<feedback>"` of the add-work rule, must change a file"
- `tasker update-branch` of the bullet "When the issue of the earlier ticket is closed" of Land the work
- `tasker update-branch` of [the comeback rule](run-one-ticket.md#the-comeback-rule)
- `tasker merge` of step 9

The orchestrator reads `tasker show <stacked issue>` of each stacked ticket after each report of the agent of that
stacked ticket, for example the run-end report of `tasker plan` (see
["When there is no reset time yet" in "Quota"](quota.md#when-there-is-no-reset-time-yet)). Before `tasker start`, the
stacked ticket has no task, so the orchestrator waits for such a report before the read. The read does not follow a stop
report of step 2 of ["Run one ticket"](run-one-ticket.md#run-one-ticket), because such a report ends the hold at once.
If `tasker show <stacked issue>` fails, [the failure rule](limits.md#the-failure-rule) applies, and the hold stays.

The orchestrator ends the hold in these cases:

- `tasker show <stacked issue>` of each stacked ticket prints the branch of the parent on its `base:` line, in the form
  `refs/heads/<parent branch>` of [the base rule](run-one-ticket.md#the-base-rule).
- The start of a stacked ticket fails. A stop report of step 2 from the agent of a stacked ticket counts as a failed
  start. The orchestrator then ends the hold at once, with no read of `tasker show <stacked issue>`. Examples are the
  refusal `blocking issue is still open`, after which no task exists, and a missing `based on <key>'s branch` note,
  after which the stacked task stays in `workspace_ready`.
- The issue of the parent closes.

The orchestrator reads the state of the issue of the parent with `gh issue view <parent issue> --json state -q .state`.
It does this read after each report of the agent of the parent or of the agent of a stacked ticket. It also does this
read each time it reads the board after a landing ([Pick the tickets](#pick-the-tickets)). The command prints `CLOSED`
for a closed issue. If the command fails, the failure rule applies, and the hold stays.

When the hold ends, the orchestrator reads the state of the parent task with `tasker show <parent issue>`, as the bullet
of Land the work that starts "Before the orchestrator sends added work or an answer" says. If
`tasker show <parent issue>` fails, the failure rule applies, and the hold stays. Otherwise, the orchestrator tells the
agent of the parent that the hold ended. If the hold ended because the start of a stacked ticket failed, the
orchestrator also reports the failure to the user. After the message that the hold ended, the agent of the parent
continues ["Run one ticket"](run-one-ticket.md#run-one-ticket) from the command where it stopped.

### The link offer

This rule covers a ticket of the milestone of the orchestrator. The ticket can start, except for the shared-file bullet
of [Pick the tickets](#pick-the-tickets). The ticket shares a file with a task in flight of the same milestone, and it
has no blocked-by link to the issue of that task. The files of the ticket are the files that the shared-file bullet of
[Pick the tickets](#pick-the-tickets) counts. A ticket that waits for another reason gets no offer until it can start
except for the shared file. Examples are a blocker that is not ready to stack, and two or more open blockers. A link to
a task of another milestone is out of scope. [The overlap rule](land-the-work.md#the-overlap-rule) covers that case.

If the user told the orchestrator that a planner of the milestone adds the blocked-by links, the orchestrator makes no
link offer. The orchestrator also adds no blocked-by link itself. The user can still ask the orchestrator for a link, as
the decline bullet below says. Then the orchestrator does the steps of the approve bullet, and the bullet for a failed
`gh issue edit` also applies. Without a link, the orchestrator follows the shared-file bullet of
[Pick the tickets](#pick-the-tickets).

The orchestrator counts a new link of the planner at its next read of the states of
[the stacking rule](#the-stacking-rule). Two of these reads come before each start and each time the orchestrator reads
the board. With a new link, the orchestrator starts the ticket or lets it wait as
[the stacking rule](#the-stacking-rule) says, and [the parent-hold rule](#the-parent-hold-rule) applies as it says. On
2026-10-17, the Docs orchestrator offered the link to #244 on #252, and the user answered that the planner
`planning-docs` adds the links.

The orchestrator offers the user a link: the ticket is blocked by the issue of that task. The orchestrator follows
[A decision of the user](working-with-the-user.md#a-decision-of-the-user).

- If the user approves, the orchestrator runs `gh issue edit <ticket> --add-blocked-by <issue of the task>`. If
  `gh issue edit` succeeds, the orchestrator reads the states of the blockers of the ticket at once. If the ticket can
  start by [the stacking rule](#the-stacking-rule) and by the other rules of [Pick the tickets](#pick-the-tickets), the
  orchestrator starts it. Otherwise, the ticket waits. For example, [the stacking rule](#the-stacking-rule) makes the
  ticket wait while the task is not ready to stack. When the task is ready to stack, the ticket can start as a stacked
  ticket on the task. For that pair, [the stacking rule](#the-stacking-rule) wins over the sentence "Start the second
  ticket after the first one lands." of the shared-file bullet. [The stacked-ticket rule](#the-stacked-ticket-rule) then
  sets the landing order, with the task first.
- If `gh issue edit` fails, [the failure rule](limits.md#the-failure-rule) applies. The ticket has no new link.
- If the user declines, or if `gh issue edit` fails, the shared-file bullet applies, and the ticket starts after the
  task lands. The stacking rule still applies to the other blockers of the ticket. After that answer or that failure,
  the orchestrator makes no new offer for that ticket and that task. The user can still ask for the link at any time.
- In each case, the move rule of [Pick the tickets](#pick-the-tickets) still wins. For a stacked ticket, the second
  exception of [the stacking rule](#the-stacking-rule) says this.

The offer comes only when the ticket can start except for the shared file. As a result, the ticket has no other open
blocker, or one other open blocker that is ready to stack. If the ticket has no other open blocker, the steps of the
approve case apply. If the ticket has one, and the user approves, the ticket has two open blockers. It waits until at
most one is open, as [the stacking rule](#the-stacking-rule) says. Then the stacking rule applies to the blocker that
stays open.

### The defer rule

To defer a ticket means that the user moves its issue to a later milestone, for example "Future". This rule covers a
deferred ticket that has a task in flight. A parked task is the task of such a ticket. On 2026-10-14, the user moved #34
from M5 to "Future" while its task was in `awaiting_plan_review`. The user did not want the task aborted, because
`tasker abort` deletes the work of the agent. When the user defers a ticket that has a task in flight, the orchestrator
does these steps:

1. Tell the agent of the ticket to end its work. A message to an agent that has ended starts it again (see
   ["Terms" in "Quota"](quota.md#terms)). The agent ends its work after its current `tasker` command ends. It runs no
   other `tasker` command. Before its final report, it removes the task worktree as
   [the own-worktree rule](limits.md#the-own-worktree-rule) says. The remove changes no task, and the task keeps its
   state. Then it gives its final report.
2. Leave the task in its state. Do not run `tasker abort`, unless the user tells you to.
3. Delete the jobs of the agent, as ["Delete the job" in "Quota"](quota.md#delete-the-job) says.
4. Move the issue to the milestone that the user names: `gh issue edit <number> --milestone "<milestone>"`.
5. Move the card of the ticket to Todo. The ticket waits in Todo of its new milestone.
6. Post a comment on the issue that starts with `## Parked task`, with the findings of the final report, so that the
   next agent can start from them. Examples are the state of the task, the open plan questions, the answers so far and
   the facts that the agent tested. For a stacked task, the comment gives the start base of the last read when the work
   of the agent ended, as the final report gives it, or says that the agent held none (see
   [the comeback rule](run-one-ticket.md#the-comeback-rule)).
7. List the open issues that the deferred issue blocks:
   `gh issue view <number> --json blocking -q '.blocking.nodes[] | select(.state == "OPEN") | .number'`. For each issue
   of the list, read its milestone: `gh issue view <blocked issue> --json milestone -q '.milestone.title'`. The command
   prints an empty line when the issue has no milestone. Keep the issues outside the new milestone of the deferred
   issue, also the issues with no milestone. If no issue is left, this step is complete. Otherwise, ask the user which
   of these links to remove. Most often the user removes all of them, so propose "remove all" as the default. Milestone
   numbers do not give the order of the milestones, so the user decides. For each link that the user names, run
   `gh issue edit <blocked issue> --remove-blocked-by <number>`. Then that issue can start, as
   [the stacking rule](#the-stacking-rule) says.

If a `gh` command of these steps fails, [the failure rule](limits.md#the-failure-rule) applies, and the orchestrator
does the other steps. The task keeps its state.

A parked task stays in flight in `tasker status`. A task in flight is a parked task when the card of its ticket is in
Todo, because the card of a ticket that runs is in In progress. To read the column of the card, run
`gh issue view <number> --json projectItems -q '.projectItems[].status.name'`. The command prints `Todo` for a parked
task. [The overlap rule](land-the-work.md#the-overlap-rule), the move rule and the fourth case of
[the stop rule](plan-review.md#the-stop-rule) leave out a parked task.

When the ticket comes back to the current milestone, the orchestrator starts a new agent for it, as
[Pick the tickets](#pick-the-tickets) says. The agent follows [the comeback rule](run-one-ticket.md#the-comeback-rule).

## The prompt of an agent

The orchestrator writes the prompt of each agent.

- The prompt of an agent gives only the context of its ticket. The context is the issue key, the milestone of its ticket
  (see the fourth case of [the stop rule](plan-review.md#the-stop-rule)), the milestones that are off limits for the
  agent, the landing order (see ["Land the work"](land-the-work.md#land-the-work)), for a stacked ticket, its parent
  (see [the stacked-ticket rule](#the-stacked-ticket-rule)), the quota slot and whether the agent has a job (see
  ["Quota"](quota.md#quota)), the folder of the agent for its files (see the folder bullet of
  ["Limits"](limits.md#limits)), the links of the change-of-scope and design-gap comments of its issue (see the bullet
  below that starts "If the account of the orchestrator"), the hints for its first refine, and the task worktree with
  its path, `../tasker-worktrees/<session name>` (see the folder bullet of ["Limits"](limits.md#limits)).
- The prompt never tells the agent to take a path from the `worktree:` line of `tasker show`. The reason: that line
  prints the worktree of tasker, and [the own-worktree rule](limits.md#the-own-worktree-rule) bans each read and each
  run there. On 2026-10-24 and 2026-10-25, the prompts of orchestrator-m21 for #395, #425 and #418 said "Take your task
  worktree from the `worktree:` line of `tasker show`". The agent of #418 followed the own-worktree rule and used
  `../tasker-worktrees/<session name>`.
- A hint of the orchestrator can resolve a conflict. Before the orchestrator gives such a hint, it compares the hint
  with the Out of scope section of the issue. If the Out of scope section excludes what the hint asks for, the
  orchestrator does not give the hint. Then the agent reports the conflict under the fifth case of
  [the stop rule](plan-review.md#the-stop-rule), and the user decides. On #301, a hint asked the plan to extend another
  hint of the page, but the Out of scope section excluded "A change of other hints".
- The prompt names the source of each fact that it gives. The source is the issue body, a comment with its link, or the
  code. On #274, a hint of the prompt said that the issue body states that the stored base revision is a ref. Only a
  comment on #273 stated it, and the agent reported the difference at step 1 of
  ["Run one ticket"](run-one-ticket.md#run-one-ticket).
- If the account of the orchestrator posted comments on the issue of the agent that start with `## Change of scope` or
  `## Design gap`, the prompt links each one. If the issue has no such comment, the prompt does not mention these
  comments. The reason: [the issue check](plan-review.md#the-issue-check) counts such a comment of the account of the
  orchestrator as part of the issue only when the orchestrator sends its link. On #395 (2026-10-24), the prompt gave no
  link to the comment https://github.com/codeguru42/tasker/issues/395#issuecomment-6386939662. The agent found the
  comment at step 1 of ["Run one ticket"](run-one-ticket.md#run-one-ticket). Then the orchestrator had to tell the agent
  that the comment is part of the issue.
- When the orchestrator starts an agent, the orchestrator names the session of the agent after the issue key of its
  ticket. The orchestrator sets the session name with the `name` option of the Agent tool, for example
  `name: "codeguru42-tasker-108"`.
  - The list of the options of the Agent tool does not show `name`, but the tool accepts it. The `description` option is
    not the session name. The M7 orchestrator tested `name` on 2026-10-15. An Agent call with
    `name: "codeguru42-tasker-nametest"` started the agent with no error. A SendMessage with
    `to: "codeguru42-tasker-nametest"` reached that agent, and the agent answered. The report of the agent came back
    from `codeguru42-tasker-nametest`.
  - The session name has the form `<owner>-<repo>-<number>`, for example `codeguru42-tasker-108` for
    `codeguru42/tasker#108`. The Agent tool refuses a name that does not match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`
    (tested on 2026-10-14). The issue key itself does not match. The Docs orchestrator tested this on 2026-10-15. An
    Agent call with `name: "codeguru42/tasker#143"` failed before the agent started, with the error
    `name must start with a letter or digit and contain only letters, digits, underscores, or hyphens (max 64 chars)`.
    This error gives the same rule as the pattern. No later session tests the issue key as a name again.
  - The orchestrator uses the session name for each message to the agent, for each resume message and in the prompt of
    each quota job. The first bullet of this section already puts the issue key in the prompt of the agent. The prompt
    of each quota job gives the full issue key too, so that each one can be matched to the task. The reason: several
    orchestrators run at the same time. A name such as `agent-1` or a bare number does not say which ticket or which
    repo the session belongs to. The full key is unique, so the reports, the messages and the jobs can be matched to the
    task.
  - One agent runs one ticket, so one name belongs to one task. If the orchestrator starts a second session for the same
    ticket, the orchestrator adds a suffix, for example `codeguru42-tasker-108-2`, and says so in the prompt of the new
    agent.
  - If an agent already runs with no name, the orchestrator does not restart the agent only to give it a name. The
    reason: a new agent does not have the context of the old agent, for example the plans that it read and its review
    loops. For an agent with no name, the orchestrator puts the full issue key in the text of each message, each resume
    message and each quota job prompt, in place of the session name. The orchestrator names each new agent.
- Before the agent starts, the orchestrator makes the folder of the agent for its files (see the folder bullet of
  ["Limits"](limits.md#limits)). In one case, a background command of an agent wrote into a missing folder and failed.
- The orchestrator writes in the prompt that the comment of step 11 of
  ["Run one ticket"](run-one-ticket.md#run-one-ticket) is the only write of the agent on GitHub issues, labels and the
  project board (see ["Limits"](limits.md#limits)). In one case, a strong "never run a gh write" line in the prompt of
  an agent made the classifier of auto mode block the comment of step 11 (see
  [the tool-block rule](tasker-commands.md#the-tool-block-rule)).
- For all the rules, the prompt points to [the orchestration pages](orchestrator.md) and to the docs that `AGENTS.md`
  names. No other base prompt exists.
- When the orchestrator learns a new rule for agents, it does not put the rule only in a prompt. It sends the rule to
  the planner, as the planner bullet of this section says. A rule that only one ticket needs can also go in the prompt
  of that ticket.
- The planner bullet: the orchestrator sends each lesson of a final report, each finding of a session review and each
  proposed issue only to `planner-<slug>` of its own slug, with `SendMessage`.
  [Working with the user](planner.md#working-with-the-user) of planner.md names that session, and
  [sessions.md](../sessions.md) defines the slug. The message gives the lesson, the ticket, the date, and the doc and
  the section that the lesson fits. The planner drafts and posts the issue, as
  [The review loop of a draft](planner.md#the-review-loop-of-a-draft) of planner.md says. The orchestrator drafts and
  files no issue itself. The one exception is the issue of step 1 of [A failed CI run](ci-wait.md#a-failed-ci-run),
  which the orchestrator files itself. If `SendMessage` fails, for example because no planner runs, the orchestrator
  sends the lesson to `operator-<slug>` as an item. A refused message counts as a failed `SendMessage`. The orchestrator
  waits for no answer from the planner. A missing answer is out of scope. On 2026-10-17 and 2026-10-18, the user asked
  the Docs orchestrator to delegate each issue draft to the planner.
