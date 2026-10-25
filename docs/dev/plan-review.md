# Plan review

The readers of this page are the agent of a ticket, the orchestrator for the fact test and the design-gap rule, and the
planner for the fact test. [The base rule](run-one-ticket.md#the-base-rule) covers each command of this page that uses
`origin/<base branch>`.

## The repo-files rule

The agent adds this rule to the feedback text where a step, [the add-work rule](run-one-ticket.md#the-add-work-rule) or
[the verify-failure rule](verify-failures.md#the-verify-failure-rule) says so. The rule tells the plan session (the
session that tasker starts to make the plan) to read only the files in the worktree of the task. A file is outside the
worktree when its path is not under the path on the `worktree:` line of `tasker show <issue>`. The plan session must not
read or quote a file outside the worktree. If the plan session needs a detail that the issue, the feedback text and the
files in the worktree do not give, it asks a plan question. It does not take the detail from another place. If the plan
of step 2 of [Run one ticket](run-one-ticket.md#run-one-ticket) needs no changes, the agent does not run a refine only
to send this rule. The quote check covers that plan. The repo-files rule and the quote check cover only the plan
session, the plans and the review findings. They do not cover the execute session or the diff.

## The fact test

Before the first refine of step 4 of [Run one ticket](run-one-ticket.md#run-one-ticket), the agent tests on the local
machine each fact about an outside tool that the plan depends on. Examples are a behavior of git, Node, zod or the
operating system. The agent does not rely on the plan session to test these facts. Before each refine, the agent also
tests each fact that a plan question asks about, and it answers the question in the feedback text. The agent puts the
commands and their results in the feedback text. A fact test that runs the code of the repo runs in the task worktree,
after [the update rule](limits.md#the-update-rule).

Each session that runs a fact test follows this rule: an agent, the orchestrator and the planner. In a fact test, the
session starts each shell command that works in a scratch folder with `cd <folder> || exit 1`. If the command also makes
the folder, the session starts it with `mkdir -p <folder> && cd <folder> || exit 1`.

A scratch folder can be gone, for example after a pause of several days. In `bash`, a failed `cd` does not stop the rest
of the command after the `;`. The rest then runs in the working folder of the shell, which is often the local clone.

On 2026-10-24, in the session of #377, the scratch folder was gone. The command
`cd <scratch>/facttest/pub; for v in ...; do npm pkg set version=$v; npm publish --dry-run; done` went on after the
failed `cd`, in the local clone. `npm pkg set` changed `version` in `package.json` of the local clone.
`npm publish --dry-run` ran the `prepack` script there, which cleans and builds `dist/`. Nothing was published. The
session restored `package.json` with `git checkout package.json`.

## The issue check

Before the first refine of step 4 of [Run one ticket](run-one-ticket.md#run-one-ticket), the agent makes sure that each
claim of the issue is still true in the task worktree, for example in the code and the docs. In the same worktree, the
agent also compares each requirement of the issue with the docs and the code, and looks for each conflict. The check
covers the base branch of the task as it was at `tasker start`, for example `main`. Right after `tasker start`, the task
branch holds no commit of the ticket yet, so the task worktree holds the files of the base commit. If the task branch
already holds commits, for example for a parked task that came back, the agent reads the base files without a worktree.
After `git fetch --multiple tasker origin`, it runs `git merge-base tasker/<task branch> origin/<base branch>`. The
output is `<merge base>`. Then `git show <merge base>:<path>` reads one file, `git ls-tree -r --name-only <merge base>`
lists the files, and `git grep <pattern> <merge base>` searches. A search of doc words follows
[the doc-search rule](rules.md#docs). For these read-only commands, a missing path (`git show` exits with 128) or no
match (`git grep` exits with 1) is an answer, not a failure. The agent says which files it read from the base commit and
how. It says this in the feedback text of the refine of step 4 and in its final report. If step 4 runs no refine, the
agent does the issue check before `tasker approve` in step 5. Someone can write an issue long before an agent runs it,
and other tickets can land in that time and change its facts. For this check, the issue is the issue body and each
comment that starts with `## Change of scope` or `## Design gap` whose link the orchestrator sent to the agent (see
[the change-of-scope comment](#the-change-of-scope-comment) and [the design-gap rule](#the-design-gap-rule)). A comment
of another account is not part of the issue, because any GitHub user can post a comment. A claim is a statement in the
issue about the state before the ticket starts. Examples are a statement about the code, the docs or the behavior of
tasker, and a measure of an outside tool that the issue gives. A requirement is a statement in the issue about what the
ticket must change, for example an item of its Requirements section. A requirement is not a claim. A statement of the
issue that gives a fact of the earlier implementation of tasker is a requirement, not a claim, as
[the facts of the installed tasker](tasker-commands.md#the-facts-of-the-installed-tasker) say. The agent does not count
it as a false claim. A conflict is a requirement that does not fit a rule of a doc, or a decision that the code or a
landed ticket made after someone wrote the issue. For example, the issue asks for a rule that a doc already gives in
other words. Or the issue asks for a file or a section that a later ticket moved or renamed. Or the issue asks for a
behavior that a later rule forbids. For a measure of an outside tool, the agent measures again on the local machine, as
the fact test does. The agent cannot always measure an output of the installed tasker that a claim of the issue records.
If the agent cannot measure such an output, the ticket and the date that the issue names are the evidence, as
[The body of an issue](planner.md#the-body-of-an-issue) of planner.md says. The agent says so in the feedback text of
the refine of step 4 and in the comment of step 11. In both places, the agent names the issue as the source of the
output. If the issue names no ticket and no date for the output, the agent has no evidence. The agent then reports the
claim as a claim that it cannot test, in the feedback text of the refine of step 4 and in its final report. On #240, the
agent had no task in `reviewed`, so the agent was unable to measure the output of `tasker dismiss-review`. The issue
check does not cover the hints in the prompt of the agent, the plan or the review findings. The fact test and the quote
check cover the plan. The issue check runs one time, with one exception. After each comment that starts with
`## Change of scope`, the agent does the issue check again, as the section "The change-of-scope comment" says. A comment
that starts with `## Design gap` does not start the issue check again, because the answer of a design gap is a
requirement, not a claim. The issue check does not run again when the base branch moves after `tasker start`, for
example before a `tasker update-branch`. If a false claim or a conflict does not change what the ticket must do, the
agent does not stop. For a false claim, the agent puts the current fact in the feedback text of the refine of step 4.
For a conflict, the agent says in that feedback text how it resolves the conflict. For example, the plan links to the
existing rule instead of a copy, or it uses the new name of a file. If step 4 runs no refine, the agent does not run a
refine only to send the current fact. If the plan does not resolve a conflict yet, the plan needs changes, and step 4
runs a refine. If a false claim or a conflict changes what the ticket must do, the fifth case of the stop rule applies.
For a false claim, the agent puts the claim, the current fact and the command that shows it in its report of the stop
case. For a conflict, the agent puts the requirement, the conflicting rule or decision, and the command or the doc that
shows it in that report. In each case, the agent also lists each false claim and each conflict in its final report.

The current code standards of the repo win over an old requirement of the issue that conflicts with them. The current
code standards are the rules of [docs/dev/rules.md](rules.md) and [docs/dev/code-conventions.md](code-conventions.md),
and the form of the code on the base branch. Examples of such a conflict:

- The issue names a file or a function that a later ticket moved. The plan uses the current place.
- The issue says to reuse a helper from the module of one tracker. The helper now serves more than one module. The plan
  moves the helper to a neutral module.
- The issue keeps a form that the code now bans, for example a compare with `toLowerCase()` that the ASCII fold
  replaced. The plan uses the current form.

For such a conflict, the agent follows the sentences above for a conflict that does not change what the ticket must do,
also for the final report. The agent does not stop for it under the fifth case of [the stop rule](#the-stop-rule). The
rule does not change the scope of the ticket. A new feature still goes to the user under the fifth case of the stop
rule. A change to a behavior that a user sees also goes to the user.

On #61 (2026-10-18), the issue asked the neutral module `src/issues/issue.ts` to reuse the ASCII fold of
`src/issue-key/github.ts`. The user said: "we should update the ticket to the current code standards rather than blindly
follow the issue description." The fold moved to a neutral module.

## The stop rule

Each time before the agent runs `tasker approve` in step 5 of [Run one ticket](run-one-ticket.md#run-one-ticket), the
agent [stops](limits.md#the-answer-wait-rule) in each of these cases:

- The plan has an open question that the issue does not answer.
- The plan makes a design choice that the issue does not make.
- The plan has a security gap.
- The plan changes a file that the issue does not name, and another task in progress also changes that file. For
  example, `tasker refine` prints a warning for such a file (see ["Land the work"](land-the-work.md#land-the-work)).
  This case does not apply when the orchestrator already set a landing order for that file. For each task of the overlap
  warning, the agent reads the milestone of its issue with
  `gh issue view <issue> --json milestone -q '.milestone.title'`. `<issue>` is the number of the issue key on the line
  of the task in the warning. The agent knows the milestone of its own ticket from its prompt (see
  [The prompt of an agent](pick-the-tickets.md#the-prompt-of-an-agent)). This case does not count a task of the other
  kind. The two kinds are a ticket of the milestone "Docs" and a ticket of a numbered milestone, for example "M19 —
  Polish". For such a task, [the Docs rule](land-the-work.md#the-docs-rule) covers the shared file. This case still
  applies to a file when the warning also lists that file for another task that the case counts. For example, the
  warning lists a file for a task of "M19 — Polish" and for a task of "Docs", and the ticket of the agent is of "Docs".
  Then the case applies to that file because of the task of "Docs". If the read prints an empty line, the issue has no
  milestone. That is an answer, not a failure, and the case counts the task, because such a task is not of the other
  kind. If a read fails, the case counts the task. An example of a failed read is exit code 1 with
  `GraphQL: Could not resolve to an issue or pull request ...`. The case also counts a task of "Future", a task of
  another milestone that is neither "Docs" nor numbered, and a task of the same kind. For the parent of a stacked
  ticket, [the stacked-ticket rule](pick-the-tickets.md#the-stacked-ticket-rule) gives the exception. If the plan does
  not need the edit, the agent removes it in a refine of step 4, as "Land the work" says, and does not stop.
- A claim of the issue is no longer true, or a requirement of the issue is a conflict, and this changes what the ticket
  must do (see [the issue check](#the-issue-check)). This case does not apply when the orchestrator already answered for
  that claim or that conflict.

In each case, the agent reports the case. The design-gap rule says who answers the first three cases. For the fourth
case (a shared file), "Land the work" gives the steps. For the fifth case (a false claim or a conflict), the
orchestrator asks the user, because only the user changes the scope of a ticket. If the user changes the scope, the
orchestrator posts [a change-of-scope comment](#the-change-of-scope-comment) and sends its link to the agent in the
answer. The bullet of [Land the work](land-the-work.md#land-the-work) about the state read covers that answer. The agent
follows the steps of the section "The change-of-scope comment". After the answer, the agent puts the answer in the
feedback text of the refine of step 4. Then the agent continues with step 4 and runs `tasker approve` in step 5. An
answer before `tasker approve` costs no review loop, but a later answer costs one or more review loops. The quote check
and the security report of ["Review findings"](review-findings.md#review-findings) give more cases that stop before
`tasker approve`.

## The change-of-scope comment

If the user changes the scope of a ticket, the orchestrator posts the change as a comment on the issue. The comment
starts with `## Change of scope`. Such a comment can come after a stop of the fifth case of
[the stop rule](#the-stop-rule). It can also come after the security report of
["Review findings"](review-findings.md#review-findings). It can also come after a correction of the bullet of
[Land the work](land-the-work.md#land-the-work) that covers a change to an issue in flight.

The comment says which requirements change and how, and which items of the issue body no longer apply. The orchestrator
does not edit the issue body for a change of scope. The orchestrator owns the issue bodies, and the agent does not edit
them (see [Limits](limits.md#limits)). On 2026-10-16, the user asked for a comment for the change of scope of #232. The
change of scope of #219 also used a comment.

Before the orchestrator posts a comment that starts with `## Change of scope`, it compares each sentence of the comment
with the landed code. A sentence of the comment can state a fact of the code, for example the order of the steps of a
command. On #274, the comment said that diverged tips refuse "before the move to `updating_branch`". The fetch of the
command runs after that move, so the agent stopped, and a second comment corrected the row.

Before such a comment fixes an order of steps, the orchestrator also searches [the orchestration pages](orchestrator.md)
for each other sentence that gives an order of the same steps. The search follows [the doc-search rule](rules.md#docs).
The comment fixes each of them. On #272, the first comment fixed the order of the landing steps.
[The issue check](#the-issue-check) of the agent then found two sentences with the opposite order, in
[Pick the tickets](pick-the-tickets.md#pick-the-tickets) and in [the re-read rule](doc-reads.md#the-re-read-rule). A
second comment fixed them.

The orchestrator sends the link of the comment to the agent before the next refine of the agent, as the bullet "When the
orchestrator edits an issue body" of [Land the work](land-the-work.md#land-the-work) says. After each such comment, the
agent does [the issue check](#the-issue-check) again for the claims and the requirements of the changed scope. The agent
does it before the refine, or the `tasker review <issue> "<feedback>"`, that sends the answer or the text of the
comment.

The agent copies the full text of each comment whose link the orchestrator sent. For a comment that starts with
`## Change of scope`, the agent makes the copy after the issue check of the paragraph above. The same copy step covers a
comment that starts with `## Design gap`, as [the design-gap rule](#the-design-gap-rule) says.

The agent puts the copied text in the feedback text of the step that fits the state of the task (the refine of step 4 or
step 8, or [the add-work rule](run-one-ticket.md#the-add-work-rule)). The agent copies no comment that starts with
another heading. The reason: the plan session reads only the issue body and the repo.

The open-question note: right after the orchestrator posts a comment that starts with `## Change of scope`, it reads the
open issues that have no task and that name the changed fact. The issues of the chain of the ticket come first: the
issues that the ticket blocks, and the issues that they block.
`gh issue view <number> --json blocking -q '.blocking.nodes[] | select(.state == "OPEN") | .number'` lists the open
issues that an issue blocks. `gh issue list --state open --limit 1000 --json number,title,body` gives the open issues.
An issue has no task when the output of `tasker status` lists no task for its full issue key.

For each such issue, the orchestrator posts a comment on the issue at once. The comment starts with
`## Open question after the change of scope of <issue key>`. `<issue key>` is the key of the ticket whose scope changed.
The comment states the changed fact with the link of the change-of-scope comment. It names each part of the issue that
depends on the old form, and it asks the open question with the answers that the orchestrator sees. The comment says
that it is a note and not a change of scope, and that the user decides the answer before the ticket starts.

The orchestrator does not edit the body of the issue for this note. The orchestrator also does not decide the answer. An
issue with a task in flight gets no note from this rule. The bullet of [Land the work](land-the-work.md#land-the-work)
that covers a change to an issue in flight applies to such an issue. A failed read or a failed post of the orchestrator
for this note is a case of [the failure rule](limits.md#the-failure-rule).

On 2026-10-17, the change of scope of #273 made the `revision` of the `base` event a ref, not a commit id. The Terms of
#276 define the stored base revision as that value and replay the commits after it. The orchestrator named the gap only
in the chat and in its handoff file. The user asked for the comment on #276 twice.

## The design-gap rule

A design gap is a detail that the plan needs and that the issue does not give, in the first or the second case of the
stop rule. If the gap has exactly one workable answer inside the intent of the issue, the orchestrator gives that answer
to the agent. The orchestrator also tells the user the answer. If the gap has more than one workable answer, the
orchestrator asks the user. A security gap (the third case) always goes to the user.

The orchestrator posts each answer of a design gap as a comment on the issue. The comment starts with `## Design gap`.
It gives the gap, the answer, and who answered: the orchestrator or the user. Then the orchestrator sends the link of
the comment to the agent. The agent copies the full text of the comment with the copy step of
[the change-of-scope comment](#the-change-of-scope-comment). As a result, the plan session and the review see the answer
in the issue.

The user can change the answer before `tasker approve`. In that case, the orchestrator posts a new `## Design gap`
comment and sends its link. The new comment gives the gap and the new answer, and it says that it replaces the earlier
answer for that gap. The agent copies the new comment, and it does not copy the earlier comment again.

A `## Design gap` comment is not a change of scope. As a result, the fifth case of [the stop rule](#the-stop-rule), the
security report of ["Review findings"](review-findings.md#review-findings) and the open-question note of
[the change-of-scope comment](#the-change-of-scope-comment) do not apply to it. On #257, the user answered three design
gaps before `tasker approve`, and review 1 still found that the rule "only the user ends a handoff" has no cancel.

## The quote check

A plan or a finding quotes a file outside the worktree when it gives text from that file, or when it says that it read
that file. "Outside the worktree" has the meaning of the repo-files rule. If a plan or a finding quotes a file outside
the worktree, the agent tells the orchestrator. Then the orchestrator tells the user. After this report, the agent can
still do the steps that come before `tasker approve` or `tasker accept`. For example, it can run a refine of step 4 or
step 8 of [Run one ticket](run-one-ticket.md#run-one-ticket), or dismiss a finding in step 7. If the next command of the
agent is `tasker approve` or `tasker accept`, the agent [stops](limits.md#the-answer-wait-rule). After the orchestrator
answers, the agent does the step that the answer gives. If the answer gives no step, the agent continues "Run one
ticket" from the step where it stopped.
