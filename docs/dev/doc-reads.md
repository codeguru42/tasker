# Doc reads

The readers of this page are the orchestrator, the task subagents, the operator, each planner and each question session.
The operator reads the notice rule and the doc-read rule, and each planner and each question session read the doc-read
rule.

## The re-read rule

The orchestrator works from the current docs of the orchestrator. The docs of the orchestrator are `AGENTS.md`,
`docs/orchestrator.md`, the pages of the list "The pages" of [docs/orchestrator.md](../orchestrator.md),
`docs/sessions.md`, `docs/dev/GLOSSARY.md`, `docs/dev/rules.md`, `docs/dev/working-with-the-user.md`, and the docs that
the prompt of the orchestrator names. For example, a prompt can name `docs/dev/planner.md`, `docs/dev/issues.md`,
`docs/dev/first-refine.md` and `docs/dev/rebase-conflicts.md`. The last read is the commit of `origin/main` from which
the orchestrator last read the docs of the orchestrator.

At the start of its session, the orchestrator runs `git -C <local clone> fetch origin`, as
[the doc-read rule](#the-doc-read-rule) says. Then it runs `git -C <local clone> rev-parse --verify origin/main`. The
hash that this command prints is the first last read. Then the orchestrator reads the docs of the orchestrator, as the
doc-read rule says.

Each time a ticket lands, the orchestrator does these steps. They are at the place that the bullet "When the final
report of the task subagent of a ticket says that the ticket landed" of [Land the work](land-the-work.md#land-the-work)
gives. The steps change no task.

1. Run `git -C <local clone> fetch origin`, as [the doc-read rule](#the-doc-read-rule) says.
2. Read the tip of `main` one time: `git -C <local clone> rev-parse --verify origin/main`. This rule calls the hash
   `<tip>`.
3. Run `git -C <local clone> diff --name-only <last read>..<tip> -- AGENTS.md docs/ skills/`. The output lists each file
   that changed since the last read. If the output is empty, no doc changed, and the steps are complete. The last read
   stays.
4. Before the next step of your work, read again each file of the list that is a doc of the orchestrator, with
   `git -C <local clone> show <tip>:<path>`. A file of the list outside the docs of the orchestrator needs no read. If
   `AGENTS.md` or `docs/orchestrator.md` is on the list, also read, for the first time, each new doc that it names for
   the work of the orchestrator, with the same command. Then `<tip>` is the new last read.

If a command of [the doc-read rule](#the-doc-read-rule) fails before a doc read of the orchestrator,
[the failure rule](limits.md#the-failure-rule) applies. This applies to the first read at the start of the session and
to each later doc read. If a command of the steps above fails, the failure rule also applies. If the orchestrator must
read a doc, it then reads the doc with `git -C <local clone> show origin/main:<path>`, from the `origin/main` of the
last fetch that worked. Then the orchestrator continues its work. The last read stays. At the start of the session, the
orchestrator then runs `git -C <local clone> rev-parse --verify origin/main` before it reads the docs of the
orchestrator, and that hash is the first last read. The orchestrator does the steps above again at the next landing.

## The notice rule

This rule covers each ticket, whatever its milestone, also a ticket with no milestone. It applies when the landing of
the ticket changes a doc of the orchestrator of the ticket (see [the re-read rule](#the-re-read-rule)), for example
`docs/orchestrator.md`, or a start doc of the operator. [docs/operator.md](../operator.md) names the start docs of the
operator. A notice is a message about such a landing from the orchestrator of the ticket. For a change of a doc of the
orchestrator, the notice goes to the other orchestrators. For a change of a start doc of the operator, the notice goes
to each session whose name starts with `operator-`. Each orchestrator has a name of the form `orchestrator-<slug>`, with
the slug of its scope, as [The start of an orchestrator](../orchestrator.md#the-start-of-an-orchestrator) says. For
example, `orchestrator-m6`, `orchestrator-m7`, `orchestrator-docs` and `orchestrator-docs-fix` are such names. For a
milestone scope, the part after `orchestrator-` is the first word of the milestone title in lowercase. Examples are
`orchestrator-m9` for "M9 — Pauses and recovery" and `orchestrator-docs` for "Docs". For a set scope, the part after
`orchestrator-` is the slug that the user gives. The other orchestrators are all the sessions with such a name except
the session of the orchestrator of the ticket. On 2026-10-25, before #561, #495 (M22 — Operator) changed
`docs/dev/handoff-operator.md`, and operator-docs got no notice. Before #565, a change of
`docs/dev/working-with-the-user.md`, a start doc of the operator, sent no notice to the operator.

The orchestrator of the ticket does these steps:

1. When the final report of the task subagent of the ticket arrives, read the files that landed in that report.
2. If no file of the report is a doc of the orchestrator of the ticket or a start doc of the operator, send no notice.
3. Read your own name from the first line of the output of `ListAgents`, as [sessions.md](../sessions.md) says. If a doc
   of the orchestrator changed, each session whose name starts with `orchestrator-`, except your own session, is another
   orchestrator. If a start doc of the operator changed, each session whose name starts with `operator-` also gets the
   notice. A session with another name, for example `planner-m7`, gets no notice. A milestone hold can stop this notice,
   as [A milestone hold](working-with-the-user.md#a-milestone-hold) says.
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
[the task subagent notice](#the-task-subagent-notice) says. When the operator gets a notice, the operator does
[the doc-read rule](#the-doc-read-rule) and then reads each changed start doc of the operator again.

Each orchestrator has its own docs of the orchestrator, because each prompt names its own docs. `AGENTS.md`,
`docs/orchestrator.md`, the pages of its list "The pages", `docs/sessions.md`, `docs/dev/GLOSSARY.md`,
`docs/dev/rules.md` and `docs/dev/working-with-the-user.md` are docs of each orchestrator.

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
prompt names because the ticket changes it. Such a file can be under `skills/`.

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

- The orchestrator, the operator, each planner session and the [question session](question-pane.md#a-question-pane).
- Each session that works with the user and has no role.
- A session that runs `/session-review`.
- The issue subagents (issue-draft, issue-review and issue-post), whatever session starts them.
- The subagent of the main session that posts a reviewed ad hoc draft.

These sessions keep the old read, also for a doc that they reach by a link:

- Each task subagent, for a whole ticket or for one task change. A task subagent never pulls in the shared local clone.
- The planner subagent, the opener subagent, the reuse subagent and the write subagent of the orchestrator, if such a
  subagent reads a doc. This covers each helper subagent of such a subagent, apart from the issue subagents.
- A read subagent that a session with no role starts for a read of code or docs.
- The ticket subagent and the review agent of a planner. The user deprecated them on 2026-11-21.
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
   is not checked out. The session follows [the failure rule](limits.md#the-failure-rule). It tells the user the command
   and its output. It reads no doc, makes no old read, and runs no `git checkout` or `git switch`. It goes on with each
   step that needs no doc read. The orchestrator starts no work that a rule of an unread doc governs.
2. Run the clean-tree check. If the command prints a line, a tracked file changed. The session runs no pull and makes
   the old read. It says in its next message, one time, that it did not pull because of a changed tracked file.
3. Run `git -C <local clone> pull --ff-only origin main`, and no other pull form. The session runs no `git stash`,
   `git checkout`, `git switch`, `git reset` or `git clean`.
4. After exit 0, read `<head>` and `<origin>` one time each with `git -C <local clone> rev-parse --verify HEAD` and
   `git -C <local clone> rev-parse --verify origin/main`. Then run the clean-tree check.
   - If `<head>` equals `<origin>` and the tree is clean, step 1 passed.
   - If `git -C <local clone> merge-base --is-ancestor <head> <origin>` exits with 0 and the tree is clean, pull one
     more time and read the hashes again.
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
differed after both pulls ended. No one measured other forms.

`--ff-only` changes nothing when it cannot fast-forward. `.claude/settings.json` has no rule for the pull, so the
classifier of auto mode decides each call that no rule matches. The commands of this rule stand in the lists of
[the allowed commands](allowed-commands.md).

A pull brings only commits that landed on `origin/main`, and it changes no tracked file of its own. So it is no change
under [the tracked-change rule](rules.md#changes) and no write action of a question pane.

### Step 2: read each doc with the Read tool

This step runs after step 1 passed.

1. Read each doc with the Read tool on the file in the local clone. `<path>` is the path of the doc from the root of the
   repo, for example `docs/dev/limits.md`. Read in pieces with `offset` and `limit`, from line 1.
2. The read reaches the end when the last piece returns fewer lines than its `limit`. It also reaches the end when the
   pieces reach the count of `wc -l <path>`.
3. If a call is refused for too many tokens, halve `limit` and read again from the same `offset`. A piece before the end
   is not a complete read, and a refused call is not a read.
4. After the last piece of a doc, run `git -C <local clone> rev-parse --verify HEAD` and the clean-tree check. If the
   hash is not `<head>` or the tree is not clean, read that doc again with the old read.

The size of a piece changes with the size of the doc and with the version of Claude Code. So this rule gives no piece
size.

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
the session starts in the local clone. The block `question-session` of [A question pane](question-pane.md) keeps
`<local clone>`. The session has no other way to learn these commands before its first read.

The start prompts are the first prompts of the orchestrator, the start prompts of the planner, the prompt read of a
handoff and the block `question-session`. The prompt of an issue subagent and of the ad hoc post subagent is also a
start prompt.

After the pull, the session reads this doc first with the Read tool, and does the checks of step 2 for it. Then it reads
its other start docs as this rule says. A change of step 1 or step 2 also changes each start prompt and the lists of the
allowed commands, in the same change.

`CLAUDE.md` loads `AGENTS.md` before step 1. So after step 1, the session reads `AGENTS.md` again. An issue subagent
does not. On 2026-11-01, the new operator-m27 read a checkout 149 commits behind `origin/main` and used old rules for
hours. The same day, planner-m27 read an old checkout and did not know the rule that some posts also give a message to
an orchestrator.

### Why the rule pulls

The old rule had no branch check and no merge, and a doc read never used the checkout of the local clone. The user asked
for a read of the newest version of the docs that also works with the Read tool. On 2026-11-21, the user said, word for
word: "We need a central location for the rules for reading the newest version of docs. I think this is `doc-reads.md`
and should be the source of truth."

The rule has these limits, and each one has a reason:

- A wrong branch reads nothing, because a pull of another branch can change the docs in a way that no one checked.
- A changed tracked file gets the old read, because a pull must not touch the edit of the user.
- A task subagent never pulls, because its worktree and the shared local clone must stay as they are.
- A pre-release install leaves the local clone on a commit that is not `main`. Then a covered session stops reading docs
  until the user checks out `main`, as [Release](release.md) says.
