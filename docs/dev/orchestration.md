# Orchestration

This page gives the rules for an orchestrator. The orchestrator is the assistant session that picks tickets, starts one agent for each ticket, moves the cards, sets the landing order and writes memory.

A ticket is an issue on the project board. An agent is an assistant session that the orchestrator starts for one ticket. The agent runs the steps of "Run one ticket" for that ticket. The user is the person who runs the orchestrator. A task is the record that tasker keeps for one ticket. tasker moves the task from state to state, for example from `awaiting_plan_review` to `approved`.

Memory is the files where an assistant keeps notes between sessions. Memory is not in the repo.

tasker also starts its own sessions for plan, execute and review. They run in a worktree of the tasker clone. They are not agents and they do not run the steps on this page.

The orchestrator and its agents run tasker from the local clone of the orchestrator. For one ticket, the agent of that ticket is the operator that [docs/dev/rebase-conflicts.md](rebase-conflicts.md) names.

Every `tasker` command on this page is the installed `tasker`: the `tasker` command on the PATH from a global install. It is not the tasker that this repo builds. For this reason, `skills/tasker/SKILL.md` does not list its commands. See the `npm link` bullet under Limits.

## Pick the tickets

The orchestrator does all the steps of this section.

- Take tickets only from the Todo column of the project board, and only from the current milestone. Do not start a ticket from a later milestone.
- Start a ticket only when all the issues that block it are closed.
- Run at most 3 agents at the same time, one ticket for each agent.
- Do not run two tickets at the same time when both edit the same shared file, for example `test/helpers.ts` or `docs/dev/code-conventions.md`. Start the second ticket after the first one lands.
- When a ticket starts, the orchestrator moves its card to In progress. `tasker start` does not move the card. The board moves the card to Done when `tasker finish` closes the issue.
- When the Todo column of the milestone is empty, stop and tell the user. Do not write the issues of the next milestone.

## Run one ticket

The agent of the ticket runs steps 1 to 10. Each step gives the state of the task after its command succeeds.

1. Run `tasker doctor`.
2. Run `tasker start <issue>`. The task goes to `workspace_ready`. Then run `tasker plan <issue>`. The task goes to `awaiting_plan_review`.
3. Read the plan with `tasker show-plan` and `tasker show-questions`. Compare the plan with the Requirements and the Docs sections of the issue.
4. If the plan needs changes, run `tasker refine <issue> "<feedback>"`. The task goes to `awaiting_plan_review` again. Then do steps 3 and 4 again until the plan needs no changes. Put the answers to the plan questions in the feedback text. `tasker plan` takes no feedback.
5. Run `tasker approve`. The task goes to `approved`. Run `tasker execute`. The task goes to `executed`. Run `tasker verify`. When the verify commands pass, the task goes to `awaiting_work_review`. Run `tasker review`. When the review has findings, the task goes to `reviewed`. When it has none, the task stays in `awaiting_work_review`. If the review has no findings, go to step 9.
6. Read the findings with `tasker show-review`. Decide for each finding if it is real.
7. Dismiss each finding that is not real, with a reason: `tasker dismiss-review <issue> --finding N "<reason>"`. The task stays in `reviewed` while a finding is still open. If you dismiss all the findings, the task goes to `awaiting_work_review`, and you go to step 9.
8. If real findings are still open, run one `tasker refine <issue> "<feedback>"`. It acts on all the open findings. The task goes to `awaiting_plan_review`. After the refine, do steps 3 and 4 for the new plan. Then do steps 5 to 8 again, starting with `tasker approve`. The "Review findings" section limits the number of loops.
9. Run `tasker accept`. The task goes to `accepted`. `tasker accept` refuses when the branch does not contain the tip of `origin/main`. In that case, run `tasker update-branch`. The task goes to `executed`. Then run `tasker verify` and `tasker review` again as in step 5. If that review has findings, go to step 6. Otherwise, run `tasker accept` again. Run `tasker merge`. The task goes to `landed`. Run `tasker finish`. The task goes to `finished`, and the issue closes.
10. After `tasker finish`, post a comment on the issue that starts with `## Decisions made during implementation`. List the choices that the issue did not state, with the reasons. Name each detail that the issue did not give.

The add-work rule: if the task is in `awaiting_work_review` and the agent must add work, the agent runs `tasker review <issue> "<feedback>"`. The task reaches `awaiting_work_review` after a review with no findings in step 5 or step 9, or after the agent dismisses all the findings in step 7. In this state, `tasker refine` refuses to run. The work can come from the orchestrator, for example. After `tasker review <issue> "<feedback>"`, the task goes to `refining`, and tasker makes a new plan revision. Then the task goes to `awaiting_plan_review`. Then the agent does steps 3 and 4 for the new plan, and steps 5 to 8 again, starting with `tasker approve`.

