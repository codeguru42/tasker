# Handoff of the planner

[docs/dev/handoff.md](handoff.md) gives the common steps of a handoff. This page gives only what differs for the
planner.

## The follow-up planner

In a handoff of a planner, the old planner gives its work to a new planner in a new session. Both are follow-up
planners, as [The initial planner and the follow-up planner](planner.md#the-initial-planner-and-the-follow-up-planner)
of planner.md defines.

The rules of this page cover only the follow-up planner. They do not cover the initial planner.

## An open draft

An open draft is a draft that the follow-up planner did not post or drop yet. It can be a draft in its review loops, a
draft that waits for a decision of the user, or a draft of a comment that waits for the approval of the user.
[The review loop of a draft](planner.md#the-review-loop-of-a-draft) of planner.md gives these cases.

## The post count

The planner counts the issues that it posts in its session. Each change of the body of an open issue also counts as one
post. At a count of 12, the planner suggests a handoff to the user after that post. The follow-up planner tells the user
each suggestion as [The operator](working-with-the-user.md#the-operator) of working-with-the-user.md says.

The reason for the count: most of the context of a planner comes from the work on each issue.

## The steps of the old planner

After the start, the old planner does these steps:

1. Post nothing new and start no new draft. Start no new ticket subagent. Wait for the report of each ticket subagent
   that runs.
2. Run the rounds of [Session-review rounds](session-review-rounds.md). Give each finding to a ticket subagent, as
   [The review loop of a draft](planner.md#the-review-loop-of-a-draft) says. For these findings, this step wins over
   step 1.

   Wait for the report of each such ticket subagent. Then post an issue, add the finding to an open issue, or drop it,
   as [The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner) says. Send each draft that waits
   for a decision of the user to the operator as an item, as [The escape hatch](planner.md#the-escape-hatch) says. Then
   send the report of the rounds to the operator as a report.

3. Write the handoff file, with the name and the time of [The handoff file](handoff.md#the-handoff-file). An example is
   `2026-10-24-1530-docs-planner.md`.
4. Send the path of the handoff file to [the operator of the session](../operator.md) as an item, as
   [The form of an item](operator-items.md#the-form-of-an-item) of operator-items.md says.

Until the end of the handoff ([The end of a handoff](handoff.md#the-end-of-a-handoff)), the old planner does step 1 of
these steps, also after step 4.

## The handoff file of the planner

The handoff file of the planner holds the items of
[The items of a handoff file](handoff.md#the-items-of-a-handoff-file). The old planner also puts these items in the
handoff file:

- The prompt names the milestone, the session name `planner-<slug>` and the first free item id. The first step of the
  prompt is the prompt read of [The items of a handoff file](handoff.md#the-items-of-a-handoff-file). The prompt names
  no other doc for the start reads. The second step of the prompt is
  [The start of the new planner](#the-start-of-the-new-planner).
- The path of each open draft, not its text, its source, and the decision of the user that it waits for, if any.
- The path of the report file of each open draft.
- Each lesson, measured fact or proposed issue that another session sent or that the old planner found, and that has no
  draft yet. Each entry names its sender, its facts and its sources.
- The number of each issue that the old planner posted in its session.

## The start of the new planner

The new planner is `planner-<slug>`. [The stop and the start](handoff.md#the-stop-and-the-start) applies. The new
planner does [the check of the handoff folder](handoff.md#the-check-of-the-handoff-folder).
