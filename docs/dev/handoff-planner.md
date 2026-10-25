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

The reason for the count: most of the context of a planner comes from the drafts of each issue and their rewrites.

## The steps of the old planner

After the start, the old planner does these steps:

1. Post nothing new and start no new draft.
2. Write the handoff file, with the name and the time of [The handoff file](handoff.md#the-handoff-file). An example is
   `2026-10-24-1530-docs-planner.md`.
3. Send the path of the handoff file to `operator-<slug>` as an item, as
   [The form of an item](operator-items.md#the-form-of-an-item) of operator-items.md says.

Until the end of the handoff ([The end of a handoff](handoff.md#the-end-of-a-handoff)), the old planner does step 1 of
these steps, also after step 3.

## The handoff file of the planner

The handoff file of the planner holds the items of
[The items of a handoff file](handoff.md#the-items-of-a-handoff-file). The old planner also puts these items in the
handoff file:

- The prompt names the milestone and the session name `planner-<slug>`. The first step of the prompt is a read of
  `AGENTS.md`, `docs/dev/planner.md`, `docs/dev/issues.md`, `docs/dev/working-with-the-user.md`, `docs/dev/handoff.md`
  and `docs/dev/handoff-planner.md`. The second step of the prompt is
  [the check of the handoff folder](handoff.md#the-check-of-the-handoff-folder).
- The path of each open draft, not its text, its source, and the decision of the user that it waits for, if any.
- Each lesson or proposed issue that another session sent and that has no draft yet. Each item names its sender, its
  facts and its sources.
- The number of each issue that the old planner posted in its session.

## The start of the new planner

The new planner is `planner-<slug>`. [The stop and the start](handoff.md#the-stop-and-the-start) applies.
