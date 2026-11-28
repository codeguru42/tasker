# Planner subagent

This page gives the rules for a [planner subagent](GLOSSARY.md). The readers of this page are the orchestrator of the
kind `claude` and each planner subagent. Each planner session and the main session of an ad hoc draft also read
[The issue subagents](#the-issue-subagents).

A planner subagent turns one item of planning work into issues. For this work, it starts an
[issue-draft subagent](GLOSSARY.md), an [issue-review subagent](GLOSSARY.md) and an [issue-post subagent](GLOSSARY.md),
as the work needs. An issue subagent on this page is one of these subagents.

## Terms

- A planning request is one send of work to the planner of the orchestrator.
  [The planning requests](#the-planning-requests) gives the sends. A planning request holds one or more items of
  planning work.
- An item of planning work has the meaning that [the glossary](GLOSSARY.md) gives. [The start](#the-start) gives how a
  planning request splits into items of planning work.
- The result of a planner subagent is the text of its `SubagentHandback` call.
- The metadata of an issue is its milestone, its labels, its state, its board column and its priority. A blocked-by link
  is not metadata on this page.
- A settled question is a question of a result that a rule of the docs or a fact of the code on `origin/main` answers.
  [A settled question](#a-settled-question) gives the rules. A settled answer is its answer, with its reason. On this
  page, a settled answer comes from a rule of the docs or a fact of the code. It is never a word of the user. In
  [question-pane.md](question-pane.md) and [handoff-orchestrator.md](handoff-orchestrator.md), the term "settled answer"
  means an answer of the user that the pane owner accepted. This page does not change those uses.
- A kept rule is a rule of the docs that the planner subagent follows. [The kept rules](#the-kept-rules) gives them.
- On this page, keep N is item N of The kept rules. Change N is item N of [The changed rules](#the-changed-rules). Drop
  N is item N of [The dropped rules](#the-dropped-rules).
- An item with a match is an item that names a match. [The terms of a match](#the-terms-of-a-match) gives the terms.

## The kind of the orchestrator

Only an orchestrator of the kind `claude` starts a planner subagent. For the kind `pi`, the reason is that the measured
pi sessions had only the tool `bash`. See [The seam of an agent kind](../config.md#the-seam-of-an-agent-kind). A Codex
orchestrator has native subagent tools, but no one measured its start of a planner subagent.

## The planning requests

Each send of the docs to the planner of the orchestrator is a planning request. These rules give such a send:

- The planner bullet of [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent), and each
  rule that sends work to the planner as that bullet says.
- [The capture and the next step](quota.md#the-capture-and-the-next-step) of quota.md.
- The paragraph of [The items of a handoff file](handoff.md#the-items-of-a-handoff-file) about an old orchestrator.
- Each relay, request, open finding, accepted proposal and recurrence that a
  [question pane](question-pane.md#a-question-pane) sends to the planner of the orchestrator.
- The planning request of late matches that [The check of the pane owner](question-pane.md#the-check-of-the-pane-owner)
  gives.

For each item of planning work of a planning request, the orchestrator of the kind `claude` starts a planner subagent,
as [The start](#the-start) says.

The orchestrator joins a planning request of late matches with the item of its proposal, as
[A joined item](#a-joined-item) says. The request names the proposal and the report that gave it.

## The start

Only the orchestrator starts a planner subagent. A task subagent, a question session, a planner and a planner subagent
start none.

At the arrival of a planning request, the orchestrator splits it into its items of planning work. It judges which parts
form one item of planning work. The split never splits the answers of
[A draft that needs the user](#a-draft-that-needs-the-user). The orchestrator starts a new planner subagent for each
item of planning work. It sends no item of planning work to a planner subagent that runs or that ended. The reason: a
message to an ended subagent starts it again, as [the answer-wait rule](limits.md#the-answer-wait-rule) says. A new
start gives each item of planning work a new context.

[The count of planner subagents](#the-count-of-planner-subagents) gives how many planner subagents run at the same time.

The orchestrator does these steps for each start:

1. Run `tasker show-config --repo <key>` and read the entries `sessions.models.planner`, `sessions.models.issue-draft`,
   `sessions.models.issue-review` and `sessions.models.issue-post`. See [`sessions`](../config.md#sessions).
2. If the read fails, follow [the failure rule](limits.md#the-failure-rule). Then pass no `model` and no `effort`. The
   prompt then gives the fact that each of the three issue keys has no entry.
3. If the read gives no entry, pass no `model` and no `effort`. If the read gives no entry for one of the three issue
   keys, the prompt gives the fact that the key has no entry.
4. If the read gives an entry, pass the `effort` of the entry. Pass the `model` of
   [The model of the start](#the-model-of-the-start).
5. Pass the subagent type `general-purpose`. Never pass the type `fork`.
6. Pass the name of [The name](#the-name) with the `name` option of the Agent tool.
7. Pass the prompt of [The prompt](#the-prompt).

A subagent of the type `fork` gets the context of the orchestrator. On 2026-11-19, with Claude Code 2.1.329, the list of
the subagent types gave "Tools: \*" for `general-purpose`. So its tool list holds the Agent tool.

If the Agent call fails, the start failed. A refused Agent call is also a failed start. After a failed start, the
orchestrator asks the user in its question pane, as the planner bullet of
[The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) says.

### The count of planner subagents

At most `maxPlannerSubagents` planner subagents of an orchestrator run at the same time. The count is the key
`sessions.maxPlannerSubagents` of the repo, a whole number above 0 with the default 3. Only an orchestrator of the kind
`claude` starts a planner subagent, so the key has no effect for another kind.

Before each decision whether a waiting item of planning work starts, the orchestrator reads the count. It runs
`tasker show-config --repo <key>` and takes `.sessions.maxPlannerSubagents` from the output. One run can also serve step
1 of [The start](#the-start). A read fails when the exit code is not 0 or when the output is not JSON. It also fails
when the output gives a value of `.sessions.maxPlannerSubagents` that is not a whole number above 0. After a failed
read, [the failure rule](limits.md#the-failure-rule) applies. Then the count for that decision is 3. A tasker that is
older than the key prints no such value. A missing value is no failed read, and the count is 3.

A lower count stops no planner subagent that runs. The orchestrator starts no new one until the count of the running
ones is under the new count. The default 3 is the count that the orchestrator used before the key existed, and no doc
gives a tested limit of Claude Code.

The count covers each planner subagent that the orchestrator started and that runs. A new planner subagent after an end
with no report, as [The life of a planner subagent](#the-life-of-a-planner-subagent) says, counts. A late report that
starts an ended planner subagent again is not a start of the orchestrator, so that planner subagent does not count. A
planner subagent whose wait a word of the user ended holds no place in the count, as
[The wait before a handoff](#the-wait-before-a-handoff) says. The known limits of
[The wait before a handoff](#the-wait-before-a-handoff) give the result. Such a planner subagent makes no path busy, as
[The wait for a busy path](#the-wait-for-a-busy-path) says.

Before each start of a planner subagent, the orchestrator follows [The wait for a busy path](#the-wait-for-a-busy-path).

In one session of the orchestrator, two planner subagents never give two drafts one file name in the folder of
[The prompt](#the-prompt), with one exception. The known limit about a compaction in this section is that exception.
This also covers the draft of an ended planner subagent that waits for a decision of the user. Each new draft file name
of a planner subagent starts with its own name and `-`, for example `plan-4-terms.md`. The limit of 24 characters still
holds. The planner subagent chooses each draft file path in a prompt, so this needs no read and no new command.

The cost: up to `maxPlannerSubagents` planner subagents and as many subagents of the three kinds run in the session of
the orchestrator, with its task subagents. Each planner subagent that a late report starts again adds one to each count.
No record of the docs gives a tested limit for these counts. More pulls of the local clone can start at the same moment.
[Step 1: pull the local clone](doc-reads.md#step-1-pull-the-local-clone) gives the failures of such pulls and their
recovery.

The orchestrator runs the count read of [the orchestrator folder](limits.md#the-orchestrator-folder) before each start
of a planner subagent. [The name](#the-name) gives the count that follows from it.

These known limits hold:

- Each planner subagent makes its table of the needs and the likely files only from its own drafts. So two planner
  subagents that post at about the same time can miss a blocked-by link between their two issues.
- The duplicate search right before a post can miss an issue that another planner subagent posts at the same moment.
- A late report can start an ended planner subagent again. That planner subagent does not count, and it makes no path
  busy, as [The wait for a busy path](#the-wait-for-a-busy-path) says. It judges the findings of the report and writes
  the record file of its draft. At the same moment, a planner subagent of an answer of the user can run on the same
  draft. Then the two write one record file and can write one draft file. The orchestrator sees the start again only at
  the second result.
- While the bar of [the orchestrator folder](limits.md#the-orchestrator-folder) holds, the orchestrator runs no count
  read. A new draft goes to the old folder, so it can get the file name of an older draft there. The new draft and its
  record file then overwrite the old ones.
- After a compaction of the context, the orchestrator can lose the counts that it gave in its session. Then it can give
  a name again. Two planner subagents of one session can then have one name, and their files can clash. This breaks the
  rule that each name is new in the session of the orchestrator, as the paragraph that starts "In one session of the
  orchestrator" gives it. No one measured what the Agent tool does with a repeated name.

### The wait for a busy path

Two planner subagents never work on one draft or one match at the same time. Before the start of a planner subagent for
an item, the orchestrator compares the paths of the item with the busy paths. If a path of the item is busy, the
orchestrator starts no planner subagent for that item. The item keeps its proposal file and waits for the result of the
planner subagent that makes the path busy. The orchestrator then takes the next item that waits. The reason: two planner
subagents on one draft file overwrite the draft file and the record file of each other.

These terms hold for this wait:

- A running planner subagent is a planner subagent that holds a place in
  [The count of planner subagents](#the-count-of-planner-subagents).
- The paths of an item are each path that the words of the item give as a match, and the proposal file of the item. For
  an item of an answer of the user or of a settled answer, its draft file path is a path of the item too. The paths of a
  joined item are the paths of each of its items. The deleted file of a join is no path.
- A record file, a report file or a body file of a draft stands for its draft file, as in
  [The check of the pane owner](question-pane.md#the-check-of-the-pane-owner).
- If a path is a path of its own item, a running planner subagent makes the path busy. It also makes busy each path in
  the folder of the draft files whose file name starts with its name and `-`. An example is `plan-4-terms.md` for
  `plan-4`.
- A busy path is a path that a running planner subagent makes busy.
- A start list is the step of [The proposal file](#the-proposal-file) that starts the planner subagents of the items
  that wait. It runs at the arrival of an item, after a result and at the end of the start steps.

A planner subagent that the orchestrator started earlier at the same start list is a running planner subagent too. The
wait also holds when the draft file path of a new item is a match of the item of a running planner subagent. An example:
a running planner subagent has an item that names `plan-3-rules.md` as a match. Later, an item of an answer comes with
the draft file path `plan-3-rules.md`, and that item waits too. An item with no busy path starts under
[The count of planner subagents](#the-count-of-planner-subagents).

If two paths name the same file, they are the same path. A path can be a full path or a file name only. A file name only
of a draft names its file in the folder of the draft files. `proposals/<number>.md` names its file in the
[orchestrator folder](limits.md#the-orchestrator-folder). For each other path, the orchestrator judges which file the
path names, and this judgment is open on purpose.

An item that waits for a busy path is still an [item of planning work that waits](#the-proposal-file). So
[The check of the pane owner](question-pane.md#the-check-of-the-pane-owner) still finds it.

The orchestrator takes the paths of an item from the words of its proposal file. The proposal file holds these words
word for word, so the paths stay through a compaction and a handoff. The orchestrator takes the busy paths of a running
planner subagent from the proposal file that names that planner subagent. While the bar of the fallback of
[The orchestrator folder](limits.md#the-orchestrator-folder) holds, the orchestrator takes both from its session.

A read of these paths can fail or get a denial of [the tool-block rule](tasker-commands.md#the-tool-block-rule). Then
[the failure rule](limits.md#the-failure-rule), the tool-block rule and the fallback of The orchestrator folder apply,
as for each call on the three folders. A failed or denied read gives no answer, so no item passes the compare with it.
If the read of the proposal file of an item fails or gets a denial, that item does not start at that decision. If the
read of the busy paths of a running planner subagent fails or gets a denial, no item starts at that decision.

While the bar holds, the orchestrator reads no proposal file, and the compare uses its session. The read of a proposal
file runs again only after the next word of the user ends the bar. While the bar holds, the session can lack the paths,
for example after a compaction. If the session lacks the paths of an item that waits, that item does not start. If the
session lacks the paths of a running planner subagent, no item starts until the bar ends.

A busy path has these states:

- Not started: a planner subagent that holds no place in the count yet makes no path busy. An item that waits makes no
  path busy.
- Running: while a planner subagent holds a place in the count, it makes its paths busy.
- Ended: a planner subagent that holds no place in the count makes no path busy. This holds after its result and after
  an end with no report.

Another rule can keep the place of a planner subagent in the count after an end with no report. Then the hold of the
place wins, and the paths of that planner subagent stay busy while it holds the place. The draft of an ended planner
subagent that waits for a decision of the user is not busy.

After an end with no report, the orchestrator starts one new planner subagent for the same item, as
[The life of a planner subagent](#the-life-of-a-planner-subagent) says. That start also gets the compare of this wait.
If a path of the item is busy, the item waits, and its later start is still the one new planner subagent. An end with no
report adds no start list. An item that waited for a path of the ended planner subagent starts at the next start list.

These known limits hold:

- A planner subagent that a late report starts again holds no place in the count, so it makes no path busy.
- A planner subagent whose wait a word of the user ended in a handoff holds no place in the count, as
  [The wait before a handoff](#the-wait-before-a-handoff) says. So it makes no path busy.
- The name of a file of another draft can start with the name of a running planner subagent and `-`. An example is a
  draft of an earlier session. An item that names such a file waits with no clash. The cost is a longer wait only.
- The wait lasts as long as the planner subagent of the busy path runs, with its review loops. No time limit ends it.
- An item A can wait for a busy path, and a later item B can name the proposal file of A as a match with full cover.
  Then B can start before A, against the order of arrival. The paths of B then make the proposal file of A busy, so A
  waits for the result of B. The cost: B works on a match whose planner subagent did not run yet, and A starts later.
  For part cover, B joins A instead, as [A joined item](#a-joined-item) says, if A still waits. The limit still holds
  when A already runs.
- After an end with no report, an item that waited for a path of the ended planner subagent waits until the next start
  list. The cost is a longer wait only.

### The model of the start

On 2026-11-19, with Claude Code 2.1.329, the parameter `model` of the Agent tool accepted only `sonnet`, `opus`, `haiku`
and `fable`. If the `model` of the entry is one of these values, the orchestrator passes that value as the `model`.

For each other value, the orchestrator first drops a suffix `[1m]`. Then it maps the value to a family word:

- `claude-opus-*` gives `opus`.
- `claude-sonnet-*` gives `sonnet`.
- `claude-haiku-*` gives `haiku`.

For each value that the map does not name, the orchestrator passes no `model`. An example: the entry
`{ "model": "claude-opus-5-5", "effort": "high" }` gives `model: "opus"` and `effort: "high"`. The cost: a family word
can name another version than the full id. No one measured which version a family word picks.

### The name

The orchestrator names each planner subagent `plan-<count>`. `<count>` is 1 more than the highest of two numbers: the
number that the count read gave before this start, and each count that the orchestrator gave in its session. With
neither, `<count>` is 1. An example is `plan-1`. A name has at most 12 characters, of lowercase letters, digits and `-`.
`plan-` and 7 digits fit.

An example: `drafts/` holds `plan-7-links.md`, `plan-7-links.findings.md` and `plan-12-terms-report.md`. The count read
gives 12, so the next name is `plan-13`. The reason: a record file of an old draft can approve a new draft by mistake,
if the new draft has the same file name. The cost: a longer count leaves fewer of the 24 characters of a draft file
name.

The name of each issue subagent of a planner subagent starts with the name of the planner subagent and `-`.
[The start of an issue subagent](#the-start-of-an-issue-subagent) gives the rules of these names. The Agent tool refuses
a name of more than 64 characters, as [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent)
says. The limit of 12 characters keeps room for the rest of each such name.

### The proposal file

A proposal file is the file `proposals/<number>.md` in the [orchestrator folder](limits.md#the-orchestrator-folder), for
one item of planning work. Only an orchestrator of the kind `claude` queues items of planning work and writes proposal
files. An orchestrator of another kind sends each item at once and writes no proposal file. The orchestrator folder
gives the reads, the calls and the fallback for this folder.

Each item of planning work gets a proposal file at its arrival. This also covers an item whose planner subagent starts
at once. The reason: the file stays until the result, so a compaction during the run of the planner subagent loses no
item of planning work.

Before the write, the orchestrator lists `proposals/` with `ls`. `<number>` is 1 more than the highest number that
`proposals/` holds or that the orchestrator gave in its session. If neither holds a number, `<number>` is 1. So the
orchestrator never uses a proposal number again in one session, and the order of the numbers is the order of arrival.
For example, `proposals/` holds no file, and the orchestrator gave the number 4 earlier in its session. Then the next
item gets `proposals/5.md`.

The proposal file holds each fact of [The prompt](#the-prompt) that comes from the item. These facts are the words of
the planning request that belong to the item, word for word, its sender, its date and the source of each fact. An item
can come from an answer of the user or from a settled answer. Then the file also holds the draft path, the questions and
the answers, each with its source. The source is the words of the user word for word, or the reason of
[A settled question](#a-settled-question). The file stands alone, as a
[question file](question-pane.md#the-question-file) does.

When fewer than `maxPlannerSubagents` planner subagents run, the orchestrator lists `proposals/`. It starts the planner
subagent of the next item of planning work that waits, in the order of arrival, lowest number first. It does this at the
arrival of an item, after a result and at the end of its start steps. It starts planner subagents until
`maxPlannerSubagents` run or no item waits. Before each start, the orchestrator follows
[The wait for a busy path](#the-wait-for-a-busy-path). An item with a busy path keeps its proposal file and waits.

An item that waits is a proposal file whose planner subagent does not run. While the bar of the fallback holds, an item
that waits is an item that waits in the session. These files are not items that wait:

- A file that stays after a failed delete at a result.
- A file whose write of the name failed, until the next word of the user.
- For step 2 of [The wait before a handoff](#the-wait-before-a-handoff), a file that a stop of the queue holds.
- For [The wait before a handoff](#the-wait-before-a-handoff), the file of a planner subagent whose wait a word of the
  user ended. A result of that planner subagent after the write of the handoff file deletes no proposal file.
- At a start with no handoff file, each file that `proposals/` holds at the end of the start steps, until the word of
  the user. [A stop with no handoff](../orchestrator.md#a-stop-with-no-handoff) gives the steps.
- A file of a draft that still has an open question, until the answer to the last open question of the draft, or until
  an answer drops the draft. See [A settled question](#a-settled-question).
- A late-match file that waits for the result of a planner subagent that runs, as [A joined item](#a-joined-item) says.
- A file whose join failed, until the next word of the user.

Before the start of a planner subagent, the orchestrator writes the name of that planner subagent into its proposal
file. The name is `plan-<count>` of [The name](#the-name). The file holds the tie of the item and the planner subagent,
so the tie stays through a compaction. If the write of the name fails, the orchestrator starts no planner subagent from
that file until the next word of the user.

At a result, the orchestrator deletes only the proposal file that names the sender of the result. A result whose sender
no file names deletes nothing, for example a second result of the same planner subagent. A result through `SendMessage`
after a refused `SubagentHandback` call is also a result. If the delete fails, the file stays, and the orchestrator
tells the user the path of the file. It does not count that file as a waiting item of planning work in its session, and
the fallback also applies.

These two cases stop the queue:

- The start fails. [The failure rule](limits.md#the-failure-rule) applies, and the orchestrator keeps the file. The
  orchestrator also asks the user in its question pane, as [The start](#the-start) says.
- The planner subagent and its one restart both end with no report. The orchestrator tells the user and keeps the file.

After such a case, the orchestrator starts no new planner subagent until the next word of the user. Each planner
subagent that runs goes on, and the orchestrator handles each of its results. The reason: the next list gives the same
file again. The user decides.

A file can still stay in `proposals/` at the write of the handoff file, for example a kept file of a failed start. Such
a file stays in the folder, and the new orchestrator finds it at the end of its start steps.

#### A joined item

A joined item is one item that the orchestrator made from two items before a planner subagent starts. These rules hold
for it.

- The tie. The proposal file of an item from a report of a question pane also holds the report that gave it: the pane
  id, the question id and the message number. The orchestrator ties a proposal of a report to its proposal file by these
  facts and by the words of the proposal. This judgment is open on purpose. If no file or two files fit, the tie fails.
- The join for part cover. Before the start of a planner subagent for an item A, the orchestrator reads the matches that
  the words of A give. Take a match B that is a proposal file or an item that waits, with the cover "in part" in the
  words of A. If B still waits and names no planner subagent, the orchestrator joins A and B. Full cover gets no join,
  as [The work for each cover](#the-work-for-each-cover) says.
- The late matches. At the arrival of a planning request of late matches, the orchestrator ties it to the item of its
  proposal. Three cases follow, and a fourth case covers a failed tie.
  - If that item still waits, the orchestrator joins the late matches with it.
  - If its planner subagent runs, the late-match item waits for its result. The late-match file names the planner
    subagent that it waits for, and it is not an item that waits until that result. After the result, the orchestrator
    writes the draft path or the issue key of the result into the late-match file as one more match. Then the item waits
    as each other item.
  - If its planner subagent already ended, the orchestrator takes the draft path or the issue key from that result in
    its session and writes it into the late-match file. If the result gave no draft and no issue, for example after a
    drop, the orchestrator writes that fact as the state of that match.
  - If the tie fails, or the session lacks the result, the late matches wait for a decision of the user. The
    orchestrator asks in its question pane.
- The join itself. The joined item keeps the file with the lower number, so the order of arrival of the earlier item
  holds. The orchestrator appends the words of the other item to that file, word for word, with its sender, its date and
  the source of each fact. Then it deletes the other file. One item then has one proposal file, as before.
- The count. A joined item starts one planner subagent and takes one place in
  [The count of planner subagents](#the-count-of-planner-subagents).
- The calls. Each read, write and delete of a join is a call on the three folders.
  [The orchestrator folder](limits.md#the-orchestrator-folder), [the failure rule](limits.md#the-failure-rule) and
  [the tool-block rule](tasker-commands.md#the-tool-block-rule) apply, with the fallback. If the write fails or gets a
  denial, no join happens, and both files stay. The two items then wait for a decision of the user and do not start. If
  the delete fails after a good write, the file of the other item stays, and the orchestrator tells the user the path.
  That file is not an item that waits. While the bar holds, the orchestrator joins the two items in its session and
  writes no file.
- The planner subagent reads no proposal file. The prompt gives the words of each joined item.

These rules need no change in [limits.md](limits.md), [allowed-commands.md](allowed-commands.md) or
[permissions.md](permissions.md). The planner subagent gets no new command. A join is a call of the orchestrator on its
own three folders, and The orchestrator folder already covers each such call.

The cost of the part-cover join is a new write of the orchestrator into the proposal file of another item, and a change
in the order of the work of the matched item. The cost of the late-match join is new reads and writes of the
orchestrator, and the tie of a proposal of a report to its proposal file. A wrong tie joins the wrong items. The user
sees the join in the result.

These known limits hold:

- After a compaction or a handoff, an item of planning work that a stop of the queue held can get a planner subagent
  again. This also holds for an item of planning work whose proposal file stayed after a failed delete.
- A planner subagent that runs again for a kept proposal file can post a duplicate issue on GitHub. Right before each
  post, the search of [Before a post](issues.md#before-a-post) looks for the same change in all the issues of the repo,
  open and closed. This search lowers the risk.

## The prompt

The prompt of a planner subagent gives these facts:

- The item of planning work word for word, with its sender and its date. The prompt names the source of each fact, as
  the source bullet of [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) says.
- The own name and the scope of the orchestrator.
- The folder of the draft files. It is the absolute path of `drafts/` of
  [the orchestrator folder](limits.md#the-orchestrator-folder), from the read of the data root, with no `$HOME` and no
  `~`. An example, for the data root `/home/u/.local/share/tasker`, the repo key `codeguru42/tasker` and the own name
  `orchestrator-m31`, is `/home/u/.local/share/tasker/codeguru42-tasker/orchestrators/m31/drafts/`. While the bar of
  that section holds, the folder is the old folder, `/tmp/tasker/<own name>/drafts/`, with the own name of the
  orchestrator. Each new draft file name of the planner subagent starts with its own name and `-`, for example
  `plan-4-terms.md`.
- The name of the planner subagent.
- The docs to read: this page and [planner.md](planner.md). The planner subagent reads each other doc of a kept rule
  only for a step that needs it. It reads each doc with the commands of
  [the doc-read rule](doc-reads.md#the-doc-read-rule).
- The list of the planner subagent in [the allowed commands](allowed-commands.md#the-planner-subagent).
- The entries `sessions.models.issue-draft`, `sessions.models.issue-review` and `sessions.models.issue-post`, or the
  fact that a key has no entry. [The start of an issue subagent](#the-start-of-an-issue-subagent) uses them.
- The ask for the result through the tool `SubagentHandback`.

The words of this prompt stand in the file
[`prompt-templates/planner/planner-subagent.md`](../../prompt-templates/planner/planner-subagent.md). The orchestrator
reads that file as [the doc-read rule](doc-reads.md#the-doc-read-rule) says, and fills each placeholder. An absent fact
has the value `none`, for example a key with no entry. The file holds the list of the planner subagent in the allowed
commands as fixed words, so a change of [that list](allowed-commands.md#the-planner-subagent) also changes the file. The
facts of each answer go in the item of planning work.

The reason for the folder: a file of the orchestrator folder stays through a reboot, and a reboot clears `/tmp`. A draft
that waits for the user is then not lost. No planner session writes in `drafts/`, so a draft of a planner session never
has the file name of a draft there. The reason of [planner.md](planner.md) for `/tmp` holds only for a draft in the old
folder.

For an item of planning work of an answer, the prompt also gives the path of the draft file and the question. It gives
the answer and its source: the words of the user word for word, or the reason of a settled answer. For a draft with two
or more questions, the prompt gives each question with its answer and source, as
[A draft that needs the user](#a-draft-that-needs-the-user) says.

## The result

The planner subagent asks the user nothing and tells the user nothing.

The planner subagent returns one result to the orchestrator that started it, with `SubagentHandback`. It reports as a
task subagent reports to the orchestrator. A kept rule can say that the planner tells, asks or reports to the user, or
that it sends a message. For the planner subagent, the fact or the question goes in its result. An example is the report
after each post or drop of [The post of a draft](planner.md#the-post-of-a-draft).

The result names each complete post. For a draft that waits for a decision of the user, the result gives the path of the
draft file and each question. [A draft that needs the user](#a-draft-that-needs-the-user) gives the kinds and the order
of these questions. It also gives each finding that the planner subagent dismissed. The result gives each issue as its
plain key, as [the issue-link rule](working-with-the-user.md#the-issue-link-rule) says for a message between two
sessions.

The planner subagent runs no round of `/session-review`. The reason: the skill deletes memory notes, as
[Limits](limits.md#limits) says for a task subagent. The result gives each lesson of the work of the planner subagent.

After a [refused `SubagentHandback` call](limits.md#the-answer-wait-rule), the planner subagent sends the same result to
the orchestrator with `SendMessage` and `to: "main"`. The first line of the message says that Claude Code refused the
`SubagentHandback` call. If this send also fails, the orchestrator gets no report. Then
[The life of a planner subagent](#the-life-of-a-planner-subagent) gives the steps of an end with no report.

The orchestrator handles a result in this way:

1. Show each report of the result as a progress report in the own tab. Show the report of a security gap at once, as
   [A draft that needs the user](#a-draft-that-needs-the-user) says. The intro of [orchestrator.md](../orchestrator.md)
   gives this form for each report.
2. Handle each lesson of the result as a lesson of a final report.
3. Ask each question of the result that is not settled in the own [question pane](question-pane.md#a-question-pane), as
   an open question of the orchestrator. For each other question, follow [A settled question](#a-settled-question). Each
   asked question gets a [question file](question-pane.md#the-question-file). The text of the question names its kind
   and the path of its draft file. The question ids follow the order of the result.
4. Take each answer of the user and each settled answer as part of an item of planning work. A draft with two or more
   questions and an answer that drops a draft are exceptions, as
   [A draft that needs the user](#a-draft-that-needs-the-user) says.
5. If the result says that a question of a posted match draft is moot, drop that question as moot work, as
   [A decision of the user](working-with-the-user.md#a-decision-of-the-user) says. The text of that question in a pane
   does not change.

The new planner subagent of such an item follows change 6.

### A settled question

The user gets a question only for a choice that the docs and the code do not settle. A rule of the docs or a fact of the
code on `origin/main` can answer a question of a result. Then the orchestrator answers it and does not ask the user.

Before the orchestrator asks a question of a result in its pane, it reads the docs and the code on `origin/main` that
the answer depends on. It reads them as the bullet of
[A question of the user](working-with-the-user.md#a-question-of-the-user) that starts "Before the session answers a
question" says. The orchestrator chooses the files. The two bullets of
[A decision of the user](working-with-the-user.md#a-decision-of-the-user) that start "A rule of the docs on
`origin/main` can answer a question" and "Before a decision of the user or a recommendation" still hold.

The orchestrator judges if a rule or a fact settles the question. Each limit of the bullet that starts "A rule of the
docs on `origin/main` can answer a question" holds, also for a fact of the code. In doubt, the question is not settled.
For a planner question, the limit on a change of a rule of the docs reads in this way: a settled answer changes no rule
of the docs itself. It only chooses among the choices of a draft. The planner subagent reviews and posts that draft
under its own rules.

The orchestrator does not ask the user a settled question and starts no question pane for it. A settled question is not
an open question of the orchestrator in the meaning of [Terms](question-pane.md#terms) of question-pane.md.

The settled answer goes to the planner subagent with its reason:

- For a rule of the docs, the reason quotes the rule and names its doc and its section.
- For a fact of the code, the reason names the file path, the fact and the commit hash of the read. After a passed
  [step 1](doc-reads.md#step-1-pull-the-local-clone) of the doc-read rule, the hash is `<head>` of step 1. After
  [the old read](doc-reads.md#the-old-read), the hash is the hash of `origin/main` after the fetch, as
  [the re-read rule](doc-reads.md#the-re-read-rule) reads it.

The text says that the answer comes from a rule of the docs or a fact of the code and not from the user. It does not
start with `From the user:`.

For each settled question, the orchestrator shows a progress report in its own tab. The report gives the question, the
answer and the reason, in the form of step 1 of [The result](#the-result).

A settled answer is part of an item of planning work, as step 4 of The result says for an answer of the user. The start
follows [The start](#the-start). For a draft with two or more questions, the settled answer joins the answers of the
other questions. The new planner subagent starts after the last answer, as
[A draft that needs the user](#a-draft-that-needs-the-user) says. The prompt gives the draft path, the questions and the
answers, each with its source. A draft can still have an open question when its settled answer comes. Then the
orchestrator writes the proposal file of the settled answer at once, as [The proposal file](#the-proposal-file) says for
an item of planning work at its arrival. The file holds the draft path, the questions and each answer so far, each with
its source. The orchestrator starts no planner subagent from that file until the answer to the last open question of the
draft. Each later answer of that draft joins the same file.

A settled answer can drop a draft only if a rule or a fact already holds the whole change of the draft. Keep 4 permits a
drop with no approval of the user. Then the drop bullet of A draft that needs the user holds for the settled answer: the
answer ends the draft, and the orchestrator asks no other question of that draft. The item of planning work of the draft
holds that answer and each earlier answer, in the one proposal file of the draft, and it starts at once. In each other
case, a settled answer drops no draft.

The new planner subagent handles a settled answer with the steps that the planner docs give for an answer of the user to
that question. Examples are the bullets of [The escape hatch](planner.md#the-escape-hatch) that start "If the answer",
and change 6. It passes the answers and their reasons on to each issue-draft subagent that it starts for the draft. A
draft never records a settled answer as a decision or as a word of the user.

These questions are never settled. The orchestrator still asks each of them in its question pane:

- A question for an approval that a rule keeps for the user, for example the question about the remaining findings and
  the approval of a comment in [Before a post](issues.md#before-a-post).
- A question of a kind of choice that still goes to the user first. The bullet of A decision of the user that starts
  "The user can let the session decide" lists these kinds, for example a security gap and a change of scope.
- The approval of a measure that changes [the state of the user](plan-review.md#the-state-of-the-user).

A question about a choice between two or more designs is settled if a rule of the docs or a fact of the code picks one
design. Otherwise the orchestrator asks the user. A settled answer that leaves the draft unchanged does not approve the
draft. It only removes that reason for the wait of the draft. If the answers of the other questions of the draft also
permit the post, the new planner subagent posts the draft, as keep 4 permits.

An answer that does not come from the user never gives an approval or a choice that a rule keeps for the user. Examples
are [The rules for the user alone](planner.md#the-rules-for-the-user-alone) and the approval of a comment in Before a
post.

If the read fails, the question is not settled. The orchestrator follows [the failure rule](limits.md#the-failure-rule)
and then asks the question in its question pane, as before.

A failed start of the new planner subagent follows [The start](#the-start), as for an answer of the user.

### A draft that needs the user

A draft that needs the user is a draft of a planner subagent that waits for a word of the user before its post. This
also covers the draft of a comment on an issue. The kind of such a draft is the reason for its wait.

For a planner subagent, these six kinds take the place of the list of decisions of
[The escape hatch](planner.md#the-escape-hatch). Each kind keeps the words of its source.

1. A security gap. The sources are the item "A security gap." of The escape hatch and the paragraph of
   [The findings and the edge cases](issue-draft.md#the-findings-and-the-edge-cases) that starts "The paragraph before
   this one".
2. A new feature, or a change of a behavior that a user sees. The source is the item of The escape hatch that starts
   with these words, with its second paragraph. The exception for a feature in the source of the draft stays. So a
   request of the user that asks for the feature, for example a decision message of a pane, gives no question of this
   kind.
3. A choice between two or more designs, where each one has a real cost. A choice of the place or the words of a doc
   change stays a choice of the ticket plan.
4. A change of scope of an issue in flight.
5. A comment on an issue. The sources are three places. The first is the term of The review loop of a draft that starts
   "A comment on an issue is not a draft". The second is the bullet of
   [The rules for the user alone](planner.md#the-rules-for-the-user-alone) that starts "A comment on an issue". The
   third is the first bullet of [Before a post](issues.md#before-a-post). Change 9 gives its actors.
   [A comment post](issue-post.md#a-comment-post) of [issue-post.md](issue-post.md) gives the post of the approved
   comment.
6. A measure that needs a change of [the state of the user](plan-review.md#the-state-of-the-user). The source is the
   item of The escape hatch that starts "A measure that needs a change". Keep 3 keeps the measure as an open question of
   the report. Change 2 puts it in the result. Keep 6 leaves its approval to the user. The question gives the command of
   the measure. The reason: the issue can get a tested fact before its post. The cost: each such measure takes a turn of
   the question pane.

Each kept rule that names a kind of The escape hatch names one of these six kinds for a planner subagent. Two examples
follow. The first is the paragraph of [The issue subagents of a planner](planner.md#the-issue-subagents-of-a-planner)
that starts "Before the planner sends a question of a report to the user". The second is each place of issue-draft.md
that names a kind of The escape hatch, for example its paragraph that starts "The report gives a question for the user".
The reason: the issue-draft subagents of a planner subagent follow issue-draft.md. The initial planner and the ad hoc
planner keep the list of The escape hatch.

Sometimes the reviews end and a finding of one of the six kinds is still open. Then the draft is a draft of that kind.
The source is the last item of the list of The escape hatch, which starts "A finding of one of these kinds".

A question of another kept rule keeps the path of [The result](#the-result) and is not one of the six kinds. Examples:

- The bullet of [The post of a draft](planner.md#the-post-of-a-draft) that starts "If the planner cannot tell which case
  applies".
- A tool block.
- An issue subagent that ends twice with no report, as [The wait for an issue subagent](#the-wait-for-an-issue-subagent)
  says.
- A failed read or write of the record file.
- A failed compare of a match.
- Words of the user that name no single issue.

The remaining findings are the term of [The issue subagents](#the-issue-subagents). The result gives one more question
about them, for each draft with remaining findings. For each remaining finding, the question gives its place in the
draft, its rule or fact, and the recommendation of the review. It has three choices: post the draft as it stands, change
it, or drop it. The planner subagent gives its recommendation and the cost of each choice.

The form of the result: for each draft that needs the user, the result gives one question for each kind of the draft. It
gives one more question for the remaining findings of the draft. Each question names its kind, or the words "remaining
findings". Each question follows [A decision of the user](working-with-the-user.md#a-decision-of-the-user). It gives a
summary of the draft and the path of the draft file, not the text of the draft. A question about a comment also gives
the exact text of the comment, because the user approves that text word for word. The result also gives each other fact
of such a draft that [The result](#the-result) gives, for example each finding that the planner subagent dismissed.

The result numbers its questions in this order:

1. A security gap.
2. A new feature, or a change of a behavior that a user sees.
3. A choice between two or more designs.
4. A change of scope of an issue in flight.
5. A measure that needs a change of the state of the user.
6. A comment on an issue.
7. A question of another kept rule.
8. The remaining findings.

These numbers are not the numbers of the list of kinds above. A comment is kind 5 and order 6. Two questions of one
number keep the alphabetic order of the names of their draft files. The reasons for the order:

- The report of an issue-draft subagent gives a security gap first. The paragraph of
  [The findings and the edge cases](issue-draft.md#the-findings-and-the-edge-cases) that starts "The paragraph before
  this one" says so.
- Items 2 to 5 of the order keep the order of the list of The escape hatch. That order starts at its item of a new
  feature and ends at its item of a measure.
- Items 6 to 8 are not on that list, so they come last.

A security gap also goes in the result as a report, with the time that the gap starts.
[Core features first](working-with-the-user.md#core-features-first) says to tell the user about a security gap at once.
Step 1 of the steps of the orchestrator shows this report at once. The question about the gap still waits for its place
in the list order.

The orchestrator handles the questions of one result in these ways:

- It gives the question ids of one result in the order of the numbers of the result. So key 3 of the list order of
  [Start](question-pane.md#start) orders the questions of one result that tie on keys 1 and 2 by these numbers. Keys 1
  and 2 still come first.
- The text of each question that it gives to the pane names the kind of the question, or the words "remaining findings",
  and the path of the draft file.
- The path of an answer stays as [The pane owner handles a decision](question-pane.md#the-pane-owner-handles-a-decision)
  gives it in its first paragraph. The same holds for two other places. One is the paragraph of
  [The question session](question-pane.md#the-question-session) that starts "A question session starts no subagent that
  plans, drafts, reviews or posts an issue". The other is the sentences that start "A planner subagent is never the
  sender of a question of a pane".
- One answer is one item of planning work, except in the two cases that follow. For a draft with two or more questions,
  all the answers of the draft form one item of planning work. A settled answer of the draft joins them. The item has
  one proposal file, and the prompt gives each question with its answer and source. Its planner subagent starts only
  after the answer to the last open question of the draft. For such a draft, this rule wins over step 4. The reason: the
  sentence of The escape hatch that starts "A planner posts nothing for such a draft" bans each post before the answer
  to each question.
- An answer that rejects or drops a draft ends the draft. A settled answer that drops a draft does the same, as
  [A settled question](#a-settled-question) says. The orchestrator asks no other open question of that draft. It drops
  each such question as moot work, as [A decision of the user](working-with-the-user.md#a-decision-of-the-user) says.
  The item of planning work of the draft then holds that answer and each earlier answer of the draft, in the one
  proposal file of the draft. The item waits for no other answer of the draft. It starts at once, under
  [the count of planner subagents](#the-count-of-planner-subagents). That planner subagent reports the drop.

The steps with each answer are the steps of change 6. For the remaining findings, the answer "post the draft as it
stands" accepts the draft with no change. The bullet of The escape hatch that starts "If the answer accepts the draft
with no change" gives this rule. That answer approves the draft, as [The count of reviews](#the-count-of-reviews) says,
so the new planner subagent starts the post with no new review. "Change it" is an answer that changes the draft, so a
new issue-draft subagent and new reviews follow.

## An item with a match

An item with a match is an item of planning work that names a match. A match is an issue, a draft or a proposal file
that the check of the pane owner or the words of the item name as one that holds the change. Without a rule, a change
that the user wants in an existing draft can become a second issue. The user said: "I think this already has a proposal
or draft, too" and "this should be added to the existing proposal/draft". This section puts such a change into its
match. The reason is the same as in the cover rule below: a match is the place where the change belongs, and a second
issue for it splits one piece of work in two.

### The terms of a match

- An item with a match is one of three kinds. The first is an accepted proposal or recurrence with its matches. The
  second is an open finding of a final report with its matches. The third is the planning request of late matches that
  [The check of the pane owner](question-pane.md#the-check-of-the-pane-owner) gives.
- The change is the part of the item that a match can hold.
- The match draft is a match that is a draft file. It is in the folder of the draft files that that section defines, or
  it is a draft of the check.
- The cover is how much of the change a match holds. It is "in full", "in part" or none.
- A posted match is a match that is an issue on GitHub.
- A joined item is an item that the orchestrator joined with another item, as [The proposal file](#the-proposal-file)
  says.

### The cover of a match

The planner subagent judges the cover again. This judgment is open on purpose. A match can change after the check, and
the answer of the check decides nothing. For a match that the docs bar the planner subagent from reading, for example a
proposal file, it takes the cover of the item. For two or more matches, it judges which part of the change goes into
which match.

### The work for each cover

Follow these steps in this order.

1. The words of the user in the item win. If they keep the change apart, make a new draft.
2. This step wins over each cover. Make a new draft if one of these holds. No match holds the cover. The change is not
   one ticket. The match draft is gone, because its state says dropped or its file no longer exists, as
   [A missing draft file](#a-missing-draft-file) gives. The match draft is a draft of a comment. The match draft is
   outside the folder of the draft files.
3. For full cover, make no new draft and change nothing. This is a drop with no approval of the user, as keep 4 permits.
   A match with no draft yet follows this step too.
4. For part cover of a match draft that waits, start an issue-draft subagent with the match draft and the change. The
   planner subagent does not change the draft itself. The rule of one ticket is in
   [The scope of a ticket](issue-subagents.md#the-scope-of-a-ticket). The count of reviews starts again, as
   [The count of reviews](#the-count-of-reviews) says. The planner subagent posts nothing. A new question of the reviews
   goes in the result.
5. For part cover of a posted match, follow [The post of a draft](planner.md#the-post-of-a-draft). It gives the cases of
   an open issue with no task, an issue in flight and a closed issue.
6. For part cover of a match with no draft yet, the orchestrator joined the two items before the start, as
   [The proposal file](#the-proposal-file) says. So the planner subagent of the joined item works on both items. If the
   item still names such a match with part cover, the join did not happen. Then the planner subagent makes a new draft
   and names the match in its result.
7. A new draft names each posted match with full or part cover by its issue key and the overlap. It names no draft file
   and no proposal file.

### A failed read of a match

The planner subagent can fail to read a match draft. The state of a match in the prompt can also be "not known". In both
cases, [the failure rule](limits.md#the-failure-rule) or [the tool-block rule](tasker-commands.md#the-tool-block-rule)
applies. The planner subagent changes no draft and makes no new draft for the whole item. A failed read is never a
missing, dropped or waiting draft. For the bar, see
[A failed call on a file of a draft](#a-failed-call-on-a-file-of-a-draft).

### The result for each match

For each match of an item, the result gives these facts:

- The path of the match.
- The cover: in full, in part or none.
- The action. It is one of these: no change, the changed match draft, the change of an open issue with its key, a new
  draft, a post after the case of [The count of reviews](#the-count-of-reviews), or nothing after a failed read.
- The reason for the action.

For a changed match draft, the result also gives a short summary of the change. It says that the draft still waits for
its open questions. After a post of that case, the result names the question about the remaining findings as moot, with
its question id. Step 5 of [The result](#the-result) gives the work of the orchestrator for that question.

### The decided choices

The user decided four choices for this section. The source is an answer in a question pane, relayed in the feedback of
plan v1 of #1097. The date is 2026-11-26.

- OD1, the state of a match. The answer is "a". The orchestrator gives the state of each match in the prompt. The cost:
  new reads and new facts in the prompt. After a compaction, the session can lack a post or a drop.
- OD2, part cover of a match with no draft yet. The answer is "b". The orchestrator joins the two items before a start.
  The cost: a new write of the orchestrator into the proposal file of another item, and a change in the order of the
  work of the matched item.
- OD3, the planning request of late matches. The answer is "b". The orchestrator joins the late matches with the item of
  the proposal. The cost: new reads and writes of the orchestrator. The orchestrator must tie a proposal of a report to
  its proposal file.
- OD4, a match draft that waits only for the question about the remaining findings. The answer is "2 b", and it is
  narrow. The planner subagent posts the draft only if the new reviews find nothing new. The cost: a post before the
  answer to a question that the user saw. The orchestrator drops a question of another draft from a result.

### The known limits of a match

These known limits hold:

- Two planner subagents can still write one match draft, for example when a planner subagent that a late report starts
  again holds no place in the count.
- The cover is a judgment of the planner subagent, so two planner subagents can judge it in two ways.
- A match can change after the check of the pane owner, and the state in the prompt can be old. After a compaction, the
  session of the orchestrator can lack a post or a drop.
- A failed read of one match stops the whole item, also when the other matches are good.
- The planner subagent reads no proposal file, so it takes the cover of such a match from the item.
- The question about the remaining findings in a pane keeps its text, also after a post that makes it moot.

The join adds these limits. A joined item can be large, so one planner subagent works longer and the wait of other items
for its paths grows. A wrong tie of a late-match request to its proposal file joins the wrong items. OD4 lapses if
another change removes the wait for the remaining findings before this work lands.

## No metadata

The planner subagent changes no metadata of an issue. It moves no card and sets no priority. It adds and removes no
label. It closes and reopens no issue, and it moves no issue to another milestone. This rule wins over each kept rule
that asks for such a change.

The issue-post subagent makes each write of a post, as
[The writes of an issue-post subagent](issue-post.md#the-writes-of-an-issue-post-subagent) says. Its create call of a
new issue gives the milestone and each label of the new issue, as [Before a post](issues.md#before-a-post) gives them.
This create call is the one exception to the rule before this one.

The planner subagent gives each issue-post subagent each blocked-by link of the report of the issue-draft subagent, with
its reason. It also gives each link to an issue that it posted before for another draft, with its reason. The issue-post
subagent adds each such link and removes a link of a race, as [The steps of a post](issue-post.md#the-steps-of-a-post)
says.

A kept rule can ask for a change of metadata. Examples are the recommendation of [A recurrence](issues.md#a-recurrence)
and a move of an issue into "Future". The planner subagent then makes no change. Its result gives the proposed change
and its reason.

## The kept rules

In each kept rule, "the planner" and "each planner" also name the planner subagent. The lists of this section, of The
changed rules and of The dropped rules win over each rule that they name. If two items name one rule, the drop list
wins, and then the change list. A named section means only its text before its first subsection. Each subsection has its
own item.

The planner subagent keeps these rules:

1. The text of [The issue subagents of a planner](planner.md#the-issue-subagents-of-a-planner) before its first
   subsection, and the text of [The review loop of a draft](planner.md#the-review-loop-of-a-draft) before its first
   subsection. The planner subagent leaves out the paragraphs that give a rule only for a planner session. These
   paragraphs start "Each planner session of the kind", "The reason: on 2026-11-21", "A pi planner session has no rule
   here", "These rules of the planner subagent do not hold", "The rule of a planner subagent across drafts", "The
   planner session runs `tasker show-config --repo <key>`", "The planner session gives each issue subagent the list",
   "The planner session names each issue subagent", "An ad hoc planner uses an ad hoc name" and "If the own name is a
   GitHub issue key". So it keeps the paragraphs that start "Before a planner subagent starts the first issue-draft
   subagent", "The reason: each review costs", "The planner then does each step after the reviews", "Before the planner
   sends a question of a report", "A change of the draft after a report", "For a change of an open issue", "If an
   issue-draft subagent of a change of an open issue", "If an issue subagent ends with no report", "The fact of the
   first sentence of the bullet", "The fact of that bullet also holds", "On 2026-11-15, the same planner" and "The
   planner gives each draft file a name". The bans of an issue-review subagent stand in
   [The bans of an issue-review subagent](issue-review.md#the-bans-of-an-issue-review-subagent), and
   [The prompt of an issue subagent](#the-prompt-of-an-issue-subagent) gives its prompt. Change 3, change 5, change 6,
   change 7 and drop 7 leave out parts of these rules. Change 8 gives their actors.
   [The count of reviews](#the-count-of-reviews) gives the count of reviews.
2. [The wait for a report](planner.md#the-wait-for-a-report). The planner subagent is the starter of each of its issue
   subagents. [The wait for an issue subagent](#the-wait-for-an-issue-subagent) gives its steps. Change 4 changes one
   bullet of a late report.
3. The first two paragraphs of [The state of the user](planner.md#the-state-of-the-user): the ban, and the measure as an
   open question of the report.
4. These parts of [The post of a draft](planner.md#the-post-of-a-draft): the post with no approval of the user, the
   duplicate search and the match of a closed issue. Also the drop with no approval of the user and the steps of a
   complete post. After a complete post, the planner subagent sends no message to an orchestrator. An orchestrator of
   another scope finds the change at its next read of the board.
5. The list of decisions of [The escape hatch](planner.md#the-escape-hatch), and its last sentence "Each planner goes on
   with the other drafts". Also its sentence that starts "An edge case that an issue-draft subagent decided as "later"".
   The planner subagent posts nothing for a draft that waits for a decision of the user. For a planner subagent, the six
   kinds of [A draft that needs the user](#a-draft-that-needs-the-user) take the place of the list of decisions.
6. [The rules for the user alone](planner.md#the-rules-for-the-user-alone), as limits. The planner subagent does none of
   the actions of that list.
7. The fourth bullet of [The order of the work](planner.md#the-order-of-the-work): a follow-up issue for a closed issue,
   and the comment rule. Change 9 gives the actors of its comment.
8. [The body of an issue](issue-subagents.md#the-body-of-an-issue),
   [The blocked-by links](issue-subagents.md#the-blocked-by-links) and
   [The milestone of an issue](issue-subagents.md#the-milestone-of-an-issue) of issue-subagents.md. Also the bullets of
   [The scope of a ticket](issue-subagents.md#the-scope-of-a-ticket) that start "What goes together in one ticket" and
   "[Core features first]". Also two bullets of [What goes in a ticket](planner.md#what-goes-in-a-ticket). They start
   "If the user states a design fact" and "The work on this repo must continue on any machine".
9. In issues.md: [Before a post](issues.md#before-a-post),
   [The reads before the write](issues.md#the-reads-before-the-write) and the commands of
   [The blocked-by links](issues.md#the-blocked-by-links). Also the reads of
   [The project board](issues.md#the-project-board), and [A recurrence](issues.md#a-recurrence) except its change of
   metadata. Change 9 gives the actors of the recurrence comment. The second paragraph of the first bullet of Before a
   post starts "Each planner posts a reviewed draft". For the planner subagent,
   [The count of reviews](#the-count-of-reviews) gives the approval of a draft.
10. The paragraph after the bullets of [The start of the initial planner](planner.md#the-start-of-the-initial-planner)
    that starts "The reason for the folder". Change 7 gives the folder.
11. [The doc-read rule](doc-reads.md#the-doc-read-rule), [the failure rule](limits.md#the-failure-rule), the rules of
    [rules.md](rules.md) and [the tool-block rule](tasker-commands.md#the-tool-block-rule).
12. These sections of working-with-the-user.md:
    [A decision of the user](working-with-the-user.md#a-decision-of-the-user),
    [Core features first](working-with-the-user.md#core-features-first),
    [Fix the root cause](working-with-the-user.md#fix-the-root-cause),
    [Simplify over special rules](working-with-the-user.md#simplify-over-special-rules) and
    [The tools of a session](working-with-the-user.md#the-tools-of-a-session).
13. The first bullet of [Working with the user](planner.md#working-with-the-user), which links to A decision of the
    user. The question goes in the result, in the form of that section.
14. The terms of the intro of [planner.md](planner.md): the planner and the blocked-by link.
15. The source bullet of [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent). The prompt
    of a planner subagent names the source of each fact, as [The prompt](#the-prompt) says.
16. [Wrong text of an open issue](planner.md#wrong-text-of-an-open-issue): the change of the body of an open issue with
    wrong text and no task. Change 8 gives the actor of the post and of its reads.

## The changed rules

The planner subagent changes these rules:

1. The source of the work. The planner subagent takes only the item of planning work of its prompt.
2. Each report, question and draft for the user goes in the result, as [The result](#the-result) says. One such place is
   the third paragraph of [The state of the user](planner.md#the-state-of-the-user). Another is the paragraph of
   [The escape hatch](planner.md#the-escape-hatch) that starts "For a draft that waits for such a decision". Others are
   the report after each post or drop in The post of a draft. The bullets of
   [The blocked-by links](issue-subagents.md#the-blocked-by-links) that name the chat with the user are also such
   places.
3. The names. The own-name prefix and the ad hoc name of a planner session do not hold for the planner subagent.
   [The start of an issue subagent](#the-start-of-an-issue-subagent) gives the names of its issue subagents.
4. In The wait for a report, the bullet of a late report that starts "If the draft waits for a decision of the user".
   The planner subagent does not wait for the answer. It gives the findings of the late report in its result.
5. The planner subagent takes the model entries from its prompt and runs no `tasker show-config`.
   [The prompt of an issue subagent](#the-prompt-of-an-issue-subagent) gives the prompt of each issue subagent. At its
   start, an issue subagent reads only the documents of [The read rule](issue-subagents.md#the-read-rule).
6. The steps with an answer of the user. They hold for the new planner subagent that gets the answer, as The result
   says. They also hold for a settled answer, as [A settled question](#a-settled-question) says. A settled answer gives
   no approval and no choice that a rule keeps for the user. One such step is in the outcome bullets of The state of the
   user, after "The answer of the user has one of these outcomes". So do the bullets of The escape hatch that start "If
   the answer", and its bullet that starts "The user can say". The paragraph of The issue subagents of a planner that
   starts "A change of the draft after a report" also gives such a step. The post of a comment after the approval of the
   user is such a step too, and change 9 gives its actor.
7. The folder of the draft files is the folder of [The prompt](#the-prompt). The bullet that starts "The issue-draft
   subagent of each planner session writes each draft" gives the folder of the slug. That folder does not hold for the
   planner subagent. A draft keeps its folder. The draft file, the report file and the record file stand next to each
   other, in `drafts/` or in the old folder, also for an answer of the user while the bar holds. The folder of the
   prompt holds only the new drafts of the planner subagent. A draft from before this change, or from a time of the bar,
   stays in the old folder with its files. A reboot can still delete such a draft. Then
   [A missing draft file](#a-missing-draft-file) holds.
8. The actors of the work on a draft. The planner subagent starts the issue-draft subagent, the issue-review subagent
   and the issue-post subagent with the Agent tool, as the work needs. Each start of an agent and each wait for a report
   in the kept rules is a step of the planner subagent. [The issue subagents](#the-issue-subagents) gives the start
   rules of the issue subagents and the actor of each other step of the kept rules. No metadata already gives a post and
   each blocked-by link of a post to an issue-post subagent. In each kept rule, a new issue-draft subagent gets the
   reviews of [The count of reviews](#the-count-of-reviews). Examples are The state of the user, The escape hatch and
   the match with an open issue.
9. The actors of a comment on an issue. This change covers the comment of the comment rule of keep 7 and the recurrence
   comment of A recurrence. An issue-draft subagent drafts the comment, and an issue-review subagent reviews it. An
   issue-post subagent posts it after the review passes and the user approves it. The planner subagent posts no comment
   itself.
10. An item with a match follows [An item with a match](#an-item-with-a-match). That section wins over each kept rule
    that makes a new draft for the change.

For a planner subagent, change 9 wins over two sentences. They are in keep 1 and keep 6. Each says that a comment on an
issue is not a draft of The review loop of a draft. For a planner subagent, these sentences mean only that a comment
needs the approval of the user.

After a tool block, the planner subagent follows [the tool-block rule](tasker-commands.md#the-tool-block-rule). The
result of an issue-post subagent gives the exact command, the folder and the exact text of a denial. The planner
subagent gives these facts in its own result.

## The dropped rules

The planner subagent drops these rules:

1. [Milestones](issues.md#milestones).
2. The name `planner-<slug>` and the start by the user. The bullet of Working with the user that starts "The user names
   the initial planner" gives them. The first two paragraphs of The start of the initial planner also give them.
3. The table of milestones of Working with the user, and the first bullet of The order of the work.
4. The question about the kinds of GitHub objects, in the third bullet of The order of the work. The planner subagent
   writes only the text of issues, as [No metadata](#no-metadata) says.
5. The rounds of `/session-review`, as The result says.
6. The denial records of [planner.md](../planner.md) and [The denial records](tasker-commands.md#the-denial-records).
   They need a word of the user.
7. Each rule only for the initial planner or the ad hoc planner. Examples are
   [The initial planner](planner.md#the-initial-planner), the bullet that starts "A milestone can need manual steps" and
   the ad hoc name.
8. Each change of metadata, as No metadata says.
9. The start docs of [planner.md](../planner.md). The prompt names the reads, as The prompt says.
10. A wait for an answer of the user. The planner subagent ends with its result. Change 6 gives the steps with the
    answer.

## The issue subagents

These terms apply in this section. The three kinds are the issue-draft subagent, the issue-review subagent and the
issue-post subagent. A review is one report of an issue-review subagent on one draft. A finding is one item of a review.
It gives a place in the draft, the rule or the fact behind it, and a recommendation. A dismissal is a decision to keep
the draft as it is for one finding, with a one-line reason. The record file is the file of
[The record file](#the-record-file). The remaining findings of the draft are the new findings of review 3 of a draft.
[The count of reviews](#the-count-of-reviews) gives their steps.

### The starter of an issue subagent

A planner subagent and a planner session of the kind `claude` start a subagent of the three kinds. The main session of
an ad hoc draft starts the issue-draft subagent and the issue-review subagent. The orchestrator, a task subagent, a
question session and a write subagent start none.

The subagent of the main session that posts a reviewed ad hoc draft is the ad hoc post subagent. It is not an issue-post
subagent. Its start in the bullet of [working-with-the-user.md](working-with-the-user.md) that starts "A subagent of the
main session posts a reviewed ad hoc draft" stays.

The planner subagent runs no write to GitHub. An issue-post subagent runs each write of a post. These are a new issue, a
new title or body of an open issue, each add or removal of a blocked-by link, and each approved comment. The planner
subagent posts no comment itself. Change 9 gives the actors of a comment. A planner subagent starts an issue-post
subagent for a comment post. A planner session keeps its own comments, as the rules of the planner say. No metadata
already gives each write of a post to the issue-post subagent. The row of the planner subagent in
[the table](permissions.md#the-table) gives it no `gh` write.

The reason: among the three kinds, only an issue-post subagent writes to GitHub, as
[The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent) says. So the work of the planner subagent has the
same single writer for an issue and its links.

The list of the planner subagent in [allowed-commands.md](allowed-commands.md#the-planner-subagent) gives the commands
that it can run.

### The order of the work on a draft

The planner subagent makes the drop judgment of keep 1 before it starts the first issue-draft subagent of an item of
planning work.

For one draft, the planner subagent does these steps:

1. Start an issue-draft subagent. It writes the draft file and its report.
2. Start an issue-review subagent for the draft. The issue-review subagent does step 1 of
   [the doc-read rule](doc-reads.md#the-doc-read-rule) itself, as [The read rule](issue-subagents.md#the-read-rule)
   says. So the planner subagent runs no `git fetch origin` before this start.
3. Judge each finding of the review under [The new-finding rule](#the-new-finding-rule), and add it to the record file.
4. Follow [The count of reviews](#the-count-of-reviews) for the next step. The next step is an approval, a new
   issue-draft subagent with the findings, or the user.
5. After the approval of a draft of an issue, start one issue-post subagent for the draft. For a draft of a comment, do
   not wait. The draft goes in the result with a question of the kind "a comment on an issue", as
   [The count of reviews](#the-count-of-reviews) says. The new planner subagent that gets the approval of the user as
   its answer, as change 6 says, starts one issue-post subagent with the facts of a comment post, as
   [The prompt of an issue subagent](#the-prompt-of-an-issue-subagent) gives them. It fills `APPROVAL` and
   `APPROVED_TEXT`.

For one draft, at most one subagent of the three kinds runs at a time. The reason: each step reads the draft file that
the step before it wrote.

A planner subagent runs at most one issue-post subagent at a time. The reason: a later post of one chain needs the issue
key of the earlier post for its blocked-by link.

Before it starts an issue-post subagent, the planner subagent decides each blocked-by link of the draft. The links
between drafts that are not posted yet come from its table of the needs and the likely files, as today.

The planner subagent starts no issue-post subagent for a draft that is not approved or that waits for a decision of the
user.

### The count of reviews

A draft gets at most 3 reviews. The count starts at 1 for the first review of the draft.

The count starts at 1 again for a change of the draft from an answer of the user or from a settled answer. It also
starts at 1 again for the change of a draft into a change of an open issue after the duplicate search. It also starts at
1 again for the change of a match draft for an item with a match, as [An item with a match](#an-item-with-a-match) says.
The planner subagent adds a line `Count starts again: <reason>` to the record file.

A review counts only with a report. A second issue-review subagent for the same review adds no review to the count.

A review with no new finding approves the draft. An answer of the user that accepts the draft with no change also
approves it, as the bullet of [the escape hatch](planner.md#the-escape-hatch) that starts "If the answer accepts the
draft with no change" says. A draft of a comment also needs the approval of the user. No other event approves a draft. A
settled answer never approves a draft. A settled answer that leaves the draft unchanged only removes that reason for the
wait.

A review 1 or 2 with a new finding leads to a new issue-draft subagent. Its prompt gives the new findings of the review.
Then the next review runs. This also holds for an issue-draft subagent that dismissed each new finding and changed
nothing.

The issue-draft subagent changes the draft or dismisses each finding of its prompt with a one-line reason, as
[The findings and the edge cases](issue-draft.md#the-findings-and-the-edge-cases) says. Its result through
`SubagentHandback` gives each dismissal with its reason. The planner subagent adds each such dismissal to the record
file.

Before an answer of the user, only a review with no new finding approves a draft.

After a review 3 with a new finding, the draft is not approved. The new findings of review 3 are the remaining findings
of the draft. The planner subagent judges the findings of review 3 itself. It starts no issue-draft subagent and no
issue-post subagent after review 3.

Such a draft waits for a decision of the user. The result of the planner subagent gives the path of the draft file and
the remaining findings of the draft, as [The result](#the-result) says. It also gives the question about the remaining
findings, as [A draft that needs the user](#a-draft-that-needs-the-user) says.

A changed match draft can wait only for the question about the remaining findings. In this case, no other question of
the draft is open, and no answer of the draft waits in a proposal file. The state of the match in the prompt gives these
facts. The count starts again for the change, and one of two cases follows.

- If a review has no new finding, it approves the draft. The planner subagent starts the issue-post subagent. Its result
  says that the question about the remaining findings is moot, with the question id.
- If a review has a new finding, nothing posts. The steps of this section hold: a new issue-draft subagent after review
  1 or 2, and the remaining findings after review 3. The draft keeps its open question. The new findings go in the
  result as a new question, as [A draft that needs the user](#a-draft-that-needs-the-user) says.

A finding of one of the six kinds that the next paragraph names still sends the draft to the escape hatch. In each other
case, a changed match draft posts nothing.

The work on the draft can leave a finding of one of the six kinds of
[A draft that needs the user](#a-draft-that-needs-the-user) open. The draft is then a draft of that kind. That finding
still sends the draft to the escape hatch, also for an approved draft. Keep 1 and keep 5 give this step.

A draft of a comment that the reviews approve waits for the approval of the user. The result gives the path of its draft
file. It also gives a question of the kind "a comment on an issue" with the exact text of the comment. Change 9 and the
paragraph after "The changed rules" that starts "For a planner subagent, change 9 wins over two sentences" give this
approval. The new planner subagent that gets the answer starts the issue-post subagent for the comment, not the planner
subagent that wrote the result. The prompt of the new planner subagent gives the words of the approval of the user with
its date and source, and the approved text, as [The result](#the-result) says for an answer. The approval of the planner
subagent never counts as the word of the user. Change 6 and change 9 give the post after the approval of the user.

### The new-finding rule

A finding is not new in two cases. An earlier review of the same draft reported it. Or the planner subagent or an
issue-draft subagent of the same draft dismissed it earlier, with a reason. Each other finding is new.

The planner subagent is the judge of this rule. It decides whether two findings are the same. This judgment is open on
purpose. An issue-review subagent writes no file, as
[The bans of an issue-review subagent](issue-review.md#the-bans-of-an-issue-review-subagent) says. So the report of each
review comes to the planner subagent as the message of its `SubagentHandback` call, and the judgment needs no other
subagent. The cost: the full text of each review and of the record file fills the context of the planner subagent.

An issue-review subagent does not judge whether a finding is new. Its prompt gives no earlier finding.

After a change of the draft from an answer of the user, from a settled answer or from an item with a match, each review
and each dismissal of the draft before the change still counts. The record file keeps them. The reason: the result of
the planner subagent already showed the user each dismissed finding, as The result says. The cost: a finding that the
change of the user makes true again is not new, so no later review stops the post for it.

### The record file

The planner subagent keeps a record of each finding of each review of a draft. It also records each dismissal with its
reason: its own dismissals and each dismissal of the result of an issue-draft subagent. The record file is next to the
draft file, in the folder of [The prompt](#the-prompt) or in the old folder.

The name is `<file>.findings.md` next to the draft file `<file>.md`. The name of a record file is never the name of a
draft file. The reason: a draft file name has only lowercase letters, digits and `-`, as
[The issue subagents of a planner](planner.md#the-issue-subagents-of-a-planner) says. So no draft file name holds a `.`
before `.md`.

The record file has one Markdown list item for each finding. Each item gives these facts:

- The number of the review.
- The place in the draft.
- The text of the finding.
- The judgment: `new`, `not new: <earlier item>` or `dismissed by <actor>: <one-line reason>`.

A line `Count starts again: <reason>` marks a start again of the count. The earlier items stay.

The planner subagent reads the record file before its first judgment of a finding of the draft. Examples are the planner
subagent of an answer of the user and the planner subagent of a late report. Before the first review of a draft, a
missing record file counts as an empty record, not as a failed read.

The reason: a new planner subagent starts with no context of an earlier planner subagent, as [The start](#the-start)
says. A new issue-draft subagent also starts with no context.

If a read or a write of the record file fails, the failure rule applies to the planner subagent. It then starts no
review and no issue-post subagent for the draft. Its result says so, and the draft waits for a decision of the user.

### A missing draft file

A draft file can be missing, also after a reboot that cleared the old folder. The steps hold for a draft file in either
folder. The failure rule does not apply to a missing draft file, and no bar starts.

- Before it starts the first issue subagent of an answer, the planner subagent reads the draft file of the answer.
- If the file is missing and the next step is an issue-draft subagent, the planner subagent still starts it.
- If the file is missing and the next step is a post, it starts no issue-post subagent. A post is next for the answer
  "post the draft as it stands" and for an approved comment. Then the result gives the path and the fact that the file
  is missing, and the draft waits for a decision of the user.

The issue-draft subagent of the answer can write a new draft at the same path, as
[issue-draft.md](issue-draft.md#a-missing-draft-file) says. If it writes one, its report says that the draft file was
missing. Only then does the planner subagent start the count of reviews again, with the line
`Count starts again: draft file missing` in the record file. A missing record file of such a draft counts as an empty
record, as [The record file](#the-record-file) says. If it writes no draft, its result gives the path and the error, and
the planner subagent starts no review and no post. The draft waits for a decision of the user.

An issue-post subagent that finds no draft file posts nothing, as [issue-post.md](issue-post.md#a-missing-draft-file)
says.

### A failed call on a file of a draft

A call on a file of a draft can fail or get a denial. The files are the draft file, the report file, the record file and
the body file. The result of each issue subagent gives the command, the path and the error. After a denial, the result
keeps the exact call and the exact text of [the tool-block rule](tasker-commands.md#the-tool-block-rule).

After such a result, the planner subagent starts no other subagent for that draft. Its own result gives the same facts,
and the draft waits for a decision of the user. A failed call on a file of `drafts/` also starts the bar of
[the orchestrator folder](limits.md#the-orchestrator-folder), when it reaches the orchestrator.

Two cases are exceptions. A missing draft file follows [A missing draft file](#a-missing-draft-file). A failed size
count follows its own rule in [issue-draft.md](issue-draft.md) and [issue-post.md](issue-post.md), and starts no bar.

### The start of an issue subagent

The planner subagent starts each subagent of the three kinds with the Agent tool. The type is not `fork`, because a fork
gets the context of its parent.

The type holds the tools of the kind: the Write tool for an issue-draft subagent and an issue-post subagent, and Bash
and the Read tool for each kind. Step 2 of [the doc-read rule](doc-reads.md#the-doc-read-rule) reads each doc with the
Read tool. The type is `general-purpose`. On 2026-11-19, with Claude Code 2.1.329, the list of the subagent types gave
"Tools: \*" for `general-purpose`.

The planner subagent gives each subagent a name with the `name` option of the Agent tool. Each name is new in the
session of the orchestrator, except after a compaction, as the known limits of
[The count of planner subagents](#the-count-of-planner-subagents) say. Each name has at most 64 characters. The form is
`<planner subagent name>-<kind>-<file>-<count>`. `<kind>` is `draft`, `review` or `post`. `<file>` is the draft file
name without `.md`. `<count>` counts the starts of that kind for that draft file in that planner subagent, from 1. An
example is `plan-4-review-plan-4-terms-1`.

With a count below 100, a name has at most 47 characters. A planner subagent name has at most 12 characters, as
[The name](#the-name) says. A draft file name has at most 24, as
[The issue subagents of a planner](planner.md#the-issue-subagents-of-a-planner) says.

The orchestrator reads the entries `issue-draft`, `issue-review` and `issue-post` under `sessions.models` in step 1 of
[The start](#the-start). The prompt of the planner subagent gives the three entries.

After a failed read, the orchestrator follows step 2 of The start. Then, and for a key with no entry, the prompt says
that the key has no entry. Before each start, the planner subagent takes the entry of the kind from its prompt. For no
entry, it passes no `model` and no `effort`. For an entry, it passes the `effort` of the entry and the `model` of the
map of [The model of the start](#the-model-of-the-start). That map also covers these three keys.

The chain of a planner subagent has two layers below the orchestrator: the planner subagent and one subagent of the
three kinds. No chain needs a third layer. These records show chains of two layers:

- The paragraph of [The issue subagents of a planner](planner.md#the-issue-subagents-of-a-planner) that starts "The fact
  of the first sentence". On 2026-11-04, planner-m16-ticket-name-option-1, a subagent of planner-m16, started a
  subagent, and its report came back.
- The paragraph of [run-one-ticket.md](run-one-ticket.md) that starts "If the proof shows no changed word", with the
  paragraph "A split read of this form". On #506, a task subagent ran six parallel subagents.
- [The chain of subagents](#the-chain-of-subagents) of this page. On 2026-11-21, Claude Code 2.1.330 ran it once.

On 2026-11-21, no record of the docs gave a test of a third layer.

One planner subagent runs at most one subagent of the three kinds at a time. The next step of each draft waits for the
result of the subagent that runs. These are the reasons:

- No record of the docs gives a tested limit of Claude Code on the count of subagents in one session.
- With at most `maxPlannerSubagents` planner subagents, as many subagents of the three kinds run in the session of the
  orchestrator. Each planner subagent that a late report starts again can add one more. So the count stays known and
  small.
- Each subagent of the three kinds pulls the local clone at its start, as The read rule says. So fewer pulls start at
  the same moment, and fewer reads are slow.

On 2026-11-21, with git 2.47.3, two pulls ran at the same moment in one clone 11 times.
[Step 1: pull the local clone](doc-reads.md#step-1-pull-the-local-clone) records the result. A clash costs a slower read
and a note of the failure, and no draft is lost.

The cost: an item of planning work with more than one draft works on its drafts one after the other, so the item takes
longer.

### The prompt of an issue subagent

Each prompt gives these facts:

1. The path of the document of its kind and the path of [issue-subagents.md](issue-subagents.md).
2. The path of the draft file, in the folder of [The prompt](#the-prompt).
3. The name of the subagent.
4. The ask for the result through `SubagentHandback`.
5. The facts of a start prompt, as [The start prompts](doc-reads.md#the-start-prompts) says.

The prompt of an issue-draft subagent also gives these facts:

- The source of the draft word for word, with its sender, its date and the source of each fact.
- The milestone of the draft and each decision of the user on the draft.
- Each question of the draft and each answer and its source. The source is the words of the user or the reason of a
  settled answer. The draft never records a settled answer as a decision or as a word of the user.
- For a change of an open issue, the issue key and the start hash, or the fact that no start hash exists.
- For a comment, the key of the repo, the key of the issue that gets the comment, the kind of the draft and the kind of
  the comment. Each fact of the comment stands in the source, with its own source. The placeholders are `DRAFT_KIND`,
  `REPO_KEY` and `COMMENT_KIND`.
- For a draft after a review, the new findings of that review. The planner subagent judged them. The prompt names no
  record file, and the issue-draft subagent does not judge whether a finding is new.
- The simple-english skill, for the self-check of the document of its kind.

The prompt of an issue-review subagent also gives the source of the draft word for word. It gives the list of
[The bans of an issue-review subagent](issue-review.md#the-bans-of-an-issue-review-subagent), word for word, as keep 1
says. For a comment, it also gives the repo key, the issue key and the kind of the draft, in the placeholders
`DRAFT_KIND`, `REPO_KEY` and `ISSUE_KEY`. It gives no opinion of the planner subagent about the draft, no earlier
finding and no dismissal.

The prompt of an issue-post subagent also gives these facts:

- The repo key and the kind of the post. The kind is a new issue, a new title or body of an open issue, the end of the
  post of an existing issue, or a comment.
- For a new issue, its milestone and each label.
- For a change of an open issue, the issue key and the start hash.
- Each blocked-by link of the draft, with the blocked issue, the blocker and the reason.
- For the end of the post of an existing issue, the key of that issue.
- For a comment post, the prompt also gives the issue key, the approval of the user and the approved text, in the
  placeholders `APPROVAL` and `APPROVED_TEXT`. The milestone, the labels and the links are `none`.

The words of these prompts stand in three files: [`issue-draft.md`](../../prompt-templates/planner/issue-draft.md),
[`issue-review.md`](../../prompt-templates/planner/issue-review.md) and
[`issue-post.md`](../../prompt-templates/planner/issue-post.md), in `prompt-templates/planner/`. The planner subagent
reads each file as [the doc-read rule](doc-reads.md#the-doc-read-rule) says, and fills each placeholder. The placeholder
`RULE_DOCS` holds the two paths of item 1. A template file is not a rule document. For a comment, the key goes in the
issue key. The planner subagent also reads the section "The bans of an issue-review subagent" and fills the placeholder
`REVIEW_BANS` with all the text of that section, after the heading line and up to the next heading. An absent fact has
the value `none`.

The model and the effort go in the Agent call, not in the prompt.

### The wait for an issue subagent

The planner subagent is the starter of each subagent of the three kinds, as
[The wait for a report](planner.md#the-wait-for-a-report) defines a starter. It judges the end of each one by the kinds
of notification of that subsection. It ends its turn during the wait as step 2 of The wait for a report says.

If a subagent of the three kinds ends with no report, [the failure rule](limits.md#the-failure-rule) applies to the
planner subagent. It starts one new subagent of the same kind for the same step. A refused Agent call is an end with no
report. If the second subagent also ends with no report, the planner subagent posts nothing for the draft. Its result
says so, with the kind and the step, and the draft waits for a decision of the user.

A second issue-post subagent runs the duplicate search before its post, as [issue-post.md](issue-post.md) says. For a
match, it posts nothing, and its result follows item 2 of
[The result of an issue-post subagent](issue-post.md#the-result-of-an-issue-post-subagent).

The planner subagent judges each match from that result. A match with the same body as the draft is the first post. For
the first post, the planner subagent does no step of a match, and the draft does not change. It starts one issue-post
subagent for the compare and the links of that issue, with the prompt above. The rule for the end of such a post is in
[The steps of a post](issue-post.md#the-steps-of-a-post). If the compare of a match failed, the planner subagent posts
nothing for the draft. Its result says so, and the draft waits for a decision of the user.

For a match of a comment post, the planner subagent gives the match in its own result, with the `url` that the
issue-post subagent gave. It starts no new comment post, because the same comment is already on the issue.

An extra report is a report of the first issue-review subagent of a review after the start of the second one. Its
findings join that review, and they add no review to the count. An extra report can come after the judgment of the
findings of its review. Its findings then go to the next judgment of the draft, with the findings of the next review. If
no next review of the draft runs, the planner subagent judges its findings before its result.

A late report is a report of a subagent of the three kinds after the result of the planner subagent. It starts the
planner subagent again, as [The life of a planner subagent](#the-life-of-a-planner-subagent) says. No one tested this
start for a subagent of the three kinds. The planner subagent handles a late report by its kind:

- An issue-review subagent: apply [The new-finding rule](#the-new-finding-rule) to each finding. With no new finding,
  change nothing, and the second result says so. For a new finding, the late-report list of "The wait for a report"
  holds, with change 4.
- An issue-draft subagent: start no review and no post for that report. If the draft waits for a decision of the user,
  the second result gives the path of the draft file and the report, and the draft keeps its wait. For a posted draft,
  the second result names the report and changes nothing. For a dropped draft, the planner subagent drops the report
  too.
- An issue-post subagent: the issue of the report exists. The second result gives its key and its URL, and says whether
  the post is complete. If the first result named no post, the second result also says so. The planner subagent starts
  no new post for the draft.

### The other sessions

An orchestrator of a kind other than `claude` starts no planner subagent, as "The kind of the orchestrator" says. So a
Codex orchestrator and a pi orchestrator start no subagent of the three kinds.

A planner session of the kind `claude` and the main session of an ad hoc draft also start issue subagents, as
[The issue subagents of a planner](planner.md#the-issue-subagents-of-a-planner) says.

## The life of a planner subagent

A planner subagent ends after its result. The orchestrator is the starter of
[The wait for a report](planner.md#the-wait-for-a-report) for it. The orchestrator judges the end by the kinds of
notification of that subsection. A wait notification does not end the wait. The result ends it. In a handoff, a word of
the user can also end it, as [The wait before a handoff](#the-wait-before-a-handoff) says.

If a planner subagent ends with no report, [the failure rule](limits.md#the-failure-rule) applies to the orchestrator.
The orchestrator then starts one new planner subagent for the same item of planning work, after the compare of
[The wait for a busy path](#the-wait-for-a-busy-path). If that one also ends with no report, the orchestrator tells the
user. The proposal file of the item stays, as [The proposal file](#the-proposal-file) says.

A late report of an issue subagent can start an ended planner subagent again. The orchestrator handles the second result
of the planner subagent as a result. The second result deletes no proposal file, because no file names its sender.

### The wait before a handoff

A planner subagent runs inside the session of the orchestrator. This wait is a part of step 4 of
[The steps of the old orchestrator](handoff-orchestrator.md#the-steps-of-the-old-orchestrator), after the send, as
[The wait before the handoff file](handoff-orchestrator.md#the-wait-before-the-handoff-file) says. So an old
orchestrator does these steps before it writes its handoff file:

1. Wait for the result of each planner subagent that runs. This includes the planner subagents of the items of planning
   work of the facts and lessons of [The items of a handoff file](handoff.md#the-items-of-a-handoff-file).
2. Start the planner subagents of the items of planning work that wait, as [The proposal file](#the-proposal-file) says.
   Up to `maxPlannerSubagents` run at the same time, and they start in the order of their numbers. This includes the
   items of the facts and lessons of [The items of a handoff file](handoff.md#the-items-of-a-handoff-file). Wait for the
   result of each one.

A planning request can arrive after step 2 started each item of planning work that waited, for example a fact or a
lesson of a late report. Then the wait runs again for the items of that request.

The old orchestrator writes its handoff file only after the result of the last planner subagent. The wait for one
planner subagent can also end in the other ways that
[The end of the wait for one subagent](handoff-orchestrator.md#the-end-of-the-wait-for-one-subagent) gives.

If a planner subagent sends no report and gets no end notification, only a word of the user ends the wait for it. The
steps of [The end of the wait for one subagent](handoff-orchestrator.md#the-end-of-the-wait-for-one-subagent) hold. For
a planner subagent, these rules also hold:

- Its proposal file stays. The planner wait starts no planner subagent from that file. The new orchestrator finds the
  file at its start and can start a planner subagent for the same item of planning work.
- Its state for the wait is ended, as [The terms of the wait](handoff-orchestrator.md#the-terms-of-the-wait) say. It
  holds no place in the count of [The count of planner subagents](#the-count-of-planner-subagents). The reason: its
  report can never come, so a place that it holds can stop the planner wait for good.
- A result of it after the write of the handoff file deletes no proposal file. It reaches only the tab of the old
  orchestrator. The reason: the new orchestrator can already run a planner subagent from that file.

This end has two known limits. The old and the new planner subagent can post the same issue. They can also overwrite one
draft file and its record file, in the same session or in a later session with the same own name.

A file that a stop of the queue holds stays in `proposals/`. Step 2 starts no planner subagent from it. The new
orchestrator finds it at the end of its start steps.

## The chain of subagents

On 2026-11-21, with Claude Code 2.1.330, a measure ran a chain of subagents below a top-level session. The subagent
`chain-1` started the subagent `chain-2` with the Agent tool, and the call had no error. `chain-2` replied "OK". The
measure was one run, and `chain-1` reported it. So a subagent can start a subagent, and a planner subagent can start its
issue subagents.
