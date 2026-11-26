# The allowed commands

The reader of this page is the orchestrator. The plan session of a task that changes a list also reads it. An actor does
not read it.

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
- A command that a step of a source names, but that no kind names, goes in the list "Named other commands". This list is
  the K16 list of the actor, as [K16](permissions.md#the-kinds-of-command) says.
- A list names each Read call that a source names as a step. A list with no Read call bans no Read call.

The command rule has four parts. The user gave its reason: "the whole purpose for allowed-commands.md is to explicate
which commands each agent can perform. It should not restrict those commands in any other way."

1. This page states only which commands each actor can run. It sets no other limit.
2. A rule page of an actor never gives a list as the reason that the actor skips a step or a read. A row of
   [the table](permissions.md#the-table) counts as a list. A rule page can still state part 4.
3. If a job needs a read-only command, the list of each actor that does the job names that command. This also holds when
   another actor already runs that command. For this part, the rule text of the first bullet is the step of the doc that
   needs the read.

   Until the issue "Test each list of allowed-commands.md against the read-only rule" of the milestone M31 lands, this
   interim rule wins over part 3. It is docs only. The reason: no one tested the lists against part 3 before this issue.
   Each list stays as it stands. Part 3 adds no command to a list by itself. A ticket can still add a command under the
   first bullet. Part 2 still holds. At a gap, part 4 and the other bullets of this section hold. The issue lands when
   someone closes it as completed. The interim rule holds while the issue is not posted, is open, or is closed in
   another way. That issue removes the interim rule. If it gives another meaning of a read-only command, its meaning
   wins.

4. A gap is a job of an actor that needs a command that the list of the actor does not name. A job outside the limit
   words of a command of the list is a gap too. Only an actor with a section on this page has a gap.
   - At a gap of a read-only command, the actor runs the read and reports the gap in its result, so that a ticket adds
     the command to its list. The reason: a gap does not stop a step that only reads, and the report lets a ticket add
     the command to the list.
   - At a gap of each other command, the list and its limit words win. The actor runs nothing that the list does not
     permit, and it reports the gap.
   - Each ban and each limit of a rule page wins over part 4. For example, a question session runs no `herdr` read (K8)
     at a gap, because [The question session](question-pane.md#the-question-session) gives it only the read-only
     commands other than `herdr` commands.
   - The orchestrator has no result, so it reports a gap to the user in its question pane, as
     [the report chain](permissions.md#the-report-chain) says.
   - A read at a gap keeps the failed-read case of its step. Part 4 adds no write.

These terms hold for the rule:

- A job is a step or a read that the rules of the actor give to it.
- A read-only command: a command of the kinds K1, K3, K5 or K8 of
  "[The kinds of command](permissions.md#the-kinds-of-command)" of docs/dev/permissions.md. A Read call that is not of
  the kind K15 is also a read-only command. A named other command that only reads is one too, for example
  `wc -l <path>`. A `git fetch` and a `git pull` are of the kind K4, so they are not read-only commands. This meaning is
  not the meaning of "read-only command" in
  [the orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule).
- Each other command is a command that is not a read-only command, for example a write, a `git fetch` or a read of the
  kind K15.
- A limit word is a word of a list that limits a command, for example "only", "asks the user", "for each doc that it
  reads" and "on its own three folders".
- A rule page of an actor is a page that the line "Sources:" or "Source:" of the section of the actor names. A prompt
  template is not a rule page.

## The orchestrator

Sources: [the orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule),
[the hold before an install](release.md#the-hold-before-an-install),
[Install a pre-release](release.md#install-a-pre-release), [the doc-read rule](doc-reads.md#the-doc-read-rule),
[the re-read rule](doc-reads.md#the-re-read-rule), [Pick the tickets](pick-the-tickets.md),
[Land the work](land-the-work.md), [the CI wait](ci-wait.md#the-ci-wait),
[The actor of each write action](question-pane.md#the-actor-of-each-write-action),
[The herdr path](question-pane.md#terms), [Start](question-pane.md#start),
[The question file](question-pane.md#the-question-file), [The handoff file](handoff.md#the-handoff-file),
[The check of the handoff folder](handoff.md#the-check-of-the-handoff-folder),
[The steps of the old orchestrator](handoff-orchestrator.md#the-steps-of-the-old-orchestrator),
[The start of the new orchestrator](handoff-orchestrator.md#the-start-of-the-new-orchestrator),
[The steps for the open peer requests](handoff-orchestrator.md#the-steps-for-the-open-peer-requests),
[The proposal file](planner-subagent.md#the-proposal-file), [Limits](limits.md#limits),
[the own-worktree rule](limits.md#the-own-worktree-rule),
[The check of the pane owner](question-pane.md#the-check-of-the-pane-owner) and
[The orchestrator folder](limits.md#the-orchestrator-folder).

- K1: the read-only `tasker` commands of
  [the orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule). They are `show-config`,
  `show-config-schema`, `show-quota`, `status`, `doctor`, the `show` commands for one task, `model` with no new model
  and no `--effort`, `--version`, `--help` and `help`.
- K2: `tasker model` with a new model or with `--effort`. Asks the user, in a settled decision message of its question
  pane.
- K3: `git rev-parse`, `git merge-base`, `git merge-base --is-ancestor`, `git diff`, `git show`, `git grep`,
  `git cat-file`, `git status --porcelain`, `git status --porcelain --untracked-files=no`, `git branch --show-current`,
  `git worktree list` and `git ls-remote --exit-code`.
- K4: `git fetch origin`, `git fetch --multiple` and `git pull --ff-only`, in its local clone, and
  `git checkout <commit>` and `git checkout main` for the release steps.
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
- K12: these writes, in the folder of the orchestrator:
  - A write of the body file of an issue
  - A write of the file of a topic handoff in the shared handoff folder
  - A write and a delete (`rm <file>`) of a file of its own three folders
  - A write of a pane handoff file in its own handoff folder
  - `mkdir -p` on its own three folders

  The three folders of the [orchestrator folder](limits.md#the-orchestrator-folder), and the parent folders that
  `mkdir -p` makes for them, count as the folder of the orchestrator for K12.

- K13 to K15: no list.
- Named other commands: `npm run install:global` (an installing orchestrator only, as the hold before an install says),
  `timeout 20 bash -c 'sleep 1'` (the wait of [the herdr path](question-pane.md#terms)), a Read call on a file of the
  local clone, `wc -l <path>`, `timeout 20 bash -c 'sleep 5'`, a Read call on the saved output of its own tool call,
  `ls` on its own three folders and a Read call on a file of its own three folders. For the check of a check request, it
  also runs `ls` on the folder of the draft files and a Read call on a draft file there.

This list gives the forms of the kind `claude`. [The orchestrator folder](limits.md#the-orchestrator-folder) gives the
forms of the kinds `pi` and `codex`, and no one measured them.

## A task subagent for a whole ticket

Sources: [Limits](limits.md#limits), [the own-worktree rule](limits.md#the-own-worktree-rule),
[the plain-form rule](tasker-commands.md#the-plain-form-rule), [Run one ticket](run-one-ticket.md#run-one-ticket),
[the CI wait](ci-wait.md#the-ci-wait), [the doc-read rule](doc-reads.md#the-doc-read-rule) and the ask rules of
[Claude Code](setup.md#claude-code).

- K1: `tasker show`, `tasker show-plan`, `tasker show-verify`, `tasker show-review` and the other read-only commands of
  [the orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule).
- K2: each task change of that rule, in the plain form, for example `tasker start`, `tasker plan`, `tasker approve`,
  `tasker execute`, `tasker verify`, `tasker review`, `tasker accept`, `tasker merge` and `tasker finish`. It never runs
  `tasker approve-credits`. `tasker abort` and `tasker update-branch` with `--undo` ask the user. The K2 cell says
  "runs", because most task changes run with no word of the user. A cell says "asks the user" only when each command of
  the list asks.
- K3: `git log`, `git show` and `git diff` on `tasker/<task branch>`, `git show origin/main:<path>`, and the other `git`
  reads of [Limits](limits.md#limits).
- K4: `git fetch tasker`, `git fetch origin`, `git worktree add`, `git worktree remove` and `git reset --keep`, as the
  own-worktree rule and [Limits](limits.md#limits) say.
- K5: `gh run list`, `gh run view`, `gh run watch` and `gh issue view`.
- K6: the comment of step 11 of "Run one ticket". It is the only write of the text of an issue.
- K12 and K14: files of its own task worktree.
- Named other commands: `npm ci` before a direct npm script, `npm run check` and the other direct npm scripts of the
  task worktree, `gh run rerun <run id> --failed` (the only write on GitHub Actions), a Read call on a saved output of
  its own tool call, and `timeout 20 bash -c 'sleep 5'`.
- K7 to K11, K13 and K15: no list.

## A task subagent for one task change

Sources: [the orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule),
[The prompt of a task subagent](pick-the-tickets.md#the-prompt-of-a-task-subagent) and
[the doc-read rule](doc-reads.md#the-doc-read-rule).

- K2: the one `tasker` command that the orchestrator sent, in the plain form of
  [the plain-form rule](tasker-commands.md#the-plain-form-rule).
- K3: `git show origin/main:<path>`.
- K4: `git fetch origin`.
- Named other commands: a Read call on a saved output of its own tool call, and `timeout 20 bash -c 'sleep 5'`.
- Each other kind: no list.

## The planner subagent

Sources: [Sessions](../config.md#sessions), [the doc-read rule](doc-reads.md#the-doc-read-rule),
[The result](planner-subagent.md#the-result), [The record file](planner-subagent.md#the-record-file),
[No metadata](planner-subagent.md#no-metadata), [The reads before the write](issues.md#the-reads-before-the-write),
[The project board](issues.md#the-project-board), [The blocked-by links](issues.md#the-blocked-by-links),
[The post of a draft](planner.md#the-post-of-a-draft), [The body of an issue](issue-subagents.md#the-body-of-an-issue),
[The blocked-by links](issue-subagents.md#the-blocked-by-links) and [Docs](rules.md#docs). The section Sessions says
that the planner subagent starts the draft, review and post subagents. The planner subagent keeps the record of the
findings of each draft in the record file.

- K1: `tasker status`, before a question of its result about a write that the reads before the write can skip.
- K3: `git -C <local clone> show origin/main:<path>`, for each doc that it reads. Also
  `git -C <local clone> grep -n -E '<pattern>' origin/main -- <paths>` for a search of doc words, and
  `git -C <local clone> log origin/main` and `git -C <local clone> show <commit>` for what a closed issue of a match
  landed. Also `git -C <local clone> grep -n -A1 -E '<pattern>' origin/main -- <paths>`, for the end of a line in a
  search of doc words, as [the doc-search rule](rules.md#docs) says.
- K4: `git -C <local clone> fetch origin`, before its first doc read.
- K5: these reads:
  - The state read `gh issue view <number> --json state -q .state`
  - The read of a closed issue of a match, `gh issue view <number> -R <repo> --json title,body,state`
  - `gh issue list --milestone "<milestone>" --state open --limit 1000 --json number` and
    `gh api repos/<owner>/<repo>/issues/<number>/dependencies/blocked_by`, for the blocked-by links of both milestones
  - The reads of [The project board](issues.md#the-project-board):
    `gh project item-list 3 --owner codeguru42 --limit 1000 --format json` with its `--jq` filter, and
    `gh issue view <number> --json projectItems`
- K12: the record file `<file>.findings.md` of each draft, in the folder of the draft files.
- Named other commands: a Read call on a saved output of its own tool call, a Read call on the record file,
  `timeout 20 bash -c 'sleep 5'`, the join form
  `git -C <local clone> show origin/main:<path> | tr '\n' ' ' | grep -o -E '<pattern>'`, a Read call on a draft file and
  a Read call on the report file of an issue-draft subagent, in the folder of the draft files.
- K10: `SendMessage` to `main` only, after a refused `SubagentHandback` call.
- K11: the start of an issue-draft subagent, an issue-review subagent and an issue-post subagent.
- Each other kind: no list.

## The issue-draft subagent

Sources: [The draft file](issue-draft.md#the-draft-file), [The size of a draft](issue-draft.md#the-size-of-a-draft),
[The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent),
[the doc-read rule](doc-reads.md#the-doc-read-rule), [The self-check](issue-draft.md#the-self-check),
[The steps before a post](issue-draft.md#the-steps-before-a-post),
[The findings and the edge cases](issue-draft.md#the-findings-and-the-edge-cases),
[A change of an open issue](issue-draft.md#a-change-of-an-open-issue), [Before a post](issues.md#before-a-post),
[The blocked-by links](issues.md#the-blocked-by-links), [The body of an issue](issue-subagents.md#the-body-of-an-issue),
[The blocked-by links](issue-subagents.md#the-blocked-by-links) and [Docs](rules.md#docs).

- K3: `git branch --show-current`, `git status --porcelain --untracked-files=no`, `git rev-parse --verify`,
  `git merge-base --is-ancestor`, `git show origin/main:<path>`, `git grep -n -E '<pattern>' -- <paths>` in the local
  clone, and `git grep -n -E '<pattern>' origin/main -- <paths>` after the old read. Also
  `git grep -n -A1 -E '<pattern>' -- <paths>` in the local clone and
  `git grep -n -A1 -E '<pattern>' origin/main -- <paths>` after the old read, for the end of a line in a search of doc
  words, as [the doc-search rule](rules.md#docs) says.
- K4: `git pull --ff-only origin main` and `git fetch origin`, in the local clone. The pull is no write of a file, as
  [The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent) says.
- K5: the start read `gh issue view <number> --json title,body`, `gh issue list` and `gh issue view` of the open issues,
  the links read `gh api repos/<owner>/<repo>/issues/<number>/dependencies/blocked_by` and the label read
  `gh issue view <blocker> -R <repo> --json labels -q '.labels[].name'`.
- K12: its draft file, its report file and the files of a scratch folder under `/tmp`.
- Named other commands: a Read call on a file of the local clone, `wc -l <path>`, `wc -m <draft file>`,
  `timeout 20 bash -c 'sleep 5'`, a Read call on the saved output of its own tool call, `printf '%s\n' "$json"`,
  `sha256sum` and `jq -r '.title, .body'` in the start read, the join form
  `tr '\n' ' ' < <path> | grep -o -E '<pattern>'` or
  `git show origin/main:<path> | tr '\n' ' ' | grep -o -E '<pattern>'` after the old read, and a Read call on its draft
  file.
- Each other kind: no list.

## The issue-review subagent

Sources: [The bans of an issue-review subagent](issue-review.md#the-bans-of-an-issue-review-subagent),
[The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent),
[the doc-read rule](doc-reads.md#the-doc-read-rule), [The context of a review](issue-review.md#the-context-of-a-review),
[The tests of a draft](issue-review.md#the-tests-of-a-draft),
[The body of an issue](issue-subagents.md#the-body-of-an-issue) and [Docs](rules.md#docs).

- K3: `git branch --show-current`, `git status --porcelain --untracked-files=no`, `git rev-parse --verify`,
  `git merge-base --is-ancestor`, `git show origin/main:<path>`, `git grep -n -E '<pattern>' -- <paths>` in the local
  clone, and `git grep -n -E '<pattern>' origin/main -- <paths>` after the old read. Also
  `git grep -n -A1 -E '<pattern>' -- <paths>` in the local clone and
  `git grep -n -A1 -E '<pattern>' origin/main -- <paths>` after the old read, for the end of a line in a search of doc
  words, as [the doc-search rule](rules.md#docs) says.
- K4: `git pull --ff-only origin main` and `git fetch origin`, in the local clone. The pull is no write of a file, as
  [The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent) says.
- K5: `gh issue list ... | jq ...` and the other `gh` reads of the open and closed issues. It writes no file.
  [The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent) gives the one case of the pull.
- Named other commands: a Read call on a file of the local clone, `wc -l <path>`, `timeout 20 bash -c 'sleep 5'`, a Read
  call on the saved output of its own tool call, the join forms `tr '\n' ' ' < <path> | grep -o -E '<pattern>'` and
  `git show origin/main:<path> | tr '\n' ' ' | grep -o -E '<pattern>'`, and a Read call on the draft file of its review,
  in the folder of the draft files.
- Each other kind: no list.

## The issue-post subagent

Sources: [The writes of an issue-post subagent](issue-post.md#the-writes-of-an-issue-post-subagent),
[The count of the body](issue-post.md#the-count-of-the-body), [A comment post](issue-post.md#a-comment-post),
[the doc-read rule](doc-reads.md#the-doc-read-rule), [The steps of a post](issue-post.md#the-steps-of-a-post),
[Before a post](issues.md#before-a-post), [The reads before the write](issues.md#the-reads-before-the-write),
[The blocked-by links](issues.md#the-blocked-by-links), [The blocked-by links](issue-subagents.md#the-blocked-by-links),
[The last steps of a post](issue-post.md#the-last-steps-of-a-post),
[The result of an issue-post subagent](issue-post.md#the-result-of-an-issue-post-subagent) and
[the defer rule](pick-the-tickets.md#the-defer-rule).

- K1: `tasker status`, in the reads before the write and in the in-flight check.
- K3: `git branch --show-current`, `git status --porcelain --untracked-files=no`, `git rev-parse --verify`,
  `git merge-base --is-ancestor` and `git show origin/main:<path>`.
- K4: `git pull --ff-only origin main` and `git fetch origin`, in the local clone. The pull is no write of a file, as
  [The bans of a subagent](issue-subagents.md#the-bans-of-a-subagent) says.
- K5: the `gh` reads of [Before a post](issues.md#before-a-post), and
  `gh issue view <number> -R <repo> --json comments`, the read of the comments of the target issue for the search and
  the compare of a comment post. It also has these reads, each named by its source:
  - The duplicate search `gh issue list --state all --search "<words> in:title,body" --limit 1000`
  - The state read `gh issue view <number> --json state -q .state`
  - The hash read `gh issue view <number> --json title,body`
  - The body read `gh issue view <number> --json body -q .body`, for the compare after a post and for the compare of
    each match
  - The walk with `--paginate` and the links read `gh api repos/<owner>/<repo>/issues/<number>/dependencies/blocked_by`
  - The label read of a blocker, `gh issue view <blocker> -R <repo> --json labels -q '.labels[].name'`
  - The read of the links of both milestones after the post,
    `gh issue list --milestone "<milestone>" --state open --limit 1000 --json number` and the links read
  - The column read of the defer rule, `gh issue view <number> --json projectItems -q '.projectItems[].status.name'`
- K6: `gh issue create` and `gh issue edit` of the title and the body, and
  `gh issue comment <number> -R <repo> --body-file <absolute path of the body file>`, which asks the user.
- K7: the `gh issue edit` calls that add or remove a blocked-by link, with the milestone and the labels of the draft in
  `gh issue create`.
- K12: the body file of the post, next to its draft file: the absolute path of the draft file, with `.body.md` in place
  of the `.md` at its end.
- Named other commands: a Read call on a file of the local clone, a Read call on the body file of a comment post,
  `wc -l <path>`, `wc -m <absolute path of the body file>`, `timeout 20 bash -c 'sleep 5'`, a Read call on the saved
  output of its own tool call, `printf '%s\n' "$json"` and `sha256sum` in the hash read, `diff` in the compare after a
  post and in the compare of a match, `timeout 60 tail -f /dev/null`, and a Read call on the draft file of its post.
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

Source: the opener prompt in
[`prompt-templates/question-pane/opener.md`](../../prompt-templates/question-pane/opener.md), as
[The prompts](question-pane.md#the-prompts) gives it. The prompt gives each command word for word.

- K1: `tasker show-config --repo <repo key>`.
- K3: `git -C <local clone> show origin/main:prompt-templates/question-pane/session.md`.
- K4: `git -C <local clone> fetch origin`.
- K8: `herdr pane read`.
- K9: `herdr pane split` and `herdr agent start`.
- Named other commands: `timeout 20 bash -c 'sleep 10'`.
- Each other kind: no list.

## The reuse subagent

Source: the reuse prompt in [`prompt-templates/question-pane/reuse.md`](../../prompt-templates/question-pane/reuse.md),
as [The prompts](question-pane.md#the-prompts) gives it. The prompt gives each command word for word.

- K3: `git -C <local clone> show origin/main:prompt-templates/question-pane/session.md`.
- K4: `git -C <local clone> fetch origin`.
- K8: `herdr agent wait`, `herdr agent get` and `herdr pane read`.
- K9: `herdr pane send-text` and `herdr pane send-keys`.
- Named other commands: `timeout 20 bash -c 'sleep 10'` and `timeout 20 bash -c 'sleep 1'`.
- Each other kind: no list.

## A question session

Sources: [The question session](question-pane.md#the-question-session), [The herdr path](question-pane.md#terms),
[The check of the pane owner](question-pane.md#the-check-of-the-pane-owner) and
[the doc-read rule](doc-reads.md#the-doc-read-rule).

- K1, K3 and K5: the read-only commands, other than `herdr` commands.
- K4: `git fetch origin` and `git pull --ff-only origin main`, in its local clone.
- K9 and K10: only the herdr path to its pane owner, for the messages that
  [Send a decision](question-pane.md#send-a-decision) gives, and for the check request of
  [The check of the pane owner](question-pane.md#the-check-of-the-pane-owner).
- Named other commands: `timeout 20 bash -c 'sleep 1'`, a Read call on a file of the local clone, `wc -l <path>`,
  `timeout 20 bash -c 'sleep 5'` and a Read call on the saved output of its own tool call.
- Each other kind: no list. It sends each write action back to its pane owner.
