# Review loops

The readers of this page are the task subagent of a ticket, and the orchestrator for the missed-finding rule.
[The base rule](run-one-ticket.md#the-base-rule) covers each command of this page that uses `origin/<base branch>`.

## Review findings

- One loop is one `tasker review` and the work on its findings. The task subagent runs at most 5 review loops.
- The same-patch rule: this rule covers a task in `awaiting_work_review` when the task subagent of the ticket runs
  `tasker update-branch`. It also covers a task in `failed` after each failed `tasker merge`. It covers the
  `tasker update-branch` that step 9 of ["Run one ticket"](run-one-ticket.md#run-one-ticket) runs because the base
  branch moved: the update of step 9 from `failed`. The reason: without this case, the review after the update from
  `failed` counts as a loop, also with the same patch. A base that moves often can make `tasker merge` fail more than
  once. The other cases of `tasker update-branch` from `failed` stay outside this rule. An example is an update after a
  failed `tasker verify`. The task subagent reads two patch ids in the local clone of the orchestrator, with the remotes
  of [the diff read](run-one-ticket.md#the-diff-read). A patch id is the first field of the output of
  `git patch-id --stable` for the diff of the task branch against its base. The output has the form
  `<patch id> 0000000000000000000000000000000000000000`. The first patch id: while the task is in
  `awaiting_work_review`, or in `failed` for the update of step 9, right before `tasker update-branch`, the task
  subagent runs `git fetch --multiple tasker origin`. Then it runs
  `set -o pipefail; git diff origin/<base branch>...tasker/<task branch> | git patch-id --stable`. For a stacked task,
  the first patch id always uses the start base of the last read in place of `tasker/<parent branch>`. The reason: the
  parent ref can move after the start, for example after a rewrite or a rebase of the parent. Then the three-dot diff
  against it holds the old commits of the parent, and the patch id covers more than the work of the task. On #182, the
  parent #172 rewrote its commits in a fix round after the start of #182. The start base of a task is the commit that
  the task branch pointed to right after `tasker start`. For a stacked task, it is the tip of the parent branch at that
  time.

  Right after `tasker start`, the task subagent reads it from the field `synced base tip` of `tasker show <issue>`. In
  two cases, the task subagent reads it with the commands of the base-commit hint of
  [All tickets](first-refine.md#all-tickets) instead. The first case: `tasker show` prints no field `synced base tip`.
  The second case: the field differs from `git rev-parse --verify tasker/<task branch>` in the local clone of the
  orchestrator, after `git fetch tasker`. The task subagent runs these commands in the local clone of the orchestrator.

  The start base lives until the next read of the start base. The task subagent reads the start base again after each
  `tasker update-branch` that moved the task branch with no rebase conflict and kept the task stacked. This holds in
  each state of the task. The task stays stacked when the `base:` line of `tasker show <issue>` still has the form
  `refs/heads/<parent branch>`.

  For this read, right after the update, the task subagent runs `tasker show <issue>` and reads the field
  `synced base tip`. That commit is the new start base. A failed `tasker show` is a failed command of a read of the
  start base.

  In two cases, the task subagent runs `git fetch tasker` and then
  `git merge-base tasker/<task branch> tasker/<parent branch>` in the local clone of the orchestrator instead. The first
  case: `tasker show` prints no field `synced base tip`. The second case: the output of the update has a line
  `synced ...` and a line `... is current with ...; nothing moved`, and no line `moved ... onto`. The reason: the field
  holds the tip that the move used, and a later move of the parent does not change it.

  After a `tasker update-branch` that reports a rebase conflict, the start base of the last read stays. The first patch
  id of a stacked task and the case of step 7 of [docs/dev/rebase-conflicts.md](rebase-conflicts.md#procedure) use the
  start base of the last read. The loop of step 11 is the exception for step 7 of that page. On #262, the task subagent
  ran `tasker update-branch` one time before the parent landed. The right start base was then the tip of the parent
  under the task branch, not the commit of the start. If a command of a read of the start base fails, the task subagent
  holds no start base. For the first patch id, that is a failed command of this rule, as the bullet "The review after
  `tasker update-branch` counts as a loop" says. The second patch id: after `tasker update-branch`, while the task is in
  `executed` and before `tasker verify`, the task subagent runs the same two commands again. The three dots diff against
  the merge base. As a result, the first patch id uses the old base, and the second patch id uses the new base. The task
  subagent must run the fetch before each read. The reads of this rule are each read of a patch id and each read of a
  text id of the same-text compare. The fetch before each such read is also a read of this rule. The reads are a new
  step at each `tasker update-branch`. The task subagent runs each read in its plain form: one read alone in its own
  Bash call, as [the plain-form rule](tasker-commands.md#the-plain-form-rule) asks for a `tasker` command. No `cd` comes
  before the read, and no other command is in the same call. Each git command of the read has the form
  [`git -C <local clone>`](tasker-commands.md#the-tool-block-rule), as the tool-block rule gives for a git command in
  the local clone. The `set -o pipefail;` and the pipe of a read are part of that one read. A denial of a read is a
  [tool block](tasker-commands.md#the-tool-block-rule). After a denial, the task subagent follows the tool-block rule.
  The update of a denial is the `tasker update-branch` that the denied read belongs to. A read of the first patch id or
  the first text id belongs to the update right after it. A read of the second patch id or the second text id belongs to
  the update right before it. The fetch before a read belongs to the same update as that read. The task subagent never
  sends a read and a `tasker update-branch` as parallel calls of one message. A read that belongs to the update right
  after it ends before that update starts. A read that belongs to the update right before it starts after that update
  ends. The task subagent also runs the reads of this rule one after the other, never as parallel calls of one message.
  Each read starts after the read before it ends. A read of this rule and the read of the start base after an update
  also run one after the other. The review after the update of a denial counts as a loop, as the bullet "The review
  after `tasker update-branch` counts as a loop" says for a failed command. This holds also when the task subagent runs
  that update after the answer of the orchestrator. A denial covers only the update of the denial. At each later
  `tasker update-branch`, the task subagent runs all the reads again, also the denied read. If the answer of the
  orchestrator says otherwise, the answer wins. On #290, the classifier denied the second patch-id read once, the task
  subagent skipped the reads at the next update, and two reviews counted as loops. On #374, the diff read ran its first
  `tasker update-branch` with no first patch id, and the task subagent sent a read and an update in parallel. On #443
  (2026-10-25), the task subagent sent the patch-id read and the text-id read, each with its fetch, as parallel calls of
  one message.

  The comeback update is the update of [the comeback rule](run-one-ticket.md#the-comeback-rule) from `failed` when the
  line `failed in` of `tasker show <issue>` prints `merging`. In the bullets of this section, the comeback update counts
  as the update of step 9 from `failed`. [The docs-only update](#the-docs-only-update) does not cover it.

- The same-text compare: the patch id depends on more than the text of the changed lines, for example on the context
  lines of the hunks. On #229 and #231, the patch ids differed after the move onto `main` (7a499ce5 and 327f92ce on
  #231), although the changed lines kept their text. A text id is the output of
  `set -o pipefail; git diff -U0 origin/<base branch>...tasker/<task branch> | grep -v -e '^index ' -e '^@@' | git hash-object --stdin`.
  Each read of a text id uses the same base as the patch id of the same read. That includes the start base of a stacked
  task. The task subagent reads the first text id right after the first patch id, before `tasker update-branch`. The
  task subagent reads the second text id right after the second patch id. The fetch before each read stays as the
  same-patch rule says. The task subagent compares the patch ids first. Only when the two patch ids differ does the task
  subagent compare the two text ids. When the two patch ids differ, a failed command of the text compare is a failed
  command of the same-patch rule. An empty output of the filter is also such a failed command. In that case the review
  counts as a loop, as the bullet "The review after `tasker update-branch` counts as a loop" says. When the two patch
  ids are the same, a failed read of a text id changes nothing.
- The same-patch review is the first `tasker review` after that `tasker update-branch` when the two patch ids are the
  same, or when the two patch ids differ and the two text ids are the same. A same-patch review does not count as a
  loop, also when it has findings. For the update of step 9 from `failed`, the same-patch review is also the first
  `tasker review` after that update, with the same cases. The bullet "The review after `tasker update-branch` counts as
  a loop" also applies to that update, with each of its cases. For this one review, the same-patch rule wins over the
  loop definition of the first bullet. If the same-patch review has no findings, the task stays in
  `awaiting_work_review`. If it has findings, the task goes to `reviewed`, and the task subagent works on them with
  steps 6 to 8 of ["Run one ticket"](run-one-ticket.md#run-one-ticket). After the 5th loop, the bullet "After the 5th
  loop" wins. If a real finding of a same-patch review is still open, the task subagent
  [stops](limits.md#the-answer-wait-rule) as that bullet says. If the task subagent dismisses all the findings in step 7
  of [Run one ticket](run-one-ticket.md#run-one-ticket), the task goes to `awaiting_work_review`. In each case, the task
  subagent then continues as the place that ran `tasker update-branch` says. Work can follow the same-patch review, for
  example the refine of step 8 or the work of [the add-work rule](run-one-ticket.md#the-add-work-rule). Then the next
  `tasker review` counts as a loop.
- The review after `tasker update-branch` counts as a loop in each of these cases. The two patch ids differ and the two
  text ids differ, for example because the rebase solved a conflict. `tasker update-branch` reported a rebase conflict.
  An output of `git patch-id` is empty, because an empty output gives no patch id. The task subagent did not read the
  first patch id. The patch ids differ and the task subagent did not read the first text id. A command of this rule
  fails, for any reason. A failed command of this rule changes nothing in the repo or in the worktrees of tasker, and
  the task keeps its state. The work changes between `tasker update-branch` and the review, for example with a refine
  after a failed `tasker verify`.
- The limit of 5 loops counts all other reviews, as before. For a task in `reviewed`, the bullet of
  ["Land the work"](land-the-work.md#land-the-work) that starts "If the task was in `reviewed`" gives the count. On #92,
  `main` moved two times during the review loops. Each `tasker update-branch` from `awaiting_work_review` forced a new
  review, and each review counted as a loop. As a result, 2 of the 5 loops had no change to the work.
- The early update: this rule covers a task in `reviewed` when the earlier ticket of a landing order shares a file with
  the task. Before each refine of step 8, the later task subagent reads the state of the earlier task one time on the
  `state:` line of `tasker show <earlier issue>`. If the earlier task is in `landed`, `finishing` or `finished`, and the
  later task subagent did not run `tasker update-branch` after the earlier ticket landed, it runs `tasker update-branch`
  first. If `tasker show <earlier issue>` fails, the later task subagent reads the state of the issue of the earlier
  ticket one time with `gh issue view <number> --json state -q .state`. If that state is `CLOSED` and the later task
  subagent did not run `tasker update-branch` after the close, it runs `tasker update-branch` first. This rule adds to
  the bullet of "Land the work" that starts "If a refine, or the `tasker review <issue> "<feedback>"` of the add-work
  rule, must change a file". The review right after this update and the review before it count as one loop, as the
  bullet of "Land the work" that starts "If the task was in `reviewed`" says. The review after the refine of step 8 is
  the next loop. So the early update costs no extra loop. If the later task subagent ran the early update after the
  earlier ticket landed, it runs no second `tasker update-branch` when it reaches the bullet "When the issue of the
  earlier ticket is closed" of "Land the work", as that bullet says. Without the early update, the update runs later
  from `awaiting_work_review`, and there a review after a rebase conflict counts as a loop. On #129, such a review was
  loop 5, so a finding in it got no fix.
- The no-loop-left rule: this rule covers a task in `awaiting_work_review` after the 5th loop, when a step needs
  `tasker update-branch`, for any reason. It also covers a task in `failed` after the 5th loop, when `tasker merge`
  failed on a moved base branch. This rule wins over each step that runs `tasker update-branch` from
  `awaiting_work_review`, for example step 9 and [the diff read](run-one-ticket.md#the-diff-read). It also wins over the
  bullet "When the issue of the earlier ticket is closed" of "Land the work". It also wins over the update of step 9
  from `failed`.

  The task subagent runs `tasker update-branch` with no stop. Before and after the update, it does each read of
  [the same-patch rule](#review-findings) and of [the docs-only update](#the-docs-only-update) that belongs to the
  update. If the update is a docs-only update, the task subagent goes on as that rule says, with no decision of the
  user. In each other case, the task subagent stops after the reads that belong to the update, for example after a
  rebase conflict. After a docs-only update, a failed `tasker verify` also stops the task subagent, before
  [the verify-failure rule](verify-failures.md#the-verify-failure-rule). At a stop, the task subagent runs no review, no
  refine and no step of [the rebase procedure](rebase-conflicts.md#procedure), and the orchestrator asks the user.

  A same-patch review costs no loop (the same-patch rule of this section). In other cases, the review counts as a loop
  (the bullet "The review after `tasker update-branch` counts as a loop"). Examples are a rebase conflict, or patch ids
  and text ids that both differ. As a result, after the 5th loop, such a review is over the limit.

  A decision of the user that the ticket lands covers each `tasker update-branch` that the landing then needs, also the
  update of step 9 from `failed`. For such an update, the decision wins over the stop of this rule. The task subagent
  runs the update with no new report, and the review after it follows the same-patch rule of this section. The decision
  also covers the review after an update that ran before the stop. After a rebase conflict, the decision also covers
  [the rebase procedure](rebase-conflicts.md#procedure). The bullet "After the 5th loop" still applies to such a review.

  On #302 (2026-10-18), the user decided that the ticket lands after loop 7, and then `main` moved. On #476
  (2026-11-03), docs-only commits moved `main` after loop 5. The user decided twice, and review 6 had the same patch id
  and found nothing. On 2026-11-03, the user chose that a docs-only update after the 5th loop needs no decision of the
  user.

- After the 5th loop, if a real finding is still open, or the diff read finds work, the task subagent stops. The
  orchestrator reports to the user.
- On the 5th loop, the task subagent dismisses cosmetic findings with a reason.
- If a finding is an edge case outside the issue, and it is not a security gap and not a bug in the core path, the task
  subagent dismisses it in step 7. The core path is the main use that the issue describes. The reason says that the edge
  case is outside the issue. The task subagent lists the finding in its final report, and the ticket does not grow. A
  refactor or duplication finding is not such an edge case.
- If a finding contradicts an exact rule of the issue, the task subagent dismisses it in step 7. The reason quotes that
  rule of the issue.
- The security report: if the task subagent dismisses a finding in step 7 because the finding contradicts the issue, and
  the finding points to a possible security gap, the task subagent also reports the gap to the orchestrator in the same
  step. A security gap is a way to harm the user or the system. For example, text of a third party, such as an issue
  body, reaches a prompt as an instruction. The report gives the finding, the rule of the issue and the risk. The
  orchestrator tells the user, because the decision belongs to the user. Then the task subagent stops before its next
  `tasker approve` or `tasker accept`, as [the quote check](plan-review.md#the-quote-check) says. If the user decides to
  close the gap, the orchestrator first posts [a change-of-scope comment](plan-review.md#the-change-of-scope-comment),
  and the task subagent follows the steps of that section. After that, the task subagent adds the work with the step
  that fits the state of the task: the refine of step 4 or step 8, or the add-work rule. If the report comes in the 5th
  loop, a decision to close the gap counts as a real finding that is still open, and the second bullet of this section
  applies. The security report does not cover a security gap in a plan before `tasker approve`. The third case of the
  stop rule covers that gap.
- A refactor or duplication finding is not cosmetic. The task subagent refines a refactor finding in the ticket that
  added the code. The task subagent fixes a duplication finding (the same code or text in more than one place) at once,
  in the ticket that adds the duplicated code. The finding comes from a review or from
  [the diff read](run-one-ticket.md#the-diff-read). The task subagent fixes a finding from a review with the refine of
  step 8, and a finding from the diff read with the add-work rule. The task subagent does not dismiss a real duplication
  finding.
- When the task subagent sends a fix in the refine text, it writes "apply everywhere it fits". Otherwise the next review
  finds the same problem in other places.

The missed-finding rule: a review or the diff read can miss a refactor or duplication finding. When someone finds it
later, the fix goes to the first place of this list that applies:

1. The ticket that adds the code, inside the 5 review loops of this section. While that ticket is open, the orchestrator
   does not move the fix into another ticket. On #71, on 2026-10-13, the user replaced the extra loop after the last
   loop with "up to 5 loops, then report".
2. If that ticket already landed, a ticket that changes the same code. For a ticket in progress, the orchestrator tells
   its task subagent to add the fix to its next refine. For a ticket that has not started, the orchestrator edits its
   issue body.
3. If no such ticket exists, the orchestrator sends the finding to the planner, as the planner bullet of
   [The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) says.

### The docs-only update

This rule covers the `tasker update-branch` of step 9 of [Run one ticket](run-one-ticket.md#run-one-ticket) and of
[the diff read](run-one-ticket.md#the-diff-read). If the same-patch rule of [Review findings](#review-findings) does not
cover such an update, this rule does not cover it. The `base:` line of `tasker show <issue>` must have a plain name at
both of its reads. A stacked task stays under the bullets of that section, because its base moves with its parent. A
docs-only update is a `tasker update-branch` that meets each condition of the list below. The skip is a choice that is
open on purpose, and the task subagent makes it.

Right after the first text id, the task subagent reads the `base:` line. Then it reads the first base with
`git -C <local clone> merge-base origin/<base branch> tasker/<task branch>`. Right after the second text id, it reads
the `base:` line again, and it reads `<task hash>` with `git -C <local clone> rev-parse --verify tasker/<task branch>`.
Then it reads the second base with `git -C <local clone> merge-base origin/<base branch> <task hash>`. The moved files
are the output of `git -C <local clone> log --no-renames --format= --name-only <first base>..<second base>`. The files
of the task are the output of `git -C <local clone> diff --no-renames --name-only <second base> <task hash>`.

The reads of this rule are the two reads of the `base:` line, the two base reads and the read of `<task hash>`. The read
of the moved files and the read of the files of the task are also reads of this rule. These reads need no fetch of their
own. The `--no-renames` flag prints both names of a renamed file. Each read has the plain form of the same-patch rule.
No read of this rule goes as a parallel call with `tasker update-branch` or with another read.

A denial of a read is a [tool block](tasker-commands.md#the-tool-block-rule). After the answer of the orchestrator, the
task subagent skips nothing at that update, unless the answer says otherwise. Another failed read does not stop the task
subagent. The task subagent then also skips nothing at that update. A denial or a failed read does not change the count
of a loop. At each later update, the task subagent runs all the reads again.

If each of these conditions is true, the task subagent can skip `tasker review` and each step of the diff read except
the last fetch and `git merge-base --is-ancestor`:

- `tasker update-branch` reported no rebase conflict.
- The two patch ids of the same-patch rule are the same.
- The moved files hold at least one file, and each one is a Markdown file under `docs/`.
- No moved file is a file of the task.
- A `tasker review` left no open finding, and the task subagent did the diff read. Both came after the last commit that
  changed the work and after the last update with no skip.

The task subagent still runs `tasker verify`. If `tasker verify` fails, this rule ends, and
[the verify-failure rule](verify-failures.md#the-verify-failure-rule) applies. If it passes, the task subagent does the
last fetch and `git merge-base --is-ancestor`, as the diff read says. The measure and each real run of the last diff
read stand.

The task subagent names each skip in the comment of step 11 of [Run one ticket](run-one-ticket.md#run-one-ticket) and in
its final report, with the two bases. This rule also applies to the update of step 9 or of the diff read under the
no-loop-left rule. It needs no decision of the user. Under that rule, a failed `tasker verify` stops the task subagent
before the verify-failure rule.

The reason: the update changed no file of the task, so the diff and the whole files of the task stay the same. The cost:
the review does not see a rule that a moved doc changed. If the moved doc is a doc of the task subagent,
[the task subagent notice](doc-reads.md#the-task-subagent-notice) names the changed section. That notice can arrive
after `tasker accept`. The user decided this rule on 2026-11-01. On #550, docs-only commits moved `main` four times in
about 15 minutes, and each cycle cost one review run with the same patch id.
