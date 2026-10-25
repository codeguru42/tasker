# Start and stop the sessions of a milestone

The operator runs each `herdr` command in its own shell, in a Bash call. See [Operator](operator.md) for the terms.

## The order of a milestone

1. The user picks the slug.
2. The user opens the operator in `claude` and names it `operator-<slug>`, for example with `claude -n operator-m9`.
3. When the user asks, the operator starts the initial planner, as "Start a session" says.
4. The user works with the initial planner in its tab. A later ticket gives the rules of the initial planner.
5. When the initial planning ends, the user tells the operator.
6. The operator closes the tab of the initial planner, as "Stop a session" says.
7. The operator starts the follow-up planner and the orchestrator, as "Start a session" says.

If a stop or a start fails, the failure cases of "Stop a session" and "Start a session" apply.

## Start a session

1. The operator runs `herdr tab create` in its shell. The folder of `--cwd` is the local clone.

   ```sh
   herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd <local clone> --label <name> --no-focus
   ```

   The operator keeps `.result.tab.tab_id` and `.result.root_pane.pane_id` of the output. If the command fails, the operator tells the user the command and the error, as [the failure rule](limits.md#the-failure-rule) says. The operator does not do step 2. No tab exists.

2. The operator runs `herdr agent start` in its shell. The command starts `claude` in the new pane.

   ```sh
   herdr agent start <name> --kind claude --pane <pane id> -- -n <name> "<prompt>"
   ```

   If the command fails, the operator tells the user the command and the error. The new tab stays open, and the operator keeps its tab id. The operator does not close the tab without the user.

The facts that follow were measured on 2026-10-24 with herdr 0.9.3 and Claude Code 2.1.310:

- Herdr sets `HERDR_WORKSPACE_ID` in each pane that it manages. As a result, the new tab opens in the workspace of the operator.
- The flag `-n` sets the session name, and the last argument is the first prompt of the session. [The seam of an agent kind](../config.md#the-seam-of-an-agent-kind) is the home of these flags.
- The herdr agent name, the session name and the name in `ListAgents` are the same.
- The new session is a top-level session, not a subagent of the operator.
- The tool `SendMessage` works in both directions, and `ListAgents` lists the session.

`--kind claude` is fixed for now.

## The start prompts

The operator puts the milestone title in place of `<milestone>`. Each prompt is the last argument of `herdr agent start`.

The initial planner:

```text
You are the planner of <milestone>. Read AGENTS.md and docs/dev/planner.md. This is the initial planning: the user works with you in this tab.
```

The follow-up planner:

```text
You are the planner of <milestone>. The initial planning is done. Read AGENTS.md and docs/dev/planner.md.
```

The orchestrator:

```text
You are the orchestrator of <milestone>. Read AGENTS.md and docs/dev/orchestrator.md, then start.
```

## Stop a session

The operator stops a session only on a request of the user. The operator closes only a tab that it opened in its own session. The tab id is the `.result.tab.tab_id` that step 1 of "Start a session" kept.

1. The operator sends "stop" to the session with the tool `SendMessage`. If `SendMessage` fails, the operator tells the user and does not do steps 2 and 3. The tab stays open.
2. The operator runs `herdr agent wait <name> --timeout 600000` in its shell.
3. If the wait ends in `idle` or `done`, the operator runs `herdr tab close <tab id>` in its shell. If `herdr tab close` fails, the operator tells the user, and the tab stays open.

If the wait fails or times out, the operator tells the user and closes nothing. If the wait ends in `blocked`, the operator follows "A blocked session" and closes nothing. Without `--until`, the wait also ends in `blocked`.

## A blocked session

- When an item arrives, and when the user asks, the operator runs `herdr agent list` in its shell. If the command fails, [the failure rule](limits.md#the-failure-rule) applies.
- A session in `blocked` waits at a permission prompt or a question prompt in its own tab. The operator tells the user the name of the session and the label of its tab.
- The operator does not answer the prompt. Only the user answers it, in that tab.
