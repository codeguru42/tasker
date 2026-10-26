# Index of the docs

Each assistant session reads this index first. It does not follow each link of the index at its start. At its start, a
session of a role reads the role index of its role and the start docs that the index names. The agent of a ticket reads
the docs that its prompt names. Each other session, for example a session that tasker starts, reads the docs that its
task needs. After its start, a session reads another doc only for a step of its work that needs the doc. A link that the
session follows for a step is a doc read, as [the doc-read rule](docs/dev/doc-reads.md#the-doc-read-rule) says.

- [docs/orchestrator.md](docs/orchestrator.md): the role index of the orchestrator, with the terms of the orchestration,
  the start docs of the orchestrator and the index of the orchestration pages.
- [docs/planner.md](docs/planner.md): the role index of the planner, with the start docs of the planner and the index of
  the planner pages.
- [docs/operator.md](docs/operator.md): the role index of the operator, with the terms of the operator, the start docs
  of the operator and the index of the operator pages.
- [docs/sessions.md](docs/sessions.md): the terms that each role uses: the user, the slug, the sessions of a slug, an
  item and the own name of a session.
- [docs/dev/rules.md](docs/dev/rules.md): the rules of the repo (the check, test first, the commits, the docs, the test
  helpers, the code rules, the simple-english skill, the installed skill and `AGENTS.md`).
- [CONTRIBUTING.md](CONTRIBUTING.md): how to start work as a contributor to tasker.
- [docs/dev/code-conventions.md](docs/dev/code-conventions.md): the layout, the steps to add a command, the imports, the
  zod facts and the tests.
- [docs/config.md](docs/config.md): the configuration.
- [docs/statemachine.md](docs/statemachine.md): the task states, the rules of the edges, the main lifecycle, the plan,
  build, work review and landing sections, the pauses, the failure and retry targets, update branch and the demotion
  rules.
- [docs/dev/data-root.md](docs/dev/data-root.md): the folders and the database.
- [docs/dev/version-control.md](docs/dev/version-control.md): the git code: the git boundary, how tasker uses git, the
  git environment, provision, the ssh key, the push guard, publish and land, the doctor checks and the repo slug.
- [docs/dev/doctor.md](docs/dev/doctor.md): the code that all doctor checks share: the timeout rules and the signal
  rule.
- [docs/dev/rebase-conflicts.md](docs/dev/rebase-conflicts.md): the procedure when `tasker update-branch` reports a
  rebase conflict.
- [docs/dev/pick-the-tickets.md](docs/dev/pick-the-tickets.md): "Pick the tickets", the stacking rule, the
  stacked-ticket rule, the parent-hold rule, the link offer, the defer rule and "The prompt of an agent".
- [docs/dev/doc-reads.md](docs/dev/doc-reads.md): the re-read rule, the notice rule and the doc-read rule.
- [docs/dev/run-one-ticket.md](docs/dev/run-one-ticket.md): "Run one ticket", the final report, the comeback rule, the
  base rule, the add-work rule, the diff read and the measure rule.
- [docs/dev/plan-review.md](docs/dev/plan-review.md): the repo-files rule, the fact test, the issue check, the stop
  rule, the change-of-scope comment, the design-gap rule and the quote check.
- [docs/dev/tasker-commands.md](docs/dev/tasker-commands.md): the plain-form rule, the tool-block rule, the command
  rules, the facts of the installed tasker and the run times.
- [docs/dev/verify-failures.md](docs/dev/verify-failures.md): the verify-failure rule, the broken-commit steps, the
  session check, the manual fix and the commit check.
- [docs/dev/ci-wait.md](docs/dev/ci-wait.md): the CI wait and "A failed CI run".
- [docs/dev/review-findings.md](docs/dev/review-findings.md): "Review findings".
- [docs/dev/land-the-work.md](docs/dev/land-the-work.md): "Land the work", the overlap rule, the Docs rule, the hold
  rule and the stuck-task rule.
- [docs/dev/quota.md](docs/dev/quota.md): "Quota", "Terms", "The delay of each agent", "Schedule a job when an agent
  starts", the seven-day rule, "When there is no reset time yet", "When the job fires", "The next job", "What the agent
  does", "Delete the job" and "Do not use these".
- [docs/dev/handoff.md](docs/dev/handoff.md): "The suggestion of a handoff", "The handoff file", "The items of a handoff
  file", "The last item id", "The check of the handoff folder", "The end of a handoff", "The stop and the start" and "A
  topic handoff".
- [docs/dev/handoff-orchestrator.md](docs/dev/handoff-orchestrator.md): "The long-running orchestrator", "The landing
  count", "The steps of the old orchestrator", "The handoff file of the orchestrator" and "The start of the new
  orchestrator".
- [docs/dev/handoff-planner.md](docs/dev/handoff-planner.md): "The follow-up planner", "An open draft", "The post
  count", "The steps of the old planner", "The handoff file of the planner" and "The start of the new planner".
- [docs/dev/handoff-operator.md](docs/dev/handoff-operator.md): "The handoff of the operator", "The close count", "The
  steps of the old operator", "The handoff file of the operator" and "The start of the new operator".
- [docs/dev/limits.md](docs/dev/limits.md): "Limits", the own-worktree rule, the update rule, the local-commit rule, the
  shared-clone rule, the address rule, the answer-wait rule and the failure rule.
- [docs/dev/planner.md](docs/dev/planner.md): the rules for a planner that plans a milestone and writes its issues: the
  initial planner and the follow-up planner, the order of the work, the review loop of a draft, the body of an issue,
  the blocked-by links, the milestone of an issue, what goes in a ticket and the work with the user.
- [docs/dev/issues.md](docs/dev/issues.md): the rules of each session that posts an issue, "A recurrence", and the steps
  of the planner for the blocked-by links, the project board and the milestones.
- [docs/dev/working-with-the-user.md](docs/dev/working-with-the-user.md): how an assistant session works with the user:
  the operator, a decision of the user, a question of the user, the issue-link rule, core features first and the work
  that waits, simplify over special rules, and the tools of a session.
- [docs/dev/operator-start.md](docs/dev/operator-start.md): the order of a milestone, the start of a session, the start
  prompts, the stop of a session, a handoff and a blocked session.
- [docs/dev/operator-items.md](docs/dev/operator-items.md): the form of an item, the open items, the answer and the
  states of an item.
- [docs/dev/operator-conversations.md](docs/dev/operator-conversations.md): a side conversation and the word of the
  user.
- [docs/dev/first-refine.md](docs/dev/first-refine.md): the hints that an agent gives in the first refine of a ticket,
  sorted by the kind of ticket.
- [docs/dev/workspaces.md](docs/dev/workspaces.md): the base branch and the workspace of a task: the forms, the source
  order of the resolve, the learned default, the guard, the branch name, and the reasons for the git flags of the diff
  and the reconcile.
- [docs/dev/issue-trackers.md](docs/dev/issue-trackers.md): the issue tracker code: the gh boundary, the gh token and
  environment, the gh and GitHub facts that the code guards against, and the doctor checks.
- [docs/dev/jira.md](docs/dev/jira.md): the Jira tracker code: the Jira folder, `runAcli()`, the commands that tasker
  never runs, `TASKER_ACLI_BIN`, the active site, the site guard, the conversion of ADF, the errors, the measure of a
  failed `acli` call, the measure of the login and the measure of an ADF description.
- [docs/dev/issue-keys.md](docs/dev/issue-keys.md): the issue key forms, the short refs, the resolve of a key to its
  repo and the stored spelling.
- [docs/dev/tasks.md](docs/dev/tasks.md): the task commands start, abort, plan, refine, approve, unapprove, execute,
  verify, review, retry, accept, merge and mark-landed, and the result of an assistant run: the purpose of start, the
  order of its steps, the locks and the lock order, the rules of a second run, the reasons of abort, the order of the
  steps of plan and refine, the approve, the execute run, the verify run, the review, the retry, the accept, the merge,
  the mark-landed and the result of an assistant run.
- [docs/dev/phases.md](docs/dev/phases.md): the phases: the environment of a phase, the deadline, the stop rules, the
  log and the marker.
- [docs/dev/assistants.md](docs/dev/assistants.md): the assistant provider interface: its purpose, the rule "refuse,
  never drop", the session id, the prompt on stdin and the provider of a new and a continued session.
- [docs/dev/release.md](docs/dev/release.md): the releases: the version forms, the steps to make a stable release, the
  steps to install a pre-release, the step for an untracked path, the reason that the installed tasker does not change,
  the hold before an install and the npm facts of the package file.
- [docs/dev/setup.md](docs/dev/setup.md): the steps to set up a new machine for an orchestrator: the tools, the local
  clone, the installed tasker and its configuration, and the Claude Code settings, skills and plugin.
