# Filing issues

This page gives the steps and the GitHub facts to file issues, blocked-by links and milestones on GitHub.
[Before a post](#before-a-post) covers each session that posts an issue, except where a sentence names the planner. The
rest of the page is for the planner. [planner.md](planner.md) defines the terms "planner", "user" and "blocked-by link".
planner.md also holds the rules for what an issue says and where it goes. This page holds only how to do it on GitHub.

## Before a post

- Each session that posts an issue, or changes the title or the body of an open issue, drafts the text first. The
  session shows the draft to the user, the person who works with that session (see
  [working-with-the-user.md](working-with-the-user.md)). A request of the user such as "file an issue" or "draft a
  ticket" gets a draft first. For a change to an open issue, the draft shows the changed text. The session posts only
  after the user approves that draft, for example with "file it" or "post it". The follow-up planner posts a reviewed
  draft with no approval of the user, as [The review loop of a draft](planner.md#the-review-loop-of-a-draft) of
  planner.md says. The approval of the user still covers a draft of the initial planner and a comment. For a draft of
  the follow-up planner that waits for a decision of the user, [The escape hatch](planner.md#the-escape-hatch) of
  planner.md says what the answer of the item does. The planner also makes sure of the kinds of GitHub objects to make,
  as [The order of the work](planner.md#the-order-of-the-work) of planner.md says.
- Right before each post, the session that posts the issue searches all the issues of the repo, open and closed, by
  title and by body, for the same change. Other sessions file issues at the same time, so the list changes between two
  turns. An example search is `gh issue list --state all --search "<words> in:title,body" --limit 1000`. The session
  runs the search in its own command and reads the result. Then the session posts the issue in a later command. A search
  and a post in one command post the issue before the session sees a match. For example, on 2026-10-18, orchestrator-m13
  ran the search and `gh issue create` in one command and posted #307. The search had found #285, which already covered
  one item of #307. A later edit of both issues moved the item.
- If an issue already covers the change, the session that posts the issue offers the user an extension of that issue
  (its body or its links) instead of a new issue. That session tells the user what each draft has that the other one
  does not have. For a match of the follow-up planner,
  [The review loop of a draft](planner.md#the-review-loop-of-a-draft) of planner.md gives the steps.
- The text of each post follows the simple-english bullet of [Docs](rules.md#docs) of rules.md. Before a session shows a
  draft to the user, the session runs the self-check of the simple-english skill over the file of the draft. A planner
  runs the check over its draft file before the first loop of
  [The review loop of a draft](planner.md#the-review-loop-of-a-draft) of planner.md. The check counts the words of each
  sentence. It also searches the draft for the banned words and for an `if` or a `when` inside a sentence. The session
  fixes each hit before it shows the draft. For example, on 2026-10-15, a draft had four sentences over the limit, and
  one search and one word count over the draft file found them.
- For a priority label on an issue, see [The body of an issue](planner.md#the-body-of-an-issue) of planner.md.

### The read in the write call

This rule covers each session that adds a blocked-by link to an issue, or changes the title or the body of an issue. The
session runs one Bash call with these steps, in this order:

1. Run `tasker status`.
2. Read the state of the issue, for example with `gh issue view <number> --json state -q .state`.
3. If `tasker status` lists no task for the full key of the issue and the state is `OPEN`, do the write.

If the issue is in flight or closed, the call skips the write, and the session tells the user. The issue is in flight
when `tasker status` lists a task for the full key of the issue.

A read in an earlier call can be old, because a task can start or the issue can close between the read and the write. On
2026-10-18, a new link of the relinked Docs chains landed on #302, which started after the planning session read the
tasks in flight. The same day, a script changed the body of #288 after #288 closed, because its check covered only the
tasks in flight.

A link can still land on a task that started between the read and the write. Then the session removes the link with the
command of [The blocked-by links](#the-blocked-by-links). The session tells the user that the link was a race. In that
case, the orchestrator did not skip a blocker.

## The blocked-by links

The rules for the links are in [The blocked-by links](planner.md#the-blocked-by-links) of planner.md. The commands below
work with gh 2.101.0:

- To add a link: `gh issue edit <blocked number> --add-blocked-by <blocker number>`.
- To remove a link: `gh issue edit <blocked number> --remove-blocked-by <blocker number>`.
- Both commands take issue numbers.
- To read the links of an issue: `gh api repos/<owner>/<repo>/issues/<number>/dependencies/blocked_by`.

## The project board

- The board is the user project "tasker": https://github.com/users/codeguru42/projects/3 (number 3, id
  `PVT_kwHOACGSlc4BmiTL`). It is linked to `codeguru42/tasker`.
- The Status field has the id `PVTSSF_lAHOACGSlc4BmiTLzhlK7j4`. Its options are Todo (`f75ad846`), In progress
  (`47fc9ee4`) and Done (`98236657`).
- A workflow of the board adds each new issue with the status Todo within a minute. The planner does not run
  `gh project item-add` for a new issue.
- The board moves an issue to Done when the issue closes. The board archives a closed item 7 days after its last update.
- To move a card:
  `gh project item-edit --project-id PVT_kwHOACGSlc4BmiTL --id <item id> --field-id PVTSSF_lAHOACGSlc4BmiTLzhlK7j4 --single-select-option-id <option id>`.
- The gh token needs the scopes `project` and `read:project`. If `gh project item-edit` fails with "missing required
  scopes [project read:project]", the user runs `gh auth refresh -s project,read:project`.
- A fine-grained token cannot open a project of a user, because its Projects permission applies only to an organization.

## Milestones

[The milestone of an issue](planner.md#the-milestone-of-an-issue) of planner.md gives the milestone of each issue. The
planner closes a milestone only when the user says so. Then it runs
`gh api -X PATCH repos/codeguru42/tasker/milestones/<number> -f state=closed`.
[Pick the tickets](pick-the-tickets.md#pick-the-tickets) of pick-the-tickets.md gives the report of an orchestrator when
its milestone is done.
