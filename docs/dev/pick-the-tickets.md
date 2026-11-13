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
  [the stacking rule](#the-stacking-rule) and the limit of 3 task subagents. If the user says no, the orchestrator makes
  no new offer for that ticket and those blockers. The user can still ask the orchestrator to run them at any time. No
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
- A manual-steps issue is an issue whose body says that no assistant session runs it.
  [What goes in a ticket](planner.md#what-goes-in-a-ticket) gives its form. The orchestrator starts no task for it and
  runs no `tasker show` for it. Each ticket that it blocks waits until it closes. While it is open, its milestone is not
  done. The earlier-blocker offer does not cover such an issue.

  For an open issue of this kind, the orchestrator of its milestone sends one item. If an open item or the handoff file
  of the orchestrator already asks for these steps, the orchestrator sends no item. The item asks the user to do the
  steps, to close the issue and then to answer the item. After the answer, the orchestrator reads the board. If the
  issue is still open, the orchestrator tells the user that its tickets wait. If the read fails,
  [the failure rule](limits.md#the-failure-rule) applies.

- The priority rule: among the tickets that can start, the orchestrator starts a ticket with the priority `P0` first.
  Then it starts a ticket with `P1`, then a ticket with no priority, then a ticket with `P2`. The priority of a ticket
  is the value of the field `Priority` on its card, as [The project board](issues.md#the-project-board) says. Two
  tickets of the same priority have no order. The rule covers the tickets of the milestone of the orchestrator.

  To read the priorities, run
  `gh project item-list 3 --owner codeguru42 --limit 1000 --format json --jq '.items[] | select(.content.type == "Issue" and .milestone.title == "<milestone>" and .priority != null) | "\(.content.number) \(.priority)"'`.
  Each line of the output gives the number of an issue and its priority, for example `587 P0`. A ticket with no line has
  no priority. If the command fails, [the failure rule](limits.md#the-failure-rule) applies, and the orchestrator starts
  no ticket until the read works.

  The rule changes no other rule of this section. A ticket with a priority still waits as
  [the stacking rule](#the-stacking-rule) says. It also still waits for the shared-file rule and the move rule. A rule
  that stops a start still wins. Examples are the ban of [A failed CI run](ci-wait.md#a-failed-ci-run), and the ban on a
  new ticket after the suggestion of a handoff in [The landing count](handoff-orchestrator.md#the-landing-count). Other
  examples are step 1 of [The steps of the old orchestrator](handoff-orchestrator.md#the-steps-of-the-old-orchestrator)
  and a hold of the user.

  The ticket of a parked task that comes back to Todo of the current milestone takes its place by its priority (see
  [the defer rule](#the-defer-rule)). Each time the orchestrator reads the board, it applies the rule again. Then a
  ticket with `P0` or `P1` that joined the milestone and can start takes the next free agent before the tickets with no
  priority.

- Each time a ticket lands, read the board again: the open issues of the milestone and the issues that block them. A new
  issue can join a milestone while a run is in progress. An open issue can also lose its last open blocker while no
  ticket lands. In one milestone, a new issue stayed in Todo for hours, because the orchestrator read the board only at
  the start. On 2026-10-25, #495 and three new issues had no open blocker, and two slots of orchestrator-m22 stayed free
  for about an hour. The bullet "When the final report of the task subagent of a ticket says that the ticket landed" of
  [Land the work](land-the-work.md#land-the-work) gives the place of this read among the landing steps. The orchestrator
  also reads the board when a message of another session names one of these changes: a new issue in the milestone of the
  orchestrator, an added or a removed blocked-by link of an open issue of that milestone, or a move of an issue into
  that milestone. This covers a message of each session on purpose. Today the follow-up planner sends such messages, as
  [The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner) says. A long-running orchestrator
  also reads the board with its board watch job, as
  [the board watch rule](handoff-orchestrator.md#the-long-running-orchestrator) says. Each read of the board that does
  not come at a landing is a read of the board, but it is not a landing. It counts for each rule of this page that acts
  "at its next read of the board" or "each time it reads the board". So the priority rule applies to each start after
  such a read. It does not count for a read that a rule ties to a landing, for example the read of the parent issue in
  [the parent-hold rule](#the-parent-hold-rule). Each rule that stops a start still wins, for example the ban of
  [A failed CI run](ci-wait.md#a-failed-ci-run) and a hold of the user.
- Run at most 3 task subagents at the same time, one ticket for each task subagent.
- The pi gate: while [the pi wait](quota.md#the-pi-wait) lasts, start no task subagent for a ticket of a repo whose
  `assistant.provider` is `pi`. A new session for a task of the pi wait is not held back. Read the provider of the repo
  with the command of the test of [A pi stop](quota.md#a-pi-stop). If the read fails,
  [the failure rule](limits.md#the-failure-rule) applies, and the ticket does not start at that moment.

  The gate wins over each bullet and rule of this page that starts a ticket. These are the earlier-blocker offer, the
  priority rule, the bullet of a live security gap, the stacking rule, the parent-hold rule and the link offer. For a
  ticket that the gate holds back, send no hold of [the parent-hold rule](#the-parent-hold-rule) and make no offer.

- A ticket that closes a live security gap goes first. A live security gap is a
  [security gap](review-findings.md#review-findings) that exists now on `origin/main` or on the machine. Whether a gap
  is live is a judgment. The judgment is open on purpose, and the session that orders the tickets makes it.

  This order holds among the tickets of the milestone that can start. It wins over the priority rule and over
  [the link offer](#the-link-offer). When the next bullet lets only one ticket run, this ticket takes the slot. No
  blocked-by link puts it behind a ticket that it does not need. If a task in flight already holds the shared file, the
  orchestrator asks the user what to do with that task.

- Do not run two tickets at the same time when both edit the same shared file, for example a file under `test/helpers/`
  or `docs/dev/code-conventions.md`. Start the second ticket after the first one lands. In this bullet, to change a file
  also means to add, move or delete it. This bullet and [the link offer](#the-link-offer) count two kinds of files of a
  ticket before its start: the files that the Requirements section or the Docs section of the issue asks to change, and
  each file that a hint of the orchestrator for the first refine asks the ticket to change. Examples are `AGENTS.md` for
  the index entry of a page and `docs/orchestrator.md` for the list "The pages". On 2026-10-19, the orchestrator gave
  #339 and #314 a hint to change their index entries in `AGENTS.md` and in the list "The pages", and #382 already
  changed `AGENTS.md`. As a result, the three tickets shared files, and the orchestrator had to set the landing order
  #382, #314, #339. Each other file that the issue names does not count. Examples are a file that the issue names only
  as the target of a link, as context or in its Out of scope section. The orchestrator judges whether an item of the
  Requirements section or the Docs section asks to change a file. The judgment of the orchestrator is open on purpose.
  On 2026-10-25, #554 and #489 gave examples of a file that an issue names but does not change: #554 named
  `docs/dev/pick-the-tickets.md` only as context and as the target of a link, and #489 named three docs only as context,
  as the target of a link or in its Out of scope section and changed only `docs/dev/planner.md`. If a ticket can start
  except for this bullet, because it shares a file with a task in flight of the same milestone,
  [the link offer](#the-link-offer) applies. This bullet covers two tickets of the milestone of the orchestrator. For a
  task in flight of another milestone, [the overlap rule](land-the-work.md#the-overlap-rule) applies instead. For a
  stacked ticket and its parent, [the stacking rule](#the-stacking-rule) wins.

  If two tickets edit only different places of each shared file, the second ticket can start. The first ticket can still
  be in flight then. The ticket that lands second runs `tasker update-branch`, as
  [the overlap rule](land-the-work.md#the-overlap-rule) says. In this bullet, a place is a section or a list entry of a
  doc. A doc is a Markdown file of the repo, for example `AGENTS.md` or a file under `docs/`.

  Two different sections of one doc are different places. A section is the text under one heading of any level, up to
  the next heading. The text before the first heading is also a section. Two entries of one list are also different
  places, for example two entries of the index of `AGENTS.md` or two bullets of one section. Two new entries at one
  place of a list, for example both at its end, are one place. Two rows of one table are one place.

  A ticket that moves, splits or renames the doc edits each place of it. A change of the form or the layout of the whole
  doc also edits each place. A change of a heading line is an edit of its section. The orchestrator judges the places of
  each ticket from the items and the hints that this bullet counts. This judgment is open on purpose. If the
  orchestrator cannot name the places of a ticket, the sentence "Start the second ticket after the first one lands."
  applies.

  The user decided the case of different places on 2026-11-12. The reason is in the bullet of
  [The blocked-by links](planner.md#the-blocked-by-links) that starts "Two issues that edit only different places". The
  cost: a clash of meaning between two places shows late, in the review or the diff read of the ticket that lands
  second. Two edits on lines next to each other can still give a conflict at `tasker update-branch`.
  [docs/dev/rebase-conflicts.md](rebase-conflicts.md) gives the steps for such a conflict. Before that day, this bullet
  counted the whole file.

  #853 edited "The tools of a session" of `docs/dev/working-with-the-user.md`. #822 asked for an edit of "The form of a
  reply" of the same doc. #853 waited until the user gave a one-time exception, because #822 waited for a decision of
  the user with no date.

  On 2026-11-12, #877 edited "The fact test" of `docs/dev/plan-review.md`. #871 asked for edits of two other sections of
  that doc. #877 started only because no task of #871 was in flight.

- The move rule: a moving ticket is a ticket that moves or splits a whole shared file, for example the split of
  `test/helpers.ts` into the folder `test/helpers/` on #140. The orchestrator starts a moving ticket only after each
  task in flight that changes that file has landed. This rule covers the tasks of every milestone, except a parked task
  (see [the defer rule](#the-defer-rule)). For the start of a moving ticket, this rule wins over the shared-file bullet.
  [The overlap rule](land-the-work.md#the-overlap-rule) gives the steps that list the tasks in flight and their files.
  The reason: a moving ticket changes each line of the file. As a result, a ticket that lands later in that file causes
  a rebase conflict in each commit, or one more refine before `tasker approve`. [The stacking rule](#the-stacking-rule)
  gives one exception for a parent.
- If a task in flight that changes the file of a moving ticket is far from landing, for example in
  `awaiting_plan_review`, the orchestrator asks the user. The user decides whether the orchestrator waits or starts the
  moving ticket now. The orchestrator follows [A decision of the user](working-with-the-user.md#a-decision-of-the-user).
  If the user answers "start now", [the overlap rule](land-the-work.md#the-overlap-rule) says whether the moving ticket
  and that task in flight get a landing order.
- When a ticket starts, the orchestrator reads stdout from `tasker start`. If stdout contains
  `moved the card of <issue key> to "<option>" on the tracker`, the orchestrator skips its own move. Otherwise, the
  orchestrator moves the card to In progress with the move command of [The project board](issues.md#the-project-board).
  The board moves the card to Done when `tasker finish` closes the issue.
- When the Todo column of the milestone is empty, the orchestrator waits until the last ticket of the milestone closes
  and no task of the milestone is in flight. If the orchestrator did not send the report that the close started yet, it
  now sends this report to the operator, as step 1 of
  [The close of a milestone](operator-start.md#the-close-of-a-milestone) says. Then the orchestrator runs the rounds of
  [Session-review rounds](session-review-rounds.md), before it tells the user that the milestone is done and before it
  stops. Do not write the issues of the next milestone. When the rounds end, the orchestrator tells the user one time
  that the milestone is done, and it lists each finding with its state. If a pass of
  [The close of a milestone](operator-start.md#the-close-of-a-milestone) adds an issue to the milestone, this bullet
  applies again after the orchestrator runs that issue.

  The orchestrator does not ask the user to close the milestone, and it does not bring the milestone up again in later
  replies. On 2026-10-25, orchestrator-m21 asked the user several times whether to ask the planner to close M21, and the
  user said: "I will decide when to close M21". The milestone closes only when the user says so, as
  [Milestones](issues.md#milestones) of issues.md says. The stop of this bullet does not cover a long-running
  orchestrator (see [The long-running orchestrator](handoff-orchestrator.md#the-long-running-orchestrator)). The review
  rounds of this bullet, the list of the findings and the report that the milestone is done cover a long-running
  orchestrator, before it moves to the next milestone. A long-running orchestrator sends the report that the close
  started only at its move to the next milestone, after its report that the milestone is done.

### The stacking rule

A blocker is an issue that blocks the ticket. The orchestrator can start a ticket when each blocker is closed or is
ready to stack. A blocker of another milestone counts the same way. A chain is a row of tickets in which each ticket
blocks the next one.

The stack is the default. The orchestrator starts a ticket at the first moment that this rule allows. That moment comes
when these facts are true:

- Each blocker of the ticket is closed or is ready to stack.
- The checks of this rule pass: the wait cases, the check of the tip of the base of the parent and the wait for a fix
  round of the parent.
- A [slot](quota.md#the-delay-of-each-task-subagent) is free, or the orchestrator keeps a slot for the ticket, as
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

If the exit code is 1, the orchestrator tells the task subagent of the parent to run `tasker update-branch`.

The commands of the check are the fetch, the two hash reads and `git merge-base --is-ancestor`. If a command of the
check fails, or the exit code of `git merge-base --is-ancestor` is not 0 and not 1,
[the failure rule](limits.md#the-failure-rule) applies to the orchestrator. Then the stacked ticket does not start at
that moment.

If the review loop 1 of the parent has findings, or the diff read of the parent finds work, the orchestrator waits. It
waits until the task subagent of the parent ends that round and the parent is in a ready state again. The orchestrator
tells the task subagent of the parent to do that round. A fix as a new commit on top of the parent is better than a
fixup, because a fixup rewrites the commits under the stacked ticket. While the parent ends its update or its fix round,
the orchestrator starts no stacked ticket on this parent. Other tickets start as the other rules say.

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
can come from a task subagent or from another orchestrator. A report from another orchestrator comes through the
messages of [the hold rule](land-the-work.md#the-hold-rule) or of [the stacked-ticket rule](#the-stacked-ticket-rule).
The sender sends only the reports that those rules already give, and a refused message or a missing answer is out of
scope (#164).

After a report of a ready state, the orchestrator lists the open issues that the task blocks:
`gh issue view <issue> --json blocking -q '.blocking.nodes[] | select(.state == "OPEN") | .number'`. If the output is
empty, no ticket waits on the task, and the step is complete. For each issue of the list, the orchestrator reads the
milestone: `gh issue view <blocked issue> --json milestone -q '.milestone.title'`. The orchestrator keeps the tickets of
its own milestone. If such a ticket can start by this rule and by the other rules of
[Pick the tickets](#pick-the-tickets), the orchestrator starts it. If a command fails,
[the failure rule](limits.md#the-failure-rule) applies. Then no ticket starts at that moment. The tickets wait until the
next read of the board or the next start.

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
2. Tell the stacked task subagent that the ticket is stacked, and name the parent.
3. For a file that the parent changes, tell the stacked task subagent that the fourth case of
   [the stop rule](plan-review.md#the-stop-rule) does not apply, because the stacked task builds on that change.

These rules apply to a stacked ticket and its parent. The user decided them on 2026-10-16.

- This rule wins over [the Docs rule](land-the-work.md#the-docs-rule) and over the landing order that
  [the overlap rule](land-the-work.md#the-overlap-rule) sets. The stacked orchestrator sets the landing order with the
  parent first, and the wait rules of [Land the work](land-the-work.md#land-the-work) apply. The Docs rule still covers
  each other shared file.
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
[The stacking rule](#the-stacking-rule) gives the ready states. The task subagent of the parent moves its task out of a
ready state with the refine of step 8 of [Run one ticket](run-one-ticket.md#run-one-ticket). It also moves its task out
of a ready state with `tasker review <issue> "<feedback>"` of [the add-work rule](run-one-ticket.md#the-add-work-rule),
`tasker update-branch` or `tasker merge`. `tasker merge` moves the task from `accepted` to `merging` and `landed`. On
#215, a refine of step 8 moved the parent out of a ready state before the task subagents of two stacked tickets ran
`tasker start`. `tasker start` refused both of them (see
[the facts of the installed tasker](tasker-commands.md#the-facts-of-the-installed-tasker)).

The orchestrator plans to start a stacked ticket on a parent that is not ready yet. It tells the task subagent of the
parent to hold. The hold of a parent that belongs to another orchestrator is out of scope. The hold lasts until the
orchestrator tells the task subagent of the parent that the hold ended. A message to a task subagent that has ended
starts the task subagent again (see ["Terms" in "Quota"](quota.md#terms)). If the task subagent of the parent gets the
message while a command runs, the task subagent lets the command end and keeps the hold. If the task subagent of the
parent gets the message while it waits for an answer or a next step, it keeps the hold. Then the task subagent of the
parent ends its turn again, as [the answer-wait rule](limits.md#the-answer-wait-rule) says.

The orchestrator sends the hold only when a [slot](quota.md#the-delay-of-each-task-subagent) is free for the stacked
ticket. If no slot is free, the orchestrator sends no hold (see the bullet "Run at most 3 task subagents at the same
time" of [Pick the tickets](#pick-the-tickets)). The reason: a hold with no free slot stalls a fix round of the parent
and starts nothing. On 2026-10-18, orchestrator-docs held #279 for #282 while all 3 slots were in use, and it ended the
hold at once.

When the orchestrator sends the hold, it keeps that free slot for the planned stacked ticket. A kept slot is not free
for another hold or for the start of another ticket. While the hold runs, the orchestrator counts the kept slot as one
of the 3 task subagents of the bullet "Run at most 3 task subagents at the same time" of
[Pick the tickets](#pick-the-tickets). As a result, the orchestrator sends at most one hold for one free slot. For a
second planned stacked ticket, on the same parent or on another parent, the orchestrator needs one more free slot.

When the orchestrator starts the task subagent of the stacked ticket, it gives that task subagent the kept slot. From
then on, the slot is the slot of that task subagent and no longer a kept slot. While the hold runs, the kept slot wins
over the bullet "When the orchestrator starts a task subagent" and over the sentence "Then the next task subagent that
starts takes the slot." of [The delay of each task subagent](quota.md#the-delay-of-each-task-subagent). If the hold ends
before the orchestrator starts the task subagent of the stacked ticket, the kept slot is free again. The user decided
this on 2026-10-24.

If no slot is free, the orchestrator keeps no record of the planned start. After the orchestrator frees a slot, as
[Delete the job](quota.md#delete-the-job) says, it applies the stacking rule and this rule again. It does this at its
next read of the states of [the stacking rule](#the-stacking-rule). If the parent is still not ready to stack then, the
orchestrator sends the hold at that moment.

While the hold runs, the task subagent of the parent continues ["Run one ticket"](run-one-ticket.md#run-one-ticket).
After `tasker verify` passes, the task subagent of the parent continues with `tasker review`, because `reviewing` and
`reviewed` are ready states. The task subagent of the parent also runs `tasker dismiss-review` and `tasker accept`,
because the task stays in a ready state.

Before a command that moves the task out of a ready state, the task subagent of the parent
[stops](limits.md#the-answer-wait-rule). The report gives the state of the task and says that the task subagent holds.
If `SendMessage` fails, the task subagent of the parent puts the report in its final answer.

This report is a report of a ready state of the stacking rule. The orchestrator then does the steps of the paragraph of
[the stacking rule](#the-stacking-rule) that starts "After a report of a ready state".

While the hold runs, the task subagent of the parent waits in place of the command at each of these places:

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

The orchestrator reads `tasker show <stacked issue>` of each stacked ticket after each report of the task subagent of
that stacked ticket, for example the run-end report of `tasker plan` (see
["When there is no reset time yet" in "Quota"](quota.md#when-there-is-no-reset-time-yet)). Before `tasker start`, the
stacked ticket has no task, so the orchestrator waits for such a report before the read. The read does not follow a stop
report of step 2 of ["Run one ticket"](run-one-ticket.md#run-one-ticket), because such a report ends the hold at once.
If `tasker show <stacked issue>` fails, [the failure rule](limits.md#the-failure-rule) applies, and the hold stays.

The orchestrator ends the hold in these cases:

- `tasker show <stacked issue>` of each stacked ticket prints the branch of the parent on its `base:` line, in the form
  `refs/heads/<parent branch>` of [the base rule](run-one-ticket.md#the-base-rule).
- The start of a stacked ticket fails. A stop report of step 2 from the task subagent of a stacked ticket counts as a
  failed start. The orchestrator then ends the hold at once, with no read of `tasker show <stacked issue>`. Examples are
  the refusal `blocking issue is still open`, after which no task exists, and a missing `based on <key>'s branch` note,
  after which the stacked task stays in `workspace_ready`.
- The issue of the parent closes.
- The orchestrator drops the planned start of the stacked ticket, for any reason. The orchestrator then ends the hold at
  once, as for a failed start, with no read of `tasker show <stacked issue>`. One example is a defer of the stacked
  ticket, as [the defer rule](#the-defer-rule) defines a defer. Another example is a stop of the start by the
  broken-test ban of [Pick the tickets](#pick-the-tickets). The ban does not stop the start of the broken-test issue
  itself.

The orchestrator reads the state of the issue of the parent with `gh issue view <parent issue> --json state -q .state`.
It does this read after each report of the task subagent of the parent or of the task subagent of a stacked ticket. It
also does this read each time it reads the board after a landing ([Pick the tickets](#pick-the-tickets)). The command
prints `CLOSED` for a closed issue. If the command fails, the failure rule applies, and the hold stays.

When the hold ends, the orchestrator reads the state of the parent task with `tasker show <parent issue>`, as the bullet
of Land the work that starts "Before the orchestrator sends added work or an answer" says. If
`tasker show <parent issue>` fails, the failure rule applies, and the hold stays. Otherwise, the orchestrator tells the
task subagent of the parent that the hold ended. If the hold ended because the start of a stacked ticket failed, the
orchestrator also reports the failure to the user. After the message that the hold ended, the task subagent of the
parent continues ["Run one ticket"](run-one-ticket.md#run-one-ticket) from the command where it stopped.

### The link offer

This rule covers a ticket of the milestone of the orchestrator. The ticket can start, except for the shared-file bullet
of [Pick the tickets](#pick-the-tickets). The ticket shares a file with a task in flight of the same milestone, and it
has no blocked-by link to the issue of that task. The files of the ticket are the files that the shared-file bullet of
[Pick the tickets](#pick-the-tickets) counts. A ticket that waits for another reason gets no offer until it can start
except for the shared file. Examples are a blocker that is not ready to stack, and two or more open blockers. A link to
a task of another milestone is out of scope. [The overlap rule](land-the-work.md#the-overlap-rule) covers that case.

If the user told the orchestrator that a planner of the milestone adds the blocked-by links, the orchestrator makes no
link offer. The orchestrator also adds no blocked-by link itself. The user can still ask the orchestrator for a link, as
the decline bullet below says. Then the orchestrator does the steps of the approve bullet, and the bullets for a failed
`gh issue edit` and for a skipped write also apply. For a ticket in flight,
[The reads before the write](issues.md#the-reads-before-the-write) gives the override by a word of the user. If the
ticket is open, is not in flight and has no link, the orchestrator follows the shared-file bullet of
[Pick the tickets](#pick-the-tickets).

The orchestrator counts a new link of the planner at its next read of the states of
[the stacking rule](#the-stacking-rule). Two of these reads come before each start and each time the orchestrator reads
the board. With a new link, the orchestrator starts the ticket or lets it wait as
[the stacking rule](#the-stacking-rule) says, and [the parent-hold rule](#the-parent-hold-rule) applies as it says. On
2026-10-17, the Docs orchestrator offered the link to #244 on #252, and the user answered that the planner
`planning-docs` adds the links.

The orchestrator offers the user a link: the ticket is blocked by the issue of that task. The orchestrator follows
[A decision of the user](working-with-the-user.md#a-decision-of-the-user).

- If the user approves, the orchestrator adds the link as
  [The reads before the write](issues.md#the-reads-before-the-write) of issues.md says. Its plain write is
  `gh issue edit <ticket> -R <repo> --add-blocked-by <issue of the task>`. If `gh issue edit` succeeds, the orchestrator
  reads the states of the blockers of the ticket at once. If the ticket can start by
  [the stacking rule](#the-stacking-rule) and by the other rules of [Pick the tickets](#pick-the-tickets), the
  orchestrator starts it. Otherwise, the ticket waits. For example, [the stacking rule](#the-stacking-rule) makes the
  ticket wait while the task is not ready to stack. When the task is ready to stack, the ticket can start as a stacked
  ticket on the task. For that pair, [the stacking rule](#the-stacking-rule) wins over the sentence "Start the second
  ticket after the first one lands." of the shared-file bullet. [The stacked-ticket rule](#the-stacked-ticket-rule) then
  sets the landing order, with the task first.
- If `gh issue edit` fails, [the failure rule](limits.md#the-failure-rule) applies. The ticket has no new link.
- If `tasker status`, the read of the state or a read of the walk fails, the ticket has no new link.
  [The failure rule](limits.md#the-failure-rule) applies, with the command and the error. Then the bullet that starts
  "If the user declines, or if `gh issue edit` fails" applies, as for a failed `gh issue edit`. As a result, the
  orchestrator makes no new offer for that ticket and that task.
- If the session skips the write because the walk finds a cycle, the ticket has no new link. The bullet that starts "If
  the user declines, or if `gh issue edit` fails" applies, as for a failed `gh issue edit`. As a result, the
  orchestrator makes no new offer for that ticket and that task.
- If the session skips the write because the ticket is in flight or closed, the link offer ends for the ticket. The
  shared-file bullet does not apply to it. The orchestrator tells the user, as The reads before the write says. The
  orchestrator makes no new offer for that ticket and that task. These rules hold only while the ticket is in flight or
  closed. When the ticket is open again, is not in flight and has no link (for example after an abort of its task), the
  shared-file bullet and the link offer apply to it.
- A task of the ticket can start between the read and the write, and the link can still land. Then the race paragraph of
  The reads before the write applies. The orchestrator removes the link and tells the user one time that the link was a
  race. The success steps of the approve bullet do not run. The ticket is in flight, so the bullet for a ticket in
  flight or closed applies, with no second message. If the remove fails, [the failure rule](limits.md#the-failure-rule)
  applies.
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

### The open-question rule

The orchestrator reads the issue of a ticket right before the start, with
`gh issue view <number> --json body,comments,updatedAt`. It does this read only for a ticket that can start now. In the
comments, only a comment of the account of the orchestrator counts, as [the issue check](plan-review.md#the-issue-check)
says. If the command fails, [the failure rule](limits.md#the-failure-rule) applies, and that ticket does not start.

A ticket that can start now is a ticket with each of these facts:

- A slot is free, or the orchestrator keeps a slot for the ticket, as [the stacking rule](#the-stacking-rule) says. The
  ticket gets that slot.
- The ticket comes next for the slot in the order of Pick the tickets. The tickets that the third item or a kept result
  of a read stops do not count for this order.
- Each other rule of the orchestration pages that needs no read of the issue lets the ticket start. Examples are the
  stacking rule, [A ticket on hold](#a-ticket-on-hold), the pi gate and the ban of
  [A failed CI run](ci-wait.md#a-failed-ci-run).

Until a ticket can start now, the orchestrator reads no body and no comment of its issue for its start. This also holds
at each read of the board. The order of Pick the tickets uses only the board and the kept results of a read, for example
the field `Priority`. This also holds for the judgment of a live security gap in the bullet that starts "A ticket that
closes a live security gap". Other rules can still read an issue at other times, for example A ticket on hold at the end
of a hold. The reason: a read ahead of the start costs tokens, and its result can wait for hours or days.

Right after the read, the orchestrator applies each rule that needs the text of the issue. Examples are the bullet of a
manual-steps issue, the shared-file bullet, the move rule, [the link offer](#the-link-offer) and this rule.
[The prompt of a task subagent](#the-prompt-of-a-task-subagent) also takes the links of its comments from this read.
Each file that the shared-file bullet counts from the issue comes from this read. The compare before the start of
[the overlap rule](land-the-work.md#the-overlap-rule) also uses these files.

A rule that needs the text of the issue can stop the start, for example the shared-file bullet. Then the orchestrator
keeps the result of the read and the value of `updatedAt`. At each read of the board and before each later start of the
ticket, the orchestrator runs `gh issue view <number> --json updatedAt -q .updatedAt`. If the output is the kept value,
the orchestrator keeps the result, and a start uses it with no new read. If the output differs, the orchestrator drops
the kept result, and the next start reads the issue again. If the command fails,
[the failure rule](limits.md#the-failure-rule) applies, and that ticket does not start.

An issue can hold an open question that stops its start. The note of
[the change-of-scope comment](plan-review.md#the-change-of-scope-comment) that starts
`## Open question after the change of scope` and the hold comment of [A ticket on hold](#a-ticket-on-hold) are forms of
such a question. For the order of the priority rule, the orchestrator counts such a ticket as a ticket that can start.
If that ticket is the next ticket for a free agent, the orchestrator asks the user about the question. Before that, the
orchestrator does not ask, also with a free agent. On 2026-10-31, #635 held such a question.

While the answer waits, the ticket after it takes the free agent. After the answer, and after each body edit that the
issue asks for, the ticket can start.

### The defer rule

To defer a ticket means that the user moves its issue to a later milestone, for example "Future". This rule covers a
deferred ticket that has a task in flight. A parked task is the task of such a ticket. On 2026-10-14, the user moved #34
from M5 to "Future" while its task was in `awaiting_plan_review`. The user did not want the task aborted, because
`tasker abort` deletes the work of the task subagent. When the user defers a ticket that has a task in flight, the
orchestrator does these steps:

1. Tell the task subagent of the ticket to end its work. A message to a task subagent that has ended starts the task
   subagent again (see ["Terms" in "Quota"](quota.md#terms)). The task subagent ends its work after its current `tasker`
   command ends. It runs no other `tasker` command. Before its final report, it removes the task worktree as
   [the own-worktree rule](limits.md#the-own-worktree-rule) says. The remove changes no task, and the task keeps its
   state. Then it gives its final report.
2. Leave the task in its state. Do not run `tasker abort`, unless the user tells you to.
3. Delete the jobs of the task subagent, as ["Delete the job" in "Quota"](quota.md#delete-the-job) says.
4. Move the issue to the milestone that the user names: `gh issue edit <number> --milestone "<milestone>"`.
5. Move the card of the ticket to Todo, with the move command of [The project board](issues.md#the-project-board). The
   ticket waits in Todo of its new milestone.
6. Post a comment on the issue that starts with `## Parked task`, with the findings of the final report. The next task
   subagent can start from them. Examples are the state of the task, the open plan questions, the answers so far and the
   facts that the task subagent tested. For a stacked task, the comment gives the start base of the last read when the
   work of the task subagent ended. The final report gives it, or says that the task subagent held none (see
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

   If the new milestone is "Future", ask no question in this step. This paragraph then wins over the earlier sentences
   of this step. For each issue that the first command of this step lists, run
   `gh issue edit <blocked issue> --remove-blocked-by <number>`. Then list the open issues that the deferred issue waits
   for: `gh issue view <number> --json blockedBy -q '.blockedBy.nodes[] | select(.state == "OPEN") | .number'`. For each
   issue of that list, run `gh issue edit <number> --remove-blocked-by <blocker>`. The reason: an open issue that waits
   for an issue of "Future" waits with no end.

If a `gh` command of these steps fails, [the failure rule](limits.md#the-failure-rule) applies, and the orchestrator
does the other steps. The task keeps its state.

A parked task stays in flight in `tasker status`. A task in flight is a parked task when the card of its ticket is in
Todo, because the card of a ticket that runs is in In progress. To read the column of the card, run
`gh issue view <number> --json projectItems -q '.projectItems[].status.name'`. The command prints `Todo` for a parked
task. [The overlap rule](land-the-work.md#the-overlap-rule), the move rule and the fourth case of
[the stop rule](plan-review.md#the-stop-rule) leave out a parked task.

When the ticket comes back to the current milestone, the orchestrator starts a new task subagent for it, as
[Pick the tickets](#pick-the-tickets) says. The task subagent follows
[the comeback rule](run-one-ticket.md#the-comeback-rule).

### A ticket on hold

A ticket on hold is an open ticket with the label `on hold`. Only a word of the user puts a ticket on hold or ends the
hold. The orchestrator adds the label with `gh issue edit <number> --add-label "on hold"`, and it removes the label with
`gh issue edit <number> --remove-label "on hold"`. The issue stays in its milestone. At each read of the board and
before each start, the orchestrator runs `gh issue list --state open --label "on hold" --limit 1000 --json number`. If
the read fails, [the failure rule](limits.md#the-failure-rule) applies, and the orchestrator starts no ticket and makes
no offer until the read works.

A hold of a whole milestone is another rule, [A milestone hold](working-with-the-user.md#a-milestone-hold).

If the ticket has a task in flight, the orchestrator does the steps of [the defer rule](#the-defer-rule), with two
changes. Step 4 adds the label, and the milestone stays. In place of step 7, the orchestrator does the link removal of a
hold below. The task of a ticket on hold is a parked task.

A same-file link is one kind of soft blocker of [The reads before the write](issues.md#the-reads-before-the-write). It
is a blocked-by link that exists only because both issues edit one file, or one place of a doc. Each bullet of
[The blocked-by links](planner.md#the-blocked-by-links) that links two issues only for a shared file gives such links.
Three examples are the bullets that start "The planner also links two issues", "Inside a chain of issues" and "A line of
tickets". A link for a real need of code or docs is not a same-file link. The links of three bullets are also not
same-file links: "A ticket that changes the form or the layout", "A ticket that renames a doc ..." and "A manual-steps
issue gets its links".

GitHub keeps no reason for a link. So the orchestrator judges each link from the Requirements and the Docs sections of
both issues. If the blocked issue cannot start before the ticket on hold lands, the link is not a same-file link. If the
blocked issue starts first and its body is then false, the link is also not a same-file link. This judgment is open on
purpose. If the orchestrator cannot tell the kind of a link, the link is not a same-file link.

The link removal of a hold removes the same-file links of a ticket on hold. The word of the user that puts the ticket on
hold is the approval of each removal. For a ticket with no task in flight, the orchestrator does these steps right after
it adds the label. If the label is already on the ticket, the orchestrator does not add it again. It then does the steps
at the word of the user. For a ticket with a task in flight, the steps come in place of step 7 of the defer rule.

1. List each open issue that the ticket blocks:
   `gh issue view <number> -R <repo> --json blocking -q '.blocking.nodes[] | select(.state == "OPEN") | .number'`. If
   the output is empty, the link removal ends.
2. Judge the kind of the link of each listed issue.
3. For each same-file link, do steps 1 and 2 of [The reads before the write](issues.md#the-reads-before-the-write) for
   the blocked issue. If the blocked issue is in flight or closed, skip its removal.
4. Remove each same-file link that step 3 does not skip. Run
   `gh issue edit <blocked issue> -R <repo> --remove-blocked-by <number>` alone in a plain call.
5. If step 4 removed a link, read the board at once.
6. Tell the user each removed link and each skipped removal with its reason. If other links exist, ask the user which of
   them to remove. Then remove each link that the user names, and read the board again.
7. A removed link of step 4 or step 6 can free an issue of another milestone. If the session list of the tools has
   `orchestrator-<milestone>` of that milestone, tell that session the removed link.

If the list of step 1 fails, [the failure rule](limits.md#the-failure-rule) applies, and no link changes. A later word
of the user can start the link removal again. If `tasker status` or the read of the state fails, the orchestrator skips
that removal and tells the user. If a removal, the session list or a message fails, the failure rule applies.

The task of an issue in flight already started, so its link no longer stops a start. A stacked task on the task of the
ticket on hold follows the postpone bullet of [the stacked-ticket rule](#the-stacked-ticket-rule).

The link removal adds no link. In a chain of three issues of one file, the middle issue can go on hold. Then the link
removal removes the link of the third issue and adds no link to the first issue. The shared-file bullet of
[Pick the tickets](#pick-the-tickets) then gives the order of the first and the third issue.

At the end of the hold, no session adds a removed link again. The ticket and each issue that the link removal freed then
follow the shared-file bullet and [the overlap rule](land-the-work.md#the-overlap-rule).

On 2026-11-13, the user said: "more generally, any issue that is on hold should automatically unblock any downstream
issues that are only blocked due to the "same file" rule."

Each rule of the orchestration pages leaves out a ticket on hold and its task, as if they are outside the milestone.
This covers the start of a ticket, an empty Todo column, the shared-file bullet, the link offer and the earlier-blocker
offer. A ticket that a ticket on hold blocks waits while the link stays, and it never stacks on the task of a ticket on
hold. A rule that names a parked task or a postponed ticket still applies, for example the bullet "If the user postpones
the parent" of the stacked-ticket rule. The report of a done milestone names each ticket on hold.

A waiting question of a ticket on hold is a question of an item of the orchestrator about that ticket. No answer to it
reached the orchestrator. Before the report of a done milestone, the orchestrator moves each waiting question to a hold
comment on its ticket. A hold comment starts with `## Open question of a ticket on hold`. It gives the question and its
choices word for word, as the item gave them, and the id of the item. It says that the orchestrator asks the question
again at the end of the hold.

The orchestrator posts each hold comment at once, with no approval of the user, as it posts the open-question note of
[the change-of-scope comment](plan-review.md#the-change-of-scope-comment). This rule wins over the approval of a comment
in [Before a post](issues.md#before-a-post). The report of a done milestone names each question that the orchestrator
moved. It gives the id of the item and the link of the hold comment of each such question. If the post of a hold comment
fails, [the failure rule](limits.md#the-failure-rule) applies, and the report names that question as still open in its
item.

An answer can reach the orchestrator after the post of the hold comment. Then the orchestrator acts on the answer and
posts an answer comment at once, with no approval of the user, as for a hold comment. An answer comment starts with
`## Answer to an open question of a ticket on hold`, and it gives the answer and the link of its hold comment. A hold
comment with an answer comment no longer counts. If the post of an answer comment fails,
[the failure rule](limits.md#the-failure-rule) applies, and the ticket does not start until the post works.

When a hold ends, a ticket with a task in flight comes back as the last paragraph of the defer rule says. A ticket with
no task starts as any other ticket. The reason for the label: a card in Todo looks like a ticket that can start.

At the end of the hold, the orchestrator reads the comments of the ticket with `gh issue view <number> --json comments`.
Only a comment of the account of the orchestrator counts, as [the open-question rule](#the-open-question-rule) says.
Before it starts any ticket after the word of the user, it asks the user, in a new item, the question of each hold
comment with no answer comment. This ask wins over the time of the ask in the open-question rule, and other tickets can
start while the answer waits. The open-question rule stops the start of the ticket until the answer. If the read of the
comments fails, [the failure rule](limits.md#the-failure-rule) applies, and the orchestrator starts no ticket until the
read works.

If the milestone is open and no orchestrator of its slug runs, the operator removes the label and starts one, as
[The close of a milestone](operator-start.md#the-close-of-a-milestone) says. If the label is already gone at the word of
the user, the orchestrator skips its removal.

## The prompt of a task subagent

The orchestrator writes the prompt of each task subagent.

A Codex orchestrator starts each task subagent with the native subagent tools of its own session. It does not start a
ticket driver as a top-level Codex session through herdr. The operator still starts top-level role sessions through
[Start a session](operator-start.md#start-a-session).

The Codex orchestrator uses its native tools to send task instructions and receive task reports. It keeps the native
identifier of each task subagent with the issue key. The native tools and their exposed arguments govern Codex starts
and messages, including the naming argument. The Claude Code `Agent` and `SendMessage` argument forms below do not
define Codex tool arguments.

If a required native subagent tool is unavailable or fails, the Codex orchestrator reports the failure through its
operator. It starts no replacement ticket driver in a herdr tab. The existing ticket selection, task prompt, worktree,
slot and landing rules still apply.

- The prompt of a task subagent gives only the context of its ticket. The context is the issue key, the milestone of its
  ticket (see the fourth case of [the stop rule](plan-review.md#the-stop-rule)), the milestones that are off limits for
  the task subagent, the landing order (see ["Land the work"](land-the-work.md#land-the-work)), for a stacked ticket,
  its parent (see [the stacked-ticket rule](#the-stacked-ticket-rule)), the quota slot and whether the task subagent has
  a job (see ["Quota"](quota.md#quota)), the folder of the task subagent for its files (see the folder bullet of
  ["Limits"](limits.md#limits)), the links of the change-of-scope and design-gap comments of its issue (see the bullet
  below that starts "If the account of the orchestrator"), the hints for its first refine, and the task worktree with
  its path, `../tasker-worktrees/<session name>` (see the folder bullet of ["Limits"](limits.md#limits)).

- The prompt never tells the task subagent to take a path from the `worktree:` line of `tasker show`. The reason: that
  line prints the worktree of tasker, and [the own-worktree rule](limits.md#the-own-worktree-rule) bans each read and
  each run there. On 2026-10-24 and 2026-10-25, the prompts of orchestrator-m21 for #395, #425 and #418 said "Take your
  task worktree from the `worktree:` line of `tasker show`". The task subagent of #418 followed the own-worktree rule
  and used `../tasker-worktrees/<session name>`.
- A hint of the orchestrator can resolve a conflict. Before the orchestrator gives such a hint, it compares the hint
  with the Out of scope section of the issue. If the Out of scope section excludes what the hint asks for, the
  orchestrator does not give the hint. Then the task subagent reports the conflict under the fifth case of
  [the stop rule](plan-review.md#the-stop-rule), and the user decides. On #301, a hint asked the plan to extend another
  hint of the page, but the Out of scope section excluded "A change of other hints".
- The prompt names the source of each fact that it gives. The source is the issue body, a comment with its link, or the
  code. On #274, a hint of the prompt said that the issue body states that the stored base revision is a ref. Only a
  comment on #273 stated it, and the task subagent reported the difference at step 1 of
  ["Run one ticket"](run-one-ticket.md#run-one-ticket).

  A hint can give a fact with a file of the repo as its source. Before the orchestrator sends the prompt, it reads that
  fact in the base of the ticket:

  - For a plain ticket, the base ref is `origin/<base branch>`, read after `git -C <local clone> fetch origin`.
    `<base branch>` is the [base hint](workspaces.md#the-resolve) of the issue, else `defaultBaseBranch` of the repo.
    The orchestrator does not use the learned default, because that value is a row of the database, and the orchestrator
    does not read the database.
  - For a stacked ticket, the base ref is `tasker/<parent branch>`, read after `git -C <local clone> fetch tasker`. A
    ticket with a parent in its prompt is stacked, as [the stacked-ticket rule](#the-stacked-ticket-rule) says.
    `<parent branch>` is the `branch:` line of `tasker show <parent issue>`.
  - Right after the fetch, the orchestrator reads the hash of the base ref one time with
    `git -C <local clone> rev-parse --verify <base ref>`. Each later command of this step uses that hash, as
    [the shared-clone rule](limits.md#the-shared-clone-rule) says.
  - If the hint names a file, the orchestrator reads the file with `git -C <local clone> show <hash>:<path>` and finds
    the fact in it.
  - If the hint names no file, the orchestrator searches the tree with
    `git -C <local clone> grep -n -w -F -e '<name>' <hash>`, and reads each hit.

  If the base does not hold the fact, the prompt drops the fact, or it names the ticket that adds the fact. That ticket
  is this ticket, or a ticket in flight by its issue key. A missing file is such a case. `git show` then exits with 128
  and prints one of the two texts of [the doc-read rule](doc-reads.md#the-doc-read-rule), and that is an answer, not a
  failure. The error text decides the answer, not the exit code. Another error of `git show` also exits with 128, and
  that error is a failure. The two texts are an answer because the read of the hash in the step before already found the
  commit. A search with no hit is such a case too: `git grep` exits with 1. If the fetch or the read of the hash fails,
  or a command fails in another way, [the failure rule](limits.md#the-failure-rule) applies. Then the prompt drops the
  fact. On #539 (2026-10-25), a hint named a resolve of `TASKER_GH_BIN` in `src/issues/github/run.ts`, and the base held
  no such name.

- If the account of the orchestrator posted comments on the issue of the task subagent that start with
  `## Change of scope` or `## Design gap`, the prompt links each one. If the issue has no such comment, the prompt does
  not mention these comments. The reason: [the issue check](plan-review.md#the-issue-check) counts such a comment of the
  account of the orchestrator as part of the issue only when the orchestrator sends its link. On #395 (2026-10-24), the
  prompt gave no link to the comment https://github.com/codeguru42/tasker/issues/395#issuecomment-6386939662. The task
  subagent found the comment at step 1 of ["Run one ticket"](run-one-ticket.md#run-one-ticket). Then the orchestrator
  had to tell the task subagent that the comment is part of the issue.
- When the orchestrator starts a task subagent, it names it after the issue key of its ticket. Codex uses the native
  tools and arguments described above. Claude Code uses the `name` argument of its `Agent` tool, for example
  `name: "codeguru42-tasker-108"`.
  - The list of the options of the Agent tool does not show `name`, but the tool accepts it. The `description` option is
    not the session name. The M7 orchestrator tested `name` on 2026-10-15. In Claude Code, an Agent call with
    `name: "codeguru42-tasker-nametest"` started the task subagent with no error. A SendMessage with
    `to: "codeguru42-tasker-nametest"` reached that task subagent, and the task subagent answered. The report of the
    task subagent came back from `codeguru42-tasker-nametest`.
  - In Claude Code, the session name has the form `<owner>-<repo>-<number>`, for example `codeguru42-tasker-108` for
    `codeguru42/tasker#108`. Its Agent tool refuses a name that does not match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`
    (tested on 2026-10-14). The issue key itself does not match. The Docs orchestrator tested this on 2026-10-15. An
    Agent call with `name: "codeguru42/tasker#143"` failed before the task subagent started, with the error
    `name must start with a letter or digit and contain only letters, digits, underscores, or hyphens (max 64 chars)`.
    This error gives the same rule as the pattern. No later session tests the issue key as a name again.
  - In Claude Code, the orchestrator uses the session name for each message to the task subagent, for each resume
    message and in the prompt of each quota job. The first bullet of this section already puts the issue key in the
    prompt of the task subagent. The prompt of each quota job gives the full issue key too, so that each one can be
    matched to the task. The reason: several orchestrators run at the same time. A name such as `agent-1` or a bare
    number does not say which ticket or which repo the session belongs to. The full key is unique, so the reports, the
    messages and the jobs can be matched to the task.
  - One task subagent runs one ticket, so one name belongs to one task. If the orchestrator starts a second session for
    the same ticket, the orchestrator adds a suffix, for example `codeguru42-tasker-108-2`, and says so in the prompt of
    the new task subagent. A SendMessage to a task subagent can fail with "No transcript found for agent ID". Then the
    orchestrator cannot resume that task subagent. In that case, the orchestrator starts a second session for the
    ticket, with the suffix of this bullet. The Claude Code `SendMessage` failure described above does not define Codex
    message behavior. The new task subagent follows [the comeback rule](run-one-ticket.md#the-comeback-rule). The prompt
    of the new task subagent gives the state of the task from `tasker show <issue>`. The prompt gives the task worktree
    of the new name, as the first bullet of this section says. The comeback rule then finds the old task worktree
    through the branch-exists case of [the own-worktree rule](limits.md#the-own-worktree-rule). The orchestrator moves
    the quota jobs of the ticket, as [Delete the job](quota.md#delete-the-job) says. On #409 (2026-10-24), a SendMessage
    failed in this way after a restart of the session of the orchestrator at a `/rename`.
  - If a task subagent already runs with no name, the orchestrator does not restart the task subagent only to give it a
    name. The reason: a new task subagent does not have the context of the old task subagent, for example the plans that
    it read and its review loops. For a task subagent with no name, the orchestrator puts the full issue key in the text
    of each message, each resume message and each quota job prompt, in place of the session name. The orchestrator names
    each new task subagent.
- Before the task subagent starts, the orchestrator makes the folder of the task subagent for its files (see the folder
  bullet of ["Limits"](limits.md#limits)). In one case, a background command of a task subagent wrote into a missing
  folder and failed.
- The orchestrator writes in the prompt that the comment of step 11 of
  ["Run one ticket"](run-one-ticket.md#run-one-ticket) is the only write of the task subagent on GitHub issues, labels
  and the project board (see ["Limits"](limits.md#limits)). In one case, a strong "never run a gh write" line in the
  prompt of a task subagent made the classifier of auto mode block the comment of step 11 (see
  [the tool-block rule](tasker-commands.md#the-tool-block-rule)).
- The prompt tells the task subagent to run `tasker merge` of step 9 of
  ["Run one ticket"](run-one-ticket.md#run-one-ticket) in [the plain form](tasker-commands.md#the-plain-form-rule), with
  its issue key. An example is `tasker merge codeguru42/tasker#719`. The prompt says: no `cd`, no pipe and no `2>&1`.
  The first bullet of this section limits the prompt to the context of its ticket, and this bullet wins over it.

  The prompt also says: after a denial, the report gives the exact command and the exact text of the denial, in full.
  [The tool-block rule](tasker-commands.md#the-tool-block-rule) gives this report and the other steps after a denial.

  The reason: the classifier of auto mode denied three merge calls of task subagents, as
  [the plain-form rule](tasker-commands.md#the-plain-form-rule) says. On 2026-11-03, the report of the task subagent of
  #563 called the denied call "plain form `tasker merge codeguru42/tasker#563`". The denied call had `2>&1 | tail -6`
  after the command. The same report gave the text of the denial with "..." in place of its end.

- For all the rules, the prompt names the docs of this list, "the base list". The base list is the same for the task
  subagent of each milestone:

  - `AGENTS.md`
  - `docs/orchestrator.md` and the pages of its list "The pages". These are
    [the orchestration pages](../orchestrator.md). The base list leaves out `docs/dev/handoff.md` and
    `docs/dev/handoff-orchestrator.md`.
  - `docs/sessions.md`
  - `docs/dev/rules.md`
  - `docs/dev/first-refine.md`
  - `docs/dev/rebase-conflicts.md`
  - `docs/dev/working-with-the-user.md`

  The prompt also names each doc that the ticket changes, for example `docs/dev/planner.md`. These are:

  - Each doc that the Requirements section or the Docs section of the issue asks to change.
  - Each doc that a hint of the orchestrator for the first refine asks the ticket to change.
  - Each file under `skills/` that the Requirements section, the Docs section or a hint for the first refine asks the
    ticket to change.

  For each other doc, [the intro of `AGENTS.md`](../../AGENTS.md) gives the rule. The reason for the base list:
  `AGENTS.md` links each doc under `docs/`, so a prompt that names the docs of `AGENTS.md` names all of them. No other
  base prompt exists.

- When the orchestrator learns a new rule for task subagents, it does not put the rule only in a prompt. It sends the
  rule to the planner, as the planner bullet of this section says. A rule that only one ticket needs can also go in the
  prompt of that ticket.
- The planner bullet: the orchestrator sends each lesson of a final report, each finding of a session review, each
  recurrence and each proposed issue only to `planner-<slug>` of its own slug, with `SendMessage`.
  [Working with the user](planner.md#working-with-the-user) of planner.md names that session, and
  [sessions.md](../sessions.md) defines the slug. The message gives the lesson, the ticket, the date, and the doc and
  the section that the lesson fits. For a recurrence, the message also names the open issue. The planner drafts and
  posts the issue, as [The review loop of a draft](planner.md#the-review-loop-of-a-draft) of planner.md says. The
  orchestrator drafts and files no issue itself. The one exception is the issue of step 1 of
  [A failed CI run](ci-wait.md#a-failed-ci-run), which the orchestrator files itself. If `SendMessage` fails, for
  example because no planner runs, the orchestrator sends the lesson to [its operator](../operator.md) as an item. A
  refused message counts as a failed `SendMessage`. The orchestrator waits for no answer from the planner. A missing
  answer is out of scope. On 2026-10-17 and 2026-10-18, the user asked the Docs orchestrator to delegate each issue
  draft to the planner.

  A request of [the user](../sessions.md) to draft an issue, or to change the title or the body of an issue, is a
  proposed issue of this bullet. [The orchestrator](../orchestrator.md) sends it to `planner-<slug>` with no question to
  the user, and [tells the user](working-with-the-user.md#the-operator) that it did. The message gives the words of the
  user and the date, and [the ticket](../orchestrator.md) when one exists. On 2026-10-26, the user asked the
  orchestrator of #391 to draft the issues of a new milestone. The orchestrator drafted and posted 8 issues and 4
  changes itself, with no review loop. Review loop 1 later found from 9 to 14 findings in each draft.

- The source bullet: a message of the planner bullet names the source of each fact of the message. Examples of a source
  are the final report, a comment, a command and its output, a doc, or the words of the user. The message marks each
  cause or claim that nobody measured as not measured. A claim of a final report with no command and no read is such a
  claim. The reason: in M14, two claims that nobody measured reached the planner as facts. A guess can then go into a
  tracked doc as a fact.
