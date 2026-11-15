# pi session measures

This page records the measures of a pi session in interactive mode in a herdr pane, with their limits. A help entry
shows an interface. It does not prove that a session can use it. [docs/dev/codex-sessions.md](codex-sessions.md) records
the session measures of Codex.

All the measures ran on 2026-11-15 with herdr 0.9.3 and pi 1.1.0. A task subagent made the tabs and started the test
sessions. The test sessions used the model `openrouter/deepseek/deepseek-v4.1-flash`. The sender is the test session
that closes itself. The recipient is the test session that gets its message. The replacement is a second test session
with the name of the sender.

## The start and the send

The reads before the trace gave these results:

- `herdr --version` printed `herdr 0.9.3`. `pi --version` printed `1.1.0`.
- `herdr agent start --help` listed `pi` as a value of `--kind`. Its usage line was
  `herdr agent start <NAME> --kind <KIND> --pane <ID> [OPTIONS] [-- [AGENT_ARG]...]`. It said that `--pane` takes an
  existing pane at an interactive shell prompt. It gave `--timeout` a default of 30000 and a maximum of 300000
  milliseconds.
- `herdr agent prompt --help` gave `herdr agent prompt <TARGET> <TEXT> [OPTIONS]` with the options `--wait`,
  `--until <STATUS>` and `--timeout <MS>`. It did not name the kind of target, a herdr agent name or a pane id. It said
  that an agent that is already blocked rejects the prompt with `agent_blocked`. It said that `--wait` does not track
  turns.

The help lists no flag that returns without a wait, because `--wait` is an opt-in flag. The send command used no flag.
No one tested how `herdr agent prompt` acts on a busy target.

The start command of a test session was:

```sh
herdr agent start <name> --kind pi --pane <pane id> --timeout 120000 -- --no-approve --no-mcp --tools bash --provider openrouter --model openrouter/deepseek/deepseek-v4.1-flash --session-dir <scratch>/sessions --session-id <native id> '<prompt>'
```

`<scratch>` is a new folder inside the folder of the task subagent. Each test session ran in a new tab with one pane,
that `herdr tab create` made with the flags `--workspace`, `--cwd`, `--label` and `--no-focus`. The send command was
`herdr agent prompt <pane id> "<text>"`. A test session ran it in its own shell, with no other flag. The target was a
pane id.

The test sessions had these ids:

| Session     | Herdr agent name | Native id             | Pane    | Tab     | Workspace | `agent_session` value of `herdr agent list`                                                                       |
| ----------- | ---------------- | --------------------- | ------- | ------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| Recipient   | `measure-b-pi`   | `b-80b739e214449b56`  | `wR:pF` | `wR:t8` | `wR`      | A path, `<scratch>/sessions/2026-11-15T18-23-14-242Z_b-80b739e214449b56.jsonl`. It is not equal to the native id. |
| Sender      | `measure-a-pi`   | `a-80b739e214449b56`  | `wR:pG` | `wR:t9` | `wR`      | A path, `<scratch>/sessions/2026-11-15T18-23-58-406Z_a-80b739e214449b56.jsonl`. It is not equal to the native id. |
| Replacement | `measure-a-pi`   | `a2-80b739e214449b56` | None    | None    | None      | The replacement did not start.                                                                                    |

The start and the send gave these results:

- The start of the recipient returned `agent_started`, with `interactive_ready` true and the agent status `done`. pi
  took the flags and the prompt as its last argument. It showed no prompt of trust and no question before a tool call.
- The start of the sender failed after 120 seconds with
  `{"code":"timeout","message":"timed out waiting for agent startup"}`. pi ran during the wait. Its record was made at
  18:23:58Z, and its first tool call ran at 18:24:01Z. No one measured the cause of the timeout.
- The send of the DELEGATION message went to the pane of the recipient, with the agent status `done`. It exited with 0
  and gave the result type `agent_prompted`. The record of the recipient holds the message as a user line at
  18:24:03.032Z. The recipient then started a turn.
- The send of the RECEIPT message to the pane `wR:pG` of the sender failed two times. The first failure was at
  18:24:04.863Z and the second at 18:24:07.452Z. Each exited with 1 and gave
  `{"error":{"code":"agent_not_ready","message":"agent wR:pG is not an active named agent"},"id":"cli:agent:prompt"}`.
- Between the two failures, `herdr agent list` gave the row
  `{"name":"measure-a-pi","pane_id":"wR:pG","tab_id":"wR:t9","agent_status":"working"}`. So herdr listed the sender by
  name and refused a send to its pane id.
- The start command of the sender still waited at that time. It returned its timeout error at 18:25:58Z. No one measured
  whether this wait caused the refusal.

## Own-session closure

The table gives one row for each measure. The sender never ran its close command, because the RECEIPT message did not
reach it.

