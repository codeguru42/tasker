# Verify failures

The reader of this page is the task subagent of a ticket. [The base rule](run-one-ticket.md#the-base-rule) covers each
command of this page that uses `origin/<base branch>`.

## The verify-failure rule

This rule applies to each `tasker verify` on [the orchestration pages](../orchestrator.md), in step 5 of
[Run one ticket](run-one-ticket.md#run-one-ticket), in step 9 and after `tasker update-branch` in
["Land the work"](land-the-work.md#land-the-work). If `tasker verify` fails, the task goes to `failed`. In `failed`,
`tasker show <issue>` lists `refine`, `update-branch`, `retry` and `abort`. A fix of a failed `tasker verify` does not
count as a loop of ["Review findings"](review-findings.md#review-findings). The limits of this rule count each refine
and each retry after the last `tasker verify` that passed, for any cause. If the task is in `failed` after a command
other than `tasker verify` or `tasker retry`, this rule does not apply. In that case, the task subagent follows the
paragraph after this list, which starts "If a command fails". The task subagent reads the output of `tasker verify` and
finds the cause of the failure. Then the task subagent does the first case of this list that applies:

- If the failure comes from the code and the task subagent already sent the refine of the next case, the task subagent
  [stops](limits.md#the-answer-wait-rule).
- If the failure comes from the code, the task subagent finds the cause with
  [the bisect diagnosis](#the-bisect-diagnosis) before repair. Then the task subagent runs one
  `tasker refine <issue> "<feedback>"`. `tasker refine` accepts a task in `failed` only when the task has a plan
  revision. The feedback gives the cause of the failure. It tells the plan to fix each cause commit in that commit, not
  in a new commit on top. More than one commit can be broken, so the refine covers all observed broken revisions. The
  feedback links to the bisect diagnosis. The broken-commit steps give the git commands for this feedback. The task
  subagent adds [the repo-files rule](plan-review.md#the-repo-files-rule) to the feedback text. The task goes to
  `awaiting_plan_review`. Then the task subagent does steps 3 and 4 for the new plan, and steps 5 to 8 again, starting
  with `tasker approve`. As the other choice, the task subagent does not refine. The task subagent stops for a manual
  fix. If the orchestrator then tells the task subagent to do the manual fix, the task subagent follows the
  broken-commit steps. For a failure from the code, the task subagent does not run `tasker retry`, because the same
  check fails again on the same code. The task subagent also does not run `tasker retry --resume-execute`. That flag
  resumes execute with no new feedback, so the plan does not get the cause of the failure.
- If the task subagent already ran `tasker retry`, the task subagent stops. If the `tasker verify` that `tasker retry`
  ran failed, the task stays in `failed`. If `tasker retry` itself failed, the task stays in the state that
  `tasker show <issue>` prints.
- If the failure does not come from the code, the task subagent runs `tasker retry <issue>` one time. For example, a
  test failed one time for a reason outside the code. `tasker retry` accepts a task in `failed`. By default,
  `tasker retry` runs `tasker verify` again on the same code. If that verify passes, the task subagent runs
  `tasker show <issue>`, and the task is in the state that it prints. Then the task subagent runs the command that comes
  after `tasker verify` in the place that ran it. In each place on [the orchestration pages](../orchestrator.md), that
  command is `tasker review`.

If a command fails or the task is in another state, run `tasker show <issue>` and follow the commands that it prints.

To find the next command, use these:

- `tasker --help` lists the commands.
- `tasker <command> --help` shows the states where the command is valid.
- `tasker show <issue>` shows the state of the task and the next commands.

## The bisect diagnosis

Diagnosis uses `git bisect` to find revisions that show the reported failure before the first repair. It does not change
commits or move the task branch. A passing ancestor bounds a search without replaying the whole branch before the first
repair. Expected test failures and nonmonotonic histories prevent bisect from certifying every required revision. The
exhaustive final audit preserves the commit contract after each repair.

For an exhaustive audit, the task subagent uses “The commit check”, and the execute session uses “The session check” in
its place.

The task subagent diagnoses in the local task worktree. The execute session diagnoses in its own worktree. Neither
creates another worktree or reads tasker data files. Each git command below runs in the named worktree.

1. On resumption, use the earlier run's saved values. Finish cleanup under “Cleanup” before new preparation.
2. In the named worktree, make sure that it is clean and no rebase is active. Use “Cleanup” to make sure that no bisect
   is active. If a bisect is active, finish cleanup before preparation. Run steps 1–4 of
   [the commit check](#the-commit-check). In an execute session, use the base commit from refine feedback instead of the
   base from step 4. Stop after any failed preparation command.
3. In the applicable worktree, run the dependency guard from step 5 of [the commit check](#the-commit-check). Then save
   the full branch name, current tip, base hash, and original `HEAD` attachment. If the guard or preparation fails, stop
   without a new search.
4. At the saved tip, run `npm run check` with the dependency guard. Record its command, result, and hash. An install
   failure or unrelated command error does not show the target failure.
5. If the target failure does not reproduce, run the exhaustive audit. Use that result as the first audit in the repair
   loop. If its list is empty, use the non-code cases of the [verify-failure rule](#the-verify-failure-rule). Do not
   continue diagnosis or run bisect.
6. Prefer the nearest known passing ancestor as the good bound. Reuse a passing verify revision only when its exact hash
   stays an ancestor on the same base and unchanged history. Record its pass and ancestry evidence.
7. In the active worktree, run `git merge-base --is-ancestor <good> <bad>` and
   `git merge-base --is-ancestor <base> <good>`. Exit 0 accepts a bound. Exit 1 rejects it. Any other exit stops
   diagnosis. An untested or failing base is not a good bound. A passing tip says nothing about untested ancestors.

### Bisect command results

After each `git bisect start`, `git bisect good`, `git bisect bad`, or `git bisect skip`, read the output before another
bisect command. Apply these results to all four commands:

- The line `<hash> is the first bad commit` has exit code 0. Record that hash as a candidate for one reproducer, then
  run “Cleanup”.
- The lines `There are only 'skip'ped commits left to test.` and `The first bad commit could be any of:` give a
  candidate set. Record every listed hash, then run “Cleanup”. For measured `skip` and `good` paths, exit code 2 with
  these lines is a result, not an unclassified failure. This rule assigns no exit code to that result from
  `git bisect bad`.

Stop after any other unclassified command failure, then follow “Cleanup”.

8. If no passing bound is valid, say that bisect cannot start. Run the exhaustive audit as the pre-repair fallback. Use
   its result as the first audit in the repair loop. If its list is empty, use the non-code cases of the verify-failure
   rule. Do not continue diagnosis or run bisect. If a bound is valid, run `git bisect start <bad> <good>` in the active
   worktree. Apply “Bisect command results”. At each selected hash, apply the dependency guard before direct commands.
   Use the same command or a smaller reproducer. After an observed pass, run `git bisect good` and apply “Bisect command
   results”. After the target failure, run `git bisect bad` and apply “Bisect command results”. If `git bisect start`
   fails, stop. Clean up under “Cleanup” if a search started.
9. In the active worktree, run `git bisect skip` for an untestable revision or unrelated failure. A skipped `test:`
   commit remains a possible cause commit. A skip is neither a pass nor proof of cause. Apply “Bisect command results”.
   Record tested hashes, commands, outcomes, skips, and all candidates. Clean up under “Cleanup” after normal,
   interrupted, or failed searches.

### Cleanup

- (a) In the active worktree, run `git rev-parse --git-path BISECT_START`. If it fails, stop without another git
  operation. Run `test -e <path>` on its output. If the file is absent, cleanup is complete.
- (b) If saved evidence is absent, stop without cleanup. Read the file. For an originally attached `HEAD`, make sure
  that its short name matches the saved branch. For an originally detached `HEAD`, make sure that its hash matches the
  saved original `HEAD`. If either differs, stop without cleanup.
- (c) Run `git rev-parse refs/heads/<task branch>` and make sure that it matches the saved tip. If the branch or tip is
  absent or differs, stop without cleanup.
- (d) Run `git bisect reset` in the active worktree. Then make sure that the branch, tip, and `HEAD` attachment match
  their saved values. If cleanup fails, report the exact state. Run no repair or tasker command.

A bisect result is a candidate transition for one reproducer. A skipped interval stays a candidate set. If observations
show failure, pass, then failure, record nonmonotonic history without claiming an earliest failure. A history rewrite or
base change invalidates reuse of a passing result. Inspect candidate diffs and relevant skipped commits to establish the
cause. Extend inspection to the base if a latent cause predates the preferred good bound. Report observed broken
revisions and cause candidates, a failure that did not reproduce, or an incomplete diagnosis. An incomplete diagnosis is
not a pass and permits no rewrite without an established cause. If the task subagent cannot establish a cause, it stops
and reports the failure.

## The broken-commit steps

These steps give the git commands for a failure from the code in the verify-failure rule. A broken commit is an
implementation commit that fails `npm run check`, or the tip of the task branch when it fails `npm run check`. The tip
has no next commit, so it must pass, whatever its prefix. The cause commit of a broken commit is the commit that adds
the cause of its failure. It is the broken commit itself, an earlier broken commit, or an earlier commit that the check
skips, for example a `test:` commit that adds a test configuration. The cause stays in the task commits after their
base. The Commits section of [docs/dev/rules.md](rules.md) defines an implementation commit and gives the rule. The fix
of a broken commit goes into its cause commit, not into a new commit on top. The steps do not change the limits or the
cases of the verify-failure rule.

The base commit is the commit under the first commit of the task branch. `tasker update-branch` moves the task branch
onto a newer base, so the base commit changes. For this reason, diagnosis preparation finds the base commit again. The
refine feedback gives the base commit found during diagnosis preparation, and the session steps use that base. The one
exception is the refine of step 4 of [Run one ticket](run-one-ticket.md#run-one-ticket) after a `tasker update-branch`:
there the task subagent finds the base commit directly, as the next paragraph says, not from a commit check.

In the refine of the verify-failure rule, the task subagent uses [the bisect diagnosis](#the-bisect-diagnosis) on the
reproduced failure before repair. Feedback gives the observed failure, bounds, candidates, skipped revisions, and
current base hash. It does not call this a complete broken-commit list. If diagnosis uses the exhaustive audit fallback,
feedback gives that audit's broken-commit list. The task subagent adds
[the repo-files rule](plan-review.md#the-repo-files-rule) to the feedback text. If the task subagent runs
`tasker update-branch` after it sends the refine and before `tasker approve`, the hashes and bounds become stale. The
session diagnoses again on its current history and base. A history rewrite or base change also invalidates the diagnosis
hashes and bounds. In the refine of step 4, the task subagent gives the new base commit. If the task stays stacked after
`tasker update-branch`, the base commit is the start base of the last read, as
[the same-patch rule](review-findings.md#review-findings) defines it, and the task subagent runs no `git merge-base`. If
the task subagent holds no start base for a stacked task, the task subagent [stops](limits.md#the-answer-wait-rule). A
task stays stacked when the `base:` line of `tasker show <issue>` still has the form `refs/heads/<parent branch>`.
Otherwise, the task subagent runs `git fetch --multiple tasker origin`, then
`git merge-base tasker/<task branch> origin/<base branch>`. If a command fails, the task subagent
[stops](limits.md#the-answer-wait-rule). This refine of step 4 is part of the same fix, not a new refine of the
verify-failure rule, so the limits of that rule do not change. Then the task subagent continues as usual.
`tasker verify` runs after `tasker approve` and `tasker execute`, as the steps of "Run one ticket" say. The feedback
tells the session (the execute session that tasker starts) to diagnose again on its current history and base, then fix
established cause commits with these steps:

1. Diagnose the current failure as [the bisect diagnosis](#the-bisect-diagnosis) says. If diagnosis is incomplete, stop
   without rewriting history.
2. If diagnosis used a fallback, use its exhaustive result as the first audit result. If the list is empty, end the
   session. If diagnosis establishes a cause after reproduction, repair that failure before the first full audit.
3. On the task branch, find the broken revision's position with `git rev-list --count <base commit>..<broken revision>`.
   Position 1 is the first task commit after the base. If the command fails, stop and report. Find its cause commit from
   the failure and diagnosis or audit candidates. Stage the repair and run `git commit --fixup=<cause commit>`. This
   also applies when the cause commit is the tip or a `test:` commit. If the command fails, stop and report. The staged
   repair stays, and git makes no fixup commit.
4. At once, run `GIT_SEQUENCE_EDITOR=: git rebase --autosquash <base commit>` on the task branch.
   `GIT_SEQUENCE_EDITOR=:` makes sure that the rebase does not wait for an editor. With git 2.47.3, the `--autosquash`
   flag works without `-i`, and the rebase does not depend on the `rebase.autoSquash` configuration. The rebase squashes
   the fixup commit into the commit that it names. As a result, the fix is part of the history before the session looks
   at the next commit. If the rebase fails, for example with a conflict, run `git rebase --abort`, then stop and report.
   If abort succeeds, the branch returns to its pre-rebase state with the fixup commit on top. If abort fails, report
   the exact state.
5. After `git rebase --autosquash`, invalidate old hashes and bounds. Never reuse an audit list from before a rewrite.
6. Use the exhaustive audit result as the first audit result after a fallback. After every repair, run the full
   [session check](#the-session-check) on current history and base. The audit lists broken commits oldest first. If it
   stops, stop and report as the session check says. If the list is empty, end the session.
7. If the list is not empty, find the oldest broken revision's position with the command in step 3. Keep that position
   until the next audit. Do not compare the first audit result's position. For each later result, require its position
   to exceed the prior result's position. If it does not, stop and report; fixes so far stay in their commits. Then
   repair its cause by repeating steps 3–6. An audit with another failure cannot report success from a repaired bisect
   result. Allow one initial diagnosis repair, followed by at most the number of task commits after the base in audit
   rounds. Stop after an empty result, audit error, failed fixup, failed rebase, or a position that does not increase.

If the session stops, the execute run fails. The task subagent then follows the verify-failure rule as it already says.
For a task in `failed` after a command other than `tasker verify` or `tasker retry`, that rule sends the task subagent
to the paragraph that starts "If a command fails".

After the refine, the task subagent continues as the verify-failure rule says. When the `tasker verify` after the fix
passes, the task subagent does the commit check before `tasker review`, unless the task subagent ran
`tasker update-branch` after the failed `tasker verify`. This check runs only because a `tasker verify` failed before
the fix. When `tasker verify` passes and no failed `tasker verify` came before it, the task subagent runs no commit
check. After `tasker update-branch`, the task subagent runs no commit check until `tasker verify` fails. `tasker verify`
runs after `tasker update-branch` as step 9 and ["Land the work"](land-the-work.md#land-the-work) say. If the commit
check fails, the task subagent stops and reports the list of broken commits. The task subagent does not run another
refine, because the verify-failure rule permits one refine.

The pushed-branch rule covers a task whose task branch was pushed to `origin` at step 9 of
[docs/dev/rebase-conflicts.md](rebase-conflicts.md). After that push, a fixup commit and an autosquash rebase change the
task branch of tasker, and `origin` keeps the pushed commits. The fix of a broken commit under the tip still goes into
its cause commit. On #201, the next `tasker update-branch` worked again only after the old task branch on `origin` was
deleted with a lease. The task subagent does the rule after a step 11 of that page that records a
[`<taken>`](rebase-conflicts.md#procedure). The rule does not run in [the loop](rebase-conflicts.md#procedure) of step
11 of that page. The task subagent does the rule before each later `tasker update-branch` of the task, until step 21 of
that page ends. The `tasker update-branch <issue> --take-remote` of step 11 is not a command of the rule. The rule
applies to each change of the pushed commits, whatever its cause.

The task subagent of the ticket does each step in the local clone of the orchestrator. No step runs in the tasker clone
or in a worktree of tasker. The git commands change no task, for example a task in `awaiting_work_review`, `reviewed`,
`awaiting_plan_review` or `failed`. The task subagent does these steps:

1. Run `git fetch --multiple tasker origin`. If the fetch fails, stop. Nothing changes.
2. Run `git ls-remote --exit-code --heads origin refs/heads/<task branch>`.
   [Step 10 of "Run one ticket"](run-one-ticket.md#run-one-ticket) gives its exit codes. If the exit code is 2, `origin`
   has no task branch. Go to step 7. If the exit code is 0, go on with step 3. If the exit code is another code, stop.
   Nothing changes.
3. Read `<commit>` with `git rev-parse --verify origin/<task branch>`. Read `<current>` with
   `git rev-parse --verify tasker/<task branch>`. If a read fails, stop. Nothing changes.
4. Run `git merge-base --is-ancestor <commit> <current>`. If the exit code is 0, the task branch of tasker contains the
   pushed commits. Go to step 7. If the exit code is 1, tasker changed the pushed commits. Go on with step 5. If the
   exit code is another code, stop. Nothing changes.
5. Make sure that `<commit>` is a hash that the task subagent holds as the driver of
   [docs/dev/rebase-conflicts.md](rebase-conflicts.md#procedure). These hashes are the `<taken>` of the last step 11 of
   that page and a [`<pushed>`](rebase-conflicts.md#procedure) of a take. A `<pushed>` of a new conflict does not count.
   If the task subagent holds neither hash, stop. If `<commit>` differs from each hash that the task subagent holds,
   stop. Nothing changes.

   On #460 (2026-10-25), the push was d4704974, and `<taken>` was dc153ce9. The orchestrator approved a delete with a
   lease at the pushed tip.

6. Delete the task branch on `origin` with a lease:
   `git push --force-with-lease=refs/heads/<task branch>:<commit> origin --delete <task branch>`. If the push fails, for
   any reason, stop. [Step 10 of "Run one ticket"](run-one-ticket.md#run-one-ticket) gives two examples: a stale lease,
   and a branch that is already gone. For another failure, the task branch on `origin` can still exist. The task
   subagent holds no `<deleted>`. If the push succeeds, keep `<commit>` as `<deleted>`. `<deleted>` lives until step 21
   of rebase-conflicts.md ends, or until the next push of step 9 of that page. That push ends the old `<deleted>`, and
   the task subagent holds no `<deleted>` until a later delete of this rule.
7. Run the `tasker update-branch` that the step that started the rule asked for, as
   [the plain-form rule](tasker-commands.md#the-plain-form-rule) says. That step gives the state of the task after the
   command.

Right after step 6, `origin` has no task branch. While the task subagent holds `<deleted>`,
[the take check](rebase-conflicts.md#the-take-check) in step 17 of rebase-conflicts.md uses it. If nobody pushed the
task branch again, step 21 of that page finds exit code 2 in
[step 10 of "Run one ticket"](run-one-ticket.md#run-one-ticket), so that step is complete. If the task subagent holds no
`<deleted>`, steps 15 to 21 of that page run as they are written.

## The session check

The session check runs `git rebase --exec` to certify history after repair. It covers every implementation commit and
the tip, even when [the bisect diagnosis](#the-bisect-diagnosis) used a passing bound. The non-reproduction and
no-passing-bound cases run this audit before repair. An expected failure in a `test:` commit stays outside the passing
set. The audit requires a passing tip. The check commands do not change commit contents. The last paragraph of
[the commit check](#the-commit-check) gives the facts of this rebase during and after its run. At the end, HEAD is on
the task branch. If the rebase stops for another reason, `git rebase --abort` puts the task branch back at its tip, with
HEAD on the task branch.

If the session stops in the middle of the rebase, the worktree stays in the rebase. Step 2 covers this case when the
session goes on.

The session does these steps in its worktree, on the task branch, with the base commit of the feedback:

1. Do steps 5, 6 and 8 of [the commit check](#the-commit-check): the `git rebase --exec` command, the notes and
   `git rebase --continue`, and the tip check. Step 2 takes the place of step 7 of the commit check. If the rebase exits
   with 0, the result is the list of broken commits, oldest first. The list can be empty. Then no rebase is in progress,
   so step 2 does nothing, and step 3 does not stop. If the rebase stops for another reason, or another error occurs,
   for example the rebase does not start or a command of step 8 of the commit check cannot run, go on with step 2.
2. If a rebase is still in progress after step 1, run `git rebase --abort`. A rebase is in progress when the folder
   `$(git rev-parse --git-path rebase-merge)` exists. If the abort fails, stop and report. The worktree stays in the
   rebase, and the task branch stays at its tip.
3. If step 1 ended with such a stop or error, stop and report. The task branch stays at its tip, with HEAD on the task
   branch.

## The manual fix

The task subagent does the manual fix only when the orchestrator tells it to, after the stop for a manual fix in the
verify-failure rule. The task subagent never changes the tasker clone (the clone of this repo that tasker keeps, see
[docs/dev/rebase-conflicts.md](rebase-conflicts.md)) or its worktrees by hand (see
[the own-worktree rule](limits.md#the-own-worktree-rule)). The task subagent does these steps:

1. Do [the remote setup](run-one-ticket.md#the-diff-read). Then do step 6 of
   [docs/dev/rebase-conflicts.md](rebase-conflicts.md). The task subagent works in the task worktree. Step 6 of that
   page uses it. [The local-commit rule](limits.md#the-local-commit-rule) holds from step 2 of this list. If a step
   fails, [stop](limits.md#the-answer-wait-rule).
2. Diagnose the failure as [the bisect diagnosis](#the-bisect-diagnosis) says. Use the base commit from step 4 of
   [the commit check](#the-commit-check). If diagnosis is incomplete, stop. The worktree and local task branch stay.
3. Repair each established cause by following [the broken-commit steps](#the-broken-commit-steps). Run the full audit
   after each repair. Invalidate bounds after any history rewrite or base change. If a step stops, stop. The worktree
   and local task branch stay.
4. Run the full audit once more after the repair loop. If it lists a broken commit, repair its cause one additional
   time, using the base commit of that audit. Then run the full audit one more time. If it still lists a broken commit,
   stop and report the list. If an audit stops with an error, stop. In each case, the worktree and local task branch
   stay. Nothing reached tasker.
5. Do steps 9 to 21 of [docs/dev/rebase-conflicts.md](rebase-conflicts.md): the push to `origin`,
   `tasker update-branch <issue> --take-remote`, the next commands, and the cleanup after `tasker finish`.

## The commit check

The commit check uses `git rebase --exec` to certify history in the exhaustive audit after each repair. It covers each
implementation commit and the tip. It also runs before repair when a failure does not reproduce or
[the bisect diagnosis](#the-bisect-diagnosis) finds no passing bound. It gives the list of broken commits and the base
commit. The task subagent does it in the task worktree, on the local task branch:

1. Do steps 1 to 4 of [the remote setup](run-one-ticket.md#the-diff-read). If a step fails,
   [stop](limits.md#the-answer-wait-rule). Nothing changes.
2. Run `git fetch --multiple tasker origin`. If the fetch fails, stop. Nothing changes.
3. Work in the task worktree, on the local task branch. This step makes no worktree. Outside the manual fix, do
   [the update rule](limits.md#the-update-rule). In the manual fix,
   [the local-commit rule](limits.md#the-local-commit-rule) holds, so run no update. If a step fails, stop. Nothing
   changes.
4. In the task worktree, find the base commit. For a plain base, run `git merge-base HEAD origin/<base branch>`. If the
   command fails, stop. For a stacked task, the base commit is the start base of the last read, as
   [the same-patch rule](review-findings.md#review-findings) defines it, and step 4 runs no `git merge-base`. After a
   rewrite of the parent, the merge base with `tasker/<parent branch>` is below the old commits of the parent, so the
   check also runs on them. If the task subagent holds no start base for a stacked task, stop. Nothing changes.
5. Run
   `git rebase --exec 'L=$(git rev-parse --git-path npm-ci-lock); { cmp -s "$L" package-lock.json || { npm ci && cp package-lock.json "$L"; }; } && case "$(git log -1 --format=%s)" in feat:*|fix:*|refactor:*) npm run check ;; esac' <base commit>`.
   The command runs after each commit. It runs `npm ci` when `package-lock.json` differs from the copy of the last
   install. It keeps that copy in the git folder of the worktree (`git rev-parse --git-path npm-ci-lock`), so
   `git status` stays clean. Then it runs `npm run check` after each implementation commit. The rebase skips `test:` and
   `docs:` commits. A `test:` commit can fail only for its new tests. An expected failure stays outside the passing set.
   The audit requires a passing tip. If `npm ci` fails, the command fails after that commit, and step 6 notes that
   commit. Because the branch already starts on the base commit, the rebase keeps the same commits.
6. If the rebase stops and prints `warning: execution failed`, the command failed after the commit that
   `git log -1 --format='%h %s'` names. Note that commit as a broken commit. Then run `git rebase --continue`, and the
   rebase checks the next commits. Do this step again each time the rebase stops this way. A commit after a broken
   commit can fail only because of the earlier commit. The session fixes the oldest broken commit first and then runs
   the check again, so a fix of the earlier commit can also remove a later commit from the list.
7. If the rebase stops for another reason, run `git rebase --abort`. The worktree goes back to the branch at the old
   tip. Then stop and report the error. If the abort fails, the ref of the branch is still at the old tip, and the
   worktree stays in the rebase. Stop and report the output of `git -C <path> status`.
8. When the rebase exits with 0, it kept the same commits, and the worktree is at the tip. If the tip is not an
   implementation commit, including a `docs:` tip, run `npm run check` one time in the worktree. The worktree already
   has the packages of the tip, because the rebase ran the command after the tip too. If `npm run check` fails, note the
   tip as a broken commit.
9. The commit check passes when it noted no broken commit. Otherwise, the check fails and gives the list of broken
   commits and the base commit of step 4. The step that ran the check gives the next step.

During the rebase, HEAD is detached inside the task worktree, and the branch ref stays at the old tip. When the rebase
ends, it keeps the same commits, so the branch is at the same tip.
