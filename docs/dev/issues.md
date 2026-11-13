# Filing issues

This page gives the steps and the GitHub facts to file issues, blocked-by links and milestones on GitHub.
[Before a post](#before-a-post) covers each session that posts an issue, except where a sentence names the planner.
[A recurrence](#a-recurrence) covers each session. The rest of the page is for the planner, but
[The blocked-by links](#the-blocked-by-links) also serves each session that decides links before a post.
[planner.md](planner.md) defines the terms "planner" and "blocked-by link", and [docs/sessions.md](../sessions.md)
defines the term "user". planner.md also holds the rules for what an issue says and where it goes. This page holds only
how to do it on GitHub.

## Before a post

- Each session that posts an issue, or changes the title or the body of an open issue, drafts the text first. The
  session shows the draft to the [user](../sessions.md) who works with that session. A request of the user such as "file
  an issue" or "draft a ticket" gets a draft first. For a change to an open issue, the draft shows the changed text. The
  session posts only after the user approves that draft, for example with "file it" or "post it".

  Each planner posts a reviewed draft with no approval of the user, as
  [The review loop of a draft](planner.md#the-review-loop-of-a-draft) of planner.md says. Approval still covers a
  comment and a draft that runs no review loop of that section. For a planner draft that waits for a decision of the
  user, [The escape hatch](planner.md#the-escape-hatch) of planner.md says what the answer does. The planner also makes
  sure of the kinds of GitHub objects to make, as [The order of the work](planner.md#the-order-of-the-work) of
  planner.md says.

- For a change of the title or the body of an open issue, the session reads both at the start of the draft. The draft
  starts from that read, not from an older draft file. The same read gives the start hash, the output of `sha256sum`
  over the JSON of the read. An example of such a read is
  `json=$(gh issue view <number> --json title,body) && printf '%s\n' "$json" | sha256sum && printf '%s\n' "$json" | jq -r '.title, .body'`.
  If the read fails, the session does not start the draft, and it tells the user.
  [The reads before the write](#the-reads-before-the-write) compares the start hash with a new hash of the issue right
  before the write.

  Other sessions can change an open issue after a post, and a post of an older text undoes their change. On 2026-11-04,
  the body of #766 changed about 15 minutes after its post, while the draft file of the planner still held the older
  paragraph.

- Right before each post, the session that posts the issue searches all the issues of the repo, open and closed, by
  title and by body, for the same change. Other sessions file issues at the same time, so the list changes between two
  turns. An example search is `gh issue list --state all --search "<words> in:title,body" --limit 1000`. The session
  runs the search in its own command and reads the result. Then the session posts the issue in a later command. A search
  and a post in one command post the issue before the session sees a match. For example, on 2026-10-18, orchestrator-m13
  ran the search and `gh issue create` in one command and posted #307. The search had found #285, which already covered
  one item of #307. A later edit of both issues moved the item.
- The session makes the body file in its own step with the Write tool or a separate call whose target is an absolute
  path. The body file is the draft file with its title line and the blank line after it taken out. Then the session runs
  `gh issue create -R <repo> --title '<literal title>' --body-file <absolute path of the body file> --milestone '<milestone>'`
  alone in a [plain call](#the-reads-before-the-write). Add `--label '<label>'` in the same call when the issue needs a
  label. The title is the title text, not a command that reads it. If the title has a single quote, use double quotes.

  Such a title holds no `$`, backtick, `\` or `\"`. On 2026-11-12, auto mode denied two compound `gh issue create`
  calls. A compound call needs an allow rule for each part, and a redirect gets its own check.

- If an issue already covers the change, the session that posts the issue offers the user an extension of that issue
  (its body or its links) instead of a new issue. That session tells the user what each draft has that the other one
  does not have. For a match of a planner, [The review loop of a draft](planner.md#the-review-loop-of-a-draft) of
  planner.md gives the steps.
- Each session that posts an issue and is not a planner decides the blocked-by links of its draft. The session finds the
  open issues and tasks in flight that edit the same files as the draft. It also finds the issues that the draft needs.
  It uses [The blocked-by links](planner.md#the-blocked-by-links). A session with no role is an ad hoc planner for a
  draft of its ticket subagent.

  A session that is not a planner shows the result with the draft: each link and its reason, or "no links" and the
  reason. It names each file of the check. After the post, it adds each approved link under
  [The blocked-by links](#the-blocked-by-links) and [The reads before the write](#the-reads-before-the-write).

  For a draft of its ticket subagent, the ad hoc planner adds the links in that subagent's report with no approval of
  the user. It gives each link and its reason in the report of
  [The post of the follow-up planner](planner.md#the-post-of-the-follow-up-planner).

- The text of each post follows the simple-english bullet of [Docs](rules.md#docs) of rules.md. Before a session shows a
  draft to the user, the session runs the self-check of the simple-english skill over the file of the draft. The ticket
  subagent of a planner runs the check over its draft file before the first loop of
  [The review loop of a draft](planner.md#the-review-loop-of-a-draft) of planner.md. The check counts the words of each
  sentence. It also searches the draft for the banned words and for an `if` or a `when` inside a sentence. The session
  fixes each hit before it shows the draft. For example, on 2026-10-15, a draft had four sentences over the limit, and
  one search and one word count over the draft file found them.
- For the priority of an issue, see [The body of an issue](planner.md#the-body-of-an-issue) of planner.md and
  [The project board](#the-project-board).
- Right after each post of the body of an issue, the session compares the posted body with the body of its draft file.
  The body of a draft file is the file with its title line and the blank line after it taken out. An example of the
  compare is `diff <(gh issue view <number> --json body -q .body) <body of the draft>`. The compare ignores blank lines
  at the end, because the read adds one.

  A difference is a failed post. The session then follows [The reads before the write](#the-reads-before-the-write) and
  runs `gh issue edit <number> -R <repo> --body-file <absolute path of the body file>` alone in a plain call. It
  compares again. If the read fails, or the second compare also fails, the session stops and tells the user. On
  2026-10-26, a script left an old second design after the Docs section of #604, and only a review agent saw it.

### The reads before the write

This rule covers each session that adds a blocked-by link to an issue, or changes the title or the body of an issue. The
session runs each read in its own Bash call before the write. The session reads each output itself. No shell test, `if`
or `$(...)` decides the write.

1. Run `tasker status` in its own call.
2. Read the issue state in its own call, for example with `gh issue view <number> --json state -q .state`.
3. For a title or body change, read the hash in its own call. The read can use
   `json=$(gh issue view <number> --json title,body) && printf '%s\n' "$json" | sha256sum` because it writes nothing.
4. After the last read, run the write alone in a plain call.

Run no other step between the last read and the write. Run no other write between the reads and the write. A plain call
is one Bash call that holds one command. It has no `cd`, no `;`, no `&&`, no `||`, no pipe, no `if`, no redirect and no
`$(...)`.

For a link, run `gh issue edit <blocked number> -R <repo> --add-blocked-by <blocker number>`. For a title or body
change, run `gh issue edit <number> -R <repo> --title '<literal title>' --body-file <absolute path of the body file>`.
Use only the flags for the change.

If the issue is in flight or closed, the session skips the write, and the session tells the user. The issue is in flight
when `tasker status` lists a task for the full key of the issue. If `tasker status` or a read of the issue fails, the
session skips the write, and the session tells the user.

If the hash read prints a hash that is not the start hash, the session skips the write, and the session tells the user.
In that case, the issue changed after the start of the draft. The session starts the draft again from the new title and
body, as [Before a post](#before-a-post) says. A second post after a failed compare of [Before a post](#before-a-post)
skips the hash read. The issue then holds the text of the failed post. A change of both the title and the body goes in
one write because the first write changes the hash.

Before the reads for a new blocked-by link, the session does a walk of the open blockers. The walk starts at the blocker
of the new link. The session reads the blockers of each issue with `--paginate` and the read command of
[The blocked-by links](#the-blocked-by-links). It follows only blockers with the `state` `open`, in lowercase, and it
reads each issue one time. If the walk reaches the blocked issue of the new link, the link closes a cycle. A cycle is a
chain of blocked-by links that comes back to its first issue.

If the walk finds a cycle, the session skips the write. It tells the user each issue of the cycle. If a read of the walk
fails, the session skips the write and tells the user. If the session reverses a link, it removes the old link before
the walk.

While no ticket of a cycle is in flight, a cycle stops each ticket of the cycle and each ticket that waits for one of
them. A walk in an earlier call can be old at the write, and this rule accepts that. On 2026-10-26, the link "#477 waits
for #572" closed a cycle of four issues, and GitHub took the link.

A read in an earlier call can be old, because a task can start or the issue can close between the read and the write. On
2026-10-18, a new link of the relinked Docs chains landed on #302, which started after the planning session read the
tasks in flight. The same day, a script changed the body of #288 after #288 closed, because its check covered only the
tasks in flight.

The reads and the write are now separate calls of one session, a few seconds apart. The section already accepts an older
read: a walk in an earlier call can be old at the write. For #302, the read came at an earlier step of the planning, not
right before the write. On 2026-11-04, the body of #766 changed about 15 minutes after the post. The race paragraph
still removes a link that lands on a task in flight.

A link can still land on a task that started between the reads and the write. Then the session removes the link with the
command of [The blocked-by links](#the-blocked-by-links). The session tells the user that the link was a race. In that
case, the orchestrator did not skip a blocker.

Before a session asks the user to approve a write that the reads can skip, it runs `tasker status` and reads the issue
state. The question names the result, for example: "#863 is in flight in orchestrator-docs, in `awaiting_plan_review`.
Do you want the link anyway?" One answer of the user then covers the case of a skip too. This rule does not apply to a
session that already has the approval of the user and does not ask.

On 2026-11-12, the main session asked the user to approve the link "#863 is blocked by #756". It said that no task ran
for #863, but it did not read `tasker status` first. The user said "do it", and the guard printed `IN FLIGHT: skip`. The
session then needed a second question, and the user said "go ahead and add the link".

For a blocked-by link, the skip of an issue in flight covers only a soft blocker. A soft blocker is a link with no need
of the work of the other ticket, for example for two tickets that edit one file. A hard blocker is a link for a ticket
that needs the work of the other ticket. The session adds a hard blocker to an issue in flight, and it tells the user. A
direct word of the user to add a soft blocker overrides the skip for that link. The session does not remove a hard
blocker or a link of such a word as a race.

The paragraph before this one does not cover a closed issue, a failed read or a change of a title or a body.

## A recurrence

A recurrence is a problem that shows again while an open issue already covers its fix. A recurrence comment is a comment
on that open issue that gives the new case. This section covers each session, also during the work.

- A session that finds a recurrence and is not the planner sends the recurrence to the planner, as each lesson goes. The
  message names the open issue. For the orchestrator, the planner bullet of
  [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) of pick-the-tickets.md gives the
  message.
- The planner drafts the recurrence comment. The comment gives the ticket, the date and the facts of the new case. The
  planner shows the draft to the user, as [Before a post](#before-a-post) says. The planner posts the comment after the
  approval.
- With the draft, the planner gives the user one recommendation for the issue: no change, a priority, another milestone,
  or new blocked-by links. The user decides. After the approval, the planner makes the change in the same post round.
- A change of the milestone follows [The milestone of an issue](planner.md#the-milestone-of-an-issue) of planner.md. A
  change of the links follows [The blocked-by links](planner.md#the-blocked-by-links) of planner.md, as for any issue.
  That also covers the read of `tasker status` before a link.

On 2026-10-24, #406 showed the problem of #391 again during the work, not in a `/session-review`. The user said: "if we
see a recurrence we can bump up its priority and adjust the milestone and blockers."

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
- The field `Priority` has the id `PVTSSF_lAHOACGSlc4BmiTLzhlK7oI`. Its options are `P0` (`79628723`), `P1` (`0a877460`)
  and `P2` (`da944a9c`). `P0` is the highest priority, and `P2` is the lowest. The priority of an issue is the value of
  this field on the card of the issue. A card with no value has no priority.
- To set the priority of an issue:
  `gh project item-edit 3 --owner codeguru42 --url https://github.com/codeguru42/tasker/issues/<number> --field Priority --value <option>`.
  `<option>` is the name of an option of the field `Priority`, for example `P0`. This form and the form of the bullet
  "To move a card" need gh 2.97.0 or later.
- To read the priority of an issue:
  `gh project item-list 3 --owner codeguru42 --limit 1000 --format json --jq '.items[] | select(.content.type == "Issue" and .content.number == <number>) | .priority'`.
  The command prints the option, for example `P0`. If the card has no priority, it prints an empty line. If the issue
  has no card, the command prints nothing.
- `gh project item-list` lists at most 30 items by default. So each `gh project item-list` command of the docs gives
  `--limit 1000`.
- The list of `gh project item-list` can miss the card of an issue. On 2026-11-04, the list missed the card of the open
  issue #765, while `gh issue view 765 --json projectItems` showed the card in Todo. No one measured the cause. So the
  commands of the docs that change a card find the card from the issue, not from the list.
- A workflow of the board adds each new issue with the status Todo within a minute. The planner does not run
  `gh project item-add` for a new issue. The workflow sets no priority, so a new issue has no priority.
- The board moves an issue to Done when the issue closes. The board archives a closed item 7 days after its last update.
- To move a card:
  `gh project item-edit 3 --owner codeguru42 --url https://github.com/codeguru42/tasker/issues/<number> --field Status --value "<option>"`.
  `<option>` is the name of an option of the Status field, for example `In progress`.
- The gh token needs the scopes `project` and `read:project`. If `gh project item-edit` fails with "missing required
  scopes [project read:project]", the user runs `gh auth refresh -s project,read:project`.
- A fine-grained token cannot open a project of a user, because its Projects permission applies only to an organization.

## Milestones

[The milestone of an issue](planner.md#the-milestone-of-an-issue) of planner.md gives the milestone of each issue. The
planner closes a milestone only when the user says so. Then it runs
`gh api -X PATCH repos/codeguru42/tasker/milestones/<number> -f state=closed`.
[Pick the tickets](pick-the-tickets.md#pick-the-tickets) of pick-the-tickets.md gives the report of an orchestrator when
its milestone is done.

Before the command, the planner reads the open issues of the milestone. If the read or the command fails, the planner
tells the user, and the milestone stays open. If the milestone has an open issue, the planner tells the user. It then
runs the command only on a new word of the user. After the command, the planner deletes each memory note whose delete
condition is the close of that milestone. Then the planner tells the user the result.
