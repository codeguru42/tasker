# Plan review

The readers of this page are the task subagent of a ticket, the orchestrator for the fact test, the stop rule and the
design-gap rule, and the planner for the fact test. A ticket subagent and its review agents also read
[The state of the user](#the-state-of-the-user). [The base rule](run-one-ticket.md#the-base-rule) covers each command of
this page that uses `origin/<base branch>`.

## The repo-files rule

The task subagent adds this rule to the feedback text where a step,
[the add-work rule](run-one-ticket.md#the-add-work-rule) or
[the verify-failure rule](verify-failures.md#the-verify-failure-rule) says so. The rule tells the plan session (the
session that tasker starts to make the plan) to read only the files in the worktree of the task. A file is outside the
worktree when its path is not under the path on the `worktree:` line of `tasker show <issue>`. The plan session must not
read or quote a file outside the worktree.

The plan session also does not read a web page or a web search result. Examples of the tools are WebFetch and WebSearch.
A web page and a web search result count like a file outside the worktree. On #430 (2026-10-25), the plan session read
web pages on permission modes, sandboxing and hooks with WebFetch, and plan v1 quoted them.

The plan session also runs no command that reads or changes something outside the worktree. The reason: a command on
another session acts on a real session, and the output of such a command is a detail from another place. An example is a
command on another session, its pane or its tab, such as `herdr agent wait`. On #473, the plan session of plan v1 ran
`herdr agent wait wB:p4 --timeout 1000` on the pane of another session and `herdr tab get wB:t4` on the tab of
operator-docs. Another example is a command that asks a program of the local machine for a fact about its behavior, for
example `claude --help`. A command of the repo that runs in the worktree is not such a command, for example `git`, `ls`,
`grep` and an `npm` script of the repo.

If the plan needs a fact about the behavior of a program, the plan session asks a plan question, as this rule says for a
detail. If the plan session needs a detail that the issue, the feedback text and the files in the worktree do not give,
it asks a plan question. It does not take the detail from another place.

If the plan of step 2 of [Run one ticket](run-one-ticket.md#run-one-ticket) needs no changes, the task subagent does not
run a refine only to send this rule. The quote check covers that plan. The repo-files rule and the quote check cover
only the plan session, the plans and the review findings. They do not cover the execute session or the diff.

## The fact test

Before the first refine of step 4 of [Run one ticket](run-one-ticket.md#run-one-ticket), the task subagent tests on the
local machine each fact about an outside tool that the plan depends on. Examples are a behavior of git, Node, zod or the
operating system. The task subagent does not rely on the plan session to test these facts. Before each refine, the task
subagent also tests each fact that a plan question asks about, and it answers the question in the feedback text. The
task subagent puts the commands and their results in the feedback text. A fact test that runs the code of the repo runs
in the task worktree, after [the update rule](limits.md#the-update-rule).

If no refine runs before the first `tasker approve`, the task subagent does the fact test before it. The task subagent
then adds the commands and their results to the list of files that it sends after `tasker approve`, as
[Land the work](land-the-work.md#land-the-work) says. It also puts them in the comment of step 11 of
[Run one ticket](run-one-ticket.md#run-one-ticket). The reason: the plan session cannot do a test that reads outside the
worktree, because [the repo-files rule](#the-repo-files-rule) bans such a command.

A fact test of a limit on output entries uses a count over the expected limit, because a smaller count can hide it. The
expected limit comes from a doc of the tool, a page size, a field such as `maxResults` or an earlier measure. A fact
test that a read gives all entries is also such a fact test. If no source gives a limit, the session picks the count,
and this choice is open on purpose. The result then names the highest count, and it says that no one measured a higher
count. On #550 (2026-10-31), `acli jira workitem view` gave all 60 of 60 comments, but only the newest 100 entries of
1,010.

A fact test can decide between two or more options, for example before a decision of the user. Then it runs each option
in the way that the option will run after the choice. It does not run a smaller or a simpler form of an option, because
such a form can give another result. An issue that gives the runs of such a fact test gives each run in that way.

On 2026-11-12, the body of #875 gave a fact test of two options for a question pane, before a decision of the user. A
question pane is a herdr pane for one open question of the user. In option A, one subagent opens the pane, and after the
decision of the user, a second subagent closes it. The session asked whether run 2 uses one subagent or two. The user
said: "yes, we want to measure how it will be run when we use it". So run 2 kept two subagents.

Each session that runs a fact test follows this rule: a task subagent, the orchestrator and the planner. In a fact test,
the session starts each shell command that works in a scratch folder with `cd <folder> || exit 1`. If the command also
makes the folder, the session starts it with `mkdir -p <folder> && cd <folder> || exit 1`.

A scratch folder can be gone, for example after a pause of several days. In `bash`, a failed `cd` does not stop the rest
of the command after the `;`. The rest then runs in the working folder of the shell, which is often the local clone.

On 2026-10-24, in the session of #377, the scratch folder was gone. The command
`cd <scratch>/facttest/pub; for v in ...; do npm pkg set version=$v; npm publish --dry-run; done` went on after the
failed `cd`, in the local clone. `npm pkg set` changed `version` in `package.json` of the local clone.
`npm publish --dry-run` ran the `prepack` script there, which cleans and builds `dist/`. Nothing was published. The
session restored `package.json` with `git checkout package.json`.

An answer of a model about its own instructions is not a fact test. On 2026-11-01, orchestrator-m27 passed a claim to a
planner as a finding. The only sources of the claim were two answers of a model about its own instructions. The planner
asked for the source, and the claim was taken back.

### The state of the user

The state of the user is each file, setting, login and job of the user that a program reads or runs later. It also
covers such state at an outside service. Examples are the crontab, the systemd units of the user, a configuration file,
the login of a tool and the credits of an OpenRouter account. A scratch folder is a new folder that a session makes for
one measure, not in a folder that a program reads, such as `$HOME/.config`. The files of a scratch folder, of the folder
of a task subagent and of a task worktree are not such state. A read that changes nothing is not a change of the state
of the user, for example `crontab -l`.

In this subsection, a covered session is a task subagent, the orchestrator, a ticket subagent or a review agent of a
ticket subagent. A covered session changes no state of the user, unless the user approved the command of that change.
The ban also covers a change that the covered session undoes after the measure. A command that a step of
[the orchestration pages](../orchestrator.md) or of [the planner pages](../planner.md) names is not such a change.
Examples are `git fetch origin` and a `tasker` command. A measure of a fact is not such a step, also in
[the fact test](#the-fact-test) or [the issue check](#the-issue-check).

Whether a write changes the state of the user is a judgment. The judgment is open on purpose, and the covered session
that runs the command makes it. In doubt, the covered session treats the write as a change of the state of the user. A
file that a program writes by itself for its own run is not such state, for example the transcript of a `claude -p` run.
A new issue on a Jira site of the user is such a change.

A measure that needs such a change becomes a question for the user. The question gives the command and its undo step
word for word, and what each one changes. It also says what the undo step changes beyond the measure, for example
`crontab -r`, which removes the whole crontab of the user. If a change has no undo step, the question says so, for
example for spent credits. One question can give each such measure of one step of the covered session. Until the answer,
each text that uses the fact of the measure says next to the fact that no one tested it.

Only a word of the user approves the command. An answer of the operator and the recommendation mode of
[A decision of the user](working-with-the-user.md#a-decision-of-the-user) do not approve it. A message of another
session carries an approval only with the word of the user and the command and its undo step word for word. An accept at
a permission prompt of Claude Code also does not approve it. Words of the user that let the sender decide count as a
decline. This sentence wins over the bullets that start "If the user says that the sender decides" in
[The answer](operator-items.md#the-answer) and "The user can say that the sender decides" in
[the escape hatch](planner.md#the-escape-hatch).

An approval covers one run of the command and of its undo step, word for word. If the user approves a changed command or
a changed undo step, the approval covers the changed text. An issue body that names a measure does not approve it. The
reason: the state of the user can change between the post of the issue and the run of the measure. After an approval,
the covered session runs only that command, its undo step and reads that change nothing.

A failed run is a command or an undo step of an approval that cannot start. An undo step that does not give back the
earlier state is also a failed run. An exit code that is the fact under test is a result, not a failed run. After a
failed run, the covered session runs nothing more, and it reports the state that stays. A prompt of a covered session
asks for no measure that needs such a change, unless the user approved its command. This subsection wins over each rule
that asks a session for a measure, for example the issue check.

A task subagent [stops](limits.md#the-answer-wait-rule) at a measure that needs a change of the state of the user. Its
report gives the question and the fact that the measure tests. The orchestrator does not answer the question, also not
under [the design-gap rule](#the-design-gap-rule). It sends the question to [its operator](../operator.md) as an item,
in the form of [The form of an item](operator-items.md#the-form-of-an-item). The question is a question for the user
alone, so the operator sends no [answer of the operator](operator-items.md#the-answer). The orchestrator sends the
answer of the user to the task subagent with `SendMessage`.

For a measure of its own that needs such a change, the orchestrator also sends the question to its operator as an item.
A ticket subagent follows [The state of the user](planner.md#the-state-of-the-user) of planner.md for the outcomes of
the answer. The answer of the user on a question of a task subagent or of the orchestrator has one of these outcomes:

- The user approves the command. The message of the orchestrator to the task subagent gives the approved command and its
  undo step word for word. The covered session that asked runs them, as this subsection says. Then it goes on from the
  step where it stopped, and it uses the result as [the fact test](#the-fact-test) says.
- A run of an approval fails. Then a task subagent stops, and the orchestrator tells the user the state that stays. The
  orchestrator asks the user for the next step and sends it to the task subagent. For a run of the orchestrator,
  [the failure rule](limits.md#the-failure-rule) applies.
- The user runs the command and gives the result. The orchestrator sends the result to the task subagent that asked. The
  covered session that asked uses the result as the fact test says, and it names the user as the source of the result.
- The user declines the measure. The fact stays untested, and each text that uses the fact still says so. A requirement
  of the issue that asks for the measure is then a conflict of [the issue check](#the-issue-check). Then the fifth case
  of [the stop rule](#the-stop-rule) applies. Otherwise, if the plan cannot go on without the fact, the task subagent
  stops for a [design gap](#the-design-gap-rule) before `tasker approve`. After `tasker approve`, the orchestrator asks
  the user, as the sources bullet of [Limits](limits.md#limits) says.
- The user gives another answer, for example a change of scope or an abort of the task. Then the orchestrator follows
  the rule of that answer, for example [the change-of-scope comment](#the-change-of-scope-comment).

On 2026-11-01, the user said that a test that writes to the real `$HOME/.codex` or to the data of the user waits for the
user. On 2026-11-04, the ticket subagent of planner-m16 for #751 measured timers of `systemd-run --user` and a crontab
with no approval of the user. It made test units, installed a test crontab and removed it with `crontab -r`. The crontab
was empty before, and the ticket subagent removed each unit, so nothing was lost. The prompt of the ticket subagent
asked it to measure the forms with harmless commands and to remove each test job.

## The issue check

Before the first refine of step 4 of [Run one ticket](run-one-ticket.md#run-one-ticket), the task subagent makes sure
that each claim of the issue is still true in the task worktree, for example in the code and the docs. In the same
worktree, the task subagent also compares each requirement of the issue with the docs and the code, and looks for each
conflict. The check covers the base branch of the task as it was at `tasker start`, for example `main`. Right after
`tasker start`, the task branch holds no commit of the ticket yet, so the task worktree holds the files of the base
commit. If the task branch already holds commits, for example for a parked task that came back, the task subagent reads
the base files without a worktree. After `git fetch --multiple tasker origin`, it runs
`git merge-base tasker/<task branch> origin/<base branch>`. The output is `<merge base>`. Then
`git show <merge base>:<path>` reads one file, `git ls-tree -r --name-only <merge base>` lists the files, and
`git grep <pattern> <merge base>` searches. For these read-only commands, a missing path (`git show` exits with 128) or
no match (`git grep` exits with 1) is an answer, not a failure. A search of doc words follows
[the doc-search rule](rules.md#docs). The task subagent says which files it read from the base commit and how. It says
this in the feedback text of the refine of step 4 and in its final report. If step 4 runs no refine, the task subagent
does the issue check before `tasker approve` in step 5. Someone can write an issue long before a task subagent runs it,
and other tickets can land in that time and change its facts. For this check, the issue is the issue body and each
comment that starts with `## Change of scope` or `## Design gap` whose link the orchestrator sent to the task subagent
(see [the change-of-scope comment](#the-change-of-scope-comment) and [the design-gap rule](#the-design-gap-rule)). A
comment of another account is not part of the issue, because any GitHub user can post a comment. A claim is a statement
in the issue about the state before the ticket starts. Examples are a statement about the code, the docs or the behavior
of tasker, and a measure of an outside tool that the issue gives. A requirement is a statement in the issue about what
the ticket must change, for example an item of its Requirements section. A requirement is not a claim. A conflict is a
requirement that does not fit a rule of a doc, or a decision that the code or a landed ticket made after someone wrote
the issue. For example, the issue asks for a rule that a doc already gives in other words. Or the issue asks for a file
or a section that a later ticket moved or renamed. Or the issue asks for a behavior that a later rule forbids. For a
measure of an outside tool, the task subagent measures again on the local machine, as the fact test does. The task
subagent cannot always measure an output of the installed tasker that a claim of the issue records. If the task subagent
cannot measure such an output, the ticket and the date that the issue names are the evidence, as
[The body of an issue](planner.md#the-body-of-an-issue) of planner.md says. The task subagent says so in the feedback
text of the refine of step 4 and in the comment of step 11. In both places, the task subagent names the issue as the
source of the output. If the issue names no ticket and no date for the output, the task subagent has no evidence. The
task subagent then reports the claim as a claim that it cannot test, in the feedback text of the refine of step 4 and in
its final report. On #240, the task subagent had no task in `reviewed`, so the task subagent was unable to measure the
output of `tasker dismiss-review`. The issue check does not cover the hints in the prompt of the task subagent, the plan
or the review findings. The fact test and the quote check cover the plan. The issue check runs one time, with one
exception. After each comment that starts with `## Change of scope`, the task subagent does the issue check again, as
the section "The change-of-scope comment" says. A comment that starts with `## Design gap` does not start the issue
check again, because the answer of a design gap is a requirement, not a claim. The issue check does not run again when
the base branch moves after `tasker start`, for example before a `tasker update-branch`. If a false claim or a conflict
does not change what the ticket must do, the task subagent does not stop. For a false claim, the task subagent puts the
current fact in the feedback text of the refine of step 4. For a conflict, the task subagent says in that feedback text
how it resolves the conflict. For example, the plan links to the existing rule instead of a copy, or it uses the new
name of a file. If step 4 runs no refine, the task subagent does not run a refine only to send the current fact. If the
plan does not resolve a conflict yet, the plan needs changes, and step 4 runs a refine. If a false claim or a conflict
changes what the ticket must do, the fifth case of the stop rule applies. For a false claim, the task subagent puts the
claim, the current fact and the command that shows it in its report of the stop case. For a conflict, the task subagent
puts the requirement, the conflicting rule or decision, and the command or the doc that shows it in that report. In each
case, the task subagent also lists each false claim and each conflict in its final report.

The current code standards of the repo win over an old requirement of the issue that conflicts with them. The current
code standards are the rules of [docs/dev/rules.md](rules.md) and [docs/dev/code-conventions.md](code-conventions.md),
and the form of the code on the base branch. Examples of such a conflict:

- The issue names a file or a function that a later ticket moved. The plan uses the current place.
- The issue says to reuse a helper from the module of one tracker. The helper now serves more than one module. The plan
  moves the helper to a neutral module.
- The issue keeps a form that the code now bans, for example a compare with `toLowerCase()` that the ASCII fold
  replaced. The plan uses the current form.

For such a conflict, the task subagent follows the sentences above for a conflict that does not change what the ticket
must do, also for the final report. The task subagent does not stop for it under the fifth case of
[the stop rule](#the-stop-rule). The rule does not change the scope of the ticket. A new feature still goes to the user
under the fifth case of the stop rule. A change to a behavior that a user sees also goes to the user.

On #61 (2026-10-18), the issue asked the neutral module `src/issues/issue.ts` to reuse the ASCII fold of
`src/issue-key/github.ts`. The user said: "we should update the ticket to the current code standards rather than blindly
follow the issue description." The fold moved to a neutral module.

## The stop rule

Each time before the task subagent runs `tasker approve` in step 5 of
[Run one ticket](run-one-ticket.md#run-one-ticket), the task subagent [stops](limits.md#the-answer-wait-rule) in each of
these cases:

- The plan has an open question that the issue does not answer.
- The plan makes a design choice that the issue does not make.
- The plan has a security gap.
- The plan changes a file that the issue does not name, and another task in progress also changes that file. For
  example, `tasker refine` prints a warning for such a file (see ["Land the work"](land-the-work.md#land-the-work)). If
  the orchestrator already set a landing order for that file, or told the task subagent that the file has no landing
  order, this case does not apply.

  For each task of the overlap warning, the task subagent reads the milestone of its issue with
  `gh issue view <issue> --json milestone -q '.milestone.title'`. `<issue>` is the number of the issue key on the line
  of the task in the warning. The task subagent knows the milestone of its own ticket from its prompt (see
  [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent)). This case does not count a task
  of another milestone. A task of another milestone is a task whose issue has another milestone than the ticket of the
  task subagent, and both have a milestone. For such a task, [the Docs rule](land-the-work.md#the-docs-rule) covers the
  shared file.

  This case still applies to a file when the warning also lists that file for another task that the case counts. For
  example, the ticket of the task subagent is of "Docs". The warning lists a file for a task of "M19 — Polish" and for a
  task of "Docs". Then the case applies to that file because of the task of "Docs". If the read prints an empty line,
  the issue has no milestone. That is an answer, not a failure, and the case counts the task, because such a task is not
  of another milestone.

  If a read fails, the case counts the task. An example of a failed read is exit code 1 with
  `GraphQL: Could not resolve to an issue or pull request ...`. The case also counts a task of the same milestone. For
  the parent of a stacked ticket, [the stacked-ticket rule](pick-the-tickets.md#the-stacked-ticket-rule) gives the
  exception. If the plan does not need the edit, the task subagent removes it in a refine of step 4, as "Land the work"
  says, and does not stop.

- A claim of the issue is no longer true, or a requirement of the issue is a conflict, and this changes what the ticket
  must do (see [the issue check](#the-issue-check)). This case does not apply when the orchestrator already answered for
  that claim or that conflict.
- Two reviews in a row each find a new edge case that the fix of the loop before drew. After the second such review, the
  task subagent stops before its next `tasker approve`. The task subagent reports the two reviews and their edge cases
  to the orchestrator. The words "a new edge case" are a judgment, open on purpose. The task subagent makes the
  judgment. The reason: step 8 of [Run one ticket](run-one-ticket.md#run-one-ticket) runs the refine, then steps 3 and
  4, then `tasker approve`. No step waits for the orchestrator, so a message of the orchestrator can come after the
  approve. On #431 (2026-10-25), the stop of the orchestrator came after the task subagent approved and executed the
  next plan, so the patch cost one more review loop.

In each case, the task subagent reports the case. The design-gap rule says who answers the first three cases. For the
fourth case (a shared file), "Land the work" gives the steps. For the fifth case (a false claim or a conflict), the
orchestrator asks the user, because only the user changes the scope of a ticket. If the user changes the scope, the
orchestrator posts [a change-of-scope comment](#the-change-of-scope-comment) and sends its link to the task subagent in
the answer. The bullet of [Land the work](land-the-work.md#land-the-work) about the state read covers that answer. The
task subagent follows the steps of the section "The change-of-scope comment". For the sixth case (two reviews with a new
edge case each), the orchestrator does one of two things. It gives the user the simpler rule as the first choice, as
[Simplify over special rules](working-with-the-user.md#simplify-over-special-rules) says, and it sends the decision of
the user to the task subagent. Or it finds that the two reviews are no such case, and it tells the task subagent to go
on. After the answer, the task subagent puts the answer in the feedback text of the refine of step 4. Then the task
subagent continues with step 4 and runs `tasker approve` in step 5. An answer before `tasker approve` costs no review
loop, but a later answer costs one or more review loops. The quote check and the security report of
["Review findings"](review-findings.md#review-findings) give more cases that stop before `tasker approve`.

## The change-of-scope comment

If the user changes the scope of a ticket, the orchestrator posts the change as a comment on the issue. The comment
starts with `## Change of scope`. Such a comment can come after a stop of the fifth case of
[the stop rule](#the-stop-rule). It can also come after the security report of
["Review findings"](review-findings.md#review-findings). It can also come after a correction of the bullet of
[Land the work](land-the-work.md#land-the-work) that covers a change to an issue in flight.

The comment says which requirements change and how, and which items of the issue body no longer apply. The orchestrator
does not edit the issue body for a change of scope. The orchestrator owns the issue bodies, and the task subagent does
not edit them (see [Limits](limits.md#limits)). On 2026-10-16, the user asked for a comment for the change of scope of
#232. The change of scope of #219 also used a comment.

Before the orchestrator posts a comment that starts with `## Change of scope`, it compares each sentence of the comment
with the landed code. A sentence of the comment can state a fact of the code, for example the order of the steps of a
command. On #274, the comment said that diverged tips refuse "before the move to `updating_branch`". The fetch of the
command runs after that move, so the task subagent stopped, and a second comment corrected the row.

Before such a comment fixes an order of steps, the orchestrator also searches
[the orchestration pages](../orchestrator.md) for each other sentence that gives an order of the same steps. The comment
fixes each of them. The search follows [the doc-search rule](rules.md#docs). On #272, the first comment fixed the order
of the landing steps. [The issue check](#the-issue-check) of the task subagent then found two sentences with the
opposite order, in [Pick the tickets](pick-the-tickets.md#pick-the-tickets) and in
[the re-read rule](doc-reads.md#the-re-read-rule). A second comment fixed them.

The orchestrator sends the link of the comment to the task subagent before the next refine of the task subagent, as the
bullet "When the orchestrator edits an issue body" of [Land the work](land-the-work.md#land-the-work) says. After each
such comment, the task subagent does [the issue check](#the-issue-check) again for the claims and the requirements of
the changed scope. The task subagent does it before the refine, or the `tasker review <issue> "<feedback>"`, that sends
the answer or the text of the comment.

The task subagent copies the full text of each comment whose link the orchestrator sent. For a comment that starts with
`## Change of scope`, the task subagent makes the copy after the issue check of the paragraph above. The same copy step
covers a comment that starts with `## Design gap`, as [the design-gap rule](#the-design-gap-rule) says.

The task subagent puts the copied text in the feedback text of the step that fits the state of the task (the refine of
step 4 or step 8, or [the add-work rule](run-one-ticket.md#the-add-work-rule)). The task subagent copies no comment that
starts with another heading. The reason: the plan session reads only the issue body and the repo.

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
that it is a note and not a change of scope, and that the user decides the answer before the ticket starts. The note can
name a place in a doc. Before the orchestrator posts the note, it runs `git fetch origin`. Then it reads the doc with
`git show origin/main:<path>` and compares each place that the note names with that doc. The orchestrator makes sure
that all the words that name one place point to the same place. For a change that did not land yet, the orchestrator
compares each place with the change-of-scope comment that makes the change. If that comment gives no place for an item,
the note does not assume a place for it. For example, the note does not assume that the milestone item is the last item.

The orchestrator does not edit the body of the issue for this note. The orchestrator also does not decide the answer. An
issue with a task in flight gets no note from this rule. The bullet of [Land the work](land-the-work.md#land-the-work)
that covers a change to an issue in flight applies to such an issue. A failed read or a failed post of the orchestrator
for this note is a case of [the failure rule](limits.md#the-failure-rule).

On 2026-10-17, the change of scope of #273 made the `revision` of the `base` event a ref, not a commit id. The Terms of
#276 define the stored base revision as that value and replay the commits after it. The orchestrator named the gap only
in the chat and in its handoff file. The user asked for the comment on #276 twice. On #433 (2026-10-25), the
open-question note treated the milestone item of #427 as the last item of the list, but #427 put that item second.

## The design-gap rule

A design gap is a detail that the plan needs and that the issue does not give, in the first or the second case of the
stop rule. If the gap has exactly one workable answer inside the intent of the issue, the orchestrator gives that answer
to the task subagent. The orchestrator also tells the user the answer. If the gap has more than one workable answer, the
orchestrator asks the user. A security gap (the third case) always goes to the user. If a stop for a design gap is also
the fifth case of [the stop rule](#the-stop-rule), the stop rule says who answers.

An answer of a design gap can name a rule or a hint that still applies to the case. Before the orchestrator gives such
an answer, it searches each page of each rule or hint that the answer names. It searches for each other rule or hint on
the same case. The search follows [the doc-search rule](rules.md#docs). The answer names each rule or hint that the
search finds and that applies. The orchestrator judges which rule or hint covers the same case and applies. This
judgment is open on purpose. On #434, the answer named only the hint of #120 and #369, and review 2 found the hint of
#365 on a reason with "would".

A `## Design gap` comment can name a place in a doc, for example an item of a list by its position. Before the
orchestrator posts such a comment, it runs `git fetch origin`. Then it reads the doc with
`git show origin/<base branch>:<path>` and compares each place that the comment names with that doc. For a stacked task,
[the base rule](run-one-ticket.md#the-base-rule) applies, as the intro of the page says. This check covers the whole
comment, the gap and the answer. The orchestrator makes sure that all the words that name one place point to the same
place in the doc. The check also covers each fact of the comment that the operator relays. If the comment names a bullet
or a paragraph, in a doc or in the plan of the task, the comment quotes its first words. On #433 (2026-10-25), the first
`## Design gap` comment gave the place "after the last item of the list, after the milestone item of #427", but the
milestone item of #427 is the second item of the list. On #484 (2026-10-25), the `## Design gap` comment named "the
bullet on the report", and two bullets of the new text of [the tool-block rule](tasker-commands.md#the-tool-block-rule)
matched it.

The orchestrator posts each answer of a design gap as a comment on the issue. The comment starts with `## Design gap`.
It gives the gap, the answer, and who answered: the orchestrator, the operator or the user. Then the orchestrator sends
the link of the comment to the task subagent. The task subagent copies the full text of the comment with the copy step
of [the change-of-scope comment](#the-change-of-scope-comment). As a result, the plan session and the review see the
answer in the issue.

The user can change the answer before `tasker approve`, also an [answer of the operator](operator-items.md#the-answer).
In that case, the orchestrator posts a new `## Design gap` comment and sends its link. The new comment gives the gap and
the new answer, and it says that it replaces the earlier answer for that gap. The task subagent copies the new comment,
and it does not copy the earlier comment again.

A `## Design gap` comment is not a change of scope. As a result, the fifth case of [the stop rule](#the-stop-rule), the
security report of ["Review findings"](review-findings.md#review-findings) and the open-question note of
[the change-of-scope comment](#the-change-of-scope-comment) do not apply to it. On #257, the user answered three design
gaps before `tasker approve`, and review 1 still found that the rule "only the user ends a handoff" has no cancel.

Before the orchestrator gives an answer that removes a [blocked-by link](planner.md) for a case, it asks two questions.
Can an issue of that case start before its blocker lands? If it starts first, is the body of that issue still true? If
the body is then false, the answer keeps the link, or it changes the body so that the body stays true. On #410, answer 4
removed the link for one case but still fixed the body, so the body named a path not yet on `main`.

## The quote check

A plan or a finding quotes a file outside the worktree when it gives text from that file, or when it says that it read
that file. "Outside the worktree" has the meaning of the repo-files rule. A plan or a finding can give text from a web
page, or say that it read a web page. A plan or a finding can also give text from a web search result, or say that it
read one. Such a plan or finding counts like a quote of a file outside the worktree. On #491 (2026-10-25), review 1
found that no rule covered a web search result, and the task subagent dismissed the finding as outside the issue. A plan
or a finding can also give the output of a command that the repo-files rule forbids, for example a row of
`herdr agent list`. Such a plan or finding also counts like a quote of a file outside the worktree.

A plan can also give the output of a command of [a fact test](#the-fact-test) that the feedback text gives. Such a plan
does not count like a quote of a file outside the worktree. The reason is that the task subagent puts the results of the
fact test in the feedback text. [The repo-files rule](#the-repo-files-rule) names the feedback text as a source of the
plan session. The exception covers only the output that the feedback text gives, and it does not let the plan session
run such a command. On #560 (2026-10-25), plan v2 repeated the output `ctx:72%` of the fact test from the feedback text,
and the task subagent judged it no quote.

A plan or a finding can also give a rule of the simple-english skill, for example a limit, a rule number or a banned
word. It can also say that it read the skill. Such a plan or finding does not count like a quote of a file outside the
worktree. The reason: [rules.md](rules.md#docs) makes the skill the home of the text rules, so a rule of the skill is no
outside source of fact. This exception wins over [the repo-files rule](#the-repo-files-rule) for the skill only. On #630
(2026-10-31) and #700 (2026-11-01), each such plan cost one refine.

If a plan or a finding quotes a file outside the worktree, the task subagent tells the orchestrator. Then the
orchestrator tells the user. After this report, the task subagent can still do the steps that come before
`tasker approve` or `tasker accept`. For example, it can run a refine of step 4 or step 8 of
[Run one ticket](run-one-ticket.md#run-one-ticket), or dismiss a finding in step 7. If the next command of the task
subagent is `tasker approve` or `tasker accept`, the task subagent [stops](limits.md#the-answer-wait-rule). After the
orchestrator answers, the task subagent does the step that the answer gives. If the answer gives no step, the task
subagent continues "Run one ticket" from the step where it stopped.
