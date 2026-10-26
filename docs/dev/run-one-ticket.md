# Run one ticket

The reader of this page is the agent of a ticket. [The base rule](#the-base-rule) covers each command of this page that
uses `origin/<base branch>`.

## Run one ticket

The agent of the ticket runs steps 1 to 11. Each step gives the state of the task after its command succeeds.

1. Run `tasker doctor`. A timeout line is a line of the output of `tasker doctor` that starts with `error` and ends with
   `the check did not finish in <n> ms`. `<n>` is a number. If the output of the first run has a timeout line, run
   `tasker doctor` one more time. On #562 (2026-10-25), the first run printed
   `error gh project: codeguru42/tasker: the check did not finish in 15000 ms`, and the second run printed no error. If
   the output of the second run has no timeout line, go on with this step. If it has a timeout line,
   [stop](limits.md#the-answer-wait-rule), and give the output of both runs in the report. The two runs of
   `tasker doctor` change no task. Run `tasker doctor` at most two times in this step. After the stop, the answer of the
   orchestrator can say otherwise. Then read the issue with `gh issue view <number>`, and compare the issue body with
   the prompt of the agent. If the body differs from the prompt, report each change to the orchestrator. The body can
   change while the agent works. Each `tasker` command of steps 1 to 11 follows
   [the command rules](tasker-commands.md#the-command-rules).
2. If `tasker status --issue <issue>` already lists a task for the ticket, for example a parked task that came back (see
   [the defer rule](pick-the-tickets.md#the-defer-rule)), follow [the comeback rule](#the-comeback-rule) instead of this
   step. Run `tasker start <issue>`. The task goes to `workspace_ready`. Read the output of `tasker start`, also stderr.
   The note `based on <key>'s branch` confirms a stacked task. If the note and the prompt do not agree (the prompt names
   a parent and the note is missing, or the note is present and the prompt names no parent),
   [stop](limits.md#the-answer-wait-rule). If `tasker start` refuses with `blocking issue is still open`, stop. No task
   exists. Then make the task worktree as [the own-worktree rule](limits.md#the-own-worktree-rule) says. If the make
   fails, stop. The make changes no task. Then run `tasker plan <issue>`. The task goes to `awaiting_plan_review`.
3. Read the plan with `tasker show-plan` and `tasker show-questions`. Compare the plan with the Requirements and the
   Docs sections of the issue. Then apply [the stop rule](plan-review.md#the-stop-rule) and do
   [the quote check](plan-review.md#the-quote-check).
4. If the plan needs changes, run `tasker refine <issue> "<feedback>"`. Add
   [the repo-files rule](plan-review.md#the-repo-files-rule) to the feedback text. Before the first refine, do
   [the fact test](plan-review.md#the-fact-test) and [the issue check](plan-review.md#the-issue-check). The task goes to
   `awaiting_plan_review` again. Then do steps 3 and 4 again until the plan needs no changes. Put the answers to the
   plan questions in the feedback text. `tasker plan` takes no feedback.
5. Run `tasker approve`. The task goes to `approved`. Run `tasker execute`. The task goes to `executed`. Run
   `tasker verify`. If the verify commands pass, the task goes to `awaiting_work_review`. If they fail, follow
   [the verify-failure rule](verify-failures.md#the-verify-failure-rule). Run `tasker review`. When the review has
   findings, the task goes to `reviewed`. When it has none, the task stays in `awaiting_work_review`. If the review has
   no findings, go to step 9.
6. Read the findings with `tasker show-review`. Decide for each finding if it is real. Then do
   [the quote check](plan-review.md#the-quote-check).
7. Dismiss each finding that is not real, with a reason: `tasker dismiss-review <issue> --finding N "<reason>"`. The
   task stays in `reviewed` while a finding is still open. If you dismiss all the findings, the task goes to
   `awaiting_work_review`, and you go to step 9.
8. If real findings are still open, run one `tasker refine <issue> "<feedback>"`. It acts on all the open findings. Add
   the repo-files rule to the feedback text. The task goes to `awaiting_plan_review`. After the refine, do steps 3 and 4
   for the new plan. Then do steps 5 to 8 again, starting with `tasker approve`. The
   ["Review findings"](review-findings.md#review-findings) section limits the number of loops.
9. Run each `tasker` command of this step as [the plain-form rule](tasker-commands.md#the-plain-form-rule) says. The
   rule also covers the `tasker` commands that change a task in the other steps. Before each `tasker accept` of this
   step, also the one after `tasker update-branch`, do [the diff read](#the-diff-read). Run `tasker accept`. The task
   goes to `accepted`. `tasker accept` refuses when the branch does not contain the tip of `origin/main`. In that case,
   run `tasker update-branch`. The task goes to `executed`. Then run `tasker verify` and `tasker review` again as in
   step 5. If `tasker verify` fails, follow the verify-failure rule. If that review has findings, go to step 6.
   Otherwise, run `tasker accept` again. Right after `tasker accept`, run `tasker merge`. The task goes to `landed`. If
   `tasker merge` fails, the task goes to `failed` from `merging`, and nothing lands. `tasker show <issue>` then prints
   `tasker retry` as the next command. To find the cause, run `git fetch --multiple tasker origin`. Then run
   `git merge-base --is-ancestor origin/<base branch> tasker/<task branch>`. If the exit code is 1, the base branch
   moved. In that case, do not run `tasker retry`, because the land fails again on the moved base. Run
   `tasker update-branch`. The task goes to `executed`. Then continue this step as it says after the first
   `tasker update-branch`: `tasker verify`, `tasker review`, the diff read, `tasker accept` and `tasker merge`. On #286
   (2026-10-18), #283 landed between `tasker accept` and `tasker merge`, so `origin` refused the push as
   non-fast-forward, and the task went to `failed`. If the exit code is 0, `tasker merge` failed for another reason. In
   that case, follow the paragraph "If a command fails" of
   [the verify-failure rule](verify-failures.md#the-verify-failure-rule). If `git fetch` or `git merge-base` fails, or
   the exit code is not 0 and not 1, [stop](limits.md#the-answer-wait-rule). After a `tasker merge` that succeeds, do
   [the CI wait](ci-wait.md#the-ci-wait). The task stays in `landed`. If the CI wait passes, run `tasker finish`. The
   task goes to `finished`, and the issue closes. If a run failed, step 12 of the CI wait runs `tasker finish`. If the
   CI wait stops, do not run `tasker finish`, and do not do steps 10 and 11.
10. After `tasker finish`, make sure that `origin` has no task branch of the ticket. Do not rely on `tasker finish` for
    this. Do this step after each `tasker finish`. At the end of this step, whatever its result, remove the task
    worktree as [the own-worktree rule](limits.md#the-own-worktree-rule) says. Each "then do step 11" of this step comes
    after that remove. The remove changes no task, and the task keeps its state, for example `finished`. In each case of
    this step that says "delete nothing" or "delete nothing more", report to the orchestrator, and then do step 11. In
    such a case, unless the case says otherwise, the task branch on `origin` can still exist, and the task keeps its
    state. If the agent followed [docs/dev/rebase-conflicts.md](rebase-conflicts.md) and did not do its steps 15 to 20
    yet, it does those steps first. If a step of that page stops before step 21, do not do the rest of this step. The
    shared failure paragraph before step 15 of that page names what stays behind, with the difference that the step
    names, and the task keeps its state. Report to the orchestrator. Then do step 11. After steps 15 to 20, step 21 of
    that page sends the agent back to this step. The agent then does the rest of this step and does not do steps 15 to
    20 again. Run each command of this step in the local clone of the orchestrator. Run `tasker show <issue>`. It prints
    the task branch on the `branch:` line and the base branch on the `base:` line. If `tasker show` fails, delete
    nothing. If `tasker show` does not print the line `state: finished`, delete nothing. For example, the task is in
    `cleanup_failed`. In each case that follows, the task stays in `finished`. Run `git fetch origin`. If the fetch
    fails, delete nothing. Find out if `origin` has the task branch, with a read-only command:
    `git ls-remote --exit-code --heads origin refs/heads/<task branch>`. Give the full ref, because a short name also
    matches a longer branch name that ends with it. For example, `x` matches `feature/x`. The command exits with 0 when
    `origin` has the task branch. It exits with 2 when `origin` does not have the task branch. It exits with 128 when
    git cannot reach `origin`, for example when the path of `origin` does not exist. If the exit code is 2, the step is
    complete, and the task stays in `finished`. If the exit code is not 0 and not 2, delete nothing. While `origin` has
    the task branch, `git fetch origin` updates `origin/<task branch>`. A fetch without `--prune` keeps
    `origin/<task branch>` after `origin` deleted the branch. For this reason, the read of the tip and the next check
    run only after the exit code 0 of `git ls-remote`. If the exit code is 0, read the tip of the task branch on
    `origin`: `git rev-parse --verify origin/<task branch>`. The command prints the full hash of 40 characters of the
    tip. This step calls it `<commit>`. If the command fails, delete nothing. Then read the tip of the base branch:
    `git rev-parse --verify origin/<base branch>`. This step calls the hash `<base>`. If the command fails, delete
    nothing. Make sure that the base branch contains `<commit>`: `git merge-base --is-ancestor <commit> <base>`. This is
    [the ancestor check](rebase-conflicts.md#the-ancestor-check) of [docs/dev/rebase-conflicts.md](rebase-conflicts.md),
    with `<commit>` as `<tip>`. That check gives the exit codes and the meaning of exit code 1. If the exit code is 1,
    do [the patch check](rebase-conflicts.md#the-patch-check) of that page, with `<commit>` as `<tip>` and the same
    `<base>`. Do only the patch check and the take check, and do not do step 17 itself or steps 18 to 21 of that page.
    If `git cherry` exits with 0 and a line starts with `+`, and the agent followed
    [docs/dev/rebase-conflicts.md](rebase-conflicts.md) for this task, do
    [the take check](rebase-conflicts.md#the-take-check) of that page. The agent is then the driver of that page and
    recorded `<taken>` at its step 11. Use `<commit>` as the pushed tip, the same `<base>` and the landed commit that
    `tasker merge` printed. Use only the two facts of the take check. Step 17 of that page already compared the local
    tip before step 20 deleted the local task branch. If the agent did not follow that page for this task, do not do the
    take check. If the patch check fails and the take check does not pass, delete nothing. For example, a fact does not
    hold, or a command of the take check fails. The task branch on `origin` stays. If the exit code is not 0 and not 1,
    delete nothing. The task branch on `origin` stays. If the exit code is 0, or the exit code is 1 and the patch check
    or the take check passes, delete the task branch on `origin` with a lease:
    `git push --force-with-lease=refs/heads/<task branch>:<commit> origin --delete <task branch>`. With the lease, git
    deletes the branch only when the branch on `origin` is still at `<commit>`. As a result, the delete cannot remove a
    commit that someone pushed to the task branch after the check. If the push succeeds, it exits with 0, and git prints
    `- [deleted]  <task branch>`. The step is complete, and the task stays in `finished`. If the push fails, for any
    reason, delete nothing more. For example, if someone pushed a new commit to the task branch after the check, the
    push exits with 1, and git prints `! [rejected]  (delete) -> <task branch> (stale info)`. The task branch on
    `origin` stays with the new commit. If someone deleted the branch after the check, the push exits with 1, and git
    prints `error: unable to delete '<task branch>': remote ref does not exist`. For another failure, the task branch on
    `origin` can still exist.
11. After `tasker finish`, post a comment on the issue that starts with `## Decisions made during implementation`. List
    the choices that the issue did not state, with the reasons. Name each detail that the issue did not give. A list
    item of the comment has no bold text at its start. The agent writes the comment in its final form before it posts
    it, because GitHub keeps the history of each edit.

### The final report

At the end of its work on the ticket, the agent gives a final report to the orchestrator. The agent gives the final
report as its final answer, not with `SendMessage`. The work of the agent on the ticket ends after step 11, or when the
orchestrator tells the agent to end its work, for example in step 1 of
[the defer rule](pick-the-tickets.md#the-defer-rule). A final answer that the agent gives before the end of its work is
an interim report, not the final report. That final answer gives the state of the task, says if the agent stopped, and
says that the agent waits. Examples are the final answer of [the answer-wait rule](limits.md#the-answer-wait-rule) and
the end of the turn after a quota stop in ["What the agent does" in "Quota"](quota.md#what-the-agent-does). The report
gives these items:

- The result: the landed commit, the number of review loops, the files that landed and, for each doc that landed, the
  sections that changed. If the work of the agent ended before `tasker finish`, for example after the orchestrator told
  the agent to end its work, the result gives the state of the task and the reason for the end of the work. In that
  case, for a stacked task, the result also gives the start base of the last read, or says that the agent holds no start
  base.
- Each finding that the agent dismissed, with its reason.
- The edge cases that the agent left out (see ["Review findings"](review-findings.md#review-findings)).
- Each claim of the issue that was no longer true and each conflict (see
  [the issue check](plan-review.md#the-issue-check)). For a false claim, the bullet gives the current fact and the
  command that shows it. For a conflict, it gives the requirement, the conflicting rule or decision, the command or the
  doc that shows it, and the resolution: the change in the feedback text of the refine of step 4, the text of the plan
  that already resolves the conflict, or the answer of the user. If the task branch already held commits at the issue
  check, also the files that the agent read from the base commit and how. The bullet also gives each claim that the
  agent cannot test, because the issue names no ticket and no date for an output of the installed tasker.
- Each task worktree or local task branch that stays, with its path.
  [The own-worktree rule](limits.md#the-own-worktree-rule) says when one stays.
- The lessons.

The orchestrator sorts the lessons. A lesson that is a rule for the repo or for agents goes where the new-rule bullet of
["The prompt of an agent"](pick-the-tickets.md#the-prompt-of-an-agent) says.

### The comeback rule

This rule covers a ticket that already has a task in flight when its agent starts, for example a parked task that came
back (see [the defer rule](pick-the-tickets.md#the-defer-rule)). The task already exists, so the agent does not run
`tasker start` or `tasker plan`. If the issue has a comment that starts with `## Parked task` (step 6 of the defer
rule), the agent reads the last such comment. Then it runs `tasker show <issue>`. If the `base:` line has the form
`refs/heads/<parent branch>`, the task is stacked. Then the agent takes the start base only from the last
`## Parked task` comment of the orchestrator account, `codeguru42`. A comment of another account does not count, because
any GitHub user can post a comment, as for [the issue check](plan-review.md#the-issue-check). An earlier
`## Parked task` comment of that account does not count either. The value from the comment is the start base of the last
read. It lives until the next read of the start base that [the same-patch rule](review-findings.md#review-findings)
names. If that last comment gives no start base, or no such comment of that account exists, the agent holds no start
base. Then each step that uses the start base does what it says for an agent that holds no start base. For example, the
diff read and the commit check stop. Then the agent does [the remote setup](#the-diff-read). Then the agent makes the
task worktree as [the own-worktree rule](limits.md#the-own-worktree-rule) says. The branch-exists case can apply. The
make changes no task. If the task is in `quota_blocked`, `interrupted` or `awaiting_quota_approval`, the agent follows
["What the agent does" in "Quota"](quota.md#what-the-agent-does), and it does not do the rest of this rule. Otherwise,
the agent runs `git merge-base --is-ancestor origin/<base branch> tasker/<task branch>`. If the exit code is 1, the base
branch moved. In that case, if `tasker show <issue>` lists `update-branch`, the agent runs `tasker update-branch`. If
`tasker show <issue>` does not list `update-branch`, the agent does not run it. The diff read before `tasker accept`
finds the move later. If `tasker update-branch` reports a rebase conflict, the agent follows
[docs/dev/rebase-conflicts.md](rebase-conflicts.md), as ["Land the work"](land-the-work.md#land-the-work) says. If a
step of that page stops, a command fails, or the exit code is not 0 and not 1, the agent
[stops](limits.md#the-answer-wait-rule). Otherwise, the agent continues ["Run one ticket"](#run-one-ticket) from the
state that `tasker show <issue>` prints. After `tasker update-branch`, "Land the work" gives the next commands for the
states that it names. For another state, for example `failed`, the agent follows the commands that `tasker show <issue>`
prints.

### The base rule

This rule covers each command of [the orchestration pages](../orchestrator.md) that uses `origin/<base branch>`. A
stacked task is a task that `tasker start` based on the branch of its parent (see
[the stacked-ticket rule](pick-the-tickets.md#the-stacked-ticket-rule)).

Before each such command, the agent reads the `base:` line of `tasker show <issue>`. The agent does these steps:

1. If the line has a plain name, use `origin/<base branch>` as the command says.
2. If the line has the form `refs/heads/<parent branch>`, the task is stacked. Right before the command, run
   `git fetch tasker`. Then use `tasker/<parent branch>` in place of `origin/<base branch>`. If the step already ran
   `git fetch tasker` or `git fetch --multiple tasker origin` right before the command, it needs no second fetch.
3. If a step uses `tasker/<parent branch>` in more than one command, read its hash one time with
   `git rev-parse --verify`, as [the shared-clone rule](limits.md#the-shared-clone-rule) says.

A `tasker update-branch` with no conflict moves a stacked task onto the base of the parent after the parent lands.

An agent of a stacked task meets a landed parent at `tasker verify` in `executed`. It also meets a landed parent at
`tasker refine` in `awaiting_plan_review`, after `tasker finish` of the parent.
[The facts of the installed tasker](tasker-commands.md#the-facts-of-the-installed-tasker) say what happens in each case.

These steps use the base: the comeback rule, the diff read, [the issue check](plan-review.md#the-issue-check),
[the broken-commit steps](verify-failures.md#the-broken-commit-steps),
[the commit check](verify-failures.md#the-commit-check), [the same-patch rule](review-findings.md#review-findings), and
steps 3 to 5 of [docs/dev/rebase-conflicts.md](rebase-conflicts.md) when those rules do them. For a stacked task, the
diff of the diff read and the first patch id of the same-patch rule, with its text id, use the start base in place of
`tasker/<parent branch>`. The base commit of step 4 of [the commit check](verify-failures.md#the-commit-check) also uses
the start base. The base commit of the refine of step 4 in
[the broken-commit steps](verify-failures.md#the-broken-commit-steps) also uses the start base.

Step 4 of [docs/dev/rebase-conflicts.md](rebase-conflicts.md) does not stop for a stacked task when the diff read, the
comeback rule or the commit check does the steps of that page. [The manual fix](verify-failures.md#the-manual-fix) and
the procedure for a rebase conflict keep the stop of step 4 for a stacked task whose parent has not landed.

### The add-work rule

If the task is in `awaiting_work_review` and the agent must add work, the agent runs
`tasker review <issue> "<feedback>"`. The agent adds [the repo-files rule](plan-review.md#the-repo-files-rule) to the
feedback text. The task reaches `awaiting_work_review` after a review with no findings in step 5 or step 9, or after the
agent dismisses all the findings in step 7. In this state, `tasker refine` refuses to run. The work can come from the
orchestrator, for example. After `tasker review <issue> "<feedback>"`, the task goes to `refining`, and tasker makes a
new plan revision. Then the task goes to `awaiting_plan_review`. Then the agent does steps 3 and 4 for the new plan, and
steps 5 to 8 again, starting with `tasker approve`.

### The diff read

Each time before the agent runs `tasker accept` in step 9, the agent reads the full diff of the task branch against the
base branch. The agent does this also after a review with no findings. In one milestone, this read found real
duplication and false doc text on four tickets where the review found nothing. In the local clone of the orchestrator,
the agent does the remote setup. The remote setup is steps 1 to 5 of
[docs/dev/rebase-conflicts.md](rebase-conflicts.md#procedure). The clone gets the read-only `tasker` remote, and the
agent reads the base branch. The fetch of step 5 fetches both remotes. It reads the tasker clone through the read-only
`tasker` remote, and it changes nothing there. Then the agent does [the update rule](limits.md#the-update-rule) in the
task worktree. The agent reads whole files of the task there. Then the agent runs
`git diff origin/<base branch>...tasker/<task branch>`. For a stacked task, the agent runs
`git diff <start base>...tasker/<task branch>` in place of that command. `<start base>` is the start base of the last
read, as [the same-patch rule](review-findings.md#review-findings) defines it. After a rewrite of the parent,
`tasker/<parent branch>` holds the old commits of the parent, and a diff against it shows them too. A diff from the
start base shows only the work of the task. If the agent holds no start base, the diff read stops. The task branch is on
the `branch:` line of `tasker show <issue>`. The agent reads the full diff.

If the full diff is too large for one context, the agent can split the read. This choice is open on purpose, and the
agent makes it. The mechanical files of a commit are the files that the agent names as files with a change of form only.
Examples of such a change are a format pass and a prose wrap. The machine proof is
`git diff --word-diff=porcelain <commit>~1 <commit> -- <mechanical files>`. It shows whether the mechanical files change
a word.

The commits of a split read are the commits of the range of the diff read command, for example
`git log --format=%H origin/<base branch>..tasker/<task branch>`. For a stacked task, the start base takes the place of
`origin/<base branch>`. In a split read, the agent reads the diff of each commit itself, with
`git diff <commit>~1 <commit>`. The one exception is the mechanical files of a commit with the machine proof.

For the mechanical files of a commit, the agent runs the machine proof. An exit code of 0 is a success of the proof.
Each other exit code is a failed command of the diff read. A changed word is a line of the proof that starts with `-` or
`+`. The two header lines of each file do not count. If the proof shows a changed word, the agent reads the diff of
those files itself.

If the proof shows no changed word, the agent starts subagents with the Agent tool. The parts split the output of
`git diff <commit>~1 <commit> -- <mechanical files>` into ranges of lines with no gap and no overlap. Each subagent
reads one part, line by line. Each subagent reports the line count of its part and its findings to the agent. The
reports are part of the own diff read of the agent.

The agent chooses the number of parts and whether the subagents run in parallel. This choice is open on purpose. The sum
of the line counts of the parts equals the output of `git diff <commit>~1 <commit> -- <mechanical files> | wc -l`. A sum
that does not match is a failed command of the diff read. The agent applies [the add-work rule](#the-add-work-rule) to
each finding of a subagent, in the same way as for a finding of the agent.

A split read of this form counts as the full read. The reason: the machine proof shows that no word changes. The
subagents read each line, and the agent reads each other change itself. On #506, the full diff had 12726 lines. Six
parallel subagents read the wrap commit, and the agent ran the machine proof.

The agent also searches each test file of the diff for a helper name that is defined two times, for example in the test
file and in `test/helpers/`. A clean review missed such copies on more than one ticket. Such a copy is a duplication. If
the agent finds a duplication, a fact that the docs lost, or a doc sentence that is false, it adds the work with the
add-work rule. ["Review findings"](review-findings.md#review-findings) limits the number of loops. Right before
`tasker accept`, after the agent read the diff, the agent fetches again, as [the base rule](#the-base-rule) says:
`git fetch --multiple tasker origin` for a stacked task, and `git fetch origin` for a plain base. Then it runs
`git merge-base --is-ancestor origin/<base branch> tasker/<task branch>`. This command uses `origin/<base branch>` one
time, so it needs no hash read. If the exit code is 0, the task branch contains the tip of the base branch, and the
agent runs `tasker accept`. If the exit code is 1, the base branch moved, for example `origin/main`. The agent does not
run `tasker accept`. Before `tasker update-branch`, the agent does each read of
[the same-patch rule](review-findings.md#review-findings) that belongs to that update, for example the first patch id.
Then it runs `tasker update-branch` and continues step 9 as it says after `tasker update-branch`. The reads of the
same-patch rule are not commands of the diff read, and that rule gives the result of a failed read. The last fetch and
`git merge-base` are commands of the diff read. An exit code of `git merge-base` that is not 0 and not 1 is a failure. A
failed step of the update rule is a failed command of the diff read. If a step or a command of the diff read fails or
stops, the agent [stops](limits.md#the-answer-wait-rule). Nothing changes in the repo or the worktrees of tasker. The
report of the stop takes the place of the person who decides on that page.

### The measure rule

This rule covers an issue that asks for a measure of the work, for example a test loop with a count of failures. The
agent of the ticket takes the measure itself. It takes the measure in each diff read, after it reads the full diff and
before the last fetch of the diff read. The agent takes the measure in the task worktree, after the update of the diff
read. If the issue asks for a measure at a named point of the work, the agent takes that measure on the commit of that
point. For example, a measure "after the fix of the test race" runs on the commit of that fix, before the later commits
of the task. The agent checks out that commit in the task worktree and names its hash with the numbers. After the
measure, the agent runs `git switch <task branch>` in the task worktree. A failed switch is a failed command of the diff
read, so the diff read [stops](limits.md#the-answer-wait-rule) as it says. A measure with no named point runs as this
rule says. The result of the measure is an answer, not a failure of the diff read. For example, a count of failures, or
a test command that exits with a code that is not 0, is a result. The agent records the result and continues the diff
read. A command of the measure that cannot start, for example because `npm ci` fails, is also a failed command of the
diff read. The diff read then stops, as it says. The agent does not rely on the execute session for the numbers. No
read-only `tasker` command prints the last message of that session. A direct read of a transcript of tasker follows
[the own-worktree rule](limits.md#the-own-worktree-rule). On #111, the agent measured the loops of the test again in its
own worktree of the task branch. The agent gives the commands and the numbers of the last measure in the comment of
step 11.