If a command fails or the task is in another state, run `tasker show <issue>` and follow the commands that it prints.

To find the next command, use these:

- `tasker --help` lists the commands.
- `tasker <command> --help` shows the states where the command is valid.
- `tasker show <issue>` shows the state of the task and the next commands.

## Review findings

- One loop is one `tasker review` and the work on its findings. The agent runs at most 3 review loops. One 4th loop is permitted only to fix a small, real correctness bug.
- After the last loop, the agent stops and reports to the orchestrator. The orchestrator reports to the user.
- On the 3rd loop, the agent dismisses cosmetic findings with a reason.
- A refactor or duplication finding is not cosmetic. The agent refines it in the ticket that added the duplicated code.
- If such a finding is missed, the orchestrator adds it to a ticket that has not started (it edits the issue). Or the orchestrator tells the agent of a ticket in progress to add it to its next refine. If neither is possible, the orchestrator opens a new issue.
- When the agent sends a fix in the refine text, it writes "apply everywhere it fits". Otherwise the next review finds the same problem in other places.

## Land the work

The steps to land a ticket are in "Run one ticket". This section gives the rules between tickets.

- After `tasker approve`, each agent sends the orchestrator the list of files that the plan changes. `tasker refine` and `tasker approve` also print a warning when another task in progress changes the same file.
- If the edit of a shared file is not required, the agent removes it in a refine. If it is required, the orchestrator sets the landing order.
- When the orchestrator sets the landing order, it tells the later agent which ticket must land first. The earlier ticket is the ticket that must land first. The later agent is the agent of the ticket that lands after it.
- The later agent does the steps of "Run one ticket" up to `tasker accept` in step 9. Before it runs `tasker accept`, it waits until the issue of the earlier ticket is closed. While the agent waits, the task is in `awaiting_work_review`.
- To wait, the agent reads the state of the issue of the earlier ticket one time: `gh issue view <number> --json state -q .state`. If the state is `OPEN`, the agent reads it again every 30 seconds until it is `CLOSED`.
- When the issue of the earlier ticket is closed, the agent runs `tasker update-branch`. The task goes from `awaiting_work_review` to `executed`. Then the agent continues step 9 of "Run one ticket" from its `tasker verify`.
- If a refine, or the `tasker review <issue> "<feedback>"` of the add-work rule, must change a file that another ticket changed and landed after this task started, the agent runs `tasker update-branch` first. Otherwise the new work uses the old text of the file, and the rebase at landing can conflict.
- If the task is in `reviewed` (a refine of step 8) or in `awaiting_work_review` (work for the add-work rule), `tasker update-branch` moves the task to `executed`. Then the agent runs `tasker verify`, and the task goes to `awaiting_work_review`. Then the agent runs `tasker review`.
- The new review is a full review pass. It reports the open findings again as still open, and it can also report new findings.
- If the new review has findings, the task goes to `reviewed`, and the agent goes to step 6. Steps 6 to 8 then read, dismiss and refine all the open findings. If the agent must also add work (the task was in `awaiting_work_review`), the agent puts that work in the feedback of the refine of step 8. If the agent dismisses all the findings in step 7 instead, the task goes to `awaiting_work_review`, and the agent follows the add-work rule instead of going to step 9.
- If the new review has no findings, the task stays in `awaiting_work_review`, and `tasker refine` refuses to run. In that case, if the agent still must make the change, it follows the add-work rule of "Run one ticket". Otherwise, the agent goes to step 9.
- If the task was in `reviewed`, the review before `tasker update-branch` and the review after it count as one loop of "Review findings".
- If the task is in `awaiting_plan_review` (a refine of step 4), `tasker update-branch` keeps the task in `awaiting_plan_review`. Then the agent runs the refine of step 4.
- If `tasker update-branch` reports a rebase conflict, the agent follows [docs/dev/rebase-conflicts.md](rebase-conflicts.md). The agent does not copy that procedure.

## Limits

These limits apply to the orchestrator and to the agents, except where a bullet names one actor.

- Do not change the repo or the worktrees of tasker by hand. Only `tasker` commands change them.
- If the issue does not give a detail that the work needs, the agent asks the user through the orchestrator.
- If tasker stops for a quota, the agent runs `tasker resume` later. Never run `tasker approve-credits`.
- Do not run `npm link` or a global install from a task worktree. The global `tasker` runs the tickets, and the install replaces it.
- Only the orchestrator writes memory, so that two agents do not write the same file. Agents report what they learn to the orchestrator in their final report.
