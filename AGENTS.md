# Index of the docs

Each assistant session reads this index first and follows the link for each topic.

- [docs/dev/rules.md](docs/dev/rules.md): the rules of the repo (the check, test first, the commits, the docs, the test helpers, the code rules, the simple-english skill, the installed skill and `AGENTS.md`).
- [CONTRIBUTING.md](CONTRIBUTING.md): how to start work as a contributor to tasker.
- [docs/dev/code-conventions.md](docs/dev/code-conventions.md): the layout, the steps to add a command, the imports, the zod facts and the tests.
- [docs/config.md](docs/config.md): the configuration.
- [docs/statemachine.md](docs/statemachine.md): the task states, the rules of the edges, the main lifecycle, the plan, build, work review and landing sections, the pauses, the failure and retry targets, update branch and the demotion rules.
- [docs/dev/data-root.md](docs/dev/data-root.md): the folders and the database.
- [docs/dev/version-control.md](docs/dev/version-control.md): the git code: the git boundary, how tasker uses git, the git environment, provision, the ssh key, the push guard, publish and land, the doctor checks and the repo slug.
- [docs/dev/doctor.md](docs/dev/doctor.md): the code that all doctor checks share: the timeout rules and the signal rule.
- [docs/dev/rebase-conflicts.md](docs/dev/rebase-conflicts.md): the procedure when `tasker update-branch` reports a rebase conflict.
- [docs/dev/orchestration.md](docs/dev/orchestration.md): the terms of the orchestration and the index of the orchestration pages.
- [docs/dev/pick-the-tickets.md](docs/dev/pick-the-tickets.md): "Pick the tickets", the stacking rule, the stacked-ticket rule, the parent-hold rule, the link offer, the defer rule and "The prompt of an agent".
- [docs/dev/doc-reads.md](docs/dev/doc-reads.md): the re-read rule, the notice rule and the doc-read rule.
- [docs/dev/run-one-ticket.md](docs/dev/run-one-ticket.md): "Run one ticket", the final report, the comeback rule, the base rule, the add-work rule, the diff read and the measure rule.
- [docs/dev/plan-review.md](docs/dev/plan-review.md): the repo-files rule, the fact test, the issue check, the stop rule, the change-of-scope comment, the design-gap rule and the quote check.
- [docs/dev/tasker-commands.md](docs/dev/tasker-commands.md): the plain-form rule, the tool-block rule, the command rules, the facts of the installed tasker and the run times.
- [docs/dev/verify-failures.md](docs/dev/verify-failures.md): the verify-failure rule, the broken-commit steps, the session check, the manual fix and the commit check.
- [docs/dev/ci-wait.md](docs/dev/ci-wait.md): the CI wait and "A failed CI run".
- [docs/dev/review-findings.md](docs/dev/review-findings.md): "Review findings".
- [docs/dev/land-the-work.md](docs/dev/land-the-work.md): "Land the work", the overlap rule, the Docs rule, the hold rule and the stuck-task rule.
- [docs/dev/quota.md](docs/dev/quota.md): "Quota", "Terms", "The delay of each agent", "Schedule a job when an agent starts", the seven-day rule, "When there is no reset time yet", "When the job fires", "The next job", "What the agent does", "Delete the job" and "Do not use these".
- [docs/dev/handoff.md](docs/dev/handoff.md): "The handoff".
- [docs/dev/limits.md](docs/dev/limits.md): "Limits", the own-worktree rule, the update rule, the local-commit rule, the shared-clone rule, the address rule, the answer-wait rule and the failure rule.
- [docs/dev/planning.md](docs/dev/planning.md): the rules for a planning session that plans a milestone and writes its issues: the order of the work, the body of an issue, the blocked-by links, the milestone of an issue, what goes in a ticket and the work with the operator.
- [docs/dev/issues.md](docs/dev/issues.md): the rules of each session that posts an issue, and the steps of the planning session for the blocked-by links, the project board and the milestones.
- [docs/dev/working-with-the-user.md](docs/dev/working-with-the-user.md): how an assistant session works with the user: a decision of the user, a question of the user, the issue-link rule, core features first and the work that waits, simplify over special rules, and the tools of a session.
- [docs/dev/first-refine.md](docs/dev/first-refine.md): the hints that an agent gives in the first refine of a ticket, sorted by the kind of ticket.
- [docs/dev/workspaces.md](docs/dev/workspaces.md): the base branch and the workspace of a task: the forms, the source order of the resolve, the learned default, the guard, the branch name, and the reasons for the git flags of the diff and the reconcile.
- [docs/dev/issue-trackers.md](docs/dev/issue-trackers.md): the issue tracker code: the gh boundary, the gh token and environment, the gh and GitHub facts that the code guards against, and the doctor checks.
- [docs/dev/issue-keys.md](docs/dev/issue-keys.md): the issue key forms, the short refs, the resolve of a key to its repo and the stored spelling.
- [docs/dev/tasks.md](docs/dev/tasks.md): the task commands start, abort, plan, refine, approve, unapprove, execute, verify, review, retry, accept, merge and mark-landed, and the result of an assistant run: the purpose of start, the order of its steps, the locks and the lock order, the rules of a second run, the reasons of abort, the order of the steps of plan and refine, the approve, the execute run, the verify run, the review, the retry, the accept, the merge, the mark-landed and the result of an assistant run.
- [docs/dev/phases.md](docs/dev/phases.md): the phases: the environment of a phase, the deadline, the stop rules, the log and the marker.
- [docs/dev/assistants.md](docs/dev/assistants.md): the assistant provider interface: its purpose, the rule "refuse, never drop", the session id, the prompt on stdin and the provider of a new and a continued session.
- [docs/dev/release.md](docs/dev/release.md): the releases: the definition of a version, the steps to make a new version, the reason of the tag and the npm facts of the package file.
- [docs/dev/setup.md](docs/dev/setup.md): the steps to set up a new machine for an orchestrator: the tools, the local clone, the installed tasker and its configuration, and the Claude Code settings, skills and plugin.
