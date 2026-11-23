---
name: issue-draft
description: Load this document when an issue-draft subagent starts, when a ticket subagent of a planner works on its draft, and when a planner needs the report, the edge cases or a change of an open issue of a draft.
---

# The issue-draft subagent

This page gives the rules that each [issue-draft subagent](GLOSSARY.md) follows for its draft. The readers of this page
are these:

- Each issue-draft subagent, as [the read rule](issue-subagents.md#the-read-rule) says.
- Each [ticket subagent](GLOSSARY.md) of a planner, for the work on its draft. It follows each rule of this page, as an
  issue-draft subagent does. For a ticket subagent, "the issue-draft subagent" on this page names the ticket subagent.
  The ticket subagent keeps the old read of [the doc-read rule](doc-reads.md#the-doc-read-rule).
- Each planner, because some steps of a planner name a part of this page. The next paragraph names these steps.

These steps name a part of this page:

- The paragraph of [The ticket subagent](planner.md#the-ticket-subagent) about a question of a report.
- The report paragraph of [The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner).
- The edge-case sentence of [The escape hatch](planner.md#the-escape-hatch).
- The sentence of [The review loop of a draft](planner.md#the-review-loop-of-a-draft) that starts "The draft that each
  planner posts after the last loop".
- The bullet of [Core features first](working-with-the-user.md#core-features-first) that starts "Each piece of work that
  waits".

When a step of its work needs a doc that a link of this page names, a reader reads that doc. A reader does not read it
at its start, as [The read rule](issue-subagents.md#the-read-rule) of issue-subagents.md says.

An issue-draft subagent also follows [The result of a subagent](issue-subagents.md#the-result-of-a-subagent) and
[The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent). This page copies no rule of issue-subagents.md.

## The draft file

The issue-draft subagent writes its draft to the path of the draft file that its prompt gives. Line 1 of the file is the
title, line 2 is blank, and the body follows. The body file of [Before a post](issues.md#before-a-post) takes out these
two lines.

It edits only its draft file, its report file and the files of a [scratch folder](plan-review.md#the-state-of-the-user).
It makes each scratch folder under `/tmp`. These rules come from step 1 of
[The review loop of a draft](planner.md#the-review-loop-of-a-draft). They also come from
[The ticket subagent](planner.md#the-ticket-subagent).

The pull of step 1 of the doc-read rule is no write of a file, as
[The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent) says.

## The fresh base

The issue-draft subagent reads each file that a claim of the draft names as
[the doc-read rule](doc-reads.md#the-doc-read-rule) says.

## The size of a draft

The draft of an issue keeps its body at or under a size target of 60000 characters. The target gives a margin under the
limit of [The count of the body](issue-post.md#the-count-of-the-body). The target binds the draft of an issue, not the
draft of a comment. The reason: an issue-draft subagent also drafts a comment, as change 9 of
[The changed rules](planner-subagent.md#the-changed-rules) of planner-subagent.md says.

Before each report, and before the self-check that comes before that report, the issue-draft subagent does these steps:

1. Count the characters of the draft file in its own call with `wc -m <draft file>`. The count of the whole draft file
   also counts the title line, so it is never lower than the count of the body.
2. If the count is over the target, cut the draft in length only. Then count again with `wc -m <draft file>`.

A cut of length only changes no meaning. Each requirement, each acceptance case and each fact stays. The cut removes,
for example, repeated text and table padding. The count and the cut run before the self-check, so the self-check covers
the text after the cut. The count and the cut run before each report, not only after the last loop, because a cut before
a review gets that review. The self-check that a ticket subagent runs before its first loop comes before any count, as
[The self-check](#the-self-check) says. The ticket subagent counts and cuts only before its report.

The report gives the count. After a cut, it also gives the count before the cut and each removal. If the count fails,
the report gives the command and the error. For a denied count, the report gives the exact command and the exact text of
the denial. If the count after the cut is still over the target, the report gives that count as a fact. The draft then
goes on under the existing rules, and the count of The count of the body still stops a body over the limit.

A cut is a change of the draft, as each other change of the issue-draft subagent is:

- If a review follows the report, that review sees the cut, under the existing loop rules.
- If no review follows the report, the draft goes to the post as it stands, with the cut, under the existing loop rules.
  The report gives each removal and the counts, so the session that started the issue-draft subagent sees them.

A cut gets no review of its own. This section adds no exception to a review loop and no new approval rule.

A ticket subagent of a planner runs all its review loops before its report. Its last loop is a loop with no finding that
it takes, or loop 3. So its count and its cut come after its last loop, and no review follows its report. The draft that
the planner posts after that last loop includes the cut, in both cases.

## The self-check

The issue-draft subagent runs the self-check of the simple-english skill over the draft file, as
[Before a post](issues.md#before-a-post) says. It runs the check before its report, after the count and the cut of
[The size of a draft](#the-size-of-a-draft). A ticket subagent still runs the check before its first loop, as step 2 of
[The review loop of a draft](planner.md#the-review-loop-of-a-draft) says. After a cut, a ticket subagent runs the check
again over the draft file before its report.

## The read bans

The issue-draft subagent keeps these two bans of [The bans of a review agent](planner.md#the-bans-of-a-review-agent),
with their exceptions, word for word:

- Read no file under `$HOME/.claude/` and not the file `$HOME/.claude.json`. A saved output of your own tool call is an
  exception: the file that the result names after "Full output saved to:". Read it with the Read tool, in parts with
  `offset` and `limit`. The files of a skill that you loaded with the Skill tool are also an exception.
- Read no credential file, for example a login file of `gh` or `pi`. Read no `.claude/settings.local.json` file. You can
  read the tracked `.claude/settings.json` with `git show origin/main:.claude/settings.json`. If you cannot read a file
  that the draft names, report each fact about it as not tested.

A ticket subagent keeps these bans too.

## The steps before a post

These bullets of [The body of an issue](issue-subagents.md#the-body-of-an-issue) give the steps before a post that an
issue-draft subagent does. Each bullet is named by its first words:

- "Before the post, the planner compares reasons in issue examples with the docs"
- "If a Docs item says that no doc names a thing"
- "If an issue copies a fact from a ticket"
- "Before the post, the planner tests each outside-tool fact it writes"
- "An issue can name a read of an outside tool"

The issue-draft subagent decides the blocked-by links of its draft under
[The blocked-by links](issue-subagents.md#the-blocked-by-links). The report gives each link with its reason.

In these bullets, "the planner" names the issue-draft subagent. A fact that a bullet gives to the user goes in the
result, as [The result of a subagent](issue-subagents.md#the-result-of-a-subagent) says.

## The report

The issue-draft subagent writes its report to the path of the draft file, with `-report.md` in place of `.md`.

The report gives the path of the draft file, the title and a short summary of the draft. It also gives each finding that
the issue-draft subagent dismissed, with its reason. It also gives each finding and each part of the draft of a kind of
[the escape hatch](planner.md#the-escape-hatch). It also gives the blocked-by links with their reasons, and each command
and result that a rule of the planner pages gives to the user. It also gives each open question of
[the state of the user](plan-review.md#the-state-of-the-user), with its command. For a change of an open issue, it also
gives the start hash of [Before a post](issues.md#before-a-post). It also gives the counts, the removals and a failed
count of [The size of a draft](#the-size-of-a-draft).

For an issue-draft subagent of a [planner subagent](planner-subagent.md), the result through `SubagentHandback` gives
each dismissal with its reason. The planner subagent adds each one to its
[record file](planner-subagent.md#the-record-file). The result gives no other fact of the report.

## The findings and the edge cases

The prompt of an issue-draft subagent can give the findings of a review. The issue-draft subagent decides on each
finding. It changes the draft, or it dismisses the finding and keeps one line with the reason.

The issue-draft subagent applies [Core features first](working-with-the-user.md#core-features-first) to each finding of
a review agent and to each question of its own work. It decides each edge case as "later" and keeps the draft in its
scope. For an edge case, it dismisses the finding or drops the question, with the reason "an edge case, later". It can
also name a proposed later issue for the edge case in its report, with its milestone. Whether a case is an edge case,
and whether it gets a proposed later issue, is a judgment of the issue-draft subagent, open on purpose. The report lists
each such edge case in its own list, with its proposed later issue.

The paragraph before this one does not cover a security gap or a bug in the core path, as Core features first says. The
core path of a draft is the main use that the draft describes, as [Review findings](review-findings.md#review-findings)
says for an issue. The issue-draft subagent changes the draft for a bug in the core path. A security gap stays a
question for the user. The report gives a security gap first, with the time that the gap starts, as Core features first
says.

The report gives a question for the user only for a decision of a kind of
[the escape hatch](planner.md#the-escape-hatch). It also gives a question for each kind of choice that still goes to the
user first. The bullet of [A decision of the user](working-with-the-user.md#a-decision-of-the-user) that starts "The
user can let the session decide" lists these kinds. An edge case that the issue-draft subagent decided as "later" is not
a question of the report. This also holds for an edge case about a behavior that a user sees. The list of the edge cases
is not part of the dismissed findings or of the findings of a kind of the escape hatch.

## A change of an open issue

An issue-draft subagent of a change of an open issue with no start hash first reads the issue, as
[Before a post](issues.md#before-a-post) says. It then writes its draft file from that read and the change. If the read
fails, the issue-draft subagent ends, and its report says so.
