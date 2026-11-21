# The permission model

This page gives the permission model of the actors of the orchestration. An actor is a session or a subagent that runs
commands for the orchestration. The page has one table. The table says which kind of command each actor runs. The page
also gives the place of the rules, the report chain and the facts of a measure.

The reader of this page is the orchestrator. It reads the table and the lists of
[the allowed commands](allowed-commands.md). Each actor reads its own row when a step needs it.

## Terms

- An actor is a session or a subagent that runs commands for the orchestration.
- A phase is plan, execute or review, as [the task states](../statemachine.md) give them.
- A kind of command is one of K1 to K16 in [The kinds of command](#the-kinds-of-command).
- The project file is `.claude/settings.json` of the repo.
- The user file is `$HOME/.claude/settings.json`.
- A user-level file is a file as [Terms](question-pane.md#terms) of the question-pane page defines it.
- A denial and a check failure are as [the tool-block rule](tasker-commands.md#the-tool-block-rule) defines them.

A cell of the table has one of three values:

- "runs": the list of the actor for that kind holds a command that runs with no word of the user.
- "asks the user": each command of the list for that kind runs only after a word of the user for that call.
- "never runs": the actor has no list for that kind.

## The kinds of command

- K1: a read-only `tasker` command, as [the orchestrator-command rule](tasker-commands.md#the-orchestrator-command-rule)
  defines it.
- K2: a task change, as the same rule defines it.
- K3: a `git` read.
- K4: a `git` write. A `git fetch` counts here, because it changes the refs of the clone.
- K5: a `gh` read.
- K6: a write of the text of an issue or a comment.
- K7: a write of the metadata of an issue.
- K8: a `herdr` read.
- K9: a `herdr` command that acts on another pane.
- K10: a message to another session.
- K11: the start of a subagent with the Agent tool.
- K12: a write of a file in the folder of the actor.
- K13: a write of a user-level file.
- K14: a write of a tracked file.
- K15: a read of a credential file or of a file under `$HOME/.claude/`.
- K16: each other command. K16 covers a command that no list of the actor names. For an actor that gets a list, its cell
  says "never runs". The sessions of tasker get no list, so their K16 cell follows
  [The limits of each role](assistants.md#the-limits-of-each-role).

## The table

Each cell of an orchestration actor follows its list in [the allowed commands](allowed-commands.md). This table copies
no list. The cells of the three sessions of tasker follow
[The limits of each role](assistants.md#the-limits-of-each-role),
[The environment of the shell](assistants.md#the-environment-of-the-shell) and
[The limits of the roles](assistants.md#the-limits-of-the-roles). A call that the plan mode, a deny rule, the hook, the
sandbox or the missing GitHub token and ssh agent blocks says "never runs". A `git push` never runs in these three rows,
because of the deny rule. Each other call says "runs". For K16, the three sessions run the commands that these limits
allow, for example the tests and the npm scripts of the execute session in its worktree. These rows change no limit.

| Actor                                  | K1         | K2            | K3         | K4         | K5         | K6         | K7         | K8         | K9         | K10        | K11        | K12        | K13        | K14        | K15        | K16        | Where the rules live                                                                                                                                                                                                                                                                                               | Gets the report of a denial                                     |
| -------------------------------------- | ---------- | ------------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| The orchestrator                       | runs       | asks the user | runs       | runs       | runs       | runs       | runs       | runs       | runs       | runs       | runs       | runs       | never runs | never runs | never runs | never runs | Docs only. [List](allowed-commands.md#the-orchestrator)                                                                                                                                                                                                                                                            | The user, in its question pane                                  |
| A task subagent for a whole ticket     | runs       | runs          | runs       | runs       | runs       | runs       | never runs | never runs | never runs | never runs | never runs | runs       | never runs | runs       | never runs | never runs | Docs only. [List](allowed-commands.md#a-task-subagent-for-a-whole-ticket)                                                                                                                                                                                                                                          | The orchestrator                                                |
| A task subagent for one task change    | never runs | runs          | never runs | never runs | never runs | never runs | never runs | never runs | never runs | never runs | never runs | never runs | never runs | never runs | never runs | never runs | Docs only. [List](allowed-commands.md#a-task-subagent-for-one-task-change)                                                                                                                                                                                                                                         | The orchestrator                                                |
| The planner subagent                   | never runs | never runs    | never runs | never runs | never runs | never runs | never runs | never runs | never runs | never runs | runs       | never runs | never runs | never runs | never runs | never runs | Docs only. [List](allowed-commands.md#the-planner-subagent)                                                                                                                                                                                                                                                        | The orchestrator                                                |
| The issue-draft subagent               | never runs | never runs    | runs       | runs       | never runs | never runs | never runs | never runs | never runs | never runs | never runs | runs       | never runs | never runs | never runs | never runs | Docs only. [List](allowed-commands.md#the-issue-draft-subagent)                                                                                                                                                                                                                                                    | The planner subagent                                            |
| The issue-review subagent              | never runs | never runs    | runs       | never runs | runs       | never runs | never runs | never runs | never runs | never runs | never runs | never runs | never runs | never runs | never runs | never runs | Docs only. [List](allowed-commands.md#the-issue-review-subagent)                                                                                                                                                                                                                                                   | The planner subagent                                            |
| The issue-post subagent                | never runs | never runs    | never runs | never runs | runs       | runs       | runs       | never runs | never runs | never runs | never runs | runs       | never runs | never runs | never runs | never runs | Docs only. [List](allowed-commands.md#the-issue-post-subagent)                                                                                                                                                                                                                                                     | The planner subagent                                            |
| The write subagent of the orchestrator | never runs | never runs    | never runs | never runs | runs       | never runs | runs       | never runs | never runs | never runs | never runs | runs       | runs       | never runs | never runs | never runs | Docs only. [List](allowed-commands.md#the-write-subagent-of-the-orchestrator)                                                                                                                                                                                                                                      | The orchestrator                                                |
| The opener subagent                    | runs       | never runs    | runs       | runs       | never runs | never runs | never runs | runs       | runs       | never runs | never runs | never runs | never runs | never runs | never runs | never runs | Docs only. [List](allowed-commands.md#the-opener-subagent)                                                                                                                                                                                                                                                         | The orchestrator                                                |
| The reuse subagent                     | never runs | never runs    | runs       | runs       | never runs | never runs | never runs | runs       | runs       | never runs | never runs | never runs | never runs | never runs | never runs | never runs | Docs only. [List](allowed-commands.md#the-reuse-subagent)                                                                                                                                                                                                                                                          | The orchestrator                                                |
| A question session                     | runs       | never runs    | runs       | runs       | runs       | never runs | never runs | never runs | runs       | runs       | never runs | never runs | never runs | never runs | never runs | never runs | Docs only. [List](allowed-commands.md#a-question-session)                                                                                                                                                                                                                                                          | The orchestrator, as its pane owner                             |
| The plan session of tasker             | never runs | never runs    | runs       | runs       | never runs | never runs | never runs | never runs | never runs | never runs | runs       | runs       | never runs | runs       | runs       | runs       | Code of tasker, [The plan and review roles](assistants.md#the-plan-and-review-roles), [The limits of the plan and review roles](assistants.md#the-limits-of-the-plan-and-review-roles) of `pi` and [The limits of the execute role](assistants.md#the-limits-of-the-execute-role) of `codex`. Kind `pi`: docs only | The task subagent that started the run, in the output of tasker |
| The execute session of tasker          | never runs | never runs    | runs       | runs       | never runs | never runs | never runs | never runs | never runs | never runs | runs       | runs       | never runs | runs       | runs       | runs       | Code of tasker, [The execute role](assistants.md#the-execute-role), [The limits of the execute role](assistants.md#the-limits-of-the-execute-role) of `codex` and [The limits of the execute role](assistants.md#the-limits-of-the-execute-role-1) of `pi`. Kind `pi`: docs only                                   | The task subagent that started the run, in the output of tasker |
| The review session of tasker           | never runs | never runs    | runs       | runs       | never runs | never runs | never runs | never runs | never runs | never runs | runs       | runs       | never runs | runs       | runs       | runs       | Code of tasker, [The plan and review roles](assistants.md#the-plan-and-review-roles), [The limits of the plan and review roles](assistants.md#the-limits-of-the-plan-and-review-roles) of `pi` and [The limits of the execute role](assistants.md#the-limits-of-the-execute-role) of `codex`. Kind `pi`: docs only | The task subagent that started the run, in the output of tasker |

Notes on the three session rows. Each cell comes from a statement of `assistants.md`.

- K1 and K2 never run, because the read deny list names the configuration of tasker, so a `tasker` command that reads it
  cannot run in the shell. `assistants.md` gives no statement for a `tasker` command that reads no configuration.
- K3 runs, because no limit blocks a read in the worktree.
- K4 runs, because the shell writes in its write paths and git data changes through `git` commands in the shell. A
  `git push` never runs under `claude-code`, because of the deny rule for the plan and review roles. The shell has no
  ssh agent and no GitHub token, so a push cannot log in.
- K5, K6 and K7 never run, because the shell has no GitHub token.
- K8 and K9 never run, because the deny rule of `herdr` (plan and review) and the sandbox (execute) stop `herdr`.
- K10 never runs, because the message path between sessions is the `herdr` path, which these limits stop.
- K11 runs. The allow list of the execute role holds `Agent` and `Task`. `assistants.md` gives no statement for K11 in
  the plan and review roles, so the rule of the cell definitions gives "runs".
- K12 runs, because the shell writes in the write paths of the sandbox, and the plan mode lets the assistant write its
  plan file.
- K13 never runs, because a user-level file is outside the write paths of the sandbox.
- K14 runs. The plan mode does not block a shell command that writes, and the sandbox lets the shell write in the
  worktree. The execute role also has `Edit` and `Write` in the worktree.
- K15 runs. The read deny list blocks the credential files only. It names no folder `$HOME/.claude/`, and the assistant
  can read files that the lists do not name.
- K16 runs, because the shell runs other commands that the sandbox allows, for example the tests and the npm scripts of
  the execute session.

## The place of the rules

Each rule of an orchestration actor is "docs only". The classifier of auto mode decides each call that no rule of Claude
Code matches. The rules of the parent session reach a subagent of the Agent tool, with no flag of the subagent, as
[the measured facts](#measured-facts) show. A session of the kind `pi` gets only the docs, because its shell runs with
the rights of the user. See [The seam of an agent kind](../config.md#the-seam-of-an-agent-kind).

The ask rules of [Claude Code](setup.md#claude-code) live in the user file. They reach each actor, because the rules of
the parent reach a subagent, as [the measured facts](#measured-facts) show. The words "asks the user" for `tasker abort`
and `tasker update-branch` with `--undo` come from these ask rules. An ask rule adds a prompt to a command. It adds no
command to a list. So `tasker approve-credits` and the force forms of `git push` never run for an actor whose list does
not name them.

No row of the table says that a tool enforces a rule. A later ticket can add a `PreToolUse` hook for one actor at a
time. The measured facts give its start.

## The report chain

Each actor reports a denial to its starter. The starter sends the report on, up to the orchestrator. The orchestrator
brings the denial to the user in its question pane. [The tool-block rule](tasker-commands.md#the-tool-block-rule) gives
the steps.

## A change of the rules

A change of the user file changes the row of each session that reads the file. A request for a permission rule of an
actor in the user file becomes a request for a new issue. No write subagent starts. See
[The actor of each write action](question-pane.md#the-actor-of-each-write-action).

A change of the project file goes through an issue and [the tracked-change rule](rules.md#changes). It waits for the
safe way of #957. The reason, in the words of the user: ".claude/settings.json needs to be reserved for development of
tasker. On the other hand, orchestrator, including its settings, will be a feature of tasker. So we need to keep that
separation as best we can."

## Measured facts

A task subagent ran a measure on 2026-11-20 with `claude` 2.1.330. It ran two `claude -p` runs. Run 1 used
`--permission-mode default`. Run 2 differs only in `--permission-mode auto`. This is the command of run 1:

```
claude -p --model sonnet --effort low --max-budget-usd 0.5 --permission-mode default --permission-prompts none --no-session-persistence --settings <settings file> --agents <agents file> --output-format stream-json --verbose --forward-subagent-text "Start the subagent probe with the Agent tool. It runs these three commands one by one with its Bash tool: echo ALPHA, then echo BETA, then echo GAMMA. Then it tries to write the file w.txt with the text hi. Report each result in one line."
```

The settings file had these rules and hooks. The command of each hook is a small script that appends its stdin JSON to a
log file:

```json
{
  "permissions": {
    "allow": ["Bash(echo ALPHA*)"],
    "deny": ["Bash(echo BETA*)"]
  },
  "hooks": {
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "<script that appends stdin to a log>" }] }],
    "PermissionRequest": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "<same script>" }] }]
  }
}
```

The agents file, the value of `--agents`, had one subagent:

```json
{
  "probe": {
    "description": "Runs the shell commands that the parent gives it and reports each result.",
    "prompt": "You run the shell commands that the parent gives you, one by one, with the Bash tool. Report the exact result or the exact denial of each command. If you have no tool for a step, say so.",
    "tools": ["Bash"]
  }
}
```

The facts:

- The rules of the parent reached a subagent of the Agent tool, with no flag of its own. In both modes, `echo ALPHA` ran
  and `echo BETA` was denied in the subagent.
- A `PreToolUse` hook saw `agent_type` ("probe") and `agent_id` for each call of the subagent, in both modes. The call
  of the parent to the Agent tool had no `agent_type`.
- In auto mode, a shell write (`echo hi > w.txt`) ran with no denial. The `PermissionRequest` hook did not run, and a
  `PreToolUse` hook saw the call. In default mode, the same call needed approval, the `PermissionRequest` hook ran, and
  the call was denied. So a `PermissionRequest` hook misses calls that auto mode allows. A hook for choice C must be a
  `PreToolUse` hook.
- Not shown: whether a `tools` list of a subagent removes a tool. The probe wrote the file with a Bash redirect and made
  no Write call.
- Not measured: that a failure of a hook denies the call.
- `echo GAMMA` was meant as a call with no rule. It ran with no prompt in both modes, so it proves nothing.
- Cost: `total_cost_usd` was 0.107 and 0.104, about 0.21 USD at the API price. The share of the quota of the user is not
  measured.

So these facts need no further measure, as [the place of the rules](#the-place-of-the-rules) says.
