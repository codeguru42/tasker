# Orchestration

This page gives the rules for an orchestrator. The orchestrator is the assistant session that picks tickets, starts one agent for each ticket, moves the cards, sets the landing order and writes memory.

A ticket is an issue on the project board. An agent is an assistant session that the orchestrator starts for one ticket. The agent runs the steps of ["Run one ticket"](run-one-ticket.md#run-one-ticket) for that ticket. The user is the person who runs the orchestrator. A task is the record that tasker keeps for one ticket. tasker moves the task from state to state, for example from `awaiting_plan_review` to `approved`.

Memory is the files where an assistant keeps notes between sessions. Memory is not in the repo.

tasker also starts its own sessions for plan, execute and review. They run in a worktree of the tasker clone. They are not agents and they do not run the steps on [the orchestration pages](orchestration.md).

The orchestrator and its agents run tasker from the local clone of the orchestrator. For one ticket, the agent of that ticket is the operator that [docs/dev/rebase-conflicts.md](rebase-conflicts.md) names.

Every `tasker` command on [the orchestration pages](orchestration.md) is the installed `tasker`: the `tasker` command on the PATH from a global install. It is not the tasker that this repo builds. For this reason, `skills/tasker/SKILL.md` does not list its commands. See the `npm link` bullet under Limits.

The orchestration pages are `docs/dev/orchestration.md` and the pages of this list, "The pages":

- [docs/dev/pick-the-tickets.md](pick-the-tickets.md): "Pick the tickets", the stacking rule, the stacked-ticket rule, the parent-hold rule, the link offer, the defer rule and "The prompt of an agent".
- [docs/dev/doc-reads.md](doc-reads.md): the re-read rule, the notice rule and the doc-read rule.
- [docs/dev/run-one-ticket.md](run-one-ticket.md): "Run one ticket", the final report, the comeback rule, the base rule, the add-work rule, the diff read and the measure rule.
- [docs/dev/plan-review.md](plan-review.md): the repo-files rule, the fact test, the issue check, the stop rule, the design-gap rule and the quote check.
- [docs/dev/tasker-commands.md](tasker-commands.md): the plain-form rule, the tool-block rule, the command rules, the facts of the installed tasker and the run times.
- [docs/dev/verify-failures.md](verify-failures.md): the verify-failure rule, the broken-commit steps, the session check, the manual fix and the commit check.
- [docs/dev/ci-wait.md](ci-wait.md): the CI wait and "A failed CI run".
- [docs/dev/review-findings.md](review-findings.md): "Review findings".
- [docs/dev/land-the-work.md](land-the-work.md): "Land the work", the overlap rule, the Docs rule, the hold rule and the stuck-task rule.
- [docs/dev/quota.md](quota.md): "Quota", "Terms", "The delay of each agent", "Schedule a job when an agent starts", the seven-day rule, "When there is no reset time yet", "When the job fires", "What the agent does", "Delete the job" and "Do not use these".

## The handoff

A long-running orchestrator is the orchestrator of a milestone that stays open while other sessions add issues to it, for example "Docs" (see [docs/dev/planning.md](planning.md)). In a handoff, the old orchestrator gives its work to a new orchestrator in a new session.

The rules of this section cover only a long-running orchestrator. An orchestrator of a numbered milestone stops when the Todo column of its milestone is empty, as [Pick the tickets](pick-the-tickets.md#pick-the-tickets) says. The rules of this section do not cover it.

Only the user starts a handoff. The user can ask the old orchestrator for a handoff at any time. The reason: the old orchestrator has no tool that shows its context use. On 2026-10-16, the Docs orchestrator guessed that about 20% of its context was used and started a handoff. The session used 6%.

The old orchestrator can suggest a handoff to the user. The suggestion does not start the handoff. The handoff starts only when the user agrees to the suggestion or asks for a handoff. In an answer to [a question of the user](working-with-the-user.md#a-question-of-the-user), the old orchestrator suggests a handoff only when the suggestion is relevant to that question.

After the start, the old orchestrator does these steps:

1. Start no new ticket.
2. Wait until each task in flight lands. For each landing, do the usual steps: delete the jobs (see [Delete the job](quota.md#delete-the-job)), do [the re-read rule](doc-reads.md#the-re-read-rule), do the memory step of the bullet "When the final report of the agent of a ticket says that the ticket landed" of [Land the work](land-the-work.md#land-the-work) and do [the notice rule](doc-reads.md#the-notice-rule). The reason: a job lives only in the session of the orchestrator (see [Terms](quota.md#terms)). If a task is still in flight at the handoff, nobody resumes it after a quota stop.
3. Run the review rounds of the last bullet of [Pick the tickets](pick-the-tickets.md#pick-the-tickets), until a round finds nothing new. The user asked for this rule on 2026-10-17. Then write the handoff file `$HOME/Documents/tasker/handoff/<date>-<role>.md`, for example `2026-10-15-docs-orchestrator.md`. If a file with that name exists, add a number, for example `2026-10-15-docs-orchestrator-2.md`.
4. Give the path of the file in the reply to the user.

Only the user ends a handoff that started. The handoff ends when the user clears the old session and starts the new session with the prompt of the handoff file. Until then, the old orchestrator starts no new ticket, also after step 4. On 2026-10-17, the Docs orchestrator saw that its handoff started too early. It then started a new ticket without the word of the user.

The old orchestrator puts these items in the handoff file:

- The prompt for the new session, in a code block. The prompt names the milestone, the session name and the first step: the start of the re-read rule. The prompt also names the docs to read and the state at the handoff. Its last step is to watch the board for new issues.
- The state at the handoff: the tasks in flight of other milestones that share a file with an open issue of the milestone, the parked tasks and the other sessions.
- What the old orchestrator did, and each decision of the user from its session.
- A table of the open issues of the milestone, with the columns issue, topic, blockers and files.
- Each finding of the review rounds, with its state, handled or open.

The old orchestrator puts no rule in the handoff file. The rules stay in the docs, and the prompt points to them.

The user pastes the prompt as the first message of the new session. The user names the session `orchestrator-<milestone>`, for example `orchestrator-docs`, as [the notice rule](doc-reads.md#the-notice-rule) says. The new orchestrator then starts with the re-read rule. Right after the first doc read, the new orchestrator does the check of the handoff folder that follows.

The new orchestrator does this check before any other step of the prompt. It lists the folder `$HOME/Documents/tasker/handoff/` with `ls`.

The files of its role are the files whose names step 3 gives for that role. The new orchestrator orders them as step 3 says. A file with a later date is newer. A file with no number is the first file of its date. For two files of the same date, the file with the higher number is newer.

The file of the first message is the handoff file whose path the first message names.

The new orchestrator then does the case of this list that applies:

- If the file of the first message is the newest file of the role, the new orchestrator works from that file.
- If the newest file of the role is newer than the file of the first message, the new orchestrator tells the user. Then it works from the newest file.
- If the list holds no file of the role, no newer file exists. The new orchestrator works from its first message.
- If the list holds a file of the role and the first message names no path of a file of the role, the new orchestrator tells the user the newest file of its role. Then it works from that file.
- If the list fails, for example because the folder is missing, the new orchestrator tells the user the command and the error. Then it works from the file of its first message. If the first message names no path of a file of the role, the new orchestrator works from its first message.

The reason: on 2026-10-16, the new Docs orchestrator got the handoff file of 01:12 in its first message. A newer handoff file of 09:09 for the same role existed. Most issues of the table of the old file had closed.

## Limits

These limits apply to the orchestrator and to the agents, except where a bullet or a rule names one actor.

- The agent reads the output of a task with the `tasker show` commands, for example `tasker show`, `tasker show-plan`, `tasker show-verify` and `tasker show-review`. [The own-worktree rule](#the-own-worktree-rule) gives the rule for a direct read of a file of the data folder of tasker, for example a transcript or a log file.
- To read the commits of a task branch, the agent runs `git fetch tasker` in the local clone of the orchestrator. If the clone has no `tasker` remote, the agent adds it as [the own-worktree rule](#the-own-worktree-rule) says. Then the agent runs `git log` or `git show` on `tasker/<task branch>`. For a diff of the task, the agent uses the command with three dots of [the diff read](run-one-ticket.md#the-diff-read). If a command fails, the agent stops and reports the error to the orchestrator. Nothing changes. The agent waits as [the answer-wait rule](#the-answer-wait-rule) says.
- A new worktree has no `node_modules`, and the local clone can have none. The task worktree lives long, and an update can change `package-lock.json`. Before a test on the local machine that runs the code of the repo, the agent runs `npm ci` in the task worktree when it has no `node_modules`. The agent also runs `npm ci` when `package-lock.json` differs from the copy of the last install. Use the copy of [the commit check](verify-failures.md#the-commit-check): `L=$(git rev-parse --git-path npm-ci-lock); cmp -s "$L" package-lock.json || { npm ci && cp package-lock.json "$L"; }`.
- The agent uses only the issue, the files of the repo, its own tests on the local machine and the answers of the orchestrator as sources. If the issue does not give a detail that the work needs, the agent asks the orchestrator. Then the agent waits for the answer, as [the answer-wait rule](#the-answer-wait-rule) says. Before `tasker approve`, [the stop rule](plan-review.md#the-stop-rule) and [the design-gap rule](plan-review.md#the-design-gap-rule) give the steps and say who answers. After `tasker approve`, the orchestrator asks the user. When the agent asks the orchestrator a question, the agent gives the options, with its suggestion for each.
- The agent changes only its own issue. On GitHub issues, labels and the project board, the comment of step 11 of ["Run one ticket"](run-one-ticket.md#run-one-ticket) is the only write of the agent. The agent does not edit an issue body, a label or the project board. This rule does not cover the git commands and the `tasker` commands of the steps on [the orchestration pages](orchestration.md), for example `tasker merge` and the delete of the task branch in step 10. On GitHub Actions, the rerun of step 9 of [the CI wait](ci-wait.md#the-ci-wait) (`gh run rerun <run id> --failed`) is the only write of the agent.
- If tasker stops for a quota, follow "Quota". Never run `tasker approve-credits`.
- Do not run `npm link` or a global install from a task worktree. The global `tasker` runs the tickets, and the install replaces it.
- Only the orchestrator writes memory, so that two agents do not write the same file. Agents report what they learn to the orchestrator in their final report (see [the final report](run-one-ticket.md#the-final-report)). For this reason, an agent does not run a skill that writes memory, for example `/session-review`. The bullet "When the final report of the agent of a ticket says that the ticket landed" of [Land the work](land-the-work.md#land-the-work) says when the orchestrator deletes a note.
- The orchestrator and each agent load the simple-english skill and follow the simple-english bullet of [Docs](rules.md#docs) of rules.md.
- The folder of an agent is `$HOME/Documents/tasker/agents/<session name>`. The session name is the name of the session of the agent from ["The prompt of an agent"](pick-the-tickets.md#the-prompt-of-an-agent), for example `codeguru42-tasker-43`. The task worktree of [the own-worktree rule](#the-own-worktree-rule) is `../tasker-worktrees/<session name>`, relative to the root of the local clone of the orchestrator. That path is a folder with the session name in the folder `tasker-worktrees`, next to the local clone of the orchestrator. The task worktree is not in the folder of the agent and not in the clone. The orchestrator makes the folder of the agent before the agent starts, as ["The prompt of an agent"](pick-the-tickets.md#the-prompt-of-an-agent) says. The agent keeps each other file that it writes in the folder of the agent, for example the feedback files and the notes. Two agents that run at the same time keep their files in different folders. Before an agent runs `tasker refine` or `tasker review <issue> "<feedback>"` with feedback text from a file, the agent makes sure that the file holds the text for its own ticket. [The plain-form rule](tasker-commands.md#the-plain-form-rule) gives the form of the command. If two agents use the same file name, the refine or the review of one ticket can send the text of another ticket. The folder of the agent stays after the work. The agent removes only the task worktree, as the own-worktree rule says.
- Do not use `pkill` or `killall`. To stop a process that it started, the orchestrator or the agent uses `kill` with the process id that it saved. `pkill` matches by name, so it can stop a process of another session of the same user.
- Never print a credential, for example an access token, a password or a key. If a command gives a credential, store its output in a shell variable, for example `token="$(gh auth token --hostname github.com --user <account>)"`. Do not print the variable. To make sure that the command succeeded, use its exit code or a test of the variable that prints nothing, for example `[ -n "$token" ]`. Pass the variable to later commands, for example `GH_TOKEN="$token" gh api user`. Do not put the credential itself in a command line, a file, a log, a feedback text or a comment. Never print the environment, for example with `env`, `printenv` or `set`, because it can hold a credential, for example the access token in `GH_TOKEN`. The assistant tools start a new shell for each tool call, and a shell variable lives only in its own shell. As a result, set the variable and use it in the same tool call. Never print the full command line of the sandbox, for example with `ps -o args`. The sandbox of a `claude` run is a `bwrap` process. Its command line holds a user name and a password of the local proxy of that run. On 2026-10-14, an agent printed them in its tool output with `ps`. To find a bind or a path in the command line, search it for only that item, and print only the match. For example, `ps -o args= -p <pid> | grep -o -F -- '<path>'` prints only `<path>`, and only when the command line holds it. This rule does not cover the code of tasker, which already keeps the access token out of its errors and logs.

### The issue-link rule

In each reply to the user, the orchestrator writes each mention of an issue as a markdown link. The link target is the page of the issue in its tracker. The link text is the issue key, in this form:

- For an issue of this repo, the text is the short form `#<N>`, for example `[#159](https://github.com/codeguru42/tasker/issues/159)`.
- For an issue of another repo, the text is the full key, for example `[owner/repo#12](https://github.com/owner/repo/issues/12)`.

The rule covers the replies of the orchestrator to the user only. The text on GitHub keeps the plain key, because GitHub links it. The messages to an agent and to another orchestrator keep the plain key, because a session reads them as text. A key inside a code span or a code block stays as it is, for example a command line with an issue key.

The reason: the user opens the issue by hand. On GitHub, `#159` is a link, but in the terminal it is plain text.

### The own-worktree rule

The orchestrator and the agents must not read the files that tasker keeps in its data folder. Never read, search or run anything in a worktree of tasker, also not with a read-only command such as `grep`. Do not change the repo or the worktrees of tasker by hand. Only `tasker` commands change them. The read has two exceptions. The first exception is a fetch through the read-only `tasker` remote, which reads the clone of tasker and changes nothing there. The second exception is a read that the user permits. A read of a file of the data folder, for example the database `tasker.db`, a log or an archived prompt, is allowed only when the user permits that read. The second exception does not cover a worktree of tasker. Before the read, the orchestrator asks the user, with the fact that it needs and the command that it plans. An agent asks the orchestrator, as the sources bullet of [Limits](#limits) says, and the orchestrator then asks the user. For an agent, the orchestrator does the read and gives the fact to the agent as an answer. Without that permission, the `tasker` commands are the only way to read the state of a task. For an agent, the first bullet of [Limits](#limits) names these commands. The reason: a `tasker` command does not give every fact, for example the time of an event, and a direct read without permission is a read of data that the user owns. On 2026-10-17, an orchestrator read event times from `tasker.db` with `sqlite3 -readonly`, and the user said: "you need to ask permission before accessing any tasker resources". The worktrees of tasker are under `<dataRoot>/repos/<owner>-<repo>/worktrees/`.

To read or run the code of a task, the agent uses its task worktree. The task worktree is the one worktree of an agent for its task. It is a worktree of the local clone of the orchestrator, in the folder that the folder bullet of [Limits](#limits) gives for the task worktree. It is on a local branch with the same name as the task branch. The task branch is on the `branch:` line of `tasker show <issue>`. After each stop of the make or of the branch-exists case, the agent waits as [the answer-wait rule](#the-answer-wait-rule) says.

- Make: the agent makes the task worktree one time, after `tasker start` in step 2 of ["Run one ticket"](run-one-ticket.md#run-one-ticket) or in [the comeback rule](run-one-ticket.md#the-comeback-rule). If the local clone has no `tasker` remote, add it as steps 1 and 2 of [docs/dev/rebase-conflicts.md](rebase-conflicts.md#procedure) say. Then run `git fetch tasker`. If the fetch fails, stop and report. Nothing changes. Then run `git worktree add -b <task branch> <path> tasker/<task branch>`. If it fails for a reason other than the branch-exists case, stop and report. No worktree exists.
- The path: the agent keeps `<path>` from the make until the remove at the end. The agent keeps `<path>` as an absolute path, because git resolves a relative path against the current folder of each command. Each later step uses that path. This includes the `<path>` of steps 6, 18 and 19 of rebase-conflicts.md.
- Use: each step that reads or runs the code of the task uses the task worktree, after the update rule.
- The branch-exists case: the make fails with `fatal: a branch named '<task branch>' already exists` and exit 255. Git makes no folder. The local branch can hold commits that tasker does not hold, for example after a stop of [the manual fix](verify-failures.md#the-manual-fix). Do these steps before the first update:
  1. Read `<hash>` with `git rev-parse --verify tasker/<task branch>`. Then run `git merge-base --is-ancestor <task branch> <hash>`.
  2. If the exit code is 1, the local branch holds a commit that tasker does not hold, or tasker rewrote the task branch after the last update, for example with a rebase or an autosquash. The step cannot tell the two apart. Stop and report. The branch and each worktree of the branch stay.
  3. If the exit code is neither 0 nor 1, or a command fails, stop and report.
  4. If the exit code is 0, run `git worktree list --porcelain`. If an entry has the line `branch refs/heads/<task branch>`, use the `worktree <path>` line of that entry as the task worktree.
  5. If no entry has that line, run `git worktree add <path> <task branch>`, with no `-b` and no `--detach`. For a branch that no worktree holds, this makes a worktree on the branch.
  6. Then do the update rule.
- The remove: the agent removes the task worktree only at the end of its work. The end is after step 10 of "Run one ticket", after `tasker abort`, or when the orchestrator tells the agent to stop. Run `git worktree remove <path>`. Do not use `--force`. If the remove fails, stop and report, as step 19 of rebase-conflicts.md says. The worktree and the local task branch stay. Then delete the local task branch with `git branch -D <task branch>`. If the delete fails, stop and report. The worktree is gone, and the local task branch stays. The agent reports to the orchestrator, and the orchestrator reports to the user.
- Exceptions to the remove: if the agent followed rebase-conflicts.md, steps 18 to 20 of that page do the remove. The agent does not do it again. While the local-commit rule holds, the worktree and the local branch stay. They also stay after a step of rebase-conflicts.md stops. The final report names each path that stays.
- Worktree commands change no task. The task keeps its state.

### The update rule

tasker changes the task branch in its own clone, for example with `tasker execute`, `tasker refine` and `tasker update-branch`. The task worktree does not follow by itself. Before each use, the agent does these steps in the task worktree:

1. Run `git fetch tasker`.
2. Read `<hash>` with `git rev-parse --verify tasker/<task branch>`. The hash lives only for this update.
3. Run `git rev-parse --git-path rebase-merge`. If the command fails, or the folder that it names exists, stop and report. Nothing changes. For example, the worktree stays in a rebase when `git rebase --abort` fails in step 7 of [the commit check](verify-failures.md#the-commit-check).
4. Run `git status --porcelain`. If it prints a line, stop and report. Nothing changes. Test the output, because the command exits with 0 also when it prints lines. Ignored files such as `node_modules/` do not print.
5. Run `git reset --keep <hash>`.

`git reset --keep` moves the branch for a fast-forward. It also moves a branch that a rebase of tasker rewrote, where `git merge --ff-only` fails with exit 128. For a change in a file that the update changes, `--keep` refuses with exit 128 (`error: Entry '<file>' not uptodate. Cannot merge.`), and the branch and the change stay. Step 4 already stops for each uncommitted change. As a result, no update runs over one. Do not use `--hard`, because it deletes changes that are not committed. If a step fails, the step that uses the worktree gives the failure path. The commands of the update rule change no task.

### The local-commit rule

The local task branch holds no commit of its own, with two exceptions. The first is [the manual fix](verify-failures.md#the-manual-fix), from its step 2 to step 11 of rebase-conflicts.md. The second is rebase-conflicts.md after a rebase conflict of `tasker update-branch`, from step 7 (the rebase) to step 11 (`--take-remote`). In that time, the agent does not run the update rule. If the agent stops in that time, for example after a failed push at step 10, the worktree and the local branch stay. After step 11, tasker holds the local tip (`<taken>`), and the rule ends. The manual fix and rebase-conflicts.md link to this rule.

### The shared-clone rule

Every orchestrator and every agent on the machine run git in one local clone. As a result, a git command of any session, for example `git fetch`, can run between two commands of a step. On 2026-10-15, `git worktree list` in the local clone listed the worktrees of the agents of other orchestrator sessions. A remote-tracking ref is the copy of a branch of a remote in the local clone, for example `origin/<branch>` or `tasker/<branch>`. If a step uses a remote-tracking ref in more than one command, the step reads the full hash of the ref one time, with `git rev-parse --verify <ref>`. Each later command of the step uses that hash, not the ref. For example, if step 10 of ["Run one ticket"](run-one-ticket.md#run-one-ticket) read `origin/<task branch>` for the check and again for the delete, a fetch between the two reads can move the ref, and the delete then acts on a commit that the check did not see. Use `--verify`, because plain `git rev-parse` also prints the name on its output when it fails. If `git rev-parse --verify` fails, for example because the ref does not exist, it exits with 128 and prints `fatal: Needed a single revision`. The step then stops, as the failure cases of that step say. If a step uses a remote-tracking ref in only one command, the step needs no hash read. The update rule reads `tasker/<task branch>` one time and resets to that hash.

### The address rule

The agent sends each message to the orchestrator with `SendMessage` and `to: "main"`. The agent puts `"main"` in the `to` option of `SendMessage`, not in the text of the message. The session name of the orchestrator, for example `orchestrator-m8`, is not the address. The rule covers each message that the agent sends while it works. Examples are the run-start and run-end reports of "When there is no reset time yet" in "Quota", the reports of the stop cases, the list of files after `tasker approve` and the questions. The rule does not cover the final report (see [the final report](run-one-ticket.md#the-final-report)). The agent of #153 learned this rule on 2026-10-15.

### The answer-wait rule

When the agent must wait for an answer or a next step from the orchestrator, the agent sends its report or its question with `SendMessage`, as [the address rule](#the-address-rule) says. Then the agent gives its final answer, which ends its turn. This final answer is an interim report (see [the final report](run-one-ticket.md#the-final-report)). The agent does not wait in a loop. The message of the orchestrator with the answer or the next step starts the agent again. The reason: a message to an agent that has ended starts the agent again, and the agent keeps its context (see "Terms" in "Quota"). On #153, the agent waited about 25 minutes in a loop for an answer, then ended its turn with a stop report. The message with the answer started the agent again, and the agent went on with its work. The rule also covers each stop after which the agent runs no other `tasker` command until the orchestrator tells it the next step. While the agent waits, the task keeps its state. For a resume message during the wait, see the resume rule in "When the job fires". The rule does not cover a wait that reads a state, for example the "To wait" bullet of ["Land the work"](land-the-work.md#land-the-work) or the wait bullet of [the command rules](tasker-commands.md#the-command-rules).

A wait point is a place where the agent waits for an answer or a next step from the orchestrator. At each wait point, the orchestrator expects an interim report from the agent. The harness is the tool that runs the agent. The harness can deliver the final answer of the agent to the orchestrator in the same way as the final report. At a wait point, the agent starts its interim report with a line that says that the report is not the final report. That line also names what the agent waits for.

On [the orchestration pages](orchestration.md), the agent waits for the orchestrator at these wait points:

- [The parent-hold rule](pick-the-tickets.md#the-parent-hold-rule): before a command that moves the task out of a ready state, and when the hold message comes during a wait
- Step 2 of [Run one ticket](run-one-ticket.md#run-one-ticket): each stop at `tasker start` and after a failed make of the task worktree
- [The comeback rule](run-one-ticket.md#the-comeback-rule): each stop of the agent
- [The diff read](run-one-ticket.md#the-diff-read): each stop of the agent
- Step 11 of [the CI wait](ci-wait.md#the-ci-wait), and each stop of the CI wait
- [The stop rule](plan-review.md#the-stop-rule): each stop case
- [The quote check](plan-review.md#the-quote-check): before `tasker approve` or `tasker accept`
- [The verify-failure rule](verify-failures.md#the-verify-failure-rule): each stop of the agent
- [The plain-form rule](tasker-commands.md#the-plain-form-rule) and [the tool-block rule](tasker-commands.md#the-tool-block-rule): a denied tool call
- [The broken-commit steps](verify-failures.md#the-broken-commit-steps): the stop at the new base commit, the stop after a failed [commit check](verify-failures.md#the-commit-check) and each stop of the pushed-branch rule
- [The manual fix](verify-failures.md#the-manual-fix): each stop of the agent
- [The commit check](verify-failures.md#the-commit-check): each stop
- The security report of [Review findings](review-findings.md#review-findings)
- The no-loop-left rule and the bullet "After the 5th loop" of [Review findings](review-findings.md#review-findings)
- [Land the work](land-the-work.md#land-the-work): after the later agent stops waiting
- [docs/dev/rebase-conflicts.md](rebase-conflicts.md): each stop of its procedure, when a step of [the orchestration pages](orchestration.md) sends the agent there
- [The hold rule](land-the-work.md#the-hold-rule): before `tasker accept`
- [What the agent does](quota.md#what-the-agent-does) in "Quota": the end of the turn after a stop in `quota_blocked` or `interrupted`, and the report for `awaiting_quota_approval`
- A question of the agent, in the sources bullet of [Limits](#limits)
- The read bullet of [Limits](#limits): a failed command
- [The own-worktree rule](#the-own-worktree-rule): each stop of the make and of the branch-exists case
- [The doc-read rule](doc-reads.md#the-doc-read-rule): each stop of an agent

The orchestrator does not treat an interim report as the end of the ticket. For an interim report alone, the orchestrator does not free the slot, delete a quota job or read the board for the ticket. The orchestrator still follows the bullets of [Delete the job](quota.md#delete-the-job). The orchestrator still does each read that a rule gives after a report of an agent, for example in [the parent-hold rule](pick-the-tickets.md#the-parent-hold-rule). On #160, #161 and #221, the agents ended their turns at a wait point, and a message of the orchestrator resumed each one.
