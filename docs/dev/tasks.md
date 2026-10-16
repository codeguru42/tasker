# The task commands

This page gives the reasons and the limits of the task commands start, abort, plan, refine, approve, unapprove, execute, verify, review, dismiss-review, merge, mark-landed, finish, retry and accept, and of the result of an assistant run. The reference files of the user doc [SKILL.md](../../skills/tasker/SKILL.md), one for each phase in `skills/tasker/references/`, show the output.

The commands abort, plan, refine, approve, unapprove, execute, accept, merge, mark-landed and finish share one rule. Each of these commands makes all its checks before its first write, so a refused command leaves the task, the files and the events as they were. [Accept](#accept) and [Mark landed](#mark-landed) give an exception for the refs of the clone. A refused approve or unapprove also leaves the plan revisions as they were. Each command that changes a task follows the no-wait rule of the task lock in [The locks](#the-locks).

## Start

### The purpose of start

`tasker start` makes a task for an issue and takes it to `workspace_ready`.

It has no option to take over a lock of a live process, and no stacked base.

### The order of the steps

The order follows what each step needs and what a failure can leave.

- The issue is read, and the closed check runs, before a task exists. As a result, a bad key, a missing issue or a closed issue leaves no task.
- The base comes before the workspace, because the workspace starts from the base.
- Bootstrap runs after the repo lock is free. A bootstrap can run for a long time, and it does not use the clone. If bootstrap holds the repo lock, one slow bootstrap stops the start of every other task in the repo.

### The locks

Each start and each abort takes the task lock first and the repo lock second. No code takes a task lock while it holds a repo lock. As a result, two commands cannot wait for each other in a circle, so they cannot deadlock.

For each command that changes a task, the task lock does not wait. A second command for the same issue stops at once, because otherwise it repeats the work of the first one. The repo lock covers the steps that change the clone and the question for the base branch. The base step fetches first and asks only after the fetch, so the question falls inside the lock. The repo lock waits, because another task of the same repo usually holds it only for these short steps. The wait is long enough for a first fetch of a large repo.

The rule that each command that changes a task takes the task lock has one home: [the locks table](data-root.md#locks-table).

A person who does not answer the question for the base branch holds the repo lock. Another start of the same repo then waits, and it stops with the lock error at the end of its wait.

### A second run

A second run continues a task that did not reach `workspace_ready`. It does not make a second task.

- A failure before the clone steps changes no state and records no error. A busy repo lock is one such failure. The task stays in `provisioning`.
- A second run of a failed task first moves the task from `failed` to `provisioning`, and this move is on record. If the repo lock is then busy, the task stays in `provisioning` with no error on record. The next start continues it.
- A failure in a clone step or in bootstrap moves the task to `failed` with the error. The next run moves it back and continues.
- A task that is past this step is not changed. The command only prints it.
- The stored base stays on a second run. A `--base` option or a `base:` label wins and is stored as the new base.
- A new base on a second run does not move a task branch that already exists. The stored base can differ from the real start point of the branch.
- An issue that closes after its task exists does not stop a second run. The closed check runs only when no task exists.

### Why the events are separate

Each learned value has its own event: the base, the workspace and the bootstrap result. A value is not part of the next transition. As a result, a failure in a later step still keeps the earlier values on record.

### Why stderr holds the question and the notes

An agent reads stdout. It holds the fields of the task, then the lines of the tracker writes, so the agent can parse it. The warnings of a failed tracker write go to stderr, and so do the question for the base branch and the notes of the base step.

### The tracker writes

If `issueTracker.updateOnStart` is `true`, the start assigns the issue and marks it in progress. Each write appends one `tracker_update` event. The data is `{ action, result }` when the write works, and `{ action, result: "failed", error }` when it fails. The value of `action` is `assign`, `in_progress` or `done`.

The start follows the check-before-write rule in the [intro](#the-task-commands) and the rules in [The locks](#the-locks). These are the reasons of the tracker writes:

- A failed write is a warning. The reason: the task and the clone are correct, and a person can mark the issue on the tracker.
- The marker check runs before the task exists. The reason: a refused start leaves no task, as [The order of the steps](#the-order-of-the-steps) says. The check protects against two machines that work on the same issue.
- The writes of start come after `workspace_ready`. The reason: a start that fails leaves the issue unmarked, and tasker cannot undo a tracker write.
- The write of finish comes before the move to `finished`. The reason: a second run after a crash runs it again, and the writes are safe to repeat. [Writes](issue-trackers.md#writes) gives the facts.

## Abort

A dirty worktree needs `--force`, because the abort cannot bring the work back. A refused abort also leaves the worktree and the branch as they were.

A task that is `finished` or `cancelled` is an error, because it has nothing to abort.

An abort can stop between two steps, for example after a crash. A second run must finish it. As a result, each step first checks that its target still exists, and a step with no target does nothing.

The compare of the stored worktree path uses the real path. The data root can go through a symlink, and git lists real paths.

The abort removes its own worktree entry. It never prunes, because a prune drops the entries of other tasks too.

The worktree goes before the branch. Git refuses to delete a branch that a worktree entry holds, also when the folder of the entry is gone.

The remove and the delete have one home in `src/tasks/`. Abort and [Finish](#finish) both call it, and the abort keeps its discard step before that call.

The abort does not delete the task branch on `origin`. `tasker merge` pushes only the base branch, and no command publishes a task branch.

A worktree or a branch that start made but did not store stays after an abort. The abort works only on what the task stores.

## The result of an assistant run

One shared step maps the outcome of an assistant run to the next state of the task. Each command that runs the assistant (plan, refine, execute and review) must use it. As a result, each command moves the task and prints in the same way, and the rule has one home.

The step records the usage of the run first, for every outcome. Then it acts on the outcome:

- A success causes no move. The command that ran the assistant makes its own checks and its own move.
- A failure and a timeout move the task to `failed`. The error goes to the event and to stderr, and the exit code is 1.
- A quota stop moves the task to `quota_blocked`. The event holds the cause and the reset time when it is known. The command prints the reset time on stdout, or says that it is unknown, and the exit code is 1.

A failed run also spends tokens, so the usage is recorded for a failure too. The record of usage must be complete.

A quota stop is not a failure. The run can continue after the reset, and the task keeps its session for that. Until the resume command exists (M9), `tasker abort` is the only way out of `quota_blocked`.

The usage event and the move are two writes, not one. A crash between them leaves the usage event and a task that is still in its spawning state. The run marker of the task stays, so tasker can find that the run died.

## The commands of each state

`tasker show`, `tasker status` and the wrong-state error use one table and one wording, so they name the same commands for a state. The state check of each command reads the same table. The table and its rules are in [the commands of each state](../statemachine.md#the-commands-of-each-state).

## Plan

`tasker plan` runs the assistant in plan mode in the worktree of a task in `workspace_ready`, and records the first plan revision. The task goes to `planning`, then to `awaiting_plan_review`.

The steps run in this order.

1. The command also makes its reads before the first write. A failure in this part leaves the task in `workspace_ready`.
2. The command records the session of the plan before it starts the assistant. [The session id](assistants.md#the-session-id) gives the reason. A task that already has a plan session continues it.
3. The command moves the task to `planning` and runs the assistant. It appends each event of the run to the transcript of the revision.
4. The command acts on the outcome as [The result of an assistant run](#the-result-of-an-assistant-run) says. A plan that tasker refuses also moves the task to `failed`, and the error lists each problem.
5. The command writes the plan file before it adds the row. [Plan files](data-root.md#plan-files) gives the reason.
6. The row, its event and the move to `awaiting_plan_review` share one transaction. [The plan_revisions table](data-root.md#plan_revisions-table) gives the rule.

An error after the start of the run also moves the task to `failed`, with the prefix `planning failed:`. A failed write of the plan file moves it to `failed` too, with its own message. A crash of tasker leaves the task in `planning`, with its run marker. Until M9, `tasker abort` is the way out.

The plan reads the title and the body of the issue. It does not read the comments. A second `tasker plan` works only on a task in `workspace_ready`.

After a successful plan, the command warns when the plan changes files that another active task of the same repo also changes. [What the plan prompt asks for](assistants.md#what-the-plan-prompt-asks-for) says that tasker compares `files_changed` with the other tasks in flight. The purpose of the warning is to let an operator order the landings before the approve, because the task that lands second can get merge conflicts and redo its work.

The warning reads the files of the newest plan of the other task and the files that its task branch changes. A task that already executed has files that its plan did not list, so the plan alone is not enough.

The warning never refuses. Only a person can decide if an overlap is harmless and which task lands first. A failure inside the compare prints one note line on stderr and changes neither the exit code nor a state.

The read takes no repo lock. It changes nothing in the clone, and a wait for the repo lock can hold the end of the command.

`tasker refine` prints the same warning with the same last line as `tasker plan`. `tasker approve` prints the same warning before its write, with two last lines: `tasker approves the plan anyway.` and `To take the approval back, run: tasker unapprove <issue key>`.

## Refine

`tasker refine` continues the plan session of a task in `awaiting_plan_review` with the feedback of the operator, and records the next plan revision. The task goes to `refining`, then back to `awaiting_plan_review`.

`tasker refine` also runs on a task in `reviewed`. This is a promotion: the open findings of the latest review go to the plan session, and the next revision has the source `review`. The feedback is optional in `reviewed`, and it is required in `awaiting_plan_review`.

The steps run in this order.

1. The command checks the state, the feedback, the plan revision, the plan session and the recorded model before it reads a file. In `reviewed`, it also checks that the latest review has an open finding. A refused refine changes nothing, as the intro says, so the operator can fix the cause and run the same command again.
2. The command reads the plan file of the newest revision from disk, so an edit by hand counts. It reads the base revision and the commits of the task branch.
3. The command fills the prompt, with the open findings in the context block for a promotion, archives the template and continues the plan session. [New and continued sessions](assistants.md#new-and-continued-sessions) gives the rule for the recorded model. The session is already recorded, so refine records no session.
4. The command moves the task to `refining` and runs the assistant. The run step is the one that `tasker plan` uses, with the prefix `refining failed:` for an error.

[The refine prompt](assistants.md#the-refine-prompt) says what the prompt asks for. The new revision is a complete plan. A question that it leaves out counts as answered by the feedback, and the store computes this. A promotion with no feedback gives such a question no answer text ([the `plan_revisions` table](data-root.md#plan_revisions-table)). The next revision goes to the next free version, and its transcript goes to the file of that version.

A promotion keeps the findings out of the feedback and leaves them open:

- The findings go in the context block, because the stored feedback holds only the words of the operator. The feedback of a revision is the answer of a question ([the `plan_revisions` table](data-root.md#plan_revisions-table)), and `tasker show-questions` prints that answer.
- The promoted findings stay open, because the next review decides if the work fixed them. [The review prompt and the findings answer](assistants.md#the-review-prompt-and-the-findings-answer) says how the next review reads them.

## Approve

`tasker approve` approves the newest plan revision of a task in `awaiting_plan_review`. The task goes to `approved`.

Its checks cover the task, the state, the pinned revision and the newest plan revision. The overlap warning comes after the checks and before the write.

The write is one transaction. It sets the approval time of the revision, appends one `approved` event with the data `{ version, openQuestions, from, to }`, and moves the task to `approved`. The `approved` event takes the place of the `transition` event for this move.

Open questions do not stop an approval. The operator decides, and the count in the event and in the output makes the choice visible.

The approval lives on the revision, not on the task. A task has one approved revision for each cycle, and an older approval stays when a newer revision is approved.

## Unapprove

`tasker unapprove` takes back the approval of a task in `approved`. The task goes back to `awaiting_plan_review`. Its checks cover the task, the state and the pinned revision.

The write is one transaction. It clears the approval time of the pinned revision, appends one `unapproved` event with the data `{ version, from, to }`, and moves the task to `awaiting_plan_review`. The `unapproved` event takes the place of the `transition` event for this move. An older approved revision stays approved, because the command clears only the pinned one.

The command works only in `approved`. The state alone sets the limit "before execute starts", because `tasker execute` moves the task out of `approved` before it spends anything.

## Execute

`tasker execute` carries out the pinned plan revision of a task in `approved` in the execute session of the assistant. The task goes to `executing`, then to `executed`. The command runs one turn for each todo that is not `done`, in the dependency order. Then it runs the queued fix turn of the revision, when the store has one. The command does not run the verify commands.

The steps run in this order.

1. The checks cover the state, the pinned revision, the plan file, the order of the todos, the base revision, the branch, the remote tip and the recorded model. The read of the remote tip gives the tip before the run.
2. The command fills the prompts and archives only the prompts that the run sends. It records a new session only when the run has a turn.
3. The command moves the task to `executing` and opens the transcript of the revision for append.
4. For each turn, the command sets the state of the todo and runs the assistant. After the turn, it records the result and reads the remote tip again.
5. The command acts on each outcome as [The result of an assistant run](#the-result-of-an-assistant-run) says, with the phase name `executing`. An error after the start of the run also moves the task to `failed`, with the prefix `executing failed:`.
6. After the last turn, the command writes the `permission_denials` event when a turn had a denial. Then it moves the task to `executed`.

The move to `executed` appends one `executed` event with the data `{ version, prompts, from, to }`. The `executed` event takes the place of the `transition` event for this move. `prompts` holds the versions of the prompts that the run sent.

The command also writes `todo_started` and `todo_done` with the data `{ id }`, and `fix_turn_started` and `fix_turn_done` with no data. It writes one `permission_denials` event with `{ denials }`, one `sandbox_cleanup` event for each turn that has one, and one `usage` event for each turn.

A second `tasker execute` works only on a task in `approved`.

The reasons:

- The session belongs to the pinned revision. A later run of the same revision continues the session, so the assistant keeps what it learned. A new revision gets a new session.
- The command runs one turn for each todo. As a result, tasker records the state of each todo, and a failed run keeps the todos that are done. A done todo stays done, also when a later turn fails. A done turn already committed its work, and a later failure does not take the commits back. So the next run must not do that todo again.
- A new session gets the prefix with the plan in its first turn. A continued session gets only the turn prompt, because the session already holds the prefix.
- The command reads the remote tip before the run and after each turn. This is layer 3 of [the push guard](version-control.md#push-guard). A push from the session moves the tip, and the command fails the task. The command reads the tip after each turn, not only at the end of the run. As a result, the run stops at the first turn that pushed. No later turn spends tokens or builds on work that already left the machine. A push wins over the outcome of the turn. A quota stop with a push ends in `failed`, because a push breaks a rule of tasker and a quota stop does not.
- A task that is already `failed` is not moved again, because a move from `failed` to `failed` is illegal. In this case the command only prints the message on stderr.
- A turn that reports `blocked` or gives no result fails the task. Nobody is present to answer the turn. The operator reads the error and decides with the next command. The todo stays `in_progress`.
- All turns share one deadline: the value of `executeTimeoutMin`. The command reads the clock once before the first turn, and each turn gets the time that is left. It starts no turn when no time is left. `executeTimeoutMin` is the limit of one execute run. A limit for each turn multiplies with the count of todos, so a plan with many todos can run for many times the configured limit.
- A run with no turn records no execute session and archives no prompt. The rule of [the sessions table](data-root.md#sessions-table) says that an id that no conversation holds must not be continued. If the run recorded one, a later fix turn from `tasker retry` continues an empty id and fails.

## Verify

`tasker verify` runs the verify commands of the repo in the worktree of a task in `executed`. These reasons explain its rules:

- The worktree must be clean before the commands. If it is not, the commands test code that the branch does not hold.
- The worktree must be clean after the commands. The worktree goes to a person as ready. A dirty tree makes that claim false.
- Only the exit codes count, because tasker never reads the output of a command. As a result, no output can change a result. [phases.md](phases.md#the-verify-phase) gives the rule.
- A failed run is recorded too. `tasker show-verify` prints the run, and the fix turn gets its log.
- The row of a run and the move of the task share one transaction. The bullet in [data-root.md](data-root.md#verify_runs-table) gives the reason.

## Review

`tasker review` reviews the committed work of a task in `awaiting_work_review`. It runs in this order:

1. Check the task: its state, its worktree, its branch and its base revision.
2. Read the tip of the task branch and the commits of the branch.
3. Build the text of the earlier reviews, and archive the prompt.
4. Prepare a new session, and record it with the next review number.
5. Move the task to `reviewing`, which writes the run marker. Run the assistant, and write its events to the transcript.
6. Check the answer. Record the review, its findings and the `review` event, and move the task.

The command writes one `transition` event into `reviewing`, one `usage` event, one `review` event with the data `{ number, revision, findings }`, and one `transition` event out of `reviewing`. A failed run writes the `usage` event and no `review` event.

These reasons explain its rules:

- Each review runs in a new session. The review is then an independent pass that the plan conversation does not bias.
- The review runs in plan mode with the limits of the plan role. [assistants.md](assistants.md#the-plan-and-review-roles) and [assistants.md](assistants.md#the-review-prompt-and-the-findings-answer) give the rules.
- The findings rest in `reviewed`, because the operator reads them first. A review with no findings moves the task back to `awaiting_work_review`.
- The review records the tip of the task branch, because the findings describe one tree. [data-root.md](data-root.md#reviews-table) gives the reason. The review reads the commits of the task branch, so the tip of that branch names the tree that the review read. An uncommitted change or a commit that is not on the task branch does not count, as for `tasker accept`.
- tasker records the review session although no command continues it yet. [assistants.md](assistants.md#the-session-id) gives the rule of the session id.

No command resumes a review that failed or stopped yet (`tasker retry` M8, `tasker resume` M9).

### The feedback form of review

`tasker review <issue> <feedback>` continues the plan session of a task in `awaiting_work_review` with the feedback of the operator on the committed work. The plan session knows the plan and its decisions. The new revision plans only the work that is still needed: [assistants.md](assistants.md#the-refine-prompt) gives that rule. The task goes through `refining` to `awaiting_plan_review`.

The command uses the run step of `tasker refine`, so [the steps of refine](#refine) apply from the plan revision on. It runs in this order:

1. Take the task lock, and check the state with the row of `review` in the table of [the commands of each state](#the-commands-of-each-state).
2. Check that the feedback is not empty. The error is `the feedback is empty`.
3. Check the branch, and read the tip of the task branch.
4. Build the context from the tip and the latest verify run, and run the shared refine step with the source `review-feedback` and the feedback.

The context names no review, and the command reads no review.

## Dismiss-review

`tasker dismiss-review` dismisses open findings of the latest review of a task in `reviewed`, with one reason. It runs in this order:

1. Read the task again, and make sure that it is in `reviewed`.
2. Make sure that the reason is not empty.
3. Read the latest review, and make sure that the task has one.
4. With `--finding`, make sure that each named position exists and is open. Without it, take every open position, and make sure that at least one exists.
5. Write the dismissals and the `review_dismissed` event in one transaction. If no finding is open after that, the move to `awaiting_work_review` is part of the same transaction.

The `review_dismissed` event has the data `{ number, positions, reason }`. The command writes a `transition` event only when the task moves. The event and the move share one transaction.

These links give the rules:

- [data-root.md](data-root.md#review_findings-table) gives the rule for the reason and the rule for an open finding.
- The next review does not report a declined finding again. [assistants.md](assistants.md#the-review-prompt-and-the-findings-answer) gives the rule.

The command has these limits:

- A dismissal acts only on the findings of the latest review.

## Retry

`tasker retry` moves a task in `failed` back to the state before the step that failed, and runs that step again. The state that the task left when it failed is the origin. A fixed table gives the target and the next command for each origin. For the origin `provisioning`, retry does not move the task. The steps of `tasker start` move it from `failed` to `provisioning`. An origin that the table does not hold gets no retry, and the command refuses it.

The move, the delete of the sessions, the todo marks, the fix turn and one `retry` event share one transaction. The `retry` event has the data `{ origin, target, resumeExecute, from, to }` and takes the place of the `transition` event for this move. For the origin `provisioning`, retry writes the `retry` event alone, with `{ origin, target, resumeExecute }`, because no move takes place.

These reasons explain its rules:

- A plan or execute run can fail before its first turn. Its recorded session id then names no conversation, so a new run must not continue it. Retry deletes the session of the failed step, and the next run starts a new session.
- A verify failure usually belongs to no todo. So `--resume-execute` marks every todo done and queues one fix turn that gets the failure. The todos do not run again.
- A refine needs feedback, and tasker can refuse a plan again. So retry runs nothing for the origin `refining`. It prints a hint, and you decide the next feedback.
- The move and the run are two steps with the lock free between them. The next command takes the task lock itself and does not wait, so retry must release the lock first.
- The fix turn gets the tail of the log from tasker, not from the sandbox. The log is in the data root, outside the worktree, and the sandbox gives the shell only the worktree. The bound of 200 lines and 64 KiB keeps a large log out of the prompt.
- The tail comes only from the verify run of this failure. Some verify failures record no run, and then the latest run belongs to an earlier verify. Its log gives the fix turn false data, so the fix turn gets no tail.

## Accept

`tasker accept` records that a person accepts the work of a task in `awaiting_work_review`. The task goes to `accepted`.

It holds the repo lock for the fetch, as [the locks table](data-root.md#locks-table) requires. Its checks cover the task, the state, the worktree, the branch, the stored base revision and the fetch of `origin` with the read of the base tip. The fetch can still move the refs of `origin` in the clone, also for a refused accept.

The write is one transaction. It appends one `accepted` event with the data `{ revision, baseTip, from, to }` and moves the task to `accepted`. The `accepted` event takes the place of the `transition` event for this move.

These reasons explain its rules:

- The base check runs here and not at the landing. As a result, a base that moved while the task waited in review shows before a person lands it.
- Accept only records the decision of a person. `tasker merge` is the one step that changes origin. As a result, a refused or an accepted task leaves origin as it was, and the person still decides to land in a separate step.

The base can move after the check of `tasker accept`. Then `tasker merge` fails, and nothing moves on `origin`.

## Merge

`tasker merge` lands the work of a task in `accepted` on the base branch of `origin`. The task goes through `merging` to `landed`.

Its checks cover the task, the state, the branch, the stored base, the base revision and the repo lock. After the check, the command takes the repo lock and moves the task to `merging`. Then it fetches `origin` and reads the tip of the task branch and the tip of the base. If the base does not contain the work, the command pushes it with `vcs.land`. The last write is one transaction that appends one `landed` event with the data `{ revision, base, pushed, from, to }` and moves the task to `landed`. The `landed` event takes the place of the `transition` event for this move. If a step fails after the move to `merging`, the task goes to `failed` with `merging failed: <reason>`. `tasker merge` does not wait for CI.

These reasons explain its rules:

- `tasker merge` runs no check of its own before the push. The land fails before the push when the revision does not build on the tip of the base on origin. The lease refuses the push when the base moves after the read. In both cases nothing moves on origin. [version-control.md](version-control.md#land) gives the mechanism.
- The on-base check runs first, so a second run after a crash lands with no second push. The check reads the clone, so a missing worktree cannot cause a second push.
- The repo lock covers the fetch and the push, because both change the refs of the clone. [The locks table](data-root.md#locks-table) requires it.
- The command takes the repo lock before the move to `merging`, so a busy lock changes no state.

## Mark landed

`tasker mark-landed` records that the work of a task in `accepted`, `pushed` or `in_peer_review` already landed on the base branch outside tasker. The task goes to `landed`.

Its checks cover the task, the state, the branch, the stored base and the base revision. Then it takes the repo lock and fetches `origin`. It reads the tip of the task branch and the tip of the base with the operation of merge. If the base does not contain the work, the command stops with an error. The fetch can still move the refs of `origin` in the clone, also when the command stops with this error. The last write is one transaction that appends one `marked_landed` event with the data `{ revision, baseTip, from, to }` and moves the task to `landed`. The `marked_landed` event takes the place of the `transition` event for this move.

These reasons explain its rules:

- The check is read-only toward `origin`. The work landed outside tasker, so tasker only records it.
- The check reads the tip of the task ref in the clone and not the worktree, for the same reason as the on-base check of [Merge](#merge).
- The fetch holds the repo lock, because the fetch changes the refs of the clone. [The locks table](data-root.md#locks-table) requires it.

## Finish

`tasker finish` cleans up a task in `landed` or `cleanup_failed`: it removes the worktree and the local task branch, and the task goes through `finishing` to `finished`.

The last write appends one `transition` event with the data `{ worktree, branch, from, to }`. The value of `worktree` is `removed` or `already gone`. The value of `branch` is `deleted` or `already gone`. If a step fails after the move to `finishing`, the task goes to `cleanup_failed`. Its `transition` event then has the data `{ error, from, to }`.

If `issueTracker.updateOnFinish` is `true`, finish also marks the issue done. The `tracker_update` event comes before the last `transition` event. [The tracker writes](#the-tracker-writes) gives the reason.

These links give the rules that finish follows:

- The command makes its checks before its first write, as the [intro](#the-task-commands) says.
- The task lock does not wait, and the repo lock waits. [The locks](#the-locks) gives both rules.
- Each step first checks that its target still exists, so a second run finishes the steps that are left. [Abort](#abort) gives the rule.
- The worktree goes before the branch, for the reason in [Abort](#abort).
- The command takes the repo lock before the move to `finishing`, for the reason in [Merge](#merge).

A cleanup that stops goes to `cleanup_failed` and not to `failed`. The verify run passed and the work landed, so the failure says nothing about them.
