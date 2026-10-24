# Orchestrator

[The orchestration pages](orchestrator.md) give the rules for an orchestrator. The orchestrator is the assistant session that picks tickets, starts one agent for each ticket, moves the cards, sets the landing order and writes memory.

A ticket is an issue on the project board. An agent is an assistant session that the orchestrator starts for one ticket. The agent runs the steps of ["Run one ticket"](run-one-ticket.md#run-one-ticket) for that ticket. The user is the person who runs the orchestrator. A task is the record that tasker keeps for one ticket. tasker moves the task from state to state, for example from `awaiting_plan_review` to `approved`.

Memory is the files where an assistant keeps notes between sessions. Memory is not in the repo.

tasker also starts its own sessions for plan, execute and review. They run in a worktree of the tasker clone. They are not agents and they do not run the steps on [the orchestration pages](orchestrator.md).

The orchestrator and its agents run tasker from the local clone of the orchestrator. For one ticket, the agent of that ticket is the driver that [docs/dev/rebase-conflicts.md](rebase-conflicts.md) names.

Every `tasker` command on [the orchestration pages](orchestrator.md) is the installed `tasker`: the `tasker` command on the PATH from a global install. It is not the tasker that this repo builds. For this reason, `skills/tasker/SKILL.md` does not list its commands (see [The installed skill](rules.md#the-installed-skill)). See the install bullet of [Limits](limits.md#limits) in `docs/dev/limits.md`.

The orchestration pages are `docs/dev/orchestrator.md` and the pages of this list, "The pages":

- [docs/dev/pick-the-tickets.md](pick-the-tickets.md): "Pick the tickets", the stacking rule, the stacked-ticket rule, the parent-hold rule, the link offer, the defer rule and "The prompt of an agent".
- [docs/dev/doc-reads.md](doc-reads.md): the re-read rule, the notice rule and the doc-read rule.
- [docs/dev/run-one-ticket.md](run-one-ticket.md): "Run one ticket", the final report, the comeback rule, the base rule, the add-work rule, the diff read and the measure rule.
- [docs/dev/plan-review.md](plan-review.md): the repo-files rule, the fact test, the issue check, the stop rule, the change-of-scope comment, the design-gap rule and the quote check.
- [docs/dev/tasker-commands.md](tasker-commands.md): the plain-form rule, the tool-block rule, the command rules, the facts of the installed tasker and the run times.
- [docs/dev/verify-failures.md](verify-failures.md): the verify-failure rule, the broken-commit steps, the session check, the manual fix and the commit check.
- [docs/dev/ci-wait.md](ci-wait.md): the CI wait and "A failed CI run".
- [docs/dev/review-findings.md](review-findings.md): "Review findings".
- [docs/dev/land-the-work.md](land-the-work.md): "Land the work", the overlap rule, the Docs rule, the hold rule and the stuck-task rule.
- [docs/dev/quota.md](quota.md): "Quota", "Terms", "The delay of each agent", "Schedule a job when an agent starts", the seven-day rule, "When there is no reset time yet", "When the job fires", "The next job", "What the agent does", "Delete the job" and "Do not use these".
- [docs/dev/handoff.md](handoff.md): "The handoff".
- [docs/dev/limits.md](limits.md): "Limits", the own-worktree rule, the update rule, the local-commit rule, the shared-clone rule, the address rule, the answer-wait rule and the failure rule.
