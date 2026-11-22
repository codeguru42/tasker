---
name: issue-post
description: Load this document when an issue-post subagent starts, when a planner posts an issue, and when a subagent of the main session posts a reviewed ad hoc draft.
---

# The issue-post subagent

This page gives the rules that each [issue-post subagent](GLOSSARY.md) follows for its post of one approved issue. A
post is a new issue, or a change of the title or the body of an open issue. The readers of this page are these:

- Each issue-post subagent, as [the read rule](issue-subagents.md#the-read-rule) says.
- Each planner, for each post that it makes. A planner follows each rule of this page, as an issue-post subagent does.
  One exception: a planner does the steps of [The last steps of a post](#the-last-steps-of-a-post) only before its
  message to an orchestrator. [The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner) gives
  that message.
- A subagent of the main session that posts a reviewed ad hoc draft. The bullet of `docs/dev/working-with-the-user.md`
  that starts "A subagent of the main session posts a reviewed ad hoc draft" gives that post. Such a subagent follows
  each rule of this page, as an issue-post subagent does.

When a step of its work needs a doc that a link of this page names, a reader reads that doc. A reader does not read it
at its start, as [The read rule](issue-subagents.md#the-read-rule) of issue-subagents.md says.

An issue-post subagent also follows [The result of a subagent](issue-subagents.md#the-result-of-a-subagent) and
[The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent). This page copies no rule of issue-subagents.md or
issues.md.

## The steps of a post

An issue-post subagent does these steps in this order:

1. Run the duplicate search right before the post, in its own call. The bullet of
   [Before a post](issues.md#before-a-post) that starts "Right before each post" gives it.
2. For a new issue, write the body file and run `gh issue create` alone in a plain call. The bullet of Before a post
   that starts "The session makes the body file" gives these steps. The milestone of the call is the milestone of the
   draft, under [The milestone of an issue](issue-subagents.md#the-milestone-of-an-issue).
3. For a change of an open issue, write the body file of the same bullet. Then do the reads and the write of
   [The reads before the write](issues.md#the-reads-before-the-write), with the start hash of the prompt.
4. Do the compare after the post. The bullet of Before a post that starts "Right after each post of the body" gives it.
5. For each blocked-by link of the prompt, do the walk of the open blockers, the reads before the write and the link
   command. [The blocked-by links](issues.md#the-blocked-by-links) of issues.md gives the commands. For a same-file
   link, the label read comes first. The bullet of [The blocked-by links](issue-subagents.md#the-blocked-by-links) of
   issue-subagents.md that starts "A ticket on hold" gives that read.
6. Do the race paragraph of The reads before the write, which starts "A link can still land on a task".
7. Do the steps of [The last steps of a post](#the-last-steps-of-a-post).

These bullets of [The blocked-by links](issue-subagents.md#the-blocked-by-links) of issue-subagents.md also apply:

- "An issue of an earlier milestone never waits", for the read of the links after the post.
- "An issue of the milestone "Future"".
- "A ticket that changes the form or the layout of a file goes early in its chain", for the in-flight check.

For an issue-post subagent, "the session" and "the planner" in these rules name the issue-post subagent.

## The bullets of Before a post

[Before a post](issues.md#before-a-post) holds bullets that a post does not follow word for word. These are the cases:

- "Each session that posts an issue": the approval of the starter takes the place of the approval of the user. The
  sentence of that bullet that starts "Each planner posts a reviewed draft" gives the same post with no approval of the
  user.
- "For a change of the title or the body": this is a step of the draft. The prompt gives the start hash.
- "Each session that posts an issue and is not a planner decides the blocked-by links": the issue-post subagent decides
  no link. Each link comes from its prompt, with its reason.
- "The text of each post follows": this is not a step of a post. The issue-draft subagent runs the self-check, as
  [The self-check](issue-draft.md#the-self-check) of issue-draft.md says.
- "If an issue already covers the change": see
  [The result of an issue-post subagent](#the-result-of-an-issue-post-subagent).
- "For the priority of an issue": see [The writes of an issue-post subagent](#the-writes-of-an-issue-post-subagent).

## The last steps of a post

A post is complete after these steps:

- The issue-post subagent runs each link command of the post, as [The blocked-by links](issues.md#the-blocked-by-links)
  of issues.md says.
- For a new issue or an issue moved into a milestone, the issue-post subagent reads the column of the card with the
  command of [the defer rule](pick-the-tickets.md#the-defer-rule). If the output is not `Todo`, it waits one minute with
  `timeout 60 tail -f /dev/null` in its own call and reads again, because
  [the workflow of the board](issues.md#the-project-board) adds a new issue within a minute.

If a link command fails, a read of the column fails, or the second read does not print `Todo`, the post is not complete.

The exit code 124 of the wait is its normal end. The wait uses `timeout` because Claude Code 2.1.310 blocked a
foreground `sleep 40` of a task subagent on #523 (2026-10-25), as [first-refine.md](first-refine.md) says. No one
measured a foreground `sleep` of an issue-post subagent.

Only a planner moves an issue into a milestone. An issue-post subagent moves no issue into a milestone.

The result of a post that is not complete says so, with the failed step.

## The result of an issue-post subagent

An issue-post subagent gives its facts in its result, as
[The result of a subagent](issue-subagents.md#the-result-of-a-subagent) says. These rules add to it:

1. A linked rule can say that the session tells the user a fact or offers the user a choice. For an issue-post subagent,
   the fact or the choice goes in its result. Examples are a skipped write of The reads before the write and a second
   failed compare of Before a post.
2. For each match of the duplicate search, the subagent posts nothing. Its result gives the key, the state and the title
   of each match. The starter then does the steps of a match of
   [The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner).
3. The result gives the key and the URL of a posted issue, each blocked-by link that the subagent added, each skipped
   link with its reason, and whether the post is complete.
4. The result gives each issue as its plain key, as [the issue-link rule](working-with-the-user.md#the-issue-link-rule)
   says for a message between two sessions.
5. After a tool block, the subagent follows [the tool-block rule](tasker-commands.md#the-tool-block-rule) and runs the
   denied action in no other form. Its result gives the exact command, the folder and the exact text of the denial. The
   paragraph of the tool-block rule that starts "The classifier of auto mode can deny a `gh` write" gives these facts.

## The writes of an issue-post subagent

An issue-post subagent makes only these writes:

- The `gh issue create` call, with the milestone and each label of the draft.
- The `gh issue edit` call of the title and the body, also the second post after a failed compare.
- The `gh issue edit` calls that add a blocked-by link or that remove a link of a race. A reversed link is not a step of
  a post. The prompt gives no reversed link, so the subagent removes no old link before the walk. The paragraph that
  starts "If the walk finds a cycle" gives that removal.
- The body file `/tmp/tasker/issue-post/<slug>-body.md`. The `<slug>` is the base name of the draft file from the
  prompt. The subagent writes no other file. The pull of step 1 of [the doc-read rule](doc-reads.md#the-doc-read-rule)
  is no write, as [The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent) says.

The subagent changes no other metadata. It moves no card. It runs no `gh project item-add`, for the reason of the bullet
of [The project board](issues.md#the-project-board) that starts "A workflow of the board". It sets no priority, as the
bullet of [The body of an issue](issue-subagents.md#the-body-of-an-issue) that starts "When the planner plans an issue"
says. It posts no comment, and it closes and reopens no issue.

The row of the issue-post subagent in [the table](permissions.md#the-table) gives its kinds of command.
