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

[The count of planner subagents](#the-count-of-planner-subagents) gives how many planner subagents run at the same time.

The orchestrator does these steps for each start:

1. Run `tasker show-config --repo <key>` and read the entries `sessions.models.planner`, `sessions.models.issue-draft`,
   `sessions.models.issue-review` and `sessions.models.issue-post`. See [`sessions`](../config.md#sessions).
2. If the read fails, follow [the failure rule](limits.md#the-failure-rule). Then pass no `model` and no `effort`. The
   prompt then gives the fact that each of the three issue keys has no entry. The planner subagent cannot read them,
   because the row of the planner subagent in [permissions.md](permissions.md) says `never runs` for K1.
3. If the read gives no entry, pass no `model` and no `effort`. If the read gives no entry for one of the three issue
   keys, the prompt gives the fact that the key has no entry. The reason is the same as in step 2.
4. If the read gives an entry, pass the `effort` of the entry. Pass the `model` of
   [The model of the start](#the-model-of-the-start).
5. Pass the subagent type `general-purpose`. Never pass the type `fork`.
6. Pass the name of [The name](#the-name) with the `name` option of the Agent tool.
7. Pass the prompt of [The prompt](#the-prompt).

A subagent of the type `fork` gets the context of the orchestrator. On 2026-11-19, with Claude Code 2.1.329, the list of
the subagent types gave "Tools: \*" for `general-purpose`. So its tool list holds the Agent tool.

If the Agent call fails, the start failed. A refused Agent call is also a failed start. A failed start counts as a
failed `SendMessage` of the planner bullet, and the step of that bullet for a failed send holds.

### The count of planner subagents

At most 3 planner subagents of an orchestrator run at the same time. This choice holds until the user changes it.

A new request waits in its [proposal file](#the-proposal-file) while 3 planner subagents run. When one of them returns
its result, the orchestrator starts the planner subagent of the next request, in the order of arrival.

The planner subagents of one orchestrator share the folder of [The prompt](#the-prompt). So each new draft file name of
a planner subagent starts with its own name and `-`. The follow-up planner of a milestone can also post at the same
time. Its draft folder differs, so its file names do not collide.

The cost of this choice: a request waits for a free place only while 3 planner subagents run. A request that waits stays
in its proposal file through a compaction of the context of the orchestrator.

These known limits hold:

- Two planner subagents can draft the same change at the same time. The search of
  [Before a post](issues.md#before-a-post) lowers the risk. Two posts that run at the same time can still both pass it.
- A blocked-by link to an issue that another running planner subagent did not post yet can be missing.
- All planner subagents use the same local clone and the same GitHub login. No one measured the load of 3 planner
  subagents at the same time.
- No one measured the token cost of 3 planner subagents at the same time.

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

The name of each issue subagent of a planner subagent starts with the name of the planner subagent and `-`.
[The start of an issue subagent](#the-start-of-an-issue-subagent) gives the rules of these names. The Agent tool refuses
a name of more than 64 characters, as [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent)
says. The limit of 12 characters keeps room for the rest of each such name.

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

When fewer than 3 planner subagents run, the orchestrator lists `proposals/`. It takes the files in the order of
arrival, lowest number first, and skips each held file. For each other file, it builds the prompt from the file and
starts the planner subagent, until 3 run or no such file is left. It does this at the arrival of a request, after the
result of a planner subagent and at the end of its start steps. A held file is one of these four kinds: a file that
names a planner subagent that runs, a file of a failed start, a file whose planner subagent and restart both ended with
no report, and a file whose write of the name failed. At a start with no handoff file,
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

These two cases hold a file:

- The start fails. [The failure rule](limits.md#the-failure-rule) applies, and the orchestrator keeps the file. A failed
  start still counts as a failed send of the planner bullet, as [The start](#the-start) says.
- The planner subagent and its one restart both end with no report. The orchestrator tells the user and keeps the file.

After each of these cases, the orchestrator starts no planner subagent from that file until the next word of the user.
The reason: the next list gives the same file again. The user decides.

A held file does not stop the other files. The planner subagents that run go on. The orchestrator starts the planner
subagent of the next file that is not held.

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
  `/tmp/tasker/orchestrator-m31/drafts/`. Each new draft file name of the planner subagent starts with its own name and
  `-`, for example `plan-4-terms.md`.
- The name of the planner subagent.
- The docs to read: this page and [planner.md](planner.md). The planner subagent reads each other doc of a kept rule
  only for a step that needs it. It reads each doc with the commands of
  [the doc-read rule](doc-reads.md#the-doc-read-rule).
- The list of the planner subagent in [the allowed commands](allowed-commands.md#the-planner-subagent).
- The entries `sessions.models.issue-draft`, `sessions.models.issue-review` and `sessions.models.issue-post`, or the
  fact that a key has no entry. [The start of an issue subagent](#the-start-of-an-issue-subagent) uses them.
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
   [The prompt of an issue subagent](#the-prompt-of-an-issue-subagent) gives its prompt. Change 3, change 5, change 6,
   change 7 and drop 8 leave out parts of these rules. Change 8 gives their actors.
2. [The wait for a report](planner.md#the-wait-for-a-report). The planner subagent is the starter of each of its issue
   subagents. [The wait for an issue subagent](#the-wait-for-an-issue-subagent) gives its steps. Change 4 changes one
   bullet of a late report.
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
   metadata. Change 9 gives the actors of the recurrence comment. The reviews before each post follow
   [The count of reviews](#the-count-of-reviews).
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
   subagent. [The start of an issue subagent](#the-start-of-an-issue-subagent) gives the names of its issue subagents.
4. In The wait for a report, the bullet of a late report that starts "If the draft waits for a decision of the user".
   The planner subagent does not wait for the answer. It gives the findings of the late report in its result.
5. The prompt of a ticket subagent in The ticket subagent does not hold for the planner subagent.
   [The prompt of an issue subagent](#the-prompt-of-an-issue-subagent) gives the prompt of each issue subagent. At its
   start, an issue subagent reads only the documents of [The read rule](issue-subagents.md#the-read-rule).
6. The steps with an answer of the user. They hold for the new planner subagent that gets the answer, as The result
   says. One such step is in the bullet of The initial planner and the follow-up planner. That bullet starts "For a
   draft that waits for a decision of the user". So do the outcome bullets of The state of the user, after "The answer
   of the user has one of these outcomes". So do the bullets of The escape hatch that start "If the answer", and its
   bullet that starts "The user can say". The paragraph of The ticket subagent that starts "A change of the draft after
   a report" also gives such a step. The post of a comment after the approval of the user is such a step too, and change
   9 gives its actor.
7. The folder of the draft files is the folder of [The prompt](#the-prompt). The bullet that starts "The ticket subagent
   of each planner writes each draft" gives the folder of the slug. Step 1 of The review loop of a draft also gives it.
   Neither folder holds for the planner subagent. The draft file, the report file and the record file stand in this
   folder.
8. The actors of the work on a draft. The planner subagent starts the issue-draft subagent, the issue-review subagent
   and the issue-post subagent with the Agent tool, as the work needs. It starts no ticket subagent and no review agent.
   Each start of an agent and each wait for a report in the kept rules is a step of the planner subagent.
   [The issue subagents](#the-issue-subagents) gives the start rules of the issue subagents and the actor of each other
   step of the kept rules. The same section changes the count of loops of step 6 of The review loop of a draft to
   [The count of reviews](#the-count-of-reviews). It gives the review loop of the planner subagent in
   [The order of the work on a draft](#the-order-of-the-work-on-a-draft).
9. The actors of a comment on an issue. This change covers the comment of the comment rule of keep 7 and the recurrence
   comment of A recurrence. An issue-draft subagent drafts the comment, and an issue-review subagent reviews it. An
   issue-post subagent posts it after the review passes and the user approves it. The planner subagent posts no comment
   itself.

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
issue-post subagent. A review is one report of an issue-review subagent on one draft. A finding is one item of a review.
It gives a place in the draft, the rule or the fact behind it, and a recommendation. A dismissal is a decision to keep
the draft as it is for one finding, with a one-line reason. The record file is the file of
[The record file](#the-record-file). The remaining findings of the draft are the new findings of review 3 of a draft.
[The count of reviews](#the-count-of-reviews) gives their steps.

### The starter of an issue subagent

Only a planner subagent starts a subagent of the three kinds. The orchestrator, a task subagent, a question session, a
planner session and a write subagent start none.

The subagent of the main session that posts a reviewed ad hoc draft is the ad hoc post subagent. It is not an issue-post
subagent. Its start in the bullet of [working-with-the-user.md](working-with-the-user.md) that starts "A subagent of the
main session posts a reviewed ad hoc draft" stays.

The planner subagent runs no write to GitHub. An issue-post subagent runs each write of a post. These are a new issue, a
new title or body of an open issue, and each add or removal of a blocked-by link. The planner subagent posts no comment.
Change 9 gives the actors of a comment. No metadata already gives each write of a post to the issue-post subagent. The
row of the planner subagent in [the table](permissions.md#the-table) gives it no `gh` write.

The reason: among the three kinds, only an issue-post subagent writes to GitHub, as
[The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent) says. So the work of the planner subagent has the
same single writer for an issue and its links.

The planner subagent runs only the kinds of command of its row in the table and of its list in
[allowed-commands.md](allowed-commands.md#the-planner-subagent). These are K3, K4, K10 (`SendMessage` to `main` only),
K11, the K12 write of the record file, and the named other commands with a Read call on the record file. It runs no
other kind. For example, it runs no `tasker` command (K1) and no `gh` read (K5).

### The order of the work on a draft

The planner subagent makes the drop judgment of keep 1 before it starts the first issue-draft subagent of a planning
request.

For one draft, the planner subagent does these steps:

1. Start an issue-draft subagent. It writes the draft file and its report.
2. Start an issue-review subagent for the draft. The issue-review subagent does step 1 of
   [the doc-read rule](doc-reads.md#the-doc-read-rule) itself, as [The read rule](issue-subagents.md#the-read-rule)
   says. The planner subagent runs no `git fetch origin` before this start, because its list gives K4 only before its
   first doc read.
3. Judge each finding of the review under [The new-finding rule](#the-new-finding-rule), and add it to the record file.
4. Follow [The count of reviews](#the-count-of-reviews) for the next step. The next step is an approval, a new
   issue-draft subagent with the findings, or the user.
5. After the approval of a draft of an issue, start one issue-post subagent for the draft. For a draft of a comment,
   [The count of reviews](#the-count-of-reviews) gives the step after its approval.

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

The count starts at 1 again for a change of the draft from an answer of the user. It also starts at 1 again for the
change of a draft into a change of an open issue after the duplicate search. A new ticket subagent of today starts its
count in the same way, as the paragraph of "The ticket subagent" in [planner.md](planner.md) that starts "A change of
the draft after a report" says. The planner subagent adds a line `Count starts again: <reason>` to the record file.

A review counts only with a report. A second issue-review subagent for the same review adds no review to the count.

A review with no new finding approves the draft. An answer of the user that accepts the draft with no change also
approves it, as the bullet of [the escape hatch](planner.md#the-escape-hatch) that starts "If the answer accepts the
draft with no change" says. A draft of a comment also needs the approval of the user. No other event approves a draft.

A review 1 or 2 with a new finding leads to a new issue-draft subagent. Its prompt gives the new findings of the review.
Then the next review runs. This also holds for an issue-draft subagent that dismissed each new finding and changed
nothing.

The issue-draft subagent changes the draft or dismisses each finding of its prompt with a one-line reason, as
[The findings and the edge cases](issue-draft.md#the-findings-and-the-edge-cases) says. Its result through
`SubagentHandback` gives each dismissal with its reason. The planner subagent reads no report file, because its list
names a Read call only on a saved output of its own tool call and on the record file. It adds each such dismissal to the
record file.

Before an answer of the user, only a review with no new finding approves a draft. Today step 6 of "The review loop of a
draft" ends the loops after a loop that changed nothing. So the rule can cost up to two more reviews than today. "The
ticket subagent" records a median of about 120,000 tokens of context for a review agent.

After a review 3 with a new finding, the draft is not approved. The new findings of review 3 are the remaining findings
of the draft. The planner subagent judges the findings of review 3 itself. It starts no issue-draft subagent and no
issue-post subagent after review 3.

Such a draft waits for a decision of the user. The result of the planner subagent gives the path of the draft file and
the remaining findings of the draft, as [The result](#the-result) says.

The work on the draft can leave a finding of a kind of the escape hatch open. That finding still sends the draft to the
escape hatch, also for an approved draft. Keep 1 and keep 5 give this step.

A draft of a comment that the reviews approve waits for the approval of the user. The result gives the path of its draft
file. Change 9 and the paragraph after "The changed rules" that starts "For a planner subagent, change 9 wins over two
sentences" give this approval. Change 6 and change 9 give the post after the approval of the user.

### The new-finding rule

A finding is not new in two cases. An earlier review of the same draft reported it. Or the planner subagent or an
issue-draft subagent of the same draft dismissed it earlier, with a reason. Each other finding is new.

The planner subagent is the judge of this rule. It decides whether two findings are the same. This judgment is open on
purpose. An issue-review subagent writes no file, as
[The bans of an issue-review subagent](issue-review.md#the-bans-of-an-issue-review-subagent) says. So the report of each
review comes to the planner subagent as the message of its `SubagentHandback` call, and the judgment needs no other
subagent. The cost: the full text of each review and of the record file fills the context of the planner subagent. Today
"The ticket subagent" keeps the text of a review out of the context of a planner.

An issue-review subagent does not judge whether a finding is new. Its prompt gives no earlier finding.

After a change of the draft from an answer of the user, each review and each dismissal of the draft before the change
still counts. The record file keeps them. The reason: the result of the planner subagent already showed the user each
dismissed finding, as The result says. The cost: a finding that the change of the user makes true again is not new, so
no later review stops the post for it.

### The record file

The planner subagent keeps a record of each finding of each review of a draft. It also records each dismissal with its
reason: its own dismissals and each dismissal of the result of an issue-draft subagent. The record file is in the folder
of the draft files of [The prompt](#the-prompt), next to the draft file.

The name is `<file>.findings.md` next to the draft file `<file>.md`. The name of a record file is never the name of a
draft file. The reason: a draft file name has only lowercase letters, digits and `-`, as "The ticket subagent" says. So
no draft file name holds a `.` before `.md`.

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

### The start of an issue subagent

The planner subagent starts each subagent of the three kinds with the Agent tool. The type is not `fork`, because a fork
gets the context of its parent.

The type holds the tools of the kind: the Write tool for an issue-draft subagent and an issue-post subagent, and Bash
and the Read tool for each kind. Step 2 of [the doc-read rule](doc-reads.md#the-doc-read-rule) reads each doc with the
Read tool. The type is `general-purpose`. On 2026-11-19, with Claude Code 2.1.329, the list of the subagent types gave
"Tools: \*" for `general-purpose`.

The planner subagent gives each subagent a name with the `name` option of the Agent tool. Each name is new in the
session of the orchestrator, with at most 64 characters. The form is `<planner subagent name>-<kind>-<file>-<count>`.
`<kind>` is `draft`, `review` or `post`. `<file>` is the draft file name without `.md`. `<count>` counts the starts of
that kind for that draft file in that planner subagent, from 1. An example is `plan-4-review-plan-4-terms-1`.

With a count below 100, a name has at most 47 characters. A planner subagent name has at most 12 characters, as
[The name](#the-name) says. A draft file name has at most 24, as "The ticket subagent" of [planner.md](planner.md) says.

The orchestrator reads the entries `issue-draft`, `issue-review` and `issue-post` under `sessions.models` in step 1 of
[The start](#the-start). The prompt of the planner subagent gives the three entries. The reason: the row of the planner
subagent in [the table](permissions.md#the-table) says "never runs" for K1, so it runs no `tasker show-config`.

After a failed read, the orchestrator follows step 2 of The start. Then, and for a key with no entry, the prompt says
that the key has no entry. Before each start, the planner subagent takes the entry of the kind from its prompt. For no
entry, it passes no `model` and no `effort`. For an entry, it passes the `effort` of the entry and the `model` of the
map of [The model of the start](#the-model-of-the-start). That map also covers these three keys.

The chain of a planner subagent has two layers below the orchestrator: the planner subagent and one subagent of the
three kinds. No chain needs a third layer. These records show chains of two layers:

- The paragraph of "The ticket subagent" that starts "The ticket subagent passes the name". On 2026-11-04, a ticket
  subagent of planner-m16 started a review agent, and its report came back.
- The paragraph of [run-one-ticket.md](run-one-ticket.md) that starts "If the proof shows no changed word", with the
  paragraph "A split read of this form". On #506, a task subagent ran six parallel subagents.
- [The chain of subagents](#the-chain-of-subagents) of this page. On 2026-11-21, Claude Code 2.1.330 ran it once.

On 2026-11-21, no record of the docs gave a test of a third layer.

One planner subagent runs at most one subagent of the three kinds at a time. The next step of each draft waits for the
result of the subagent that runs. These are the reasons:

- No record of the docs gives a tested limit of Claude Code on the count of subagents in one session.
- With at most 3 planner subagents, at most 3 subagents of the three kinds run in the session of the orchestrator. Each
  planner subagent that a late report starts again can add one more. So the count stays known and small.
- Each subagent of the three kinds pulls the local clone at its start, as The read rule says. So fewer pulls start at
  the same moment, and fewer reads are slow.

On 2026-11-21, with git 2.47.3, two pulls ran at the same moment in one clone 11 times.
[Step 1: pull the local clone](doc-reads.md#step-1-pull-the-local-clone) records the result. A clash costs a slower read
and a note of the failure, and no draft is lost.

The cost: a planning request with more than one draft works on its drafts one after the other, so the request takes
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
- For a change of an open issue, the issue key and the start hash, or the fact that no start hash exists.
- For a comment, the key of the issue that gets the comment.
- For a draft after a review, the new findings of that review. The planner subagent judged them. The prompt names no
  record file, and the issue-draft subagent does not judge whether a finding is new.
- The simple-english skill, for the self-check of the document of its kind.

The prompt of an issue-review subagent also gives the source of the draft word for word. It gives the list of
[The bans of an issue-review subagent](issue-review.md#the-bans-of-an-issue-review-subagent), word for word, as keep 1
says. It gives no opinion of the planner subagent about the draft, no earlier finding and no dismissal.

The prompt of an issue-post subagent also gives these facts:

- The repo key and the kind of the post. The kind is a new issue, a new title or body of an open issue, or the end of
  the post of an existing issue.
- For a new issue, its milestone and each label.
- For a change of an open issue, the issue key and the start hash.
- Each blocked-by link of the draft, with the blocked issue, the blocker and the reason.
- For the end of the post of an existing issue, the key of that issue.

The model and the effort go in the Agent call, not in the prompt.

### The wait for an issue subagent

The planner subagent is the starter of each subagent of the three kinds, as
[The wait for a report](planner.md#the-wait-for-a-report) defines a starter. It judges the end of each one by the kinds
of notification of that subsection. It ends its turn during the wait.

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

An extra report is a report of the first issue-review subagent of a review after the start of the second one. Its
findings join that review, and they add no review to the count. An extra report can come after the judgment of the
findings of its review. Its findings then go to the next judgment of the draft, with the findings of the next review.
"The wait for a report" gives the same step today for a ticket subagent. If no next review of the draft runs, the
planner subagent judges its findings before its result.

A late report is a report of a subagent of the three kinds after the result of the planner subagent. It starts the
planner subagent again, as [The life of a planner subagent](#the-life-of-a-planner-subagent) says. No one tested this
start for a subagent of the three kinds. The planner subagent handles a late report by its kind:

- An issue-review subagent: apply [The new-finding rule](#the-new-finding-rule) to each finding. With no new finding,
  change nothing, and the second result says so. For a new finding, the late-report list of "The wait for a report"
  holds, with change 4. In that list, a new issue-draft subagent and the reviews of
  [The count of reviews](#the-count-of-reviews) take the place of "a new ticket subagent".
- An issue-draft subagent: start no review and no post for that report. If the draft waits for a decision of the user,
  the second result gives the path of the draft file and the report, and the draft keeps its wait. For a posted draft,
  the second result names the report and changes nothing. For a dropped draft, the planner subagent drops the report
  too.
- An issue-post subagent: the issue of the report exists. The second result gives its key and its URL, and says whether
  the post is complete. If the first result named no post, the second result also says so. The planner subagent starts
  no new post for the draft.

### The other sessions

An orchestrator of a kind other than `claude` starts no planner subagent, as "The kind of the orchestrator" says. So a
Codex orchestrator and a pi orchestrator start no subagent of the three kinds. Their planning requests go to
`planner-<slug>`.

The follow-up planner, the initial planner and an ad hoc planner keep the ticket subagent, the review agent and the
review loop of today. After loop 3, they post the draft as "The review loop of a draft" says today.

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
2. Start a planner subagent for each request that waits, as
   [The count of planner subagents](#the-count-of-planner-subagents) says. Start the next one each time a result frees a
   place. This includes the request of the facts and lessons of
   [The items of a handoff file](handoff.md#the-items-of-a-handoff-file). Take the requests from `proposals/`, in the
   order of their numbers. While the bar of the fallback holds, take the requests that wait in the session. Wait for the
   result of each one.

The old orchestrator writes its handoff file only after the result of the last planner subagent.

A file that a stop of the queue holds stays in `proposals/`. Step 2 starts no planner subagent from it. The new
orchestrator finds it at the end of its start steps.

## The chain of subagents

On 2026-11-21, with Claude Code 2.1.330, a measure ran a chain of subagents below a top-level session. The subagent
`chain-1` started the subagent `chain-2` with the Agent tool, and the call had no error. `chain-2` replied "OK". The
measure was one run, and `chain-1` reported it. So a subagent can start a subagent, and a planner subagent can start its
issue subagents.
