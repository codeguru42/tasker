# Sessions

This page gives the terms that name the operator, and the steps with which a session reads its own name. It also gives
the sections "The start of a session by the user", "The start of a herdr session" with "The facts of a herdr start",
"The herdr agent name of a new operator", "The start gate of a pi session", "Two sessions with one name" and "A blocked
session". [The glossary](dev/GLOSSARY.md) gives the other terms that the sessions use.

The sessions of a slug are `operator-<slug>`, `planner-<slug>` and `orchestrator-<slug>`. The slug of a set scope names
only `orchestrator-<slug>`, as [The start of an orchestrator](orchestrator.md#the-start-of-an-orchestrator) says.

An item is a message from a planner or an orchestrator to the operator about something that needs the user.

## The read of the own name

The [own name](dev/GLOSSARY.md) of a session of the kind `claude` is in the first line of the output of `ListAgents`, in
the form "This session is <name>". The own session ref comes from the first line of `ListAgents`.

A pi session gets its own name from `-n <name>` at the start. Before its role work, it reads the name with
`grep -m1 '"type":"session_info"' "$PI_SESSION_FILE"` and takes the value of `"name"`. Its role and its slug come from
that name, in the form that [the glossary](dev/GLOSSARY.md) gives for the own name. The own name and the herdr agent
name relate in this way:

- A planner, an orchestrator and a session of a topic handoff have the same text for both.
- A new operator in a handoff has the herdr agent name `operator-<slug>-<time>` and the own name `operator-<slug>`.
- The first operator has no herdr agent name.

If `PI_SESSION_FILE` is not set, the read fails, or the name is not the expected form, the pi session does no role work.
It tells the user in its own tab. This holds also for the first operator. An orchestrator can have a first prompt that
names a handoff file. Then the message also gives the path of the handoff file and the way on, as
[The start checks](orchestrator.md#the-start-checks) say. The read uses the file form of pi 1.1.0 and was measured with
a bash tool. [docs/dev/pi-sessions.md](dev/pi-sessions.md) gives the limits.

## The start of a session by the user

This section gives step 2 of [The order of a milestone](dev/operator-start.md#the-order-of-a-milestone), which other
sessions also use.

2. The user runs `tasker show-config --repo <key>` and reads `sessions.models.operator`. `<key>` is the repo key of the
   repo of the local clone, for example `codeguru42/tasker`. If the command fails, the user does not open the operator.
   Then the user opens the operator in `claude` and names it `operator-<slug>`. The user passes the model and the effort
   of `sessions.models.operator` with the flags of [the seam of an agent kind](config.md#the-seam-of-an-agent-kind), for
   example `claude -n operator-m9 --model opus --effort high`. If `sessions.models.operator` has no entry, the user
   passes neither flag.

   If `sessions.kind` is `pi`, the user opens the operator with
   `pi -n operator-<slug> --provider <upstream> --model <model> --thinking <effort>`. If `sessions.models.operator` has
   no entry, the user passes only `-n operator-<slug>`. The user does the naming step with `-n`. The session reads its
   name before its role work, as [docs/sessions.md](#the-read-of-the-own-name) says. The first operator has no herdr
   agent name.

## The start of a herdr session

This section gives steps 2 and 3 of [Start a session](dev/operator-start.md#start-a-session), which other sessions also
use.

2. The operator runs `herdr tab create` in its shell. The folder of `--cwd` is the local clone.

   ```sh
   herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd <local clone> --label <name> --no-focus
   ```

   In a handoff of the operator, the operator leaves out `--no-focus`, as
   [The start of the new operator](dev/handoff-operator.md#the-start-of-the-new-operator) says.

   The operator keeps `.result.tab.tab_id` and `.result.root_pane.pane_id` of the output. If the command works, the
   operator puts the tab id and the session name into the tab list. If the command fails, the operator tells the user
   the command and the error, as [the failure rule](dev/limits.md#the-failure-rule) says. The operator does not do
   step 3. No tab exists, so no entry goes into the tab list.

3. Before the command, the operator joins the lines of the prompt into one line, with one space between two lines. herdr
   0.9.3 refuses a prompt with a newline, with the error "agent arguments cannot be encoded safely for the target
   shell". operator-docs measured this on 2026-10-24, in the handoff of planner-docs. Then the operator runs
   `herdr agent start` in its shell. The command starts the agent of the kind in the new pane.

   ```sh
   herdr agent start <name> --kind <kind> --pane <pane id> -- -n <name> <model flags> "<prompt>"
   ```

   In a handoff of the operator, the herdr agent name and the session name differ. The herdr agent name is
   `operator-<slug>-<time>`, and `-n` takes the session name `operator-<slug>`.
   [The herdr agent name of a new operator](#the-herdr-agent-name-of-a-new-operator) gives the command.

   `<kind>` is `sessions.kind`. `<model flags>` is the model flag and the effort flag of the kind in
   [the seam of an agent kind](config.md#the-seam-of-an-agent-kind), with the model and the effort of the entry of the
   role. If `sessions.models` has no entry for the role, the operator leaves out `<model flags>`. Under `pi`, the
   `<model flags>` are the pi cells of the seam. A planner and an orchestrator have the same text for the herdr agent
   name and the own name.

   `herdr agent start` can fail while the new session still starts. The known errors are "timed out waiting for agent
   startup", and "named agent `<name>` no longer owns the target terminal" with the code `agent_name_not_found`.
   `<name>` is the name of the session.

   After one of these errors, the operator first looks for the new session in `ListAgents`, or it runs
   `herdr pane read <pane id>` in its shell. The pane id is the one that step 2 kept. If the session runs, the start
   worked. If `ListAgents` does not list the new session, or `herdr pane read` fails or shows no running session, the
   failure case that follows applies. In a handoff of the operator, step 3 of "The start of the new operator" wins over
   the first sentence of this paragraph.

   For a pi session, the operator does not use `ListAgents` after one of these errors. It runs
   `herdr pane read <pane id>` in its shell. If the pane shows a running session, the gate of
   [The start gate of a pi session](#the-start-gate-of-a-pi-session) applies. Otherwise the failure case that follows
   applies.

   operator-docs saw the timeout on 2026-10-24, in the handoff of planner-docs, and the session ran. operator-docs saw
   the error "named agent orchestrator-docs no longer owns the target terminal" (`agent_name_not_found`) on 2026-10-24,
   at the start of the new orchestrator-docs, and the session ran.

   If the command fails in another way, or the new session does not run, the operator tells the user the command and the
   error. The new tab stays open, and its entry stays in the tab list. The operator does not close the tab without the
   user. If the user closes that tab, or tells the operator to close it, the entry leaves the tab list.

   If the kind is `pi` and the start returned, the operator goes on to
   [The start gate of a pi session](#the-start-gate-of-a-pi-session).

### The facts of a herdr start

The facts that follow are facts of the kind `claude`. They were measured on 2026-10-24 with herdr 0.9.3 and Claude Code
2.1.310. [docs/dev/pi-sessions.md](dev/pi-sessions.md) records the facts of the kind `pi`.

- Herdr sets `HERDR_WORKSPACE_ID` in each pane that it manages. As a result, the new tab opens in the workspace of the
  operator.
- The flag `-n` sets the session name, and the last argument is the first prompt of the session.
  [The seam of an agent kind](config.md#the-seam-of-an-agent-kind) is the home of these flags.
- In the fact tests of #503 and #516, the row of a test session had the field `name`, with the herdr agent name. Each
  task subagent read the row soon after a `herdr agent start` that exited with 0. The row for a pane that
  `herdr pane report-agent` reported, with no `herdr agent start` in that pane, has no `name` field. The task subagent
  of #503 measured this with herdr 0.9.3 on 2026-10-25.
- On 2026-10-25 at about 15:40 MDT, none of the 17 rows of `herdr agent list` had a `name` field. This includes the rows
  of planner-m14 and orchestrator-m14, which `herdr agent start` started. The cause of the missing field is not known.
  The start of planner-m14 and the start of orchestrator-m14 each exited with 1 and the error code `timeout`. For the
  other rows, the result of the start is not known. operator-m14 and planner-m14 measured this with herdr 0.9.3 on
  2026-10-25.
- `herdr agent start` refuses a herdr agent name that already runs. It exits with code 1 and prints the error code
  `agent_name_taken`. The task subagent of #503 measured this with herdr 0.9.3 on 2026-10-25.
- The new session is a top-level session, not a subagent of the operator.
- The tool `SendMessage` works in both directions, and `ListAgents` lists the session.
- The model flag and the effort flag of [the seam of an agent kind](config.md#the-seam-of-an-agent-kind) reach the new
  session. The new session runs with the model and the effort of these flags.

## The herdr agent name of a new operator

This section gives step 2 of [The start of the new operator](dev/handoff-operator.md#the-start-of-the-new-operator),
which other sessions also use.

2. The herdr agent name is `operator-<slug>-<time>`. `<time>` is the time part of the name of the handoff file, for
   example `1530`. So the command of step 3 of "Start a session" is:

   ```sh
   herdr agent start operator-<slug>-<time> --kind <kind> --pane <pane id> -- -n operator-<slug> <model flags> "<prompt>"
   ```

   The error text of that step names the herdr agent name. Under `pi`, the `<model flags>` are the pi cells of
   [the seam of an agent kind](config.md#the-seam-of-an-agent-kind).

`herdr agent start` refuses a herdr agent name that already runs. With no suffix `-<time>`, the start of the third
operator fails, because the second operator still runs.

## The start gate of a pi session

The gate applies to a pi session that the operator starts with `herdr agent start`. It makes sure that the new session
runs with the expected own name before the operator goes on. The facts are in
[docs/dev/pi-sessions.md](dev/pi-sessions.md).

- Pending: the time from `herdr agent start` until the read gives a result, or until the limit ends. The flag `-n` makes
  the name exist right after the start. So the operator starts to read as soon as `herdr agent start` returns. The state
  stays Pending after each read that gives a wait case, until a read gives Done or Failed, or until the limit ends.
- Done: the row has the new pane id, and the name in the session file equals the expected own name. Then the operator
  goes on as after a `claude` start that worked.
- Failed: any case of the list "The gate gives Failed at once", or the end of the limit while the state is Pending. The
  list "The operator reads again" does not give Failed.

The read has three steps:

1. The operator runs `herdr agent list`. It takes the row whose `pane_id` is the pane id that step 2 of "Start a
   session" kept. It does not look up the row by the herdr agent name, because the field `name` can be missing.
2. The operator runs `test -e <agent_session.value>`. If the file does not exist yet, the command exits with 1.
3. If the file exists, the operator runs `grep -m1 session_info <agent_session.value>` and takes the value of `"name"`.

The operator reads every 15 seconds, up to 300 seconds after the start returns. 300000 ms is the maximum `--timeout` of
`herdr agent start`.

The operator reads again after 15 seconds in each of these cases. The state stays Pending:

- No row of `herdr agent list` has the new pane id yet.
- The row has no `agent_session` path yet.
- The file at the `agent_session` path does not exist yet. `test -e` exits with 1.
- The file holds no `session_info` line yet. `grep` exits with 1.

The gate gives Failed at once in each of these cases:

- A command of the read fails with an error. For example, `herdr agent list` exits with an error, or the file exists and
  `grep` exits with 2.
- The file holds a name that is not the expected own name.
- The limit of 300 seconds ends while the state is still Pending.

Such a name does not change, so another read does not help.

After Failed, the operator tells the user the command and the error. The tab and its entry in the tab list stay. The
operator starts no second session and renames no other session. The user closes the tab. If the name shows up after
Failed, the state stays Failed.

In a handoff of the operator, the old and the new operator hold the same own name, and pi allows this. Only the tie to
the new pane id gives Done. The name alone is never Done.

## Two sessions with one name

This section gives a fact of [A handoff](dev/operator-start.md#a-handoff), which other sessions also use.

Two sessions with one name break each `SendMessage` to that name.

## A blocked session

This section gives the rules for a session in `blocked`, which other sessions also use.

- When an item arrives, and when the user asks, the operator runs `herdr agent list` in its shell. If the command fails,
  [the failure rule](dev/limits.md#the-failure-rule) applies.
- A session in `blocked` waits at a permission prompt or a question prompt in its own tab. The operator tells the user
  the name of the session and the label of its tab.
- The operator does not answer the prompt. Only the user answers it, in that tab.
