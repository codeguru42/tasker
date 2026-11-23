# Planner subagent

This page gives the rules for a [planner subagent](GLOSSARY.md). The readers of this page are the orchestrator of the
kind `claude` and each planner subagent.

A planner subagent turns one planning request into issues. For this work, it starts an
[issue-draft subagent](GLOSSARY.md), an [issue-review subagent](GLOSSARY.md) and an [issue-post subagent](GLOSSARY.md),
as the work needs. An issue subagent on this page is one of these subagents. A planner subagent starts no
[ticket subagent](GLOSSARY.md) and no review agent.

## Terms

- A planning request is one piece of work that the docs send to the planner of the orchestrator.
  [The planning requests](#the-planning-requests) gives the sends.
- The result of a planner subagent is the text of its `SubagentHandback` call.
- The metadata of an issue is its milestone, its labels, its state, its board column and its priority. A blocked-by link
  is not metadata on this page.
- A kept rule is a rule of the docs that the planner subagent follows. [The kept rules](#the-kept-rules) gives them.
- On this page, keep N is item N of The kept rules. Change N is item N of [The changed rules](#the-changed-rules). Drop
  N is item N of [The dropped rules](#the-dropped-rules).

## The kind of the orchestrator

Only an orchestrator of the kind `claude` starts a planner subagent. An orchestrator of another kind sends each planning
request to `planner-<slug>`, as the planner bullet of
[The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) says. For the kind `pi`, the reason
is that the measured pi sessions had only the tool `bash`. See
[The seam of an agent kind](../config.md#the-seam-of-an-agent-kind). A Codex orchestrator has native subagent tools, but
no one measured its start of a planner subagent.

## The planning requests

Each send of the docs to the planner of the orchestrator is a planning request. These rules give such a send:

- The planner bullet of [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent), and each
  rule that sends work to the planner as that bullet says.
- [The capture and the next step](quota.md#the-capture-and-the-next-step) of quota.md.
- The paragraph of [The items of a handoff file](handoff.md#the-items-of-a-handoff-file) about an old orchestrator.
- Step 1 of [The steps of the old operator](handoff-operator.md#the-steps-of-the-old-operator), for the findings of the
  orchestrator.
- Each relay, request, open finding, accepted proposal and recurrence that a
  [question pane](question-pane.md#a-question-pane) sends to the planner of the orchestrator.

For each planning request, the orchestrator of the kind `claude` starts a planner subagent, in place of a message to
`planner-<slug>`. The [follow-up planner](planner.md#the-initial-planner-and-the-follow-up-planner) gets no planning
request of such an orchestrator. Each other rule of the follow-up planner stays.

## The start

Only the orchestrator starts a planner subagent. A task subagent, a question session, an operator, a planner and a
planner subagent start none.

The orchestrator starts a new planner subagent for each planning request. It sends no planning request to a planner
subagent that runs or that ended. The reason: a message to an ended subagent starts it again, as
[the answer-wait rule](limits.md#the-answer-wait-rule) says. A new start gives each request a new context.

At most one planner subagent of an orchestrator runs at a time. A new request waits in its
[proposal file](#the-proposal-file) for the result of the planner subagent that runs. Then the orchestrator starts the
planner subagent of the next request, in the order of arrival. This choice holds until the user changes it.

The cost of this choice: a request waits for each draft, review and post of the requests before it. A request that waits
stays in its proposal file through a compaction of the context of the orchestrator. The follow-up planner of a milestone
can post at the same time. Its draft folder differs from the folder of [The prompt](#the-prompt), so the file names do
not collide.

The orchestrator does these steps for each start:

1. Run `tasker show-config --repo <key>` and read the entry `sessions.models.planner`. See
   [`sessions`](../config.md#sessions).
2. If the read fails, follow [the failure rule](limits.md#the-failure-rule). Then pass no `model` and no `effort`.
3. If the read gives no entry, pass no `model` and no `effort`.
4. If the read gives an entry, pass the `effort` of the entry. Pass the `model` of
   [The model of the start](#the-model-of-the-start).
5. Pass the subagent type `general-purpose`. Never pass the type `fork`.
6. Pass the name of [The name](#the-name) with the `name` option of the Agent tool.
7. Pass the prompt of [The prompt](#the-prompt).

A subagent of the type `fork` gets the context of the orchestrator. On 2026-11-19, with Claude Code 2.1.329, the list of
the subagent types gave "Tools: \*" for `general-purpose`. So its tool list holds the Agent tool.

If the Agent call fails, the start failed. A refused Agent call is also a failed start. A failed start counts as a
failed `SendMessage` of the planner bullet, and the step of that bullet for a failed send holds.

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

The orchestrator names each planner subagent `plan-<count>`. `<count>` counts the planner subagents of the session of
the orchestrator, from 1. An example is `plan-1`. Each name is new in the session of the orchestrator. A name has at
most 12 characters, of lowercase letters, digits and `-`.

The name of each issue subagent of a planner subagent starts with the name of the planner subagent and `-`. #973 gives
the rules of these names. The Agent tool refuses a name of more than 64 characters, as
[The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) says. The limit of 12 characters
keeps room for the rest of each such name.

### The proposal file

A proposal file is the file `proposals/<number>.md` in the [orchestrator folder](limits.md#the-orchestrator-folder), for
one planning request. Only an orchestrator of the kind `claude` queues planning requests and writes proposal files. An
orchestrator of another kind sends each request at once and writes no proposal file. The orchestrator folder gives the
reads, the calls and the fallback for this folder.

Each planning request gets a proposal file at its arrival. This also covers a request whose planner subagent starts at
once. The reason: the file stays until the result, so a compaction during the run of the planner subagent loses no
request.

Before the write, the orchestrator lists `proposals/` with `ls`. `<number>` is 1 more than the highest number that
`proposals/` holds or that the orchestrator gave in its session. If neither holds a number, `<number>` is 1. So the
orchestrator never uses a proposal number again in one session, and the order of the numbers is the order of arrival.
For example, `proposals/` holds no file, and the orchestrator gave the number 4 earlier in its session. Then the next
request gets `proposals/5.md`.

The proposal file holds each fact of [The prompt](#the-prompt) that comes from the request. These facts are the request
word for word, its sender, its date and the source of each fact. A request can come from an answer of the user. Then the
file also holds the path of the draft file, the question and the words of the user word for word. The file stands alone,
as a [question file](question-pane.md#the-question-file) does.

When no planner subagent runs, the orchestrator lists `proposals/`. It reads the file with the lowest number, builds the
prompt from it and starts the planner subagent. It does this at the arrival of a request, after the result of a planner
subagent and at the end of its start steps. At a start with no handoff file,
[A stop with no handoff](../orchestrator.md#a-stop-with-no-handoff) gives the steps. While the bar of the fallback
holds, the orchestrator takes the next request that waits in its session in place of a file.

Before the start of a planner subagent, the orchestrator writes the name of that planner subagent into its proposal
file. The name is `plan-<count>` of [The name](#the-name). The file holds the tie of the request and the planner
subagent, so the tie stays through a compaction. If the write of the name fails, the orchestrator starts no planner
subagent from that file until the next word of the user.

At a result, the orchestrator deletes only the proposal file that names the sender of the result. A result whose sender
no file names deletes nothing, for example a second result of the same planner subagent. A result through `SendMessage`
after a refused `SubagentHandback` call is also a result. If the delete fails, the file stays, and the orchestrator
tells the user the path of the file. It does not count that file as a waiting request in its session, and the fallback
also applies.

These two cases stop the queue:

- The start fails. [The failure rule](limits.md#the-failure-rule) applies, and the orchestrator keeps the file. A failed
  start still counts as a failed send of the planner bullet, as [The start](#the-start) says.
- The planner subagent and its one restart both end with no report. The orchestrator tells the user and keeps the file.

After each of these cases, the orchestrator starts no planner subagent until the next word of the user. The reason: the
next list gives the same file again. The user decides.

A file can still stay in `proposals/` at the write of the handoff file, for example a kept file of a failed start. Such
a file stays in the folder, and the new orchestrator finds it at the end of its start steps.

These known limits hold:

- After a compaction or a handoff, a request that a stop of the queue held can get a planner subagent again. This also
  holds for a request whose proposal file stayed after a failed delete.
- A planner subagent that runs again for a kept proposal file can post a duplicate issue on GitHub. Right before each
  post, the search of [Before a post](issues.md#before-a-post) looks for the same change in all the issues of the repo,
  open and closed. This search lowers the risk.

## The prompt

The prompt of a planner subagent gives these facts:

- The planning request word for word, with its sender and its date. The prompt names the source of each fact, as the
  source bullet of [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) says.
- The own name and the scope of the orchestrator.
- The folder of the draft files, `/tmp/tasker/<own name>/drafts/`, with the own name of the orchestrator. An example is
  `/tmp/tasker/orchestrator-m31/drafts/`.
- The name of the planner subagent.
- The docs to read: this page and [planner.md](planner.md). The planner subagent reads each other doc of a kept rule
  only for a step that needs it. It reads each doc with the commands of
  [the doc-read rule](doc-reads.md#the-doc-read-rule).
- The list of the planner subagent in [the allowed commands](allowed-commands.md#the-planner-subagent).
- The ask for the result through the tool `SubagentHandback`.

The reason for the folder: the follow-up planner of the slug writes its drafts to `/tmp/tasker/<slug>/drafts/`. A shared
folder can give two drafts one file name.

For a planning request of an answer of the user, the prompt also gives the path of the draft file and the question. It
gives the words of the user word for word.

## The result

The planner subagent asks the user nothing and tells the user nothing. It sends no item and no message to an operator.
This rule wins over each kept rule that sends a question of the planner to an operator.

The planner subagent returns one result to the orchestrator that started it, with `SubagentHandback`. It reports as a
task subagent reports to the orchestrator. A kept rule can say that the planner tells, asks or reports to the user, or
that it sends an item. For the planner subagent, the fact or the question goes in its result. An example is the report
after each post or drop of [The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner).

The result names each complete post. For a draft that waits for a decision of the user, the result gives the path of the
draft file and each question. It also gives each finding that the planner subagent dismissed. The result gives each
issue as its plain key, as [the issue-link rule](working-with-the-user.md#the-issue-link-rule) says for a message
between two sessions.

The planner subagent runs no round of `/session-review`. The reason: the skill deletes memory notes, as
[Limits](limits.md#limits) says for a task subagent. The result gives each lesson of the work of the planner subagent.

After a [refused `SubagentHandback` call](limits.md#the-answer-wait-rule), the planner subagent sends the same result to
the orchestrator with `SendMessage` and `to: "main"`. The first line of the message says that Claude Code refused the
`SubagentHandback` call. If this send also fails, the orchestrator gets no report. Then
[The life of a planner subagent](#the-life-of-a-planner-subagent) gives the steps of an end with no report.

The orchestrator handles a result in this way:

1. Show each report of the result as a progress report in the own tab. The intro of
   [orchestrator.md](../orchestrator.md) gives this form for each report.
2. Handle each lesson of the result as a lesson of a final report.
3. Ask each question of the result in the own [question pane](question-pane.md#a-question-pane), as an open question of
   the orchestrator. Each such question gets a [question file](question-pane.md#the-question-file).
4. Take each answer of the user to such a question as a new planning request.

The new planner subagent of such an answer follows change 6.

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

In each kept rule, "the planner", "each planner" and "the follow-up planner" also name the planner subagent. The lists
of this section, of The changed rules and of The dropped rules win over each rule that they name. If two items name one
rule, the drop list wins, and then the change list. A named section means only its text before its first subsection.
Each subsection has its own item.

The planner subagent keeps these rules:

1. The text of [The ticket subagent](planner.md#the-ticket-subagent) and of
   [The review loop of a draft](planner.md#the-review-loop-of-a-draft) before their first subsections. This includes the
   judgment of a drop of a lesson or a proposed issue. Also
   [The bans of a review agent](planner.md#the-bans-of-a-review-agent). Each issue-review subagent gets these bans, and
   #973 gives its prompt. Change 3, change 5, change 6, change 7 and drop 8 leave out parts of these rules. Change 8
   gives their actors.
2. [The wait for a report](planner.md#the-wait-for-a-report). The planner subagent is the starter of each of its issue
   subagents. Change 4 changes one bullet of a late report.
3. The first two paragraphs of [The state of the user](planner.md#the-state-of-the-user): the ban, and the measure as an
   open question of the report.
4. These parts of [The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner): the post with no
   approval of the user, the duplicate search and the match of a closed issue. Also the drop with no approval of the
   user and the steps of a complete post. After a complete post, the planner subagent sends no message to an
   orchestrator. An orchestrator of another scope finds the change at its next read of the board.
5. The list of decisions of [The escape hatch](planner.md#the-escape-hatch), and its last sentence "Each planner goes on
   with the other drafts". Also its sentence that starts "An edge case that a ticket subagent decided as "later"". The
   planner subagent posts nothing for a draft that waits for a decision of the user.
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
   metadata. Change 9 gives the actors of the recurrence comment.
10. The paragraph after the bullets of
    [The initial planner and the follow-up planner](planner.md#the-initial-planner-and-the-follow-up-planner) that
    starts "The reason for the folder". Change 7 gives the folder.
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

## The changed rules

The planner subagent changes these rules:

1. The source of the work. The planner subagent takes only the planning request of its prompt. The bullet of
   [The initial planner and the follow-up planner](planner.md#the-initial-planner-and-the-follow-up-planner) that starts
   "The follow-up planner takes lessons" does not hold for it.
2. Each report, question, item and draft for the user goes in the result, as [The result](#the-result) says. One such
   place is the bullet that starts "The follow-up planner sends each question". Another is the third paragraph of
   [The state of the user](planner.md#the-state-of-the-user). Another is the paragraph of
   [The escape hatch](planner.md#the-escape-hatch) that starts "For a draft that waits for such a decision". Others are
   the report after each post or drop and the tell of the sender in The post of the follow-up planner. The bullets of
   [The blocked-by links](issue-subagents.md#the-blocked-by-links) that name the chat with the user are also such
   places.
3. The names. The names of a ticket subagent and of a review agent in The ticket subagent do not hold for the planner
   subagent. [The name](#the-name) gives the names of its issue subagents.
4. In The wait for a report, the bullet of a late report that starts "If the draft waits for a decision of the user".
   The planner subagent does not wait for the answer. It gives the findings of the late report in its result.
5. The prompt of a ticket subagent in The ticket subagent does not hold for the planner subagent. #973 gives the prompt
   of each issue subagent. At its start, an issue subagent reads only the documents of
   [The read rule](issue-subagents.md#the-read-rule).
6. The steps with an answer of the user. They hold for the new planner subagent that gets the answer, as The result
   says. One such step is in the bullet of The initial planner and the follow-up planner. That bullet starts "For a
   draft that waits for a decision of the user". So do the outcome bullets of The state of the user, after "The answer
   of the user has one of these outcomes". So do the bullets of The escape hatch that start "If the answer", and its
   bullet that starts "The user can say". The paragraph of The ticket subagent that starts "A change of the draft after
   a report" also gives such a step. The post of a comment after the approval of the user is such a step too, and change
   9 gives its actor.
7. The folder of the draft files is the folder of [The prompt](#the-prompt). The bullet that starts "The ticket subagent
   of each planner writes each draft" gives the folder of the slug. Step 1 of The review loop of a draft also gives it.
   Neither folder holds for the planner subagent.
8. The actors of the work on a draft. The planner subagent starts the issue-draft subagent, the issue-review subagent
   and the issue-post subagent with the Agent tool, as the work needs. It starts no ticket subagent and no review agent.
   Each start of an agent and each wait for a report in the kept rules is a step of the planner subagent. #973 gives the
   start rules of the issue subagents and the actor of each other step of the kept rules.
9. The actors of a comment on an issue. This change covers the comment of the comment rule of keep 7 and the recurrence
   comment of A recurrence. An issue-draft subagent drafts the comment, and an issue-review subagent reviews it. An
   issue-post subagent posts it after the review passes and the user approves it. The planner subagent posts no comment
   itself. If #973 makes a comment a write of the planner subagent, this change wins.

For a planner subagent, change 9 wins over two sentences. They are in keep 1 and keep 6. Each says that a comment on an
issue is not a draft of The review loop of a draft. For a planner subagent, these sentences mean only that a comment
needs the approval of the user.

After a tool block, the planner subagent follows [the tool-block rule](tasker-commands.md#the-tool-block-rule). The
result of an issue-post subagent gives the exact command, the folder and the exact text of a denial. The planner
subagent gives these facts in its own result.

## The dropped rules

The planner subagent drops these rules:

1. [The close duties of the follow-up planner](planner.md#the-close-duties-of-the-follow-up-planner), the bullet that
   starts "At the end of a milestone, the follow-up planner", and [Milestones](issues.md#milestones). This includes the
   milestone guard of [The steps that end each role](operator-start.md#the-steps-that-end-each-role).
2. The handoff: each rule of [handoff-planner.md](handoff-planner.md), with the post count, and the handoff bullet of
   Working with the user.
3. The name `planner-<slug>` and the start by the operator. The bullet of Working with the user that starts "The
   operator names each planner" gives them. The first two paragraphs of The initial planner and the follow-up planner
   also give them.
4. The table of milestones of Working with the user, and the first bullet of The order of the work.
5. The question about the kinds of GitHub objects, in the third bullet of The order of the work. The planner subagent
   writes only the text of issues, as [No metadata](#no-metadata) says.
6. The rounds of `/session-review`, as The result says.
7. The denial records of [planner.md](../planner.md) and [The denial records](tasker-commands.md#the-denial-records).
   They need a word of the user.
8. Each rule only for the initial planner or the ad hoc planner. Examples are
   [The initial planner](planner.md#the-initial-planner), the bullet that starts "A milestone can need manual steps" and
   the ad hoc name.
9. Each change of metadata, as No metadata says.
10. The start docs of [planner.md](../planner.md). The prompt names the reads, as The prompt says.
11. A wait for an answer of the user. The planner subagent ends with its result. Change 6 gives the steps with the
    answer.

## The issue subagents

These terms apply in this section. The three kinds are the issue-draft subagent, the issue-review subagent and the
issue-post subagent. A review is one run of an issue-review subagent over one version of a draft. A finding is one point
of a review that asks for a change. A dismissal is a decision to make no change for a finding, with a one-line reason.
The record file is the file of [The record file](#the-record-file). The remaining findings of the draft are the findings
that the planner subagent neither changed in the draft nor dismissed.

### The starter of an issue subagent

Only a planner subagent starts a subagent of the three kinds. It starts each one with the Agent tool, as the work on a
draft needs. No other session starts such a subagent. This holds for the orchestrator, the operator, a task subagent, a
question session, a planner and each issue subagent.

The planner subagent is the starter of each issue subagent that it starts. So it does each step of the kept rules that
names the starter of an agent. These steps include the wait for a report and the decision on each finding.

Change 9 names the actors of a comment on an issue. The planner subagent starts the issue-draft subagent, the
issue-review subagent and the issue-post subagent for such a comment. It posts no comment itself.

The subagent of the main session that posts a reviewed ad hoc draft is not an issue-post subagent of this page. The
bullet "A subagent of the main session posts a reviewed ad hoc draft" of
[working-with-the-user.md](working-with-the-user.md) gives its start. That start does not change.

### The order of the work on a draft

The planner subagent does these steps for each draft:

1. Start an issue-draft subagent. It writes the draft file and its report file.
2. Run `git fetch origin` in the local clone. Then start an issue-review subagent for the review of the draft.
3. Add each finding of the review to the record file, with its judgment, as [The record file](#the-record-file) says.
4. Decide on each finding. Change the draft with a new issue-draft subagent, or dismiss the finding with a one-line
   reason.
5. If the draft changed and [The count of reviews](#the-count-of-reviews) permits it, go to step 2.
6. Start an issue-post subagent. It posts the draft as it stands after the decisions on the last review.
7. Put the result of each step in the result of the planner subagent, as [The result](#the-result) says.

The planner subagent starts the next subagent of a draft only after the result of the earlier one. It reads no draft
file and no report file in its own context. It reads the record file.

### The count of reviews

A draft gets at most 3 reviews. The count starts at 1 for the first review of a draft.

A review with no new finding ends the work on the draft. A new finding that the planner subagent takes changes the
draft. If the count is below 3, one more review follows.

After review 3, the planner subagent starts no more review. It posts the draft as it stands after its decisions on the
findings of review 3. The draft includes each cut of length only of
[The size of a draft](issue-draft.md#the-size-of-a-draft).

The count starts again at 1 in two cases. The first case is a change of the draft from an answer of the user. The second
case is a change of the draft into a change of an open issue. The planner subagent adds a line
`Count starts again: <reason>` to the record file in each case. The earlier items stay.

A dismissal of an issue-draft subagent counts as a dismissal of the planner subagent. The issue-draft subagent gives
each dismissal with its reason in its result. The planner subagent adds each one to the record file. It reads no report
file.

If a finding of an escape-hatch kind is still not resolved after the last review, the draft goes to
[the escape hatch](planner.md#the-escape-hatch). The planner subagent posts nothing for that draft.

### The new-finding rule

If no earlier item of the record file states the same point about the same place of the draft, the finding is new. The
planner subagent judges this for each finding of a review.

A finding that is not new gets the judgment `not new: <earlier item>`. The planner subagent takes no new action for it.
It keeps the earlier decision.

A review with only findings that are not new counts as a review with no new finding. The work on the draft ends after
such a review.

A new finding gets the judgment `new`. The planner subagent then changes the draft or dismisses the finding.

The planner subagent also judges the finding of a review after a start again of the count. The earlier items of the
record file still count for this judgment.

### The record file

The record file keeps the findings and the judgments of one draft. Its name is `<file>.findings.md`. It stands in the
same folder as the draft file `<file>.md`.

A draft file name has only lowercase letters, digits and `-`. So no draft file name has a `.` before `.md`, and a record
file name is never a draft file name.

The record file has one Markdown list item for each finding. Each item gives these facts:

- The number of the review.
- The place in the draft.
- The text of the finding.
- The judgment: `new`, `not new: <earlier item>` or `dismissed by <actor>: <one-line reason>`.

Each dismissal of the result of an issue-draft subagent is also an item. The planner subagent is the only writer of the
record file. A line `Count starts again: <reason>` is also part of the file.

The planner subagent writes the record file in the folder of the draft files. It keeps the file until its result.

### The start of an issue subagent

The planner subagent starts each issue subagent with these values:

- The subagent type is `general-purpose`. It never passes the type `fork`. [The start](#the-start) gives the reason.
- The name is `<planner subagent name>-<kind>-<file>-<count>`. `<kind>` is `draft`, `review` or `post`. `<file>` is the
  draft file name without `.md`. `<count>` counts the starts of that kind for that draft file in that planner subagent,
  from 1. A second start after an end with no report also counts. An example is `plan-4-review-plan-4-terms-1`.
- The `model` and the `effort` come from the entries of the prompt. The key is `issue-draft`, `issue-review` or
  `issue-post`. If the prompt says that the key has no entry, the planner subagent passes no `model` and no `effort`.
- The map of [The model of the start](#the-model-of-the-start) also covers these three keys. The planner subagent maps a
  `model` value as that subsection says.

With a count below 100, a name has at most 47 characters. The Agent tool refuses a name of more than 64 characters.

The planner subagent starts at most one issue subagent for one draft at a time. It can run the work of different drafts
at the same time.

The start of a subagent below a subagent rests on these records. The chain of
[The chain of subagents](#the-chain-of-subagents) shows that a subagent can start a subagent.
[The ticket subagent](planner.md#the-ticket-subagent) and [run-one-ticket.md](run-one-ticket.md) give the earlier start
rules for a review agent. [The doc-read rule](doc-reads.md#the-doc-read-rule) and its
[Step 1: pull the local clone](doc-reads.md#step-1-pull-the-local-clone) give the read of a doc.

A failed start counts as an end with no report. If the start fails, the planner subagent puts the failure in its result.

### The prompt of an issue subagent

The prompt of an issue subagent gives these facts:

1. The kind of the subagent, and the document of its kind: [issue-draft.md](issue-draft.md),
   [issue-review.md](issue-review.md) or [issue-post.md](issue-post.md).
2. The path of the draft file, and of the record file where the kind needs it.
3. The source of the draft word for word, with its sender and its date. The prompt names the source of each fact.
4. The milestone of the draft and each decision of the user on the draft.
5. For an issue-review subagent, the tests of [the tests of a draft](issue-review.md#the-tests-of-a-draft) and the bans
   of [The bans of a review agent](planner.md#the-bans-of-a-review-agent), word for word. The prompt gives it no opinion
   of the planner subagent about the draft.
6. The ask for the result through the tool `SubagentHandback`.
7. The own name of the subagent, as [The start of an issue subagent](#the-start-of-an-issue-subagent) gives it.

An issue subagent reads only the documents of [The read rule](issue-subagents.md#the-read-rule) at its start. It loads a
doc that a link names only on demand, for a specific task that needs the doc.

### The wait for an issue subagent

The planner subagent follows [The wait for a report](planner.md#the-wait-for-a-report) for each issue subagent. It is
the starter of that wait.

1. A wait notification does not end the wait. The result of the subagent ends it.
2. If the issue subagent ends with no report, [the failure rule](limits.md#the-failure-rule) applies.
3. The planner subagent then starts one new subagent of the same kind for the same draft. The new start counts in
   `<count>`.
4. If that one also ends with no report, the planner subagent puts the failure in its result. It posts nothing for that
   draft.
5. The planner subagent starts the next subagent of a draft only after the result of the earlier one.
6. Before the post of an issue-post subagent, the planner subagent makes sure that the result of the last review is in
   the record file.
7. An issue-post subagent posts the body of the draft. Right after the post, it compares the body on GitHub with the
   body of the draft, as [Before a post](issues.md#before-a-post) and [issues.md](issues.md) say. Its result gives the
   compare.
8. The planner subagent reads the result of the issue-post subagent. It adds each fact for the user to its own result.
9. A result that names a tool block follows [the tool-block rule](tasker-commands.md#the-tool-block-rule).
10. A late report of an issue subagent can start an ended planner subagent again.
    [The life of a planner subagent](#the-life-of-a-planner-subagent) gives the steps. The second result deletes no
    proposal file.
11. The planner subagent ends only after the result of each issue subagent that it started.

### The other sessions

No other session changes because of this section. The follow-up planner keeps its ticket subagent and its review agent.
The task subagent, the operator and the question session start no issue subagent.

The ad hoc post subagent of the main session keeps its own start, as
[The starter of an issue subagent](#the-starter-of-an-issue-subagent) says. The orchestrator starts only the planner
subagent, as [The start](#the-start) says.

## The life of a planner subagent

A planner subagent ends after its result. The orchestrator is the starter of
[The wait for a report](planner.md#the-wait-for-a-report) for it. The orchestrator judges the end by the kinds of
notification of that subsection. A wait notification does not end the wait. The result ends it.

If a planner subagent ends with no report, [the failure rule](limits.md#the-failure-rule) applies to the orchestrator.
The orchestrator then starts one new planner subagent for the same request. If that one also ends with no report, the
orchestrator tells the user. The proposal file of the request stays, as [The proposal file](#the-proposal-file) says.

A late report of an issue subagent can start an ended planner subagent again. The wait for a report says this for a late
report of a review agent and its ticket subagent. The orchestrator handles the second result of the planner subagent as
a result. The second result deletes no proposal file, because no file names its sender.

### The wait before a handoff

A planner subagent runs inside the session of the orchestrator. So an old orchestrator does these steps before it writes
its handoff file:

1. Wait for the result of each planner subagent that runs. This includes the planner subagent of the facts and lessons
   of [The items of a handoff file](handoff.md#the-items-of-a-handoff-file).
2. Start a planner subagent for each request that waits, in turn, as [The start](#the-start) says. This includes the
   request of the facts and lessons of [The items of a handoff file](handoff.md#the-items-of-a-handoff-file). Take the
   requests from `proposals/`, in the order of their numbers. While the bar of the fallback holds, take the requests
   that wait in the session. Wait for the result of each one.

The old orchestrator writes its handoff file only after the result of the last planner subagent.

A file that a stop of the queue holds stays in `proposals/`. Step 2 starts no planner subagent from it. The new
orchestrator finds it at the end of its start steps.

## The chain of subagents

On 2026-11-21, with Claude Code 2.1.330, a measure ran a chain of subagents below a top-level session. The subagent
`chain-1` started the subagent `chain-2` with the Agent tool, and the call had no error. `chain-2` replied "OK". The
measure was one run, and `chain-1` reported it. So a subagent can start a subagent, and a planner subagent can start its
issue subagents.
