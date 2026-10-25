# Review loops

The readers of this page are the agent of a ticket, and the orchestrator for the missed-finding rule.
[The base rule](run-one-ticket.md#the-base-rule) covers each command of this page that uses `origin/<base branch>`.

## Review findings

- One loop is one `tasker review` and the work on its findings. The agent runs at most 5 review loops.
- The same-patch rule: this rule covers a task in `awaiting_work_review` when the agent of the ticket runs
  `tasker update-branch`. The agent reads two patch ids in the local clone of the orchestrator, with the remotes of
  [the diff read](run-one-ticket.md#the-diff-read). A patch id is the first field of the output of
  `git patch-id --stable` for the diff of the task branch against its base. The output has the form
  `<patch id> 0000000000000000000000000000000000000000`. The first patch id: while the task is in
  `awaiting_work_review`, right before `tasker update-branch`, the agent runs `git fetch --multiple tasker origin`. Then
  it runs `set -o pipefail; git diff origin/<base branch>...tasker/<task branch> | git patch-id --stable`. For a stacked
  task, the first patch id always uses the start base of the last read in place of `tasker/<parent branch>`. The reason:
  the parent ref can move after the start, for example after a rewrite or a rebase of the parent. Then the three-dot
  diff against it holds the old commits of the parent, and the patch id covers more than the work of the task. On #182,
  the parent #172 rewrote its commits in a fix round after the start of #182. The start base of a task is the commit
  that the task branch pointed to right after `tasker start`. For a stacked task, it is the tip of the parent branch at
  that time. The agent reads it right after `tasker start` with the commands of the base-commit hint of
  [All tickets](first-refine.md#all-tickets). The agent runs these commands in the local clone of the orchestrator. The
  start base lives until the next read of the start base. The agent reads the start base again only after a
  `tasker update-branch` that moved the task branch with no rebase conflict and keeps the task stacked. The task stays
  stacked when the `base:` line of `tasker show <issue>` still has the form `refs/heads/<parent branch>`. For this read,
  right after the update, the agent runs `git fetch tasker` and then
  `git merge-base tasker/<task branch> tasker/<parent branch>` in the local clone of the orchestrator. After a
  `tasker update-branch` that reports a rebase conflict, the start base of the last read stays. The first patch id of a
  stacked task and the case of step 7 of [docs/dev/rebase-conflicts.md](rebase-conflicts.md#procedure) use the start
  base of the last read. On #262, the agent ran `tasker update-branch` one time before the parent landed. The right
  start base was then the tip of the parent under the task branch, not the commit of the start. If a command of a read
  of the start base fails, the agent holds no start base. For the first patch id, that is a failed command of this rule,
  as the bullet "The review after `tasker update-branch` counts as a loop" says. The second patch id: after
  `tasker update-branch`, while the task is in `executed` and before `tasker verify`, the agent runs the same two
  commands again. The three dots diff against the merge base. As a result, the first patch id uses the old base, and the
  second patch id uses the new base. The agent must run the fetch before each read. The reads of this rule are each read
  of a patch id and each read of a text id of the same-text compare. The fetch before each such read is also a read of
  this rule. The reads are a new step at each `tasker update-branch`. The agent runs each read in its plain form: one
  read alone in its own Bash call, as [the plain-form rule](tasker-commands.md#the-plain-form-rule) asks for a `tasker`
  command. No `cd` comes before the read, and no other command is in the same call. Each git command of the read has the
  form [`git -C <local clone>`](tasker-commands.md#the-tool-block-rule), as the tool-block rule gives for a git command
  in the local clone. The `set -o pipefail;` and the pipe of a read are part of that one read. A denial of a read is a
  [tool block](tasker-commands.md#the-tool-block-rule). After a denial, the agent follows the tool-block rule. The
  update of a denial is the `tasker update-branch` that the denied read belongs to. A read of the first patch id or the
  first text id belongs to the update right after it. A read of the second patch id or the second text id belongs to the
  update right before it. The fetch before a read belongs to the same update as that read. The review after the update
  of a denial counts as a loop, as the bullet "The review after `tasker update-branch` counts as a loop" says for a
  failed command. This holds also when the agent runs that update after the answer of the orchestrator. A denial covers
  only the update of the denial. At each later `tasker update-branch`, the agent runs all the reads again, also the
  denied read. If the answer of the orchestrator says otherwise, the answer wins. On #290, the classifier denied the
  second patch-id read once, the agent skipped the reads at the next update, and two reviews counted as loops.
- The same-text compare: the patch id depends on more than the text of the changed lines, for example on the context
  lines of the hunks. On #229 and #231, the patch ids differed after the move onto `main` (7a499ce5 and 327f92ce on
  #231), although the changed lines kept their text. A text id is the output of
  `set -o pipefail; git diff -U0 origin/<base branch>...tasker/<task branch> | grep -v -e '^index ' -e '^@@' | git hash-object --stdin`.
  Each read of a text id uses the same base as the patch id of the same read. That includes the start base of a stacked
  task. The agent reads the first text id right after the first patch id, before `tasker update-branch`. The agent reads
  the second text id right after the second patch id. The fetch before each read stays as the same-patch rule says. The
  agent compares the patch ids first. Only when the two patch ids differ does the agent compare the two text ids. When
  the two patch ids differ, a failed command of the text compare is a failed command of the same-patch rule. An empty
  output of the filter is also such a failed command. In that case the review counts as a loop, as the bullet "The
  review after `tasker update-branch` counts as a loop" says. When the two patch ids are the same, a failed read of a
  text id changes nothing.
- The same-patch review is the first `tasker review` after that `tasker update-branch` when the two patch ids are the
  same, or when the two patch ids differ and the two text ids are the same. A same-patch review does not count as a
  loop, also when it has findings. For this one review, the same-patch rule wins over the loop definition of the first
  bullet. If the same-patch review has no findings, the task stays in `awaiting_work_review`. If it has findings, the
  task goes to `reviewed`, and the agent works on them with steps 6 to 8 of
  ["Run one ticket"](run-one-ticket.md#run-one-ticket). After the 5th loop, the bullet "After the 5th loop" wins. If a
  real finding of a same-patch review is still open, the agent [stops](limits.md#the-answer-wait-rule) as that bullet
  says. If the agent dismisses all the findings in step 7 of [Run one ticket](run-one-ticket.md#run-one-ticket), the
  task goes to `awaiting_work_review`. In each case, the agent then continues as the place that ran
  `tasker update-branch` says. Work can follow the same-patch review, for example the refine of step 8 or the work of
  [the add-work rule](run-one-ticket.md#the-add-work-rule). Then the next `tasker review` counts as a loop.
- The review after `tasker update-branch` counts as a loop in each of these cases. The two patch ids differ and the two
  text ids differ, for example because the rebase solved a conflict. `tasker update-branch` reported a rebase conflict.
  An output of `git patch-id` is empty, because an empty output gives no patch id. The agent did not read the first
  patch id. The patch ids differ and the agent did not read the first text id. A command of this rule fails, for any
  reason. A failed command of this rule changes nothing in the repo or in the worktrees of tasker, and the task keeps
  its state. The work changes between `tasker update-branch` and the review, for example with a refine after a failed
  `tasker verify`.
- The limit of 5 loops counts all other reviews, as before. For a task in `reviewed`, the bullet of
  ["Land the work"](land-the-work.md#land-the-work) that starts "If the task was in `reviewed`" gives the count. On #92,
  `main` moved two times during the review loops. Each `tasker update-branch` from `awaiting_work_review` forced a new
  review, and each review counted as a loop. As a result, 2 of the 5 loops had no change to the work.
- The early update: this rule covers a task in `reviewed` when the earlier ticket of a landing order shares a file with
  the task. Before each refine of step 8, the later agent reads the state of the earlier task one time on the `state:`
  line of `tasker show <earlier issue>`. If the earlier task is in `landed`, `finishing` or `finished`, and the later
  agent did not run `tasker update-branch` after the earlier ticket landed, it runs `tasker update-branch` first. If
  `tasker show <earlier issue>` fails, the later agent reads the state of the issue of the earlier ticket one time with
  `gh issue view <number> --json state -q .state`. If that state is `CLOSED` and the later agent did not run
  `tasker update-branch` after the close, it runs `tasker update-branch` first. This rule adds to the bullet of "Land
  the work" that starts "If a refine, or the `tasker review <issue> "<feedback>"` of the add-work rule, must change a
  file". The review right after this update and the review before it count as one loop, as the bullet of "Land the work"
  that starts "If the task was in `reviewed`" says. The review after the refine of step 8 is the next loop. So the early
  update costs no extra loop. If the later agent ran the early update after the earlier ticket landed, it runs no second
  `tasker update-branch` when it reaches the bullet "When the issue of the earlier ticket is closed" of "Land the work",
  as that bullet says. Without the early update, the update runs later from `awaiting_work_review`, and there a review
  after a rebase conflict counts as a loop. On #129, such a review was loop 5, so a finding in it got no fix.
- The no-loop-left rule: this rule covers a task in `awaiting_work_review` after the 5th loop, when a step needs
  `tasker update-branch`, for any reason. The agent stops before `tasker update-branch`. The orchestrator asks the user.
  This rule wins over each step that runs `tasker update-branch` from `awaiting_work_review`, for example step 9 and
  [the diff read](run-one-ticket.md#the-diff-read), and the bullet "When the issue of the earlier ticket is closed" of
  "Land the work". A same-patch review costs no loop (the same-patch rule of this section). For example, if the patch
  ids differ and the text ids differ, or the rebase has a conflict, the review counts as a loop (the bullet "The review
  after `tasker update-branch` counts as a loop"). As a result, after the 5th loop, such a review is over the limit. A
  decision of the user that the ticket lands covers each `tasker update-branch` that the landing then needs. For such an
  update, the decision wins over the stop of this rule. The agent runs the update with no new report, and the review
  after it follows the same-patch rule of this section. The bullet "After the 5th loop" still applies to that review. On
  #302 (2026-10-18), the user decided that the ticket lands after loop 7, and then `main` moved.
- After the 5th loop, if a real finding is still open, or the diff read finds work, the agent stops. The orchestrator
  reports to the user.
- On the 5th loop, the agent dismisses cosmetic findings with a reason.
- If a finding is an edge case outside the issue, and it is not a security gap and not a bug in the core path, the agent
  dismisses it in step 7. The core path is the main use that the issue describes. The reason says that the edge case is
  outside the issue. The agent lists the finding in its final report, and the ticket does not grow. A refactor or
  duplication finding is not such an edge case.
- If a finding contradicts an exact rule of the issue, the agent dismisses it in step 7. The reason quotes that rule of
  the issue.
- The security report: if the agent dismisses a finding in step 7 because the finding contradicts the issue, and the
  finding points to a possible security gap, the agent also reports the gap to the orchestrator in the same step. A
  security gap is a way to harm the user or the system. For example, text of a third party, such as an issue body,
  reaches a prompt as an instruction. The report gives the finding, the rule of the issue and the risk. The orchestrator
  tells the user, because the decision belongs to the user. Then the agent stops before its next `tasker approve` or
  `tasker accept`, as [the quote check](plan-review.md#the-quote-check) says. If the user decides to close the gap, the
  orchestrator first posts [a change-of-scope comment](plan-review.md#the-change-of-scope-comment), and the agent
  follows the steps of that section. After that, the agent adds the work with the step that fits the state of the task:
  the refine of step 4 or step 8, or the add-work rule. If the report comes in the 5th loop, a decision to close the gap
  counts as a real finding that is still open, and the second bullet of this section applies. The security report does
  not cover a security gap in a plan before `tasker approve`. The third case of the stop rule covers that gap.
- A refactor or duplication finding is not cosmetic. The agent refines a refactor finding in the ticket that added the
  code. The agent fixes a duplication finding (the same code or text in more than one place) at once, in the ticket that
  adds the duplicated code. The finding comes from a review or from [the diff read](run-one-ticket.md#the-diff-read).
  The agent fixes a finding from a review with the refine of step 8, and a finding from the diff read with the add-work
  rule. The agent does not dismiss a real duplication finding.
- When the agent sends a fix in the refine text, it writes "apply everywhere it fits". Otherwise the next review finds
  the same problem in other places.

The missed-finding rule: a review or the diff read can miss a refactor or duplication finding. When someone finds it
later, the fix goes to the first place of this list that applies:

1. The ticket that adds the code, inside the 5 review loops of this section. While that ticket is open, the orchestrator
   does not move the fix into another ticket. On #71, on 2026-10-13, the user replaced the extra loop after the last
   loop with "up to 5 loops, then report".
2. If that ticket already landed, a ticket that changes the same code. For a ticket in progress, the orchestrator tells
   its agent to add the fix to its next refine. For a ticket that has not started, the orchestrator edits its issue
   body.
3. If no such ticket exists, the orchestrator sends the finding to the planner, as the planner bullet of
   [The prompt of an agent](pick-the-tickets.md#the-prompt-of-an-agent) says.
