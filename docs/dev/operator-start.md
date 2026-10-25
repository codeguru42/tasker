# Start and stop the sessions of a milestone

The operator runs each `herdr` command in its own shell, in a Bash call. See [Operator](../operator.md) and
[Sessions](../sessions.md) for the terms.

## The order of a milestone

1. The user picks the slug.
2. The user runs `tasker show-config --repo <key>` and reads `sessions.models.operator`. `<key>` is the repo key of the
   repo of the local clone, for example `codeguru42/tasker`. If the command fails, the user does not open the operator.
   Then the user opens the operator in `claude` and names it `operator-<slug>`. The user passes the model and the effort
   of `sessions.models.operator` with the flags of [the seam of an agent kind](../config.md#the-seam-of-an-agent-kind),
   for example `claude -n operator-m9 --model opus --effort high`. If `sessions.models.operator` has no entry, the user
   passes neither flag.
3. If the user tells the operator that the milestone has no initial planning, the operator does not start the initial
   planner. The operator skips steps 4 to 6 and does step 7 at once. Otherwise, when the user asks, the operator starts
   the initial planner, as "Start a session" says. An example of a milestone with no initial planning is a milestone
   that stays open and gets its issues from the follow-ups of other tickets.
4. The user works with the initial planner in its tab.
   [The initial planner and the follow-up planner](planner.md#the-initial-planner-and-the-follow-up-planner) of
   planner.md gives the rules of the initial planner.
5. When the initial planning ends, the user tells the initial planner that the initial planning ends. If the user tells
   the operator first, the operator tells `planner-<slug>` with `SendMessage`, as
   [The word of the user](operator-conversations.md#the-word-of-the-user) says. The message of the operator starts with
   "From the user:" and says that the initial planning ends. Then the operator waits for the message of the initial
   planner that the initial planning is done. This message ends the wait. While it waits, the operator continues its
   other work and does not wait in a loop, as [the answer-wait rule](limits.md#the-answer-wait-rule) says for an agent.
   If the send fails, the operator tells the user, as [the failure rule](limits.md#the-failure-rule) says. The tab of
   the initial planner stays open, and the operator still waits for the message of the initial planner.
6. The message of the initial planner is the one signal that ends the initial planning. The operator does this step only
   after this message. The word of the user to the initial planner in step 5 is the request of the user for this stop.
   Then the operator closes the tab of the initial planner, as "Stop a session" says.
7. The operator starts the follow-up planner and the orchestrator, as "Start a session" says.

If a stop or a start fails, the failure cases of "Stop a session" and "Start a session" apply.

## Start a session

1. The operator runs `tasker show-config --repo <key>` in its shell. `<key>` is the repo key of the repo of the local
   clone, for example `codeguru42/tasker`.

   ```sh
   tasker show-config --repo <key>
   ```

   The operator keeps `.sessions.kind` and the entry of `.sessions.models.<role>` of the output. `<role>` is the role of
   the new session: `planner` or `orchestrator`. If the command fails, the operator tells the user the command and the
   error, as [the failure rule](limits.md#the-failure-rule) says. The operator does not do steps 2 and 3. No tab exists,
   so no entry goes into [the tab list](../operator.md).

2. The operator runs `herdr tab create` in its shell. The folder of `--cwd` is the local clone.

   ```sh
   herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd <local clone> --label <name> --no-focus
   ```

   The operator keeps `.result.tab.tab_id` and `.result.root_pane.pane_id` of the output. If the command works, the
   operator puts the tab id and the session name into the tab list. If the command fails, the operator tells the user
   the command and the error, as [the failure rule](limits.md#the-failure-rule) says. The operator does not do step 3.
   No tab exists, so no entry goes into the tab list.

3. Before the command, the operator joins the lines of the prompt into one line, with one space between two lines. herdr
   0.9.3 refuses a prompt with a newline, with the error "agent arguments cannot be encoded safely for the target
   shell". operator-docs measured this on 2026-10-24, in the handoff of planner-docs. Then the operator runs
   `herdr agent start` in its shell. The command starts the agent of the kind in the new pane.

   ```sh
   herdr agent start <name> --kind <kind> --pane <pane id> -- -n <name> <model flags> "<prompt>"
   ```

   `<kind>` is `sessions.kind`. `<model flags>` is the model flag and the effort flag of the kind in
   [the seam of an agent kind](../config.md#the-seam-of-an-agent-kind), with the model and the effort of the entry of
   the role. If `sessions.models` has no entry for the role, the operator leaves out `<model flags>`.

   `herdr agent start` can fail while the new session still starts. The known errors are "timed out waiting for agent
   startup", and "named agent `<name>` no longer owns the target terminal" with the code `agent_name_not_found`.
   `<name>` is the name of the session.

   After one of these errors, the operator first looks for the new session in `ListAgents`, or it runs
   `herdr pane read <pane id>` in its shell. The pane id is the one that step 2 kept. If the session runs, the start
   worked. If `ListAgents` does not list the new session, or `herdr pane read` fails or shows no running session, the
   failure case that follows applies.

   operator-docs saw the timeout on 2026-10-24, in the handoff of planner-docs, and the session ran. operator-docs saw
   the error "named agent orchestrator-docs no longer owns the target terminal" (`agent_name_not_found`) on 2026-10-24,
   at the start of the new orchestrator-docs, and the session ran.

   If the command fails in another way, or the new session does not run, the operator tells the user the command and the
   error. The new tab stays open, and its entry stays in the tab list. The operator does not close the tab without the
   user. If the user closes that tab, or tells the operator to close it, the entry leaves the tab list.

The facts that follow were measured on 2026-10-24 with herdr 0.9.3 and Claude Code 2.1.310:

- Herdr sets `HERDR_WORKSPACE_ID` in each pane that it manages. As a result, the new tab opens in the workspace of the
  operator.
- The flag `-n` sets the session name, and the last argument is the first prompt of the session.
  [The seam of an agent kind](../config.md#the-seam-of-an-agent-kind) is the home of these flags.
- In the fact tests of #503 and #516, the row of a test session had the field `name`, with the herdr agent name. Each
  agent read the row soon after a `herdr agent start` that exited with 0. The row for a pane that
  `herdr pane report-agent` reported, with no `herdr agent start` in that pane, has no `name` field. The agent of #503
  measured this with herdr 0.9.3 on 2026-10-25.
- On 2026-10-25 at about 15:40 MDT, none of the 17 rows of `herdr agent list` had a `name` field. This includes the rows
  of planner-m14 and orchestrator-m14, which `herdr agent start` started. The cause of the missing field is not known.
  The start of planner-m14 and the start of orchestrator-m14 each exited with 1 and the error code `timeout`. For the
  other rows, the result of the start is not known. operator-m14 and planner-m14 measured this with herdr 0.9.3 on
  2026-10-25.
- `herdr agent start` refuses a herdr agent name that already runs. It exits with code 1 and prints the error code
  `agent_name_taken`. The agent of #503 measured this with herdr 0.9.3 on 2026-10-25.
- The new session is a top-level session, not a subagent of the operator.
- The tool `SendMessage` works in both directions, and `ListAgents` lists the session.
- The model flag and the effort flag of [the seam of an agent kind](../config.md#the-seam-of-an-agent-kind) reach the
  new session. The new session runs with the model and the effort of these flags.

## The start prompts

The operator puts the milestone title in place of `<milestone>`. Each prompt is the last argument of
`herdr agent start`.

The initial planner:

```text
You are the planner of <milestone>. Read AGENTS.md and docs/planner.md. This is the initial planning: the user works with you in this tab.
```

The follow-up planner:

```text
You are the planner of <milestone>. This is not the initial planning. Read AGENTS.md and docs/planner.md.
```

The orchestrator:

```text
You are the orchestrator of <milestone>. Read AGENTS.md and docs/orchestrator.md, then start.
```

## Stop a session

The operator stops a session only on a request of the user. In a handoff of an orchestrator or a follow-up planner, the
rule of the user of 2026-10-25 in [The end of a handoff](handoff.md#the-end-of-a-handoff) is that request, for step 4 of
[A handoff](#a-handoff). The operator closes only a tab that it opened in its own session, or a tab that an earlier
operator of its slug opened. In a handoff, the operator also stops a session in a tab that it did not open, for example
a tab that the user opened.

Outside a handoff, the operator takes the tab id of each session from [the tab list](../operator.md), also of its own
sessions. If the tab list gives no tab id for the session, the operator tells the user and closes nothing. In a handoff,
the operator takes the tab id from the row of the session.

The operator finds the pane id and the tab id in the row of the session. The row of a session is the object in
`.result.agents` of the output of `herdr agent list` whose `terminal_title_stripped` is the name of the session. The row
gives `pane_id` and `tab_id`. Before step 1, the operator runs `herdr agent list` in its shell. If the command fails,
the operator tells the user, as [the failure rule](limits.md#the-failure-rule) says, and closes nothing. If no row has
the name of the session, the operator tells the user and closes nothing.

Each time that the operator reads the row of a session, in a handoff or in each other stop, it counts the rows with the
name of the session. If more than one row has the name, the operator does not do steps 1 to 3, sends no "stop" and
closes no pane and no tab. It tells the user one time. The message names the session, and the pane id and the tab id of
each row with that name, and it gives no other items. This stop did not close the pane of the session, and the operator
sends no second message for the failed close. A close of the wrong pane stops the other session.

Outside a handoff, if the tab id of the row is not a tab id of the tab list, the operator tells the user and closes
nothing. Steps 2 and 3 use the pane id and the tab id of the row.

1. The operator sends "stop" to the session with the tool `SendMessage`, as a word of the user (see
   [The word of the user](operator-conversations.md#the-word-of-the-user)). If `SendMessage` fails, the operator tells
   the user and does not do steps 2 and 3. The tab stays open.
2. The operator runs `herdr agent wait <pane id> --timeout 600000` in its shell. `herdr agent wait <session name>` exits
   with 1 and the code `agent_not_found` for each listed session (herdr 0.9.3, measured on 2026-10-24).
3. If the wait ends in `idle` or `done`, the operator runs `herdr tab get <tab id>` in its shell. If
   `.result.tab.pane_count` is 1, the operator runs `herdr tab close <tab id>`. If `.result.tab.pane_count` is more than
   1, the operator runs `herdr pane close <pane id>`. A tab that the user opened can hold other panes of the user. If
   `herdr tab get`, `herdr tab close` or `herdr pane close` fails, the operator tells the user, and the pane stays open.
   If the close works and the tab has an entry in the tab list, the operator takes that entry out. After
   `herdr pane close`, the tab stays open.

A session at its input prompt runs no turn and is ready for the next input at its prompt, in the state `idle` or `done`.
A session in `blocked` is not such a session, and [A blocked session](#a-blocked-session) covers it. For a session at
its input prompt, the wait of step 2 ends at once, before the session reads "stop". Then the session can read "stop" in
a new turn right after the wait, or it reads nothing before the close. In both cases, the operator still does the close
of step 3 at once. It does not wait for a read of "stop", and it sends no message to the user for this case. The reason:
the turn that "stop" starts only answers the stop, so a close that cuts it loses no work. On 2026-10-25, with herdr
0.9.3 and Claude Code 2.1.310, the agent of #519 sent "stop" to a test session of its own in the state `done`.
`herdr agent wait <pane id> --timeout 600000` returned `done` at once. About 0.5 seconds later, the message started a
new turn, and the session answered the stop. On 2026-10-25, with herdr 0.9.3 and Claude Code 2.1.310, operator-docs sent
"From the user: stop" to planner-messages, which waited for the input of the user.
`herdr agent wait wB:p9 --timeout 600000` returned `idle` at once. `herdr pane read` showed "1 new message (ctrl+End)",
so the stop was still unread. Then `herdr tab close` closed the session before it read the stop.

If the wait fails or times out, the operator tells the user and closes nothing. If the wait ends in `blocked`, the
operator follows "A blocked session" and closes nothing. Without `--until`, the wait also ends in `blocked`.

After each other end of this section, the entry stays in the tab list. Examples are a failed `SendMessage`, a failed
wait, a `blocked` session and a failed `herdr tab close`.

## A handoff

The operator does these steps for each handoff of an orchestrator or a follow-up planner. This also covers a session
that the user started in a tab of the user. The old session is the orchestrator or the follow-up planner that hands off
its work. The new session takes the work, with the same name as the old session.

1. A recommendation "hand off now" of the old session arrives. This recommendation is a suggestion of a handoff, as
   [The suggestion of a handoff](handoff.md#the-suggestion-of-a-handoff) says. The operator sends the go to the session
   at once with `SendMessage`, with no question to the user. The go is a word of the operator, not a word of the user,
   so it does not start with "From the user:". The session finishes its current tasks and then does the steps of its
   handoff. If `SendMessage` fails, the operator tells the user, as [the failure rule](limits.md#the-failure-rule) says.
2. The old session sends the operator the path of its handoff file as an item. The item can also give the prompt for the
   new session.
3. The operator reads the handoff file. It takes the prompt for the new session from the code block of the file. If the
   read fails, the operator tells the user, as the failure rule says, and does not do steps 4 and 5.
4. The operator stops the old session, as [Stop a session](#stop-a-session) says.
5. The operator starts the new session, as [Start a session](#start-a-session) says. The prompt is the prompt of step 3.

If step 4 does not close the pane of the old session, the operator does not do step 5. It tells the user, as
[the failure rule](limits.md#the-failure-rule) says. In the case of more than one row, the message of
[Stop a session](#stop-a-session) is the one message. Two sessions with one name break each `SendMessage` to that name.

In a handoff, these rules stay with the user:

- Only the user answers a prompt of a session in `blocked`, as [A blocked session](#a-blocked-session) says.
- After a failed `herdr agent start`, the operator does not close the new tab without the user, as
  [Start a session](#start-a-session) says.

The table gives each change of a handoff. An empty cell means that the page gives no state for that actor. For the case
of more than one row, the row "More than one row has the name" wins over the row "A close or a start fails".

| Change                         | Old session                                                                                                                                  | Operator                                         | New session           | Who tells whom                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------- | ------------------------------------------------ |
| The recommendation arrives     | Waits for the go                                                                                                                             | Sends the go                                     |                       | The old session tells the operator               |
| The go arrives                 | Finishes its tasks, writes the handoff file                                                                                                  |                                                  |                       | The operator tells the old session               |
| The path arrives               | Waits                                                                                                                                        | Reads the handoff file                           |                       | The old session tells the operator, with an item |
| The stop                       | If it runs a turn, it reads "stop" and ends the turn. At its input prompt, it can read "stop" in a new turn or read nothing. Its pane closes | Waits for `idle` or `done`, then closes the pane |                       | The operator tells the old session "stop"        |
| The start                      |                                                                                                                                              | Starts the new session                           | Runs, from the prompt | The operator starts it with `herdr agent start`  |
| A close or a start fails       |                                                                                                                                              | Tells the user                                   |                       | The operator tells the user                      |
| More than one row has the name | Runs                                                                                                                                         | Closes nothing, tells the user                   | Not started           | The operator tells the user                      |

## A blocked session

- When an item arrives, and when the user asks, the operator runs `herdr agent list` in its shell. If the command fails,
  [the failure rule](limits.md#the-failure-rule) applies.
- A session in `blocked` waits at a permission prompt or a question prompt in its own tab. The operator tells the user
  the name of the session and the label of its tab.
- The operator does not answer the prompt. Only the user answers it, in that tab.
