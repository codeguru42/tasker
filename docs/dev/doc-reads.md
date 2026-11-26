# Doc reads

The readers of this page are the orchestrator, the task subagents, each planner, each question session, the issue
subagents and each session with no role. Each planner, each question session, each issue subagent and each session with
no role read the doc-read rule.

## The re-read rule

The orchestrator works from the current docs of the orchestrator. The docs of the orchestrator are `AGENTS.md`,
`docs/orchestrator.md`, the pages of the list "The pages" of [docs/orchestrator.md](../orchestrator.md),
`docs/sessions.md`, `docs/dev/GLOSSARY.md`, `docs/dev/rules.md`, `docs/dev/working-with-the-user.md`, and the docs that
the prompt of the orchestrator names. For example, a prompt can name `docs/dev/planner.md`, `docs/dev/issues.md`,
`docs/dev/first-refine.md` and `docs/dev/rebase-conflicts.md`. The last read is the commit of `origin/main` from which
the orchestrator last read the docs of the orchestrator.

The re-read docs are the docs of the orchestrator that the orchestrator reads again after a landing. They are these
docs:

- Each start doc of [docs/orchestrator.md](../orchestrator.md#the-start-reads), and `AGENTS.md`.
- Each doc that the prompt of the orchestrator names.
- Each page of the list "The pages" that the orchestrator read in its session.

In the state Running or Ended of item 5 of [step 2](#step-2-read-each-doc-with-the-read-tool), a page counts as read in
the session. In the state Not started, a page is not a re-read doc. An old read of a page with `git show` counts as a
read of the page in the same way.

At the start of its session, the orchestrator does step 1 of [the doc-read rule](#the-doc-read-rule). The first last
read is `<head>`, the hash that step 1 reads. If step 1 did not pull, the orchestrator runs
`git -C <local clone> rev-parse --verify origin/main` after the fetch, and that hash is the first last read. Then the
orchestrator makes its start reads, as [The start reads](../orchestrator.md#the-start-reads) says. The start reads read
no other page.

Each time a ticket lands, the orchestrator does these steps. They are at the place that the bullet "When the final
report of the task subagent of a ticket says that the ticket landed" of [Land the work](land-the-work.md#land-the-work)
gives. The steps change no task.

1. Do step 1 of [the doc-read rule](#the-doc-read-rule).
2. Set `<tip>` to `<head>`. If step 1 did not pull, run `git -C <local clone> rev-parse --verify origin/main` one time
   and set `<tip>` to that hash.
3. Run `git -C <local clone> diff --name-only <last read>..<tip> -- AGENTS.md docs/ skills/`. The output lists each file
   that changed since the last read. If the output is empty, no doc changed, and the steps are complete. The last read
   stays.
4. Before the next step of your work, read again each file of the list that is a re-read doc, with the Read tool in
   pieces, as step 2 of the doc-read rule says. If step 1 did not pull, use `git -C <local clone> show <tip>:<path>`
   instead. A file of the list that is not a re-read doc needs no read. This also holds for a changed page that the
   orchestrator did not read. If `AGENTS.md` or `docs/orchestrator.md` is on the list, also read, for the first time,
   each new start doc that it names, with the same read. A new page of the list "The pages" gets no read at the landing.
   Then `<tip>` is the new last read.

The memory step of [Land the work](land-the-work.md#land-the-work) stays. Its read of the landed docs can cover a page
that is not a re-read doc. That read is a read on need for the memory step, so the page then counts as read.

A read on need does step 1 of [the doc-read rule](#the-doc-read-rule), and step 1 can pull a newer commit. The last read
stays. So the start docs can be of an older commit than a page that the orchestrator read on need. The next run of the
steps above reads again each re-read doc that changed since the last read, for example `docs/dev/rules.md`.

If a command of [the doc-read rule](#the-doc-read-rule) fails before a doc read of the orchestrator,
[the failure rule](limits.md#the-failure-rule) applies. This applies to the first read at the start of the session and
to each later doc read. If a command of the steps above fails, the failure rule also applies. If the orchestrator must
read a doc, it then reads the doc with `git -C <local clone> show origin/main:<path>`, from the `origin/main` of the
last fetch that worked. Then the orchestrator continues its work. The last read stays. At the start of the session, the
orchestrator then runs `git -C <local clone> rev-parse --verify origin/main` before its start reads, and that hash is
the first last read. The orchestrator does the steps above again at the next landing.

If the branch check of step 1 fails, the orchestrator reads no doc. It tells the user the command and its output, and it
starts no new ticket. It keeps its running tasks on their last read. It repeats the check at its next landing, or when
the user says that `main` is back.

## The notice rule

This rule covers each ticket, whatever its milestone, also a ticket with no milestone. It applies when the landing of
the ticket changes a doc of the orchestrator of the ticket (see [the re-read rule](#the-re-read-rule)), for example
`docs/orchestrator.md`. A notice is a message about such a landing from the orchestrator of the ticket. For a change of
a doc of the orchestrator, the notice goes to the other orchestrators. Each orchestrator has a name of the form
`orchestrator-<slug>`, with the slug of its scope, as
[The start of an orchestrator](../orchestrator.md#the-start-of-an-orchestrator) says. For example, `orchestrator-m6`,
`orchestrator-m7`, `orchestrator-docs` and `orchestrator-docs-fix` are such names. For a milestone scope, the part after
`orchestrator-` is the first word of the milestone title in lowercase. Examples are `orchestrator-m9` for "M9 — Pauses
and recovery" and `orchestrator-docs` for "Docs". For a set scope, the part after `orchestrator-` is the slug that the
user gives. The other orchestrators are all the sessions with such a name except the session of the orchestrator of the
ticket. On 2026-10-25, before #561, #495 (M22 — Operator) changed `docs/dev/handoff-operator.md`, and operator-docs got
no notice. Before #565, a change of `docs/dev/working-with-the-user.md`, a start doc of the operator, sent no notice to
the operator.

The orchestrator of the ticket does these steps:

1. When the final report of the task subagent of the ticket arrives, read the files that landed in that report.
2. If no file of the report is a doc of the orchestrator of the ticket, send no notice.
3. Read your own name from the first line of the output of `ListAgents`, as [sessions.md](../sessions.md) says. If a doc
   of the orchestrator changed, each session whose name starts with `orchestrator-`, except your own session, is another
   orchestrator. A session with another name, for example `planner-m7`, gets no notice. A milestone hold can stop this
   notice, as [A milestone hold](working-with-the-user.md#a-milestone-hold) says.
4. Send one notice to each session of step 3 with `SendMessage`. Take the landed commit and the sections that changed
   from the same report. The notice names them in one or two lines.

   For example: Landed `<commit>` on `main`. `docs/dev/run-one-ticket.md` changed in "Run one ticket", and
   `docs/dev/land-the-work.md` changed in "Land the work".

The notice does not depend on the re-read rule. If the re-read rule fails at this landing, the orchestrator of the
ticket still sends the notice, and [the failure rule](limits.md#the-failure-rule) applies, as the re-read rule says. If
the session list or a message fails, the failure rule applies, and the orchestrator of the ticket continues its work. A
session that does not answer gets no second notice. The re-read rule covers such an orchestrator at its next landing.

The notice is information. When the other orchestrator gets a notice, the other orchestrator does the steps of the
re-read rule before its next step. The other orchestrator takes the rule from the doc, not from the notice. The other
orchestrator also sends a task subagent notice to its own task subagents in flight, as
[the task subagent notice](#the-task-subagent-notice) says. A covered session that gets a notice does step 1 again
before its read. If the branch check fails, a planner session reads no doc and tells the user. It repeats the check at
its next notice, or when the user says that `main` is back.

Each orchestrator has its own docs of the orchestrator, because each prompt names its own docs. `AGENTS.md`,
`docs/orchestrator.md`, the pages of its list "The pages", `docs/sessions.md`, `docs/dev/GLOSSARY.md`,
`docs/dev/rules.md` and `docs/dev/working-with-the-user.md` are docs of each orchestrator. A page that an orchestrator
did not read is still a doc of that orchestrator for this rule. So the notice still goes out for a change of that page.
The notice makes the other orchestrator do the steps of the re-read rule, and those steps read only its re-read docs.

The re-read rule and the notice rule do not cover the task subagents. Each new task subagent reads its docs when it
starts. [The task subagent notice](#the-task-subagent-notice) gives the docs of a task subagent, and it covers a task
subagent in flight.

## The task subagent notice

After a landing, the orchestrator tells each task subagent in flight which sections of its docs changed. On #486, #444
landed while #486 ran and changed the order of the same-patch reads before `tasker update-branch`. The task subagent of
#486 read the diff of the docs on its own, with no rule that asked it to.

The docs of a task subagent are the docs that its prompt names for all the rules and for the change of its ticket, as
[The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) of `docs/dev/pick-the-tickets.md`
says. These are the docs of "[the base list](pick-the-tickets.md#the-prompt-of-a-task-subagent)" and each file that the
prompt names because the ticket changes it. Such a file can be under `skills/`. The base list lives in
[`prompt-templates/subagents/task.md`](../../prompt-templates/subagents/task.md).

A file that the prompt names for another reason, for example as the source of a fact of a hint, is not a doc of the task
subagent. Each task subagent has its own docs, because each prompt names its own docs. The orchestrator takes the docs
of a task subagent from the prompt that it wrote for that task subagent.

A task subagent in flight is a task subagent of the orchestrator from its start until its
[final report](run-one-ticket.md#the-final-report) arrives. The term "running" of ["Terms"](quota.md#terms) in
`docs/dev/quota.md` keeps its own meaning. A task subagent in flight can be running or ended in the meaning of that
page.

The task subagent notice covers each landing of a ticket of the orchestrator. The steps of the orchestrator come right
after the steps of [the notice rule](#the-notice-rule), as [Land the work](land-the-work.md#land-the-work) says.

1. When the final report of the task subagent says that the ticket landed, the orchestrator reads the files that landed
   in that report.
2. If no file of the report is a doc of a task subagent in flight, the orchestrator sends no task subagent notice for
   that landing.
3. Otherwise, the orchestrator sends one message with `SendMessage` to each task subagent in flight that has a file of
   the report among its docs. The message is the task subagent notice. It names the landed commit and each changed
   section of each doc of that task subagent, from the same report.

   For example: Landed `<commit>` on `main`. `docs/dev/run-one-ticket.md` changed in "The diff read", and
   `docs/dev/review-findings.md` changed in "Review findings".

When the orchestrator gets a notice of the notice rule from another orchestrator, it sends a task subagent notice too.
It sends it to each task subagent in flight that has a doc of the notice among its docs. The task subagent notice names
each section of the notice that is in a doc of that task subagent. If no section of the notice is in a doc of a task
subagent in flight, the orchestrator sends no task subagent notice.

The task subagent notice does not depend on [the re-read rule](#the-re-read-rule). If the re-read rule fails at this
landing, the orchestrator still sends the task subagent notice. [The failure rule](limits.md#the-failure-rule) of
`docs/dev/limits.md` applies, as the re-read rule says.

When a task subagent gets a task subagent notice, it reads each named doc again, as
[the doc-read rule](#the-doc-read-rule) says. It does this before its next command or tool call of its work. From then
on, the task subagent follows the new text of the named sections. A step that the task subagent already did stays done.

If the task subagent runs a long `tasker` command in the background, the read comes after the end of that command.

A task subagent can wait in a loop that reads a state. Examples are the "To wait" bullet of "Land the work",
[the CI wait](ci-wait.md#the-ci-wait) of `docs/dev/ci-wait.md` and the wait bullet of
[the command rules](tasker-commands.md#the-command-rules) of `docs/dev/tasker-commands.md`. Such a task subagent reads
the named docs again before its next read of the state. The limit of the wait does not change.

A task subagent can also wait with its turn ended. Examples are a wait for an answer under
[the answer-wait rule](limits.md#the-answer-wait-rule) of `docs/dev/limits.md`, and a wait in `quota_blocked` or
`interrupted`, as ["What the task subagent does"](quota.md#what-the-task-subagent-does) of `docs/dev/quota.md` says.

If the last report of the task subagent is an interim final answer, the task subagent waits with its turn ended. If the
orchestrator sent an answer, a next step or a resume message after that report, this wait ended. In each other case, the
orchestrator sends the task subagent notice.

For such a wait, the orchestrator sends no task subagent notice, because each message starts the task subagent again. It
keeps each landed commit and each changed section of each doc of that task subagent. It puts them in the next message
that it sends to that task subagent, for example the answer or the resume message. Each section stands one time in that
message. The paragraphs of this wait win over each other sentence of this section on the send of a task subagent notice.

After the send of that message works, the orchestrator drops the kept sections. If that message fails, the orchestrator
keeps them for the next message. When the task subagent is no longer in flight, the orchestrator also drops them. When a
new session takes its ticket, the orchestrator also drops them. The limit: the kept sections live in the context of the
orchestrator, so a compaction can lose them.

The task subagent treats the sections of that message as a task subagent notice. A task subagent notice can still reach
a task subagent that ended its turn, because the notice left before its interim final answer. A message can also leave
the task subagent in its wait, for example a hold of the parent-hold rule. Such a task subagent reads the named docs
again. Then it ends its turn with an [interim final answer](limits.md#the-answer-wait-rule). It sends no `SendMessage`
and does not repeat its question or its report.

The first line of that interim final answer says that the answer is not the final report and names what the task
subagent still waits for. The orchestrator treats it as no answer and no next step, and the wait does not change. For
the orchestrator, each read that a rule gives after a report of a task subagent still applies.

If the fetch of the doc-read rule fails, a task subagent that does not wait stops and reports the error. The doc-read
rule says this for a task subagent. A task subagent that waits gives the error in its interim final answer, or in its
next report, and keeps its wait.

If a message of the orchestrator fails, the failure rule of `docs/dev/limits.md` applies, and the orchestrator continues
its work. The orchestrator sends no second task subagent notice for that landing. The task subagent notice needs no
answer.

The task subagent notice is information. The task subagent takes each rule from the doc, not from the task subagent
notice.

At the end of a milestone hold, the task subagent notice has another form, as item 9 of
[A milestone hold](working-with-the-user.md#a-milestone-hold) says. The notice names each changed file of the docs of
the task subagent, in place of a landed commit and its sections. The task subagent then reads each such file again in
full.

## The doc-read rule

The local clone holds the checkout of the user, for example a commit of a pre-release. The docs of the orchestration
come from `origin/main`, not from that checkout. A covered session pulls `main` only when the branch check, the clean
tree and the hash checks protect the read.

This section is the only home of the read steps. Each other doc links here. The exceptions are the start prompts and the
lists of [the allowed commands](allowed-commands.md).

### The covered sessions

Only a session of the kind `claude` is covered. The covered sessions are:

- The orchestrator, each planner session and the [question session](question-pane.md#a-question-pane).
- Each session that works with the user and has no role.
- A session that runs `/session-review`.
- The issue subagents (issue-draft, issue-review and issue-post), whatever session starts them.
- The subagent of the main session that posts a reviewed ad hoc draft.

These sessions keep the old read, also for a doc that they reach by a link:

- Each task subagent, for a whole ticket or for one task change. A task subagent never pulls in the shared local clone.
- The planner subagent, the opener subagent, the reuse subagent and the write subagent of the orchestrator, if such a
  subagent reads a doc. This covers each helper subagent of such a subagent, apart from the issue subagents.
- A read subagent that a session with no role starts for a read of code or docs.
- A session of a kind other than `claude`, for example `pi`. The measured `pi` sessions had only `bash`. Such a session
  runs no pull.

A session with no local clone has no step 1 and gets no command.

### The terms

- The old read is the fetch, then `git -C <local clone> show origin/main:<path>` in a Bash call.
- A clean tree is a tree for which `git -C <local clone> status --porcelain --untracked-files=no` exits with 0 and
  prints nothing.
- The branch check is `git -C <local clone> branch --show-current`.

### Step 1: pull the local clone

The session does step 1 one time for each group of reads that one step of its work needs.

1. Run the branch check. It passes on exit 0 with the output `main`. If it prints another name or an empty line, `main`
   is not checked out. The session follows [the failure rule](limits.md#the-failure-rule). It tells the user the
   command, its output and that `main` is not checked out. It reads no doc, makes no old read, and runs no
   `git checkout` or `git switch`. It goes on with each step that needs no doc read. The orchestrator starts no work
   that a rule of an unread doc governs. This is the only case of step 1 that fails with no fallback.
2. Run the clean-tree check. If the command prints a line, a tracked file changed. The session runs no pull and makes
   the old read. It says in its next message, one time, that it did not pull because of a changed tracked file.
3. Run `git -C <local clone> pull --ff-only origin main`, and no other pull form. The session runs no `git stash`,
   `git checkout`, `git switch`, `git reset` or `git clean`.
4. After exit 0, read `<head>` and `<origin>` one time each with `git -C <local clone> rev-parse --verify HEAD` and
   `git -C <local clone> rev-parse --verify origin/main`. Then run the clean-tree check.
   - If `<head>` equals `<origin>` and the tree is clean, step 1 passed.
   - If `<head>` is an ancestor of `<origin>` and the tree is clean, pull one more time, once. The test is that
     `git -C <local clone> merge-base --is-ancestor <head> <origin>` exits with 0. Then read the two hashes again. If
     they still do not pass, the pull failed, and item 7 applies.
   - Each other result is a failed pull. Exit 1 of `--is-ancestor` means that the commit is no ancestor.
5. Each other exit code of a check command is an error. Then step 1 counts as a failed pull. An error of the branch
   check is not a wrong branch.
6. If a command gives a lock error, delete no lock file. Wait with `timeout 20 bash -c 'sleep 5'` and run the checks of
   item 4 one time. If they pass, step 1 is done. Otherwise pull one more time. A second failure follows item 7.
7. After a failed pull, a denied pull, a refused prompt or a pull whose checks fail, the session follows the failure
   rule and tells the user the command and the error. Then it runs `git -C <local clone> fetch origin` and makes the old
   read. Its work goes on.

An error with "cannot lock" counts as a lock error. So does `Unable to create '<path>/index.lock': File exists`. The
text "fatal: Cannot fast-forward to multiple branches." names no lock, so it follows item 7. A fetch of the old read
with a lock error takes the same wait.

On 2026-11-21, with git 2.47.3, two pulls ran at the same moment 11 times. One pull printed "error: cannot lock ref
'refs/remotes/origin/main': is at <hash> but expected <hash>" and exited with 1. In some tries, the other pull printed
"fatal: Cannot fast-forward to multiple branches." and exited with 128. In 7 of 11 tries, `HEAD` and `origin/main`
differed after both pulls ended. These tries are the case of requirement 3.3 of #1008, in a scratch clone of a local
bare repo. No text names the pull form of these tries.

On 2026-11-22, the allowed pull of item 3 failed in the local clone, in real use, in two cases: case A and case B. In
real use means in a session at work in the local clone, not in a scratch clone of a measure. In each of cases A and B,
the pull printed "fatal: Cannot fast-forward to multiple branches." and exited with 128. In each of cases A and B, the
session followed item 7, and its work went on.

In case A, a question session reported that `HEAD` and `origin/main` were both at `aa0477b5` at its start. After the
failed pull, it reported that both were at `34c18ae3`. On 2026-11-22, after cases A and B, with git 2.47.3,
`git -C <local clone> reflog show --date=iso HEAD` gave `aa0477b5` at 13:32:38, `b7cdf121` at 13:59:04, `13c8a01c` at
14:37:20 and `34c18ae3` at 15:32:13, all times -0700. The next entry was `21dabc46` at 15:42:51. Each entry has the
message "pull --ff-only origin main: Fast-forward", which names no session. So three fast-forward pulls of the allowed
form moved `HEAD` from `aa0477b5` to `34c18ae3`, and the failed pull did not.

The same day, `git -C <local clone> reflog show --date=iso refs/remotes/origin/main` gave `34c18ae3` at 15:29:30 and the
next entry `21dabc46` at 15:42:35. This is an inference, not a measure: if the session read its hashes just after the
failed pull, that pull ran between 15:32:13 and 15:42:35.

In case B, later the same day, a question session in the same question pane ran the allowed pull at the start of its
`/session-review` rounds. After the failed pull, the session reported that `origin/main` was "still" at `491dbd2f`. It
did not say which earlier read the word "still" compares with, and no session reported the value before the pull. It
reported no value of `HEAD`.

On 2026-11-22, after cases A and B, with git 2.47.3, a read of
`git -C <local clone> reflog show --date=iso refs/remotes/origin/main` gave the entry `491dbd2f` at 15:48:14, all times
-0700. The next entry after `491dbd2f` was `39677208` at 20:17:38. No entry lies between these two times. This is an
inference, not a measure: the session read `491dbd2f` in that window. If the failed pull also started in that window,
`origin/main` was at `491dbd2f` before it too.

No one measured these facts of cases A and B:

- The cause. No one saw another git command that fetches in the same clone at the same moment, for example a pull or a
  fetch. Such a command is a guess.
- Which session ran each pull of the reflog of `HEAD` above.
- The exact time of each failed pull. The reflog of `HEAD` holds no entry of a failed pull.
- The git version at the time of each case. On 2026-11-22, after cases A and B, `git --version` on the machine of the
  local clone printed `git version 2.47.3`.
- The value of `HEAD` after the failed pull of case B.

Case C is one more failed pull. The source of each fact of case C is the report of the question session, as the
orchestrator tasker-48 relayed it. No one else measured case C.

In case C, the question session of the question pane `question-1024-comment`, for the question id `tasker-48-7`, ran
`git -C <local clone> pull --ff-only origin main`. This is the allowed pull of item 3. The session ran the pull at the
start of its `/session-review` rounds. It reported git 2.47.3. The pull printed "fatal: Cannot fast-forward to multiple
branches." and exited with 128. After the failed pull, the session ran `git fetch origin`. After that fetch, it reported
that `HEAD` and `origin/main` were both at `33e26733`. Then it went on with its rounds and proposed a change to the
user.

The session gave the date 2026-11-22 and the time 03:34 UTC on 2026-11-23. The date and the time name different days. No
one made sure of the date or the time zone, and no one reconciled the two. So case C stands apart from the count of
2026-11-22 above, and no count of this section includes or excludes it.

No one measured these facts of case C:

- The cause. No one saw another git command that fetches in the same clone at the same moment.
- The reflog of the local clone for case C. No one read it, so this section gives no reflog entry for case C.
- The values of `HEAD` and `origin/main` before the failed pull. No report gives such a value.
- The exact date, time and time zone of the failed pull, as the paragraph above says.
- Each part of item 7 other than the fetch. The report names only the fetch. For example, it does not say whether the
  session made the old read.

Cases D, E, F and G are more failed pulls in real use. Each of them came on 2026-11-24. In each of them, the pull
printed "fatal: Cannot fast-forward to multiple branches." and exited with 128. No source gives the order in time of
cases D, E, F and G, so the letters D to G give no order in time.

Case H is one more failed pull in real use, on 2026-11-25. So it came after each of cases D to G. All times are -0700.

Case D is a failure of the question session of the question `orchestrator-m31-332`. The source of each fact of case D is
the report of that session, as orchestrator-m31 relayed it on 2026-11-24. No one measured these facts again. The session
reported these facts:

- The pull at the start of the session printed "Already up to date."
- Later, with git 2.47.3, the session ran `git pull --ff-only origin main` in the local clone.
- The pull printed "fatal: Cannot fast-forward to multiple branches." and exited with 128. It ran a little before
  14:24:00.
- After the failed pull, the session ran `git fetch origin`, which exited with 0. Then it read the docs from
  `origin/main`.
- Before and after the failed pull, `HEAD` and `origin/main` were both at `d94007cf`.

A fast-forward is due when `origin/main` is a later commit on the line of `HEAD` and differs from `HEAD`. This section
says that nothing was due when `HEAD` and `origin/main` are at the same commit. This is an inference, not a measure: the
failed pull of case D moved neither `HEAD` nor `origin/main`, and nothing was due.

No one measured these facts of case D:

- The cause. No one saw another git command that fetches in the same clone at the same moment. Such a command is a
  guess.
- The exact time of the failed pull.
- Whether a command fetches more than one remote in the local clone, and which command.
- Which command or tool runs `git pull -q --ff-only` in the local clone.
- The git version at the time of case D. The session reported git 2.47.3, but it did not say how it got the version. A
  read at 16:34:33, after case D, printed `git version 2.47.3`.

Case E is a failure of the question session of the question `orchestrator-m31-338`. The source of each fact of case E is
the report of that session, as orchestrator-m31 relayed it on 2026-11-24. No one measured these facts again. The source
gives no time for any of these steps. The session reported these facts:

- At the start of the session, `git pull --ff-only origin main` in the local clone printed "fatal: Cannot fast-forward
  to multiple branches." and exited with 128.
- Then the session ran `git fetch origin` and read the docs from `origin/main`.
- `git --version` printed `git version 2.47.3`.
- At the start of its review rounds, the same pull printed "Already up to date." and exited with 0.
- `git reflog show --date=iso HEAD` gave `d94007cf` at 2026-11-24 12:00:04 as its newest entry.
- `git reflog show --date=iso refs/remotes/origin/main` gave `d94007cf` at 2026-11-24 11:46:27 as its newest entry.

The source does not name the clone of the two reflog reads. This is an inference of the source, not a measure, with a
condition. If the two reflog reads ran in the local clone, `HEAD` and `origin/main` were both at `d94007cf` before and
after the failed pull. Then nothing was due when the pull failed.

No one measured these facts of case E:

- The cause. No one saw another git command that fetches in the same clone at the same moment. Such a command is a
  guess.
- The exact time of the failed pull.
- Whether a command fetches more than one remote in the local clone, and which command.
- Which command or tool runs `git pull -q --ff-only` in the local clone.
- The values of `HEAD` and `origin/main` just before and just after the failed pull. The source infers them from the
  reflog.
- The time and the clone of the reflog reads, and the time of `git --version`.
- The exit code of `git fetch origin`.
- Each step of item 7 other than the fetch and the doc reads.

The reads of the local clone on 2026-11-24 at about 14:37 and at 16:34:33 came after case D. Each of them ran in the
local clone with git 2.47.3. On 2026-11-24, later fetches moved `origin/main`, at 16:01:39 and after. The read at about
14:37 gave these facts:

- `git rev-parse --verify HEAD` and `git rev-parse --verify origin/main` both gave
  `d94007cfc371b2f4b84793c02e32bb12753317fb`. An earlier read at 14:29 gave the same values.
- The reflog of `HEAD` gave the newest entry `d94007cf` at 2026-11-24 12:00:04, with the message "pull --ff-only origin
  main: Fast-forward".
- The entry before it in the reflog of `HEAD` is `1bc56344` at 2026-11-23 16:53:29, with the message "pull -q --ff-only:
  Fast-forward".
- The reflog of `origin/main` gave the newest entry `d94007cf` at 2026-11-24 11:46:27, with the message "fetch --append
  --no-auto-gc --no-write-commit-graph origin: fast-forward".
- The four entries before it in the reflog of `origin/main`, of 2026-11-23, have the same form. One of them, at
  07:51:52, also has `-q`.
- The last entry of the reflog of `origin/main` before 16:53:29 is `1bc56344` at 16:42:12.
- `git remote` lists two remotes.
- A pull just before these reads printed "Already up to date." It added no entry to either reflog.

The read at 16:34:33 gave these facts:

- The reflog of `HEAD` gave the entry `d94007cf` at 12:00:04. The next entry is `020e7c48` at 16:14:26, with the message
  "pull --ff-only origin main: Fast-forward".
- The reflog of `origin/main` gave the entry `d94007cf` at 11:46:27. The next entry is `020e7c48` at 16:01:39, with the
  message "fetch --append --no-auto-gc --no-write-commit-graph origin: fast-forward".
- `git remote` lists two remotes. `git --version` printed `git version 2.47.3`.

This is an inference, not a measure: `HEAD` was at `d94007cf` from 12:00:04 to 16:14:26, and `origin/main` was at
`d94007cf` from 11:46:27 to 16:01:39. Case D ran a little before 14:24:00, inside both times. This supports the report
of case D.

This is an inference, not a measure, with a condition. If the reflog reads of case E ran in the local clone, the session
of case E read the reflog of `origin/main` before 16:01:39. The source does not say whether that read ran before or
after the failed pull.

This is an inference, not a measure: some command or tool in the local clone runs `git pull -q --ff-only`, as the entry
of 16:53:29 shows.

Case F is a failure of the orchestrator orchestrator-m31. The source of each fact of case F is the report of
orchestrator-m31 of 2026-11-24. No one measured these facts again. orchestrator-m31 reported these facts:

- After the landing of #981, the pull of orchestrator-m31 printed "fatal: Cannot fast-forward to multiple branches." and
  exited with 128.
- Then orchestrator-m31 followed item 7. It ran `git fetch origin` and read the docs from `origin/main`.

The doc-read rules tell the orchestrator to pull the local clone after each landing, as
[the re-read rule](#the-re-read-rule) says. This is an inference, not a measure, with a condition. If orchestrator-m31
ran the pull as the doc-read rules say, the pull was `git pull --ff-only origin main` in the local clone. The source
does not give the pull form or the folder of the pull.

No one measured these facts of case F:

- The cause. No one saw another git command that fetches in the same clone at the same moment. Such a command is a
  guess.
- The exact time of the failed pull. The source says only that it came after the landing of #981.
- If the pull ran in the local clone: whether a command fetches more than one remote in the local clone, and which
  command.
- If the pull ran in the local clone: which command or tool runs `git pull -q --ff-only` in the local clone.
- The git version.
- The values of `HEAD` and `origin/main` just before and just after the failed pull.
- The pull form and the folder of the pull.
- The exit code of `git fetch origin`.
- Each step of item 7 other than the fetch and the doc reads.

Case G is a failure of an issue-review subagent, in review 1 of the planner subagent plan-110. That review was the first
review of a draft of a new body of #1039. Two reports of 2026-11-24 give the facts of case G. No one measured them
again. orchestrator-m31 reported that the issue-review subagent had the failed pull ("Cannot fast-forward to multiple
branches", exit 128) in review 1 of plan-110.

plan-110 reported these facts:

- The pull of review 1 failed with "fatal: Cannot fast-forward to multiple branches." and exit 128.
- The subagent made "the old read".
- `origin/main` moved to `4752a209` during the review.

The start prompt of an issue-review subagent uses the words "the old read" for the reads with
`git show origin/main:<path>` alone. It gives `git fetch origin` as a step of its own. So this section does not count
the fetch of case G as done.

A read of the git history of this repo gave these facts:

- On 2026-11-24, the start prompt of an issue-review subagent gave the pull `git pull --ff-only origin main` with no
  `-C` option.
- The prompt ran the pull in the folder where the session starts. That folder is the local clone.
- The words of the pull came in commit `47c8415a` (2026-11-23 01:17:07).
- The words of the folder came in commit `666b89cf` (2026-11-23 01:40:00).

No one read the prompt of review 1 of plan-110. No source gives the time of that review. This is an inference, not a
measure, with a condition. If that prompt gave the same pull, the pull of case G was `git pull --ff-only origin main` in
the local clone. Case G is a record of the rules of 2026-11-24.

No one measured these facts of case G:

- The cause. No one saw another git command that fetches in the same clone at the same moment. Such a command is a
  guess.
- The exact time of the failed pull.
- If the pull ran in the local clone: whether a command fetches more than one remote in the local clone, and which
  command.
- If the pull ran in the local clone: which command or tool runs `git pull -q --ff-only` in the local clone.
- The git version.
- The values of `HEAD` and `origin/main` just before and just after the failed pull.
- Whether `origin/main` moved to `4752a209` before or after the failed pull.
- The pull form and the folder that the prompt of review 1 of plan-110 gave.
- Whether the fetch ran, and its exit code.
- Each other step of item 7.

Case H is a failure of the question session of the question `orchestrator-m31-388`, in the question pane
`question-973-count`. The first source of case H is the report of that session, as orchestrator-m31 relayed it on
2026-11-25. The source says that no one tested these facts further. The session reported these facts:

- The session used git 2.47.3.
- The pull at the start of the session printed "Already up to date." The source gives no time for this pull.
- Later, at the start of the `/session-review` rounds, the session ran `git pull --ff-only origin main` in the local
  clone.
- The pull printed "fatal: Cannot fast-forward to multiple branches." and exited with 128. It ran a little before
  15:52:14.
- Then the session ran `git fetch origin`, which exited with 0. It read the review docs with
  `git show origin/main:<path>`.
- Before and after the fetch, `HEAD` was at `628239c8` and `origin/main` was at `64d2aa7a`.
- The reflog of `origin/main` gave `64d2aa7a` at 2026-11-25 15:44:52, with the message "fetch --append --no-auto-gc
  --no-write-commit-graph origin: fast-forward".
- The reflog of `origin/main` also gave `628239c8` at 14:53:59, with the message "fetch origin: fast-forward".
- The reflog of `HEAD` gave the newest entry `628239c8` at 15:19:05, with the message "pull --ff-only origin main:
  Fast-forward".
- The configuration `remote.origin.fetch` is `+refs/heads/*:refs/remotes/origin/*`.

The source does not name the clone of the reflog reads and of the configuration read. It gives no time for them.

The second source of case H is the report of round 2 of the `/session-review` rounds of the same session.
orchestrator-m31 relayed it on 2026-11-25. No one measured it again. The source gives no time for these steps. The
session reported these facts:

- At the start of round 2, the session ran `git pull --ff-only origin main` in the local clone.
- The pull printed "Updating 628239c8..64d2aa7a" and "Fast-forward", and exited with 0.
- After that pull, `HEAD` and `origin/main` were both at `64d2aa7a`, and the tree was clean.

The third source of case H is a read in the local clone on 2026-11-25 at 16:01:45, with git 2.47.3. The read gave these
facts:

- `HEAD` and `origin/main` were both at `64d2aa7a6dd808f7fbe9454112625532d832d40d`. The source names no command for
  these two values.
- The reflog of `HEAD` gave the newest entry `64d2aa7a` at 15:59:33, with the message "pull --ff-only origin main:
  Fast-forward". The entry before it is `628239c8` at 15:19:05, with the same message.
- The reflog of `origin/main` gave the newest entry `64d2aa7a` at 15:44:52, with the message "fetch --append
  --no-auto-gc --no-write-commit-graph origin: fast-forward". The entry before it is `628239c8` at 14:53:59, with the
  message "fetch origin: fast-forward".
- `git config --get-all remote.origin.fetch` printed `+refs/heads/*:refs/remotes/origin/*`.
- `git remote` lists two remotes.
- `git merge-base --is-ancestor 628239c8 64d2aa7a` exited with 0. So `64d2aa7a` is a fast-forward of `628239c8`.

The next facts are inferences, not measures. The local clone holds the reflog entries of the first source, with the same
hashes, times and messages. In the local clone, `HEAD` was at `628239c8` from 15:19:05 to 15:59:33. `origin/main` was at
`64d2aa7a` from 15:44:52 to at least 16:01:45. So from 15:44:52 to 15:59:33, a fast-forward from `628239c8` to
`64d2aa7a` was due.

This is an inference, not a measure, with a condition. If the failed pull ran after 15:19:05, it did not move `HEAD`,
because the reflog of `HEAD` has no entry from 15:19:05 to 15:59:33. The source gives the time only as "a little before
15:52:14". So it does not say whether the pull ran after 15:19:05.

This is an inference of the source, not a measure, with a condition. If the failed pull ran after 15:44:52, a
fast-forward was due when the pull failed. Then the failed pull left the local clone behind `origin/main`. The source
does not say whether the pull ran after 15:44:52.

This is an inference, not a measure: in case D, nothing was due. In case E, nothing was due, with the condition of case
E. Case H differs from both, with the condition of the paragraph above.

This is an inference, not a measure: the pull of round 2 started at `628239c8`. So `HEAD` was still at `628239c8` at the
start of round 2. The session saw `origin/main` at `64d2aa7a` before the fetch. So the local clone stayed behind
`origin/main` from the read before the fetch until the pull of round 2. The pull of round 2 ended that gap.

This is an inference, not a measure, with a condition. The reflog of `HEAD` at 16:01:45 has one entry that moved `HEAD`
from `628239c8` to `64d2aa7a`, at 15:59:33. If the pull of round 2 ran before the read of 16:01:45, it is the pull of
that entry. The source does not give the time of the pull of round 2. No source says that it is the pull of 15:59:33.

No one measured these facts of case H:

- The cause. No one saw another git command that fetches in the same clone at the same moment. Such a command is a
  guess.
- The exact time of the failed pull, and whether it ran before or after 15:44:52.
- Whether a command fetches more than one remote in the local clone, and which command.
- Which command or tool runs `git pull -q --ff-only` in the local clone.
- The command that ran the fetch of 15:44:52.
- The command or session that ran the pull of 15:59:33.
- The time of the pull of round 2, and whether that pull is the pull of 15:59:33.
- How the session got the values of `HEAD` and `origin/main` and the state of the tree after the pull of round 2.
- The time of the pull of the start, and how the session got the git version.
- The clone and the time of the reflog reads and of the configuration read of the first source.
- The time of the reads of `HEAD` and `origin/main` before and after the fetch.
- Each step of item 7 other than the fetch and the doc reads.

`--ff-only` changes nothing when it cannot fast-forward. `.claude/settings.json` has no rule for the pull, so the
classifier of auto mode decides each call that no rule matches. The commands of this rule stand in the lists of
[the allowed commands](allowed-commands.md).

A pull brings only commits that landed on `origin/main`, and it changes no tracked file of its own. So it is no change
under [the tracked-change rule](rules.md#changes) and no write action of a question pane.

### Step 2: read each doc with the Read tool

This step runs after step 1 passed.

1. Read each doc with the Read tool on the file in the local clone. `<path>` is the path of the doc from the root of the
   repo, for example `docs/dev/limits.md`. Read in pieces with `offset` and `limit`, from line 1.
2. The read reaches the end when the last piece returns fewer lines than its `limit` and the result is not a partial
   view. It also reaches the end when the pieces reach the count of `wc -l <path>`.
3. If a call is refused for too many tokens, halve `limit` and read again from the same `offset`. A piece before the end
   is not a complete read, and a refused call is not a read. Item 5 also names a partial view as a result that is not a
   complete read.
4. After the last piece of a doc, run `git -C <local clone> rev-parse --verify HEAD` and the clean-tree check. If the
   hash is not `<head>` or the tree is not clean, read that doc again with the old read.

5. A partial view is a result of a Read call that shows fewer lines than the call asks for. It has a notice that names a
   next `offset`. For a call with no `limit`, it shows fewer lines than the file has. A result with no such notice is
   not a partial view. For example, a piece before the end of the file has no such notice.

   After a partial view, read again from the `offset` that its notice names. Read in pieces with `offset` and `limit`,
   until the read reaches the end of item 2.

   A partial view is not a complete read of the doc, and it never reaches the end of item 2. This also holds when it
   shows fewer lines than the `limit` of its call.

   This item holds for a Read call with a `limit` and for a Read call with no `limit`. It also holds for each piece of
   the read, not only for the first piece. A session can make a call with no `limit`, for example the read that a start
   prompt asks for. Such a call is outside item 1.

   The read of one doc has these states:

   - (a) Not started: the session made no Read call on the doc. It has no read of the doc.
   - (b) Running: the session made one or more Read calls, and the read did not reach the end of item 2. No piece of
     this state is a complete read. This also holds for a partial view. After a partial view, the session goes on as
     this item says.
   - (c) Ended: the read reached the end of item 2. Then the read of the pieces is complete, and the session does
     item 4.

   This item gives no piece size, as Step 2 gives none. It changes no rule of item 3 for a refused call.

On 2026-11-20, with Claude Code 2.1.330, one Read call with `limit: 2000` on `docs/dev/pick-the-tickets.md` failed. At
commit `507bcddb`, that file had 1077 lines and 91,959 bytes. The error was "File content (31880 tokens) exceeds maximum
allowed tokens (25000)". So the doc was above 25000 tokens.

A Read call on `docs/dev/doc-reads.md` returned all its lines. At commit `507bcddb`, that file had 258 lines. At commit
`507bcddb`, no doc under `docs/` was longer than 2000 lines. The longest was `docs/dev/assistants.md`, with 1804 lines.

At commit `941a4f88`, `docs/dev/pick-the-tickets.md` had 1236 lines and 103,281 bytes. The longest doc under `docs/` was
still `docs/dev/assistants.md`, with 1821 lines. Each count is a fact of its commit. No one measured which doc the Read
tool refuses in one call. So this rule gives the pieces rule and no piece size.

A missing doc is an answer, not a failure. With the old read, the two `fatal:` texts below are the answer. With the Read
tool, an error that starts "File does not exist." is the answer. On 2026-11-21, with Claude Code 2.1.330, a Read call on
a missing file of the local clone returned that error.

### The old read

The old read runs `git -C <local clone> fetch origin`. Then it reads each doc with
`git -C <local clone> show origin/main:<path>` in a Bash call. A read of `origin/main` in one command needs no hash
read.

Each reader makes a complete read of each doc that it reads. A complete read is a read of each part of the output of the
doc read, in order. A failed read is never a complete read. Each other failed read follows the failure rule.

Claude Code cuts a long output. It saves the full output to a file and shows a preview. Then the session reads the rest
of that file in parts, in order, with the Read tool, before its next action. A read with a cut output is not a complete
read. Before the read is complete, the session reports no start read as done.

These facts show the cut:

- On 2026-11-19, with Claude Code 2.1.329, one Bash call ran `git show 04f8307f:docs/dev/pick-the-tickets.md`. Claude
  Code printed "Output too large (72.7KB)". It saved the full output to a file and showed only the first 2KB as a
  preview.
- On 2026-11-19, with git 2.47.3, `git show 04f8307f:<path> | wc -c` ran over the 18 start docs of the orchestrator. The
  docs hold 530,345 bytes in all. The largest is `docs/dev/pick-the-tickets.md`, with 74,471 bytes.
- On 2026-11-16, planner-m16 reported a cut read with Claude Code 2.1.325. One call that printed only
  `docs/dev/handoff.md` gave 33.1 KB, and Claude Code showed a preview. No one measured this case again.

`git show` does not resolve `..`: `git show origin/main:docs/dev/../config.md` fails with
`fatal: path 'docs/dev/../config.md' exists on disk, but not in 'origin/main'`.

If `git show` prints `fatal: path '<path>' does not exist in '<commit>'` or
`fatal: path '<path>' exists on disk, but not in '<commit>'`, the doc does not exist on that commit, and the reader has
nothing to read.

A read of a file on disk without a passed step 1 is not a doc read, because the file can be of another commit.

If the fetch fails, a task subagent [stops](limits.md#the-answer-wait-rule) and reports the error. Each other session
that keeps the old read follows the failure rule and reads from the `origin/main` of the last fetch that worked. The
question session tells the user in its second reply. An issue subagent gives each fact for the user in its result. For
the orchestrator, [the re-read rule](#the-re-read-rule) gives the failure path.

### A link in a doc

A link in a doc that the reader follows is also a doc read. The reader drops the part from `#` (the anchor). It resolves
the path against the folder of the doc. For example, the link `limits.md#the-failure-rule` in `docs/dev/doc-reads.md`
gives `docs/dev/limits.md`, and the link `../../README.md#install` in `docs/dev/setup.md` gives `README.md`. With the
Read tool, `..` works. The `..` failure of `git show` applies only to the old read.

### The start prompts

The start prompts and the handoff prompts give the branch check, the clean-tree check and the pull with no `-C`, because
the session starts in the local clone. The session prompt in
[`prompt-templates/question-pane/session.md`](../../prompt-templates/question-pane/session.md) keeps `{{LOCAL_CLONE}}`.
The session has no other way to learn these commands before its first read.

The start prompts are the first prompts of the orchestrator, the start prompts of the planner and the prompt read of a
handoff. The session prompt of a question pane is also a start prompt. These four kinds of start prompt read this doc at
their start. The prompt of an issue subagent and of the ad hoc post subagent is also a start prompt. The ad hoc post
subagent is the subagent of the main session that posts a reviewed ad hoc draft. These two prompts do not read this doc
at their start. An issue subagent keeps [the read rule](issue-subagents.md#the-read-rule). The ad hoc post subagent
follows each rule of [docs/dev/issue-post.md](issue-post.md), so it keeps the same read rule.

After the pull, a session of one of the four kinds reads this doc first, with the Read tool. This read is a complete
read of this doc, as item 2 of step 2 says. The first paragraph of this doc names the rules that each reader follows. It
does not give the part of this doc that a reader reads at its start. Then the session reads `<head>` and `<origin>` and
runs the clean-tree check, as step 1 item 4 says. Then it does step 2 item 4 for this doc. If a check fails, the session
follows this rule, also for this doc. Then it reads its other start docs as this rule says.

Each start prompt above is an exception to the only home of the read steps. This includes the prompt of an issue
subagent and of the ad hoc post subagent. A start prompt or a list of the allowed commands changes with step 1 or step 2
in two cases only. It then changes in the same change as the step. In the first case, the change makes the words of that
prompt or list untrue. In the second case, the change alters a command that the prompt or list gives.

The reason for the complete read: each start prompt that reads this doc at its start makes the same read of it. The old
read in the session prompt already reads the whole file. At commit `b410b27a`, one question session read only lines 200
to 422 of this doc, the section "The doc-read rule", because the session prompt named only that section.

`CLAUDE.md` loads `AGENTS.md` before step 1. So after step 1, the session reads `AGENTS.md` again. An issue subagent
does not. On 2026-11-01, the new operator-m27 read a checkout 149 commits behind `origin/main` and used old rules for
hours. The same day, planner-m27 read an old checkout and did not know the rule that some posts also give a message to
an orchestrator.

### Why the rule pulls

The old rule had no branch check and no merge, and a doc read never used the checkout of the local clone. On 2026-11-20,
the user said, word for word: "File a ticket to modify this rule: 1. Run `git pull` in the local clone to get up to date
copies. 2. Use the Read() tool to read the instruciton files." Later the same day, the user added, word for word: "The
issue for pulling main and reading instruction files directly should also double check that main is checked out and fail
if not." On 2026-11-21, the user said, word for word: "We need a central location for the rules for reading the newest
version of docs. I think this is `doc-reads.md` and should be the source of truth."

The rule has these limits, and each one has a reason:

- A wrong branch reads nothing. A wrong branch can mean that the user works in the clone, and the user decides what to
  do. The old read gives the committed text in the other cases. A failure in each case stops each session for a cause
  that the old read handles.
- A changed tracked file gets the old read. A pull over a changed file keeps the change, and then the Read tool shows
  text that is not on `origin/main`.
- A task subagent works in its own task worktree on its own task branch. It never pulls in the local clone, because that
  clone is shared.
- A pre-release install can leave the local clone on a commit that is not `main`. Then each covered session fails its
  doc read until `main` is checked out again, as [Release](release.md) says.