| Measure                              | Result                                         | Exact call or surface                                                                                                                                                                                  | Observed output                                                                                                                                                                                                                                                                                                                                                                                                                   | Version and date                  | Limit                                                                                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The own-session closure              | Tab: `not measured`<br>Process: `not measured` | The last tool call of the sender, `herdr tab close wR:t9`, did not run. Then `herdr tab get wR:t9`, `herdr pane get wR:pG`, `herdr agent get wR:pG` and `ps -o pid=,comm= -p 532508` ran at 18:31:15Z. | The sender never reached step 5 of its prompt. All four reads showed a living session: `herdr tab get` gave exit 0 and status `working`, `herdr pane get` and `herdr agent get` gave exit 0, and `ps` gave `532508 pi`. Then the task subagent closed the tab in the cleanup. After that, `herdr tab get wR:t9` gave `tab_not_found` and exit 1, and `ps` gave no output and exit 1. This is no closure of the session by itself. | pi 1.1.0, herdr 0.9.3, 2026-11-15 | The step did not happen within 5 minutes after its trigger, so the task subagent stopped the run. The close was not tested. The pid `532508` has the `comm` value `pi`, so it counts as the process of the session. A tab with more than one pane did not run. |
| The binding of a session to its pane | `measured match`                               | The environment of the sender, `herdr pane current --current` and the row of `herdr agent list` with the name `measure-a-pi`, in step 1 of its prompt.                                                 | The environment gave `wR:pG`, `wR:t9` and `wR`. `herdr pane current --current` gave the pane `wR:pG` and the tab `wR:t9`. The row of `herdr agent list` gave `pane_id` `wR:pG`, `tab_id` `wR:t9` and the `agent_session` path of the sender.                                                                                                                                                                                      | pi 1.1.0, herdr 0.9.3, 2026-11-15 | This covers only a session that herdr started in a new pane. The `agent_session` value is a path, not the native id. The start command of the sender had returned a timeout error.                                                                             |
| The survival of a final report       | `not measured`                                 | `grep -F 'FINAL 80B739E214449B56'` on the one record of the sender, `sessions/2026-11-15T18-23-58-406Z_a-80b739e214449b56.jsonl`.                                                                      | The search found no line, with exit code 1. The sender never wrote the final report, because it still waited for the RECEIPT message.                                                                                                                                                                                                                                                                                             | pi 1.1.0, herdr 0.9.3, 2026-11-15 | The sender did not close, so the search did not test a report after a closure. The survival of the record of a closed pi session is not known.                                                                                                                 |
| The observer read                    | `not measured`                                 | The observer command of the recipient, step 4 of its prompt, with the pane `wR:pG`, the tab `wR:t9` and the pid `532508`.                                                                              | The 10 reads of `herdr pane get wR:pG` gave exit 0, from 18:24:12Z to 18:25:52Z. `herdr tab get wR:t9` gave exit 0 and `ps` gave `532508 pi`. No read gave `pane_not_found`.                                                                                                                                                                                                                                                      | pi 1.1.0, herdr 0.9.3, 2026-11-15 | The sender did not close, so no read saw a closure. The reads show only that the observer command works on a living session.                                                                                                                                   |
| The receipt                          | `measured match`                               | `herdr agent prompt wR:pF "DELEGATION 80b739e214449b56 from measure-a-pi id a-80b739e214449b56 pane wR:pG tab wR:t9 pid 532508"` from the sender. Then the RECEIPT message of the recipient.           | The send result was `agent_prompted` with exit 0. The record of the recipient holds the received message as a user line at 18:24:03.032Z. The reply `herdr agent prompt wR:pG "RECEIPT 80b739e214449b56"` failed two times with `agent_not_ready` and exit 1, at 18:24:04.863Z and 18:24:07.452Z.                                                                                                                                 | pi 1.1.0, herdr 0.9.3, 2026-11-15 | The match covers only the DELEGATION message. The reply did not reach the sender, so the round trip did not match. The sender still worked at the time of each failure. No one measured how pi acts on input during a turn.                                    |
| The replacement check                | `not measured`                                 | None.                                                                                                                                                                                                  | The replacement did not start, because the sender did not close.                                                                                                                                                                                                                                                                                                                                                                  | pi 1.1.0, herdr 0.9.3, 2026-11-15 | No test session with the name `measure-a-pi` started after a closure. The name rule of `herdr agent start` and the target of a PING message are not known.                                                                                                     |

## Not measured and unresolved

- The tab part of the own-session closure is `not measured`. The sender did not run `herdr tab close`.
- The process part of the own-session closure is `not measured`. The pid `532508` was alive at 18:31:15Z, and it ended
  with the tab at the cleanup.
- The survival of a final report is `not measured`. The sender never wrote `FINAL 80B739E214449B56`.
- The observer read is `not measured`. No read of the observer command saw a closed pane.
- The replacement check is `not measured`. The replacement did not start.
- The reply RECEIPT of the recipient did not reach the sender. Two sends by pane id failed with `agent_not_ready` while
  herdr listed the sender by name as `working`.
- The cause of the timeout of `herdr agent start` for the sender is not known, although pi ran. The cause of the refusal
  `agent_not_ready` is not known.
- A send by herdr agent name did not run. The help of `herdr agent prompt` does not say that the target can be a name.
- A send to a session that waits at a prompt of pi did not run. A tab with two panes did not run. pi showed no prompt of
  trust and no question before a tool call in this run.
- The model of the trace was one model of one upstream. The files that pi wrote in its agent folder were not read.
