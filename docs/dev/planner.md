# Planner

This page gives the rules for a planner. A planner is the assistant session that plans a milestone and writes its issues
on GitHub. The [user](GLOSSARY.md) works with the planner. The readers of this page are the planner and its user. A
session that [Before a post](issues.md#before-a-post) of issues.md sends to
[The blocked-by links](issue-subagents.md#the-blocked-by-links) of issue-subagents.md also reads that section.

An ad hoc planner is a session that drafts issues for the user outside the initial planning of a milestone. For each
draft, it follows [The issue subagents of a planner](#the-issue-subagents-of-a-planner) and
[The review loop of a draft](#the-review-loop-of-a-draft). It follows [Before a post](issues.md#before-a-post) and posts
each draft after its reviews under [The post of a draft](#the-post-of-a-draft). The post rules and
[The escape hatch](#the-escape-hatch) apply to each planner.

The page does not cover the work of the orchestrator and of the task subagents of the tickets.
[The orchestration pages](../orchestrator.md) hold that work, and [orchestrator.md](../orchestrator.md) defines
"orchestrator" and "ticket". [GLOSSARY.md](GLOSSARY.md) defines the terms "task subagent", "issue-draft subagent",
"issue-review subagent" and "issue-post subagent".

[issues.md](issues.md) gives the steps and the GitHub facts to file issues, blocked-by links and milestones, and the
facts of the project board.

A planner is not the orchestrator. It is also not one of the sessions that tasker starts for plan, execute and review.

A blocked-by link is the GitHub link that says that one issue waits for another issue.

## The start of the initial planner

The planner is one role. The user starts the initial planner by hand, as [The start prompts](#the-start-prompts) says.

The initial planner is the planner that writes the first issues of a milestone with the user, in its own tab.

- The initial planner works with the user directly, as
  [Reports and questions of a session](working-with-the-user.md#reports-and-questions-of-a-session) of
  working-with-the-user.md says. It tells and asks the user in its own tab.
- After its start reads, the initial planner reads the title and the description of its milestone, with the read command
  of [The read of the milestones](#the-read-of-the-milestones). Then it starts the drafts of the issues at once. The
  prompt names no kinds of GitHub objects to make, so the initial planner still asks the user before a post, as
  [The order of the work](#the-order-of-the-work) says.
- When the user says that the initial planning is done, the initial planner waits for the report of each issue subagent
  that still runs. It posts each such draft after its reviews, under [The post of a draft](#the-post-of-a-draft). Then
  it runs the rounds of [Session-review rounds](session-review-rounds.md).

  It posts each draft of a finding of its rounds after that draft's reviews. Only then does it give the report of the
  rounds to the user in its own tab. Then it ends its work. The user closes its tab.

  For the initial planner, a finding of a round that the user wants posted is a draft of
  [The initial planner](#the-initial-planner).

- The user stops the initial planner in three steps:
  - (a) The user asks the initial planner in its tab to run its rounds of
    [Session-review rounds](session-review-rounds.md).
  - (b) The user waits for the report of the rounds in its tab.
  - (c) The user closes the tab.
- The issue-draft subagent of each planner session writes each draft to `/tmp/tasker/<slug>/drafts/<file>.md`.
- For a draft that waits for a decision of the user, [The escape hatch](#the-escape-hatch) says what the answer of the
  user does.

The reason for the folder: the drafts go in `/tmp`, so they do not fill the `Documents` folder of the user, and the
system deletes them. The limit: a reboot deletes the open drafts, and the planner then starts a new issue-draft subagent
for each of them.

### The read of the milestones

To read the milestones, the planner runs
`gh api --paginate 'repos/codeguru42/tasker/milestones?state=all&per_page=100'`.

### The start prompts

This subsection gives the start of the initial planner by the user and its first prompt. The user starts the initial
planner in the steps of [The steps of the user](../orchestrator.md#the-steps-of-the-user) of orchestrator.md, with the
role `planner` in place of the role `orchestrator`. The user reads the entry `sessions.models.planner` and gives the own
name `planner-<slug>`. [GLOSSARY.md](GLOSSARY.md) defines the slug.

The first prompt is the template
[`prompt-templates/start/planner-initial.md`](../../prompt-templates/start/planner-initial.md). The user makes the
prompt from this file in the steps of [The steps of the user](../orchestrator.md#the-steps-of-the-user). The user puts
the milestone title in place of `{{MILESTONE}}`.

The prompt asks for the start reads of `AGENTS.md` and `docs/planner.md`. It says that this is the initial planning, in
which the user works with the planner in this tab. After the start reads, it asks for the read of the title and the
description of the milestone.

## The order of the work

- The user decides when a milestone starts. The planner plans one milestone at a time. If the user asks, the planner
  writes the issues of the next milestone before the current milestone ends.
- The initial planner first starts an issue-draft subagent for each issue of the milestone. It posts each draft after
  its reviews under [The post of a draft](#the-post-of-a-draft).
- If the request does not say which kinds of GitHub objects to make (milestones, issues, project items), the planner
  asks the user before a post. In one case, "post everything" meant milestones only, and the session made more than 100
  unwanted issues.
- If a ticket that landed needs a change, the planner writes a new follow-up issue. It does not edit the body of a
  closed issue. If a closed issue has wrong text but right landed work, each session, not only the planner, adds a
  comment to the issue. The comment names the wrong text and gives the right fact. The session does not edit the body.
  For this comment, the session also follows the first bullet of [Before a post](issues.md#before-a-post) of issues.md,
  so it shows the draft to the user first. On #160, the Summary still named the latest review after the user removed the
  review from the requirements, and a comment recorded the fix.

### Wrong text of an open issue

Wrong text is text in the body of an issue that states a wrong fact, rule or requirement, when the planner knows the
right fact. An open issue has no task when `tasker status` lists no task for the full key of the issue. With no option,
`tasker status` lists only the active tasks. These are the tasks that are not `finished` and not `cancelled`. In this
subsection, "the planner" includes the planner subagent of an orchestrator.

If an open issue has wrong text and no task, the planner changes the body of the issue. The planner drafts the changed
body and runs [The review loop of a draft](#the-review-loop-of-a-draft). Then it posts the reviewed body under
[The post of a draft](#the-post-of-a-draft). The planner adds no comment about the wrong text. A blocked-by link is no
condition of the rule. A blocked issue and an issue with no blocker get the same rule.

The body is the text that a later task reads. The plan session of a task reads only the issue body and the repo, as
[The change-of-scope comment](plan-review.md#the-change-of-scope-comment) says. The task subagent copies no comment that
starts with a heading other than `## Change of scope` or `## Design gap`. As a result, a comment with a correction does
not reach the plan of a later task.

The rule adds no read and no command. Its test is the `tasker status` read and the read of the issue state of
[The reads before the write](issues.md#the-reads-before-the-write). Each change of a body already runs these reads right
before its write. The actor of the reads is the actor of the write. The issue-post subagent of the post runs the reads,
in step 3 of [The steps of a post](issue-post.md#the-steps-of-a-post), for a planner session and for a planner subagent.
For a session with no role, the ad hoc post subagent runs them.

The change passes each gate of a change of the body of an open issue:

- The start read and the start hash of [Before a post](issues.md#before-a-post).
- [A change of an open issue](issue-draft.md#a-change-of-an-open-issue).
- [The reads before the write](issues.md#the-reads-before-the-write), with the write alone in a plain call.
- The post with no approval of the user, under [The post of a draft](#the-post-of-a-draft).
- [The escape hatch](#the-escape-hatch). For example, a change of a behavior that a user sees waits for a decision of
  the user, unless the source of the change holds the behavior.
- The lists of the issue-post subagent and of the planner subagent in [allowed-commands.md](allowed-commands.md) and
  their rows in [permissions.md](permissions.md).

The rule adds no item to a list of allowed commands.

The rule gives a different result in each state of the issue:

- Not started: the issue is open, and `tasker status` lists no task for it. The rule applies.
- Running: the issue is open, and `tasker status` lists a task for it, so the issue is in flight. The reads skip the
  write, and the planner tells the user. The rule does not apply. The bullet for an issue in flight of
  [land-the-work.md](land-the-work.md) and the case "A change of scope of an issue in flight" of the escape hatch stay.
- Ended and closed: the reads skip the write, and the planner tells the user. The rule does not apply. The bullet of
  [The order of the work](#the-order-of-the-work) that starts "If a ticket that landed needs a change" applies: a
  comment with the approval of the user, and no change of the body.
- Ended and open, with a `finished` or `cancelled` task: `tasker status` lists no such task, so the test gives "no
  task". The test alone cannot tell this state from "Not started". This is a known limit of the test.

An open issue can have a `finished` task. If `issueTracker.updateOnFinish` is not `true`, `tasker finish` does not mark
the issue done. If the write to the tracker fails, the task still goes to `finished`. A task can also go to `cancelled`
after `landed`, because `landed` is not terminal, as [docs/statemachine.md](../statemachine.md) shows. The bullet of
[The order of the work](#the-order-of-the-work) that starts "If a ticket that landed needs a change" wins over the rule.
If the planner knows that the work landed, it writes a new follow-up issue and does not change the body. It knows this
from the source of the change or from a read that it already has. The rule adds no read for this case. The test does not
use `tasker status --state finished` or `--state cancelled`, because the proposal that the user accepted gives the test
with `tasker status`.

The reads run right before the write. A task that starts, or an issue that closes, before the reads gives its state of
the list above. If the reads skip the write, the planner posts no comment under this rule, and the rule of the new state
applies. If a read fails, the write does not run, the planner tells the user, and the planner posts no comment. A failed
read gives no answer, so it never counts as "no task". A task can still start between the last read and the write, and
[The reads before the write](issues.md#the-reads-before-the-write) already accepts this race.

These rules stay for their own cases:

- The open-question note of [The change-of-scope comment](plan-review.md#the-change-of-scope-comment). It asks an open
  question and gives no known right fact, so the note rule wins for its case.
- The recurrence comment of [A recurrence](issues.md#a-recurrence). It records a new case, not wrong text.
- The bullet "A comment on an issue" of [The rules for the user alone](#the-rules-for-the-user-alone). The rule makes no
  comment, so this limit does not stop the change of the body.
- The paragraph of [question-pane.md](question-pane.md) that starts "For a title or body request". A request of the user
  in a question pane keeps that path.
- The bullet of [What goes in a ticket](#what-goes-in-a-ticket) that starts "If the user states a design fact".
- Item 2 of the missed-finding rule of [review-findings.md](review-findings.md). The orchestrator is not a planner, so
  it keeps this rule.

The planner judges whether a text is wrong text or a new requirement. The judgment is open on purpose. A new requirement
keeps the rules for a change of an open issue. A new design fact or rule of the user also keeps the bullet "If the user
states a design fact".

On 2026-11-22, the user said, word for word: "edit the body of 10123 since no task has started it yet and it is
currently blocked." In this quote, "10123" names #1023. The same day, the user confirmed with "yes" a proposal with this
rule: "when an open issue with wrong text has no task in `tasker status`, a planner changes its body with its review
loops and posts the reviewed body, and does not add a comment." The user accepted two guesses about the quote, and they
stay guesses:

- Guess 1: the words give a general rule for each open issue, not a choice for #1023 only.
- Guess 2: the condition is "no task exists for the issue", and "it is currently blocked" gives a reason for the case of
  #1023, not a second condition.

## The issue subagents of a planner

Each planner session of the kind `claude` starts an issue-draft subagent, an issue-review subagent and an issue-post
subagent for each draft, as [GLOSSARY.md](GLOSSARY.md) defines them. A planner session is the initial planner or an ad
hoc planner. For the work on one draft, the planner session follows
[The issue subagents](planner-subagent.md#the-issue-subagents) of planner-subagent.md and its subsections. There, "the
planner subagent" names the planner session. For an ad hoc draft of a session with no role, the main session starts the
issue-draft and issue-review subagents, and the ad hoc post subagent makes the post, as
[working-with-the-user.md](working-with-the-user.md) says.

The reason: on 2026-11-21, the user moved the work on each draft of a planner session to the issue subagents.

A pi planner session has no rule here. No one measured a pi session that starts a subagent, and the measured pi sessions
had only `bash`, as [pi-sessions.md](pi-sessions.md) says.

These rules of the planner subagent do not hold for a planner session: [The result](planner-subagent.md#the-result),
[No metadata](planner-subagent.md#no-metadata) and the six kinds of
[A draft that needs the user](planner-subagent.md#a-draft-that-needs-the-user). A planner session keeps the list of
[The escape hatch](#the-escape-hatch). Where a rule of the planner subagent puts a question or a report in its result,
the planner session asks or tells the user in its chat. Each other rule of a planner session stays, for example its
chat, its metadata changes, its own comments and its rounds of `/session-review`.

The planner session runs `tasker show-config --repo <key>` and reads the entries `sessions.models.issue-draft`,
`sessions.models.issue-review` and `sessions.models.issue-post`. It maps each entry as
[The model of the start](planner-subagent.md#the-model-of-the-start) says.

The planner session gives each issue subagent the list of its kind from [allowed-commands.md](allowed-commands.md). It
fills the prompt templates as the planner subagent does, as
[The prompt of an issue subagent](planner-subagent.md#the-prompt-of-an-issue-subagent) says.

Before a planner subagent starts the first issue-draft subagent for a lesson or a proposed issue, it decides on a drop,
as [The post of a draft](#the-post-of-a-draft) permits. First, it reads the docs for the rule that the lesson or the
proposed issue asks for. Then it judges whether a case with a cost is on record, for example a stop or a change of
scope. If neither such a case nor a real gap of the docs exists, the planner subagent can drop the lesson or the
proposed issue. The judgment is open on purpose, and the planner subagent makes it.

The reason: each review costs at least one issue-review subagent. On 2026-11-04, the subagents that reviewed drafts held
a median of about 120,000 tokens of context.

The planner then does each step after the reviews. Examples are a question to the user, the post and the report of the
post. When it posts, the planner adds the links. Links between drafts that are not posted yet stay with the planner,
from its table of the needs and the likely files.

Before the planner sends a question of a report to the user, it applies the paragraph of
[The findings and the edge cases](issue-draft.md#the-findings-and-the-edge-cases) of issue-draft.md that starts "The
report gives a question for the user". A question about an edge case that is not a security gap or a bug in the core
path does not go to the user. The planner decides it as "later" and adds it to the list of the edge cases of the report.
The planner gives that list in each place where it gives the findings that it dismissed. Examples are the report of a
post and a question of the escape hatch.

A change of the draft after a report starts a new issue-draft subagent. An example is a change from an answer of the
user. Another example is the change of the draft into a change of an open issue after the duplicate search. A change
that comes while an issue subagent of the draft runs waits for its report. The planner gives the new issue-draft
subagent the draft file and the change. The count of reviews of
[The count of reviews](planner-subagent.md#the-count-of-reviews) starts again.

For a change of an open issue, the report of the issue-draft subagent gives the start hash of
[Before a post](issues.md#before-a-post). The planner gives that start hash to each later issue-draft subagent of the
same change, with the draft file. After the post of the change, the planner drops the start hash. If
[the reads before the write](issues.md#the-reads-before-the-write) skip the post because the hash changed, the planner
also drops the start hash. After such a skip, it starts a new issue-draft subagent with the same change and no start
hash.

If an issue-draft subagent of a change of an open issue with no start hash cannot read the issue, its report says so, as
[A change of an open issue](issue-draft.md#a-change-of-an-open-issue) says. Then the planner tells the user.

If an issue subagent ends with no report, the planner follows
[The wait for an issue subagent](planner-subagent.md#the-wait-for-an-issue-subagent).

The planner session names each issue subagent `<own name>-<kind>-<file>-<count>`, with the `name` option of the Agent
tool. [The start of an issue subagent](planner-subagent.md#the-start-of-an-issue-subagent) gives the rest of the name.
`<own name>` is the own name of the planner, as [docs/dev/GLOSSARY.md](GLOSSARY.md) defines it.

The fact of the first sentence of the bullet that starts "The list of the options of the Agent tool" in
[The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) also holds for the Agent tool of a
subagent of a planner. On 2026-11-04, planner-m16-ticket-name-option-1, a subagent of planner-m16, passed
`name: "planner-m16-ticket-name-option-1-review-1"`, and the report of the subagent that it started came from that name.
On the same day, four subagents of planner-m16 did not see `name` in the list of the options of their Agent tool. They
put the name of each subagent that they started only in its description and its prompt. The prompt of an issue subagent
gives the rule to pass `name` and says that the tool accepts `name` but does not list it.

The fact of that bullet also holds for the Agent tool of the planner. If that list shows no `name`, the planner still
passes the name of each issue subagent with the `name` option. On 2026-11-11, the ad hoc planner `codeguru42/tasker#857`
saw no `name` in that list. It put the name of each subagent only in the prompt, and it did not try the option. No
record gives the version of Claude Code of that day.

On 2026-11-15, the same planner called its Agent tool with `name: "adhoc-857-name-test-1"`. That day, `claude --version`
printed `2.1.325 (Claude Code)`. The list of the options of the tool showed no `name`. The JSON schema of that list had
`additionalProperties: false`. The call did not fail. The agent started, and its `SubagentHandback` report came as a
message from `adhoc-857-name-test-1`.

The planner gives each draft file a name of at most 24 characters, of lowercase letters, digits and `-`. The Agent tool
refuses a name of more than 64 characters, and other names, as
[The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) says. If the Agent tool refuses a
name, the planner gives the draft file a shorter name. A subagent is not a session of a role, so its name gives no role
and no slug in the sense of [docs/dev/GLOSSARY.md](GLOSSARY.md).

An ad hoc planner uses an ad hoc name in two places. The ad hoc name takes the place of `<slug>` in the path of each
draft file. It also takes the place of `<own name>` in the name of each issue subagent. On 2026-11-11, `ListAgents` gave
the own name `codeguru42/tasker#857` to a session that started with `/tasker start codeguru42/tasker#857`. That session
later drafted issues as an ad hoc planner. That own name has no slug, and the Agent tool refuses a name that holds `/`
or `#`.

If the own name is a GitHub issue key of the form `<owner>/<repo>#<number>`, the ad hoc name is `adhoc-<number>`. An
example is `adhoc-857`. For each other own name, the ad hoc planner picks an ad hoc name of the form `adhoc-<word>`. The
choice of the word is open on purpose, and the ad hoc planner makes it. Each ad hoc name has at most 12 characters, of
lowercase letters, digits and `-`. With this limit, each name of an issue subagent has at most 64 characters, as the
Agent tool requires.

### The state of the user

[The state of the user](plan-review.md#the-state-of-the-user) of plan-review.md gives the term, the ban, the form of the
question and the approval. The ban also holds for each issue subagent, and each issue subagent makes each scratch folder
under `/tmp`.

An issue-review subagent gives a measure that needs a change of the state of the user as a finding with its command. If
the draft needs the measure, the issue-draft subagent makes the question an open question of its report. The bullet of
[The body of an issue](issue-subagents.md#the-body-of-an-issue) of issue-subagents.md that starts "Before the post, the
planner tests each outside-tool fact it writes" gives the words that no one tested the fact. This subsection wins over
that bullet and over the bullet that starts "An issue can name a read of an outside tool".

The initial planner and the ad hoc planner ask the user in their chat. A planner subagent gives the question in its
result, as [The result](planner-subagent.md#the-result) says. The draft waits for the answer, as a draft of
[the escape hatch](#the-escape-hatch) does. Paragraphs 5 and 6 of the subsection of plan-review.md also hold for the
planner when it handles the answer. The answer of the user has one of these outcomes:

- The user approves the command. Then the planner starts a new issue-draft subagent with the draft file, the approved
  command and its undo step, word for word. That subagent first runs them, as
  [The state of the user](plan-review.md#the-state-of-the-user) of plan-review.md says. Then it changes the draft with
  the result. The reviews of [The count of reviews](planner-subagent.md#the-count-of-reviews) follow. After a failed
  run, the issue-draft subagent ends, and the planner tells the user the state that stays.
- The user runs the command and gives the result. Then the planner starts a new issue-draft subagent with the draft file
  and the result. That subagent changes the draft with the result. The reviews of
  [The count of reviews](planner-subagent.md#the-count-of-reviews) follow.
- The user declines the measure. Then the draft keeps the words that no one tested the fact, and the measure is no
  longer an open question. For each planner, the bullet of the escape hatch that starts "If the answer accepts the draft
  with no change" then applies.
- The user rejects or drops the draft. Then the planner drops the draft, as the escape hatch says.

### The wait for a report

In this subsection, the starter is the planner session, the planner subagent, the main session of an ad hoc draft, or
the orchestrator for a planner subagent. The agent is the subagent that the starter started with the Agent tool. A
harness notification is a `<task-notification>` block that Claude Code sends to the starter of an agent. Among other
fields, it has the fields `<task-id>`, `<status>`, `<summary>`, `<note>` and `<result>`. The `<task-id>` of the harness
notification of an agent is the agent id that the Agent tool gave at the start.

A harness notification of an agent is of one of two kinds:

- A wait notification has a `<summary>` that ends with "is waiting on its own background work". Its `<note>` starts with
  "This agent stopped with background work of its own still running". The agent still runs, and it can report later.
- An end notification is each harness notification of an agent that is not a wait notification. The agent has ended.

Both kinds have the `<status>` `completed`. As a result, the starter never judges the end of an agent by the `<status>`
alone. An agent can send more than one harness notification. A wait notification can also come after the report.

A harness notification of a background command says nothing about the agent.

The report of an agent is the text of its `SubagentHandback` call. Claude Code delivers it to the starter as a message
that starts with `[Subagent hand-back]`. The message comes from the name of the agent. If the agent has no name, the
message comes from its agent id. The `<result>` of a harness notification that comes after the report says that the
report "was delivered to you as a message". The report of an agent ends the wait for that agent, and the starter ignores
each later harness notification of that agent.

An agent ended with no report when its end notification arrived and no report of the agent arrived. An end notification
whose `<result>` says "was delivered to you as a message" is not an end with no report.

No one tested an agent that ends with no `SubagentHandback` call. If an end notification holds the text of a report in
its `<result>`, the starter takes that text as the report. If the Agent call fails, no agent runs. The failure counts as
an end with no report.

The starter never reads the output file of an agent to judge whether the agent runs. The output file is the transcript
of the agent, and its last record does not show an end. The result of the Agent tool also says not to read the file. On
2026-11-04, a subagent of planner-m16 read the transcript of a subagent that it started, 16 seconds after the start. It
took the last record, an API request, as an end, and handed back with no report. The started subagent reported about 5
minutes after its start.

After the starter starts an agent, it does these steps:

1. Keep the agent id and the name of the agent.
2. End the turn with no other tool call.
3. If the report of the agent arrives, use it. If a wait notification arrives, end the turn again. If an end
   notification arrives with no report, follow
   [The wait for an issue subagent](planner-subagent.md#the-wait-for-an-issue-subagent).

The starter starts no background `sleep` for the wait, and it reads no clock. The wait has no time limit. The harness
starts the starter again with the report and with each harness notification.

On 2026-11-04, planner-m16-ticket-pi-extensions-1 ended its turn while the subagents that it started ran, and it got
each report.

A late report is a report of an issue subagent that arrives after its starter ended the work on that step, or after the
result of a planner subagent. On 2026-11-04, a late report started planner-m16-ticket-priority-field-1 again with its
context, 2 minutes 43 seconds after its hand-back.

For a late report, the planner uses the first bullet of this list that matches:

- If an issue-draft subagent of the draft runs, the late report waits for its report. Then the planner uses this list
  again for the late report.
- If the draft waits for a decision of the user, the late report waits for that answer. This includes a question in the
  result of a planner subagent and a question in the chat of the initial planner or the ad hoc planner. Then the planner
  uses this list again for the late report. An answer that accepts the draft with no change makes the planner post the
  draft, so the bullet "If the planner posted the draft" then applies.
- If the planner dropped the draft, the planner drops the late report too.
- If the planner did not post the draft, the planner starts a new issue-draft subagent with the draft file and the
  report file. The findings of the late report are findings of the last review. The reviews of
  [The count of reviews](planner-subagent.md#the-count-of-reviews) follow.
- If the planner posted the draft and the issue is open, the planner starts a new issue-draft subagent with the report
  file. That subagent turns the findings into a change of the open issue. [The escape hatch](#the-escape-hatch) still
  applies, for example to a change of scope of an issue in flight.
- If the planner posted the draft and the issue is closed, the planner starts a new issue-draft subagent with the report
  file. That subagent writes a follow-up issue from the findings, as [The order of the work](#the-order-of-the-work)
  says.

## The review loop of a draft

These terms apply in this section:

- A draft is the text of a new issue, or the changed title or body of an open issue.
- A comment on an issue is not a draft of this section. A comment still needs the approval of the user, as
  [Before a post](issues.md#before-a-post) says.

Each issue subagent and each planner follow [Text as data](issue-subagents.md#text-as-data) of issue-subagents.md.

Each planner runs the reviews of a draft as
[The order of the work on a draft](planner-subagent.md#the-order-of-the-work-on-a-draft),
[The count of reviews](planner-subagent.md#the-count-of-reviews),
[The new-finding rule](planner-subagent.md#the-new-finding-rule) and
[The record file](planner-subagent.md#the-record-file) of planner-subagent.md say.

### The post of a draft

After the reviews, an issue-post subagent makes each post of a planner, with no approval of the user. For a session with
no role, the ad hoc post subagent makes it. The post follows [docs/dev/issue-post.md](issue-post.md). These rules still
apply to the post: [The steps of a post](issue-post.md#the-steps-of-a-post) of issue-post.md.

On 2026-11-12, the user gave this reason for the post with no approval of the user: "Have the planner run the review
cycles defined in its rules. Then post the final result."

If the duplicate search right before the post finds an open issue that covers the change, each planner starts a new
issue-draft subagent. That subagent turns the draft into a change of that issue, and its reviews follow. Then the
planner posts the change with no approval of the user. The escape hatch still applies to the change, for example for a
change of scope of an issue in flight.

If the match right before the post is a closed issue, each planner compares the draft with what the closed issue landed:

- If the draft is a true duplicate, because the change already landed, the planner drops the draft and reports the
  match.
- If the draft asks for more than the closed issue landed, the planner posts a new follow-up issue that names the closed
  issue, with no approval of the user. The escape hatch still applies.
- If the planner cannot tell which case applies, the draft waits for a decision of the user. A planner subagent gives
  the question in its result. The initial planner and the ad hoc planner ask in their chat. The planner posts nothing
  for that draft.

A planner subagent can also drop a lesson or a proposed issue with no approval of the user. A drop needs no review.

After each post or drop, each planner tells the user in a short report. The report gives the link or the drop, the
source, and each finding that the planner dismissed, with its reason. It gives each blocked-by link with its reason and
the list of edge cases of [The findings and the edge cases](issue-draft.md#the-findings-and-the-edge-cases) of
issue-draft.md. It also gives the command and result of each test of a fact about an outside tool, as
[The body of an issue](issue-subagents.md#the-body-of-an-issue) says.

A planner subagent gives this report in its result. The initial planner and the ad hoc planner give it in their chat.

### The escape hatch

When a draft needs one of these decisions, each planner asks the user before the post, as
[A decision of the user](working-with-the-user.md#a-decision-of-the-user) says:

- A new feature, or a change of a behavior that a user sees, for example the text of an output or an exit code. If the
  feature or the behavior change is in the source of the draft, the draft needs no such decision. The source is a
  request of the user or the description of a milestone that the user approved.

  A request that another session passes on with the words of the user is a request of the user. A lesson or proposed
  issue from another session, without those words, does not supply such a request.

- A choice between two or more designs, where each one has a real cost. A choice of the place or words of a doc change
  is a choice of the implementation. The ticket plan makes it.
- A change of scope of an issue in flight.
- A security gap.
- A measure that needs a change of [the state of the user](plan-review.md#the-state-of-the-user).
- A finding of one of these kinds that the reviews leave open.

An edge case that an issue-draft subagent decided as "later" needs none of these decisions, as
[The findings and the edge cases](issue-draft.md#the-findings-and-the-edge-cases) of issue-draft.md says.

For a draft that waits for such a decision, each planner posts nothing. A planner subagent gives the draft, its
questions and each finding that it dismissed in its result, as
[A draft that needs the user](planner-subagent.md#a-draft-that-needs-the-user) says. The answer is the decision of the
user. The initial planner and the ad hoc planner ask in their chat, with each finding that they dismissed. A planner
posts nothing for such a draft until each question has an answer.

- If the answer rejects the draft or says to drop it, the planner drops the draft and reports the drop, as
  [The post of a draft](#the-post-of-a-draft) says. A [partial answer](items.md#the-terms-of-the-questions) that rejects
  the draft or says to drop it also ends the draft.
- If the answer accepts the draft with no change, the planner posts the draft.
- If the answer changes the draft, the planner starts a new issue-draft subagent with the change. Its reviews follow, as
  [The count of reviews](planner-subagent.md#the-count-of-reviews) says. Then the planner posts it with no approval of
  the user. The escape hatch still applies to the changed draft.
- The user can say that the sender decides the open part of a question, as [The answer](items.md#the-answer) says. Then
  the planner decides the open part by its recommendation. If that decision changes the draft, the bullet "If the answer
  changes the draft" applies. Otherwise the bullet "If the answer accepts the draft" applies. If the words of the user
  say to reject or drop the draft, the first bullet of this list applies.

Each planner goes on with the other drafts.

### The rules for the user alone

The post of a draft by each planner with no approval of the user does not cover these rules:

- The close of a milestone, in [Milestones](issues.md#milestones). The start of
  [The start and the authority](milestone-close.md#the-start-and-the-authority) gives the authority for the GitHub
  milestone closure. The escape hatch does not cover it.
- The start of a milestone and the question about the kinds of GitHub objects, in
  [The order of the work](#the-order-of-the-work). The escape hatch does not cover them. They stay with the user.
- A comment on an issue. It is not a draft of this section, so it still needs the approval of the user.
- A change of scope and a security gap. The escape hatch covers both.
- The approval of a measure that changes [the state of the user](plan-review.md#the-state-of-the-user). The escape hatch
  covers the wait of the draft, but only the user approves the measure.

### The initial planner

The initial planner starts the issue subagents of each draft, as
[The issue subagents of a planner](#the-issue-subagents-of-a-planner) says. It posts each draft after its reviews under
[The post of a draft](#the-post-of-a-draft). Then it reports the post in its chat under that subsection.

## What goes in a ticket

- A milestone can need manual steps of the user before its work, for example an install or a login. Then the initial
  planner files a manual-steps issue for them. Whether a step needs this issue is a judgment. The judgment is open on
  purpose, and the initial planner makes it.

  The body of a manual-steps issue says that the user does it and that no assistant session runs it. It gives each step
  and the test of each step. A root issue is an issue with no open blocker in its milestone. The manual-steps issue is a
  root issue, and it blocks each other root issue of its milestone. The reason: an assistant session cannot do these
  steps, so a step inside another ticket stops that ticket at its start.
  [Pick the tickets](pick-the-tickets.md#pick-the-tickets) says what the orchestrator does with the issue.

- If the user states a design fact or a rule, the planner puts it in a doc of the repo. This doc change follows
  [the tracked-change rule](rules.md#changes) of rules.md. The change goes in the plan of a ticket in progress, before
  `tasker approve` when possible. It can also go in the body of a ticket that has not started, or in a new issue.
- The work on this repo must continue on any machine. Each new rule, fact or preference goes to a doc of the repo, as
  the bullet before this one says. This includes the preferences of the user about how to work. No rule, fact or
  preference goes to memory, as [the memory rule](rules.md#docs) of rules.md says.

## Working with the user

- Before the user decides something, the planner follows
  [A decision of the user](working-with-the-user.md#a-decision-of-the-user) of working-with-the-user.md.
- If the planner shows the list of milestones, it uses one table with the columns `#`, `Milestone` and `Description`,
  one row for each milestone, and "Future" last. The description in each row is the description of the milestone on
  GitHub. Notes go below the table.
- The user names the initial planner `planner-<slug>` with the flag `-n` of `claude`, for example `planner-m7`. This is
  the form of `claude`. A pi planner gets its name as
  [The read of the own name](../sessions.md#the-read-of-the-own-name) says. [GLOSSARY.md](GLOSSARY.md) defines the slug.
  The name of a session is a noun for its role, not a verb. Examples are `orchestrator-<slug>` and `planner-<slug>`. The
  name tells the user which session is the planner and which session is an orchestrator. For example, on 2026-10-15, the
  user confused a planner with the orchestrator. [The notice rule](doc-reads.md#the-notice-rule) says which sessions get
  a notice.
