# The doc layout

## The folders

- `docs/` holds user docs and the role index. `config.md` explains configuration, `sessions.md` defines session terms,
  `statemachine.md` describes task states and their edges, and `orchestrator.md` indexes the orchestrator docs. This doc
  sets no new layout for these files.
- `docs/dev/orchestrator/` holds docs with steps for the orchestrator. `pick-the-tickets.md` covers ticket choice,
  `land-the-work.md` covers landing work, `quota.md` covers quota limits, `handoff-orchestrator.md` covers handoff,
  `milestone-close.md` covers milestone closure, `setup.md` covers machine setup, `permissions.md` covers permissions,
  and `allowed-commands.md` covers allowed commands.
- `docs/dev/task-subagent/` holds docs with steps for a task subagent. `run-one-ticket.md` covers one ticket,
  `plan-review.md` covers plan review, `first-refine.md` covers the first refine, `verify-failures.md` covers failed
  verification, `review-findings.md` covers review findings, `rebase-conflicts.md` covers rebase conflicts, and
  `ci-wait.md` covers waiting for CI.
- `docs/dev/planner-subagent/` holds docs with steps for the planner subagent. `planner-subagent.md` gives those steps.
- `docs/dev/issue-subagents/` holds docs with steps for the issue-draft, issue-review and issue-post subagents.
  `issue-subagents.md` gives their shared rules; `issue-draft.md`, `issue-review.md` and `issue-post.md` give their
  steps.
- `docs/dev/question-pane/` holds docs with steps for a question-pane session. `question-pane.md` gives its steps, and
  `session-review-rounds.md` gives the review rounds.
- `docs/dev/shared/` holds rules for several roles when no one role owns them. `doc-reads.md` covers doc reads,
  `limits.md` covers role limits, `working-with-the-user.md` covers work with the user, `tasker-commands.md` covers
  tasker commands, `items.md` defines message items, `handoff.md` covers handoffs, `issues.md` covers issues,
  `GLOSSARY.md` defines shared terms, and `rules.md` gives repo rules. This doc moves here when the folder exists.
- `docs/dev/code/` holds docs about tasker code, tests, build, release, trackers, assistants and data.
  `code-conventions.md` covers code style, `data-root.md` covers data storage, `version-control.md` covers git,
  `doctor.md` covers doctor checks, `forge.md`, `github.md` and `jira.md` cover tracker services, `issue-trackers.md`
  covers tracker code, `issue-keys.md` covers issue keys, `tasks.md` covers task commands, `phases.md` covers phases,
  `assistants.md` covers assistant providers, `prompt-templates.md` covers prompt templates, `release.md` covers
  releases, `codex-sessions.md` and `pi-sessions.md` cover those sessions, and `workspaces.md` covers workspaces.

There is no folder or index for the operator or the planner session because both roles are retired.

## The placement rule

Use these tests in order. The first test that fits sets the home of the doc:

1. If the doc gives steps for one role, put it with that role. The readers do not set its home. For example, the
   orchestrator can read docs for other roles when needed.
2. If the doc gives steps for several roles and no one role owns it, put it with the shared docs.
3. If the doc covers tasker code, tests, build, release, trackers, assistants or data, put it with the code docs.

Each doc has one home and no copy. If these tests do not decide its home, name it with a reason in “The folders”.

## A split of a doc

A split doc stays with its role. For example, a split between starter rules and run rules puts the starter rules with
the role that starts the session. This rule means a split needs no new layout decision. This doc does not decide a
split.

## A doc of a retired role

A doc that another issue will retire, such as `docs/dev/planner.md`, keeps its path until that work lands. It gets no
new home. If parts remain, the retiring change places them by this rule. `docs/planner.md` also keeps its path and gets
no new home.

## The orchestrator index

`docs/orchestrator.md` stays in `docs/`. Many files name it, and moving it gives readers no gain. After a move, its
links and its “The pages” list follow the moved paths.

## The index in AGENTS.md

Keep one entry for each doc. After the first move, group entries under one heading for each folder. See
[AGENTS.md](rules.md#agentsmd) for the index rule.

## A new doc

If its destination exists, put a new doc there. Otherwise, put it at the top of `docs/dev/` and move it when the
destination is created. A doc never has to wait for its folder, and the layout does not arrive in parts.

## A move

Move one folder of docs in each coherent change, under
[the scope of a ticket](issue-subagents.md#the-scope-of-a-ticket). Repair each reference in the same change:

- Each relative link to the moved doc in every tracked file.
- Each full path and each path as text, including paths in `src/`, `test/`, `prompt-templates/`, `skills/`,
  `.claude/skills/`, `README.md` and `CONTRIBUTING.md`.
- Each relative link inside the moved doc. For example, `../orchestrator.md` becomes `../../orchestrator.md`.
- Each anchor if the move changes or removes a heading.

Measure references again before the move. Use `git grep -n -F '<file name>'` and [the doc-search rule](rules.md#docs).
For open issue bodies, follow the bullet “A ticket that renames a doc” in
[the blocked-by links](issue-subagents.md#the-blocked-by-links). This doc names no issue and no order of steps, as
[the short-exception rule](rules.md#docs) requires.
