# The allowed commands

The reader of this page is the orchestrator. An actor does not read it.

For each actor of [the table](permissions.md#the-table), this page lists the commands that the orchestrator sends to
that actor. The orchestrator looks the list up here. It sends the list in the prompt or in the message that starts the
actor. The actor receives the list. It does not take a list by itself. A starter that starts an actor for the
orchestrator passes the list of that actor on. An example is the planner subagent, which starts an issue subagent.

The form of the send is open. A later ticket decides it. Until then, the lists are docs only, as
[the place of the rules](permissions.md#the-place-of-the-rules) says. A rule page of an actor gives no copy of a list.

## The rules for the lists

- Each command comes from the rule text of the doc that the section names. No command is invented. If no doc names a
  command for a kind, the actor has no list for that kind. The cell of the table then says "never runs".
- The kinds K1 to K16 are the kinds of [the kinds of command](permissions.md#the-kinds-of-command).
- A command that runs only after a word of the user for that call carries the words "asks the user" in its list. The
  cell of the table says "asks the user" only when each command of the list for that kind asks.
- A command that a step of a source names, but that no kind names, goes in the list "Named other commands". Such a
  command is in no kind of K1 to K15, and K16 stays "never runs" for it.

## The orchestrator

Sources: [the orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule),
[the hold before an install](release.md#the-hold-before-an-install), [Pick the tickets](pick-the-tickets.md),
[Land the work](land-the-work.md), [the CI wait](ci-wait.md#the-ci-wait),
[The actor of each write action](question-pane.md#the-actor-of-each-write-action) and [Limits](limits.md#limits).

- K1: the read-only `tasker` commands of
  [the orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule). They are `show-config`,
  `show-config-schema`, `show-quota`, `status`, `doctor`, the `show` commands for one task, `model` with no new model
  and no `--effort`, `--version`, `--help` and `help`.
- K2: `tasker model` with a new model or with `--effort`. Asks the user, in a settled decision message of its question
  pane.
- K3: `git rev-parse`, `git merge-base`, `git merge-base --is-ancestor`, `git diff`, `git show`, `git grep`,
  `git cat-file`, `git status --porcelain`, `git worktree list` and `git ls-remote --exit-code`.
- K4: `git fetch origin`, `git fetch --multiple` and `git pull --ff-only`, in its local clone.
- K5: `gh issue view`, `gh issue list`, `gh run list`, `gh run view`, `gh run watch`, `gh project item-list` and the
  read forms of `gh api`.
- K6: `gh issue create`, only for the issue of a failed CI run, as [A failed CI run](ci-wait.md#a-failed-ci-run) says.
- K7: `gh issue edit` for a milestone, a label or a blocked-by link, as [Pick the tickets](pick-the-tickets.md) says,
  and `gh project item-edit` for the field `Priority`, as [The project board](issues.md#the-project-board) says.
- K8: `herdr agent list`, `herdr agent get`, `herdr agent wait`, `herdr pane read`, `herdr pane get`,
  `herdr pane current` and `herdr tab get`.
- K9: `herdr agent start`, `herdr pane split`, `herdr pane send-text`, `herdr pane send-keys`, `herdr tab create`,
  `herdr tab close`, `herdr pane close` and `herdr notification show`.
- K10: a message to a task subagent, a planner subagent or a question session, on the path that the orchestration pages
  give for that session.
- K11: the start of a task subagent, a planner subagent, a write subagent, an opener subagent and a reuse subagent.
- K12: the body file of an issue and the handoff file, in the folder of the orchestrator.
- K13 to K16: no list.
- Named other commands: `npm run install:global` (an installing orchestrator only, as the hold before an install says).

## A task subagent for a whole ticket

Sources: [Limits](limits.md#limits), [the own-worktree rule](limits.md#the-own-worktree-rule),
[the plain-form rule](tasker-commands.md#the-plain-form-rule), [Run one ticket](run-one-ticket.md#run-one-ticket),
[the CI wait](ci-wait.md#the-ci-wait) and the ask rules of [Claude Code](setup.md#claude-code).

- K1: `tasker show`, `tasker show-plan`, `tasker show-verify`, `tasker show-review` and the other read-only commands of
  [the orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule).
- K2: each task change of that rule, in the plain form, for example `tasker start`, `tasker plan`, `tasker approve`,
  `tasker execute`, `tasker verify`, `tasker review`, `tasker accept`, `tasker merge` and `tasker finish`. It never runs
  `tasker approve-credits`. `tasker abort` and `tasker update-branch` with `--undo` ask the user. The K2 cell says
  "runs", because most task changes run with no word of the user. A cell says "asks the user" only when each command of
  the list asks.
- K3: `git log`, `git show` and `git diff` on `tasker/<task branch>`, and the other `git` reads of
  [Limits](limits.md#limits).
- K4: `git fetch tasker`, `git fetch origin`, `git worktree add`, `git worktree remove` and `git reset --keep`, as the
  own-worktree rule and [Limits](limits.md#limits) say.
- K5: `gh run list`, `gh run view`, `gh run watch` and `gh issue view`.
- K6: the comment of step 11 of "Run one ticket". It is the only write of the text of an issue.
- K12 and K14: files of its own task worktree.
- Named other commands: `npm ci` before a direct npm script, `npm run check` and the other direct npm scripts of the
  task worktree, and `gh run rerun <run id> --failed` (the only write on GitHub Actions).
- K7 to K11, K13, K15 and K16: no list.

## A task subagent for one task change

Sources: [the orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule) and
[The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent).

- K2: the one `tasker` command that the orchestrator sent, in the plain form of
  [the plain-form rule](tasker-commands.md#the-plain-form-rule).
- Each other kind: no list.

## The planner subagent

Source: [Sessions](../config.md#sessions). That section says that the planner subagent starts the draft, review and post
subagents. No doc of this base names another command of the planner subagent.

- K11: the start of an issue-draft subagent, an issue-review subagent and an issue-post subagent.
- Each other kind: no list.

## The issue-draft subagent

Sources: [The draft file](issue-draft.md#the-draft-file) and
[The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent).

- K3: `git show origin/main:<path>`.
- K4: `git fetch origin`, in the local clone before its first read.
- K12: its draft file, its report file and the files of a scratch folder under `/tmp`.
- Each other kind: no list.

## The issue-review subagent

Sources: [The bans of an issue-review subagent](issue-review.md#the-bans-of-an-issue-review-subagent) and
[The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent).

- K3: `git show origin/main:<path>`.
- K5: `gh issue list ... | jq ...` and the other `gh` reads of the open and closed issues. It writes no file.
- Each other kind: no list.

## The issue-post subagent

Source: [The writes of an issue-post subagent](issue-post.md#the-writes-of-an-issue-post-subagent).

- K5: the `gh` reads of [Before a post](issues.md#before-a-post).
- K6: `gh issue create` and `gh issue edit` of the title and the body.
- K7: the `gh issue edit` calls that add or remove a blocked-by link, with the milestone and the labels of the draft in
  `gh issue create`.
- K12: the body file `/tmp/tasker/issue-post/<slug>-body.md`.
- Each other kind: no list.

## The write subagent of the orchestrator

Sources: [The actor of each write action](question-pane.md#the-actor-of-each-write-action) and
[The reads before the write](issues.md#the-reads-before-the-write).

- K5: the reads before the write, for example `gh issue view`.
- K7: a change of the metadata of an issue with `gh issue edit`, and the link-removal commands of step 7 of
  [the defer rule](pick-the-tickets.md#the-defer-rule).
- K12: each input file, at the path that the message gives.
- K13: a write of a user-level file, only the text that the user approved, after the hash check.
- Named other commands: `sha256sum <path>`.
- Each other kind: no list. It runs no `tasker` command, no `herdr` command and no `git` write.

## The opener subagent

Source: the prompt `question-opener` of [The prompts](question-pane.md#the-prompts). The prompt gives each command word
for word.

- K1: `tasker show-config --repo <repo key>`.
- K3: `git -C <local clone> show origin/main:docs/dev/question-pane.md`.
- K4: `git -C <local clone> fetch origin`.
- K8: `herdr pane read`.
- K9: `herdr pane split` and `herdr agent start`.
- Named other commands: `timeout 20 bash -c 'sleep 10'`.
- Each other kind: no list.

## The reuse subagent

Source: the prompt `question-reuse` of [The prompts](question-pane.md#the-prompts). The prompt gives each command word
for word.

- K3: `git -C <local clone> show origin/main:docs/dev/question-pane.md`.
- K4: `git -C <local clone> fetch origin`.
- K8: `herdr agent wait`, `herdr agent get` and `herdr pane read`.
- K9: `herdr pane send-text` and `herdr pane send-keys`.
- Named other commands: `timeout 20 bash -c 'sleep 10'`.
- Each other kind: no list.

## A question session

Source: [The question session](question-pane.md#the-question-session).

- K1, K3 and K5: the read-only commands, other than `herdr` commands.
- K4: `git fetch origin`.
- K9 and K10: only the herdr path to its pane owner, for the messages that
  [Send a decision](question-pane.md#send-a-decision) gives.
- Each other kind: no list. It sends each write action back to its pane owner.
