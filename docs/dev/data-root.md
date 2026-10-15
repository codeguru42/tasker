# Data root and task store

tasker keeps all of its data under one folder, the `dataRoot` of the configuration.

## Folders

tasker makes each folder that is missing. It does not remove or change anything that exists, so a second start on the same `dataRoot` is safe.

| Path | Content |
| --- | --- |
| `<dataRoot>/clones/` | The folders of each repo: the bare clone, the publish tokens and the worktrees. |
| `<dataRoot>/clones/<slug>/bare-repo` | The bare clone of one repo. The name must not end in `.git`. [version-control.md](version-control.md#sandbox-write-paths) gives the reason. |
| `<dataRoot>/clones/<slug>/bare-repo.incomplete` | The marker of a clone that is not complete. Provision writes it before `git init` and removes it after the first fetch of a fresh clone. If a later step fails, the marker stays, and the next provision deletes the clone folder and makes the clone again. |
| `<dataRoot>/clones/<slug>/bare-repo/tasker-ssh.config` | The include file with the ssh command (`core.sshCommand`). Provision writes it, and `include.path` links it. See [docs/dev/version-control.md](version-control.md#provision). |
| `<dataRoot>/clones/<slug>/publish-tokens/` | The publish tokens of one repo. |
| `<dataRoot>/clones/<slug>/worktrees/` | The worktrees of the tasks of one repo. |
| `<dataRoot>/clones/<slug>/worktrees/<shortRef>/` | The worktree of one task. |
| `<dataRoot>/artifacts/` | The files that tasks produce. |
| `<dataRoot>/artifacts/<issue slug>/attempt-<N>/` | The files of one attempt of a task. The issue slug comes from the issue key. |
| `<dataRoot>/artifacts/<issue slug>/attempt-<N>/plans/` | The plan files of one attempt. |
| `<dataRoot>/artifacts/<issue slug>/attempt-<N>/plans/v<N>.md` | The plan text of revision N, a copy of the plan for people. |
| `<dataRoot>/artifacts/<issue slug>/attempt-<N>/sessions/` | The folder of the assistant sessions of one attempt. |
| `<dataRoot>/artifacts/<issue slug>/attempt-<N>/transcripts/` | The transcripts of one attempt. |
| `<dataRoot>/artifacts/<issue slug>/attempt-<N>/transcripts/plan-v<N>.jsonl` | The transcript of the planning run of plan version N. It has one JSON event on each line, and tasker opens it for append. `tasker plan` and `tasker refine` write it. |
| `<dataRoot>/artifacts/<issue slug>/attempt-<N>/logs/verify-run-<number>/` | The logs of verify run `<number>` of one attempt. |
| `<dataRoot>/artifacts/<issue slug>/attempt-<N>/logs/verify-run-<number>/verify-<position>.log` | The log of the verify command at position `<position>` of the configured list, from 1. `tasker verify` writes it, and `tasker show-verify` reads it. |
| `<dataRoot>/prompts/` | The prompt archive. It is outside `artifacts/` because one prompt version serves many tasks. |
| `<dataRoot>/prompts/<version>.md` | One file for each prompt version. |
| `<dataRoot>/tasker.db` | The SQLite database of the task store. |

`<slug>` comes from the repo key. [version-control.md](version-control.md) describes the slug. The setup of the data root does not make the folders of a repo. Provision makes them. tasker never changes or deletes a file in `prompts/`.

SQLite runs in WAL mode (write-ahead log). It also makes `tasker.db-wal` and `tasker.db-shm` next to the database file. Do not delete these files while a tasker process runs.

## `tasks` table

The table has one row for each task. All times are ISO 8601 text in UTC, for example `2026-01-01T00:00:00.000Z`.

A task is active when its state is not terminal (`finished` and `cancelled`). The store allows one active task for each pair of repo and issue. A partial unique index on the active rows keeps this rule, so it holds for raw SQL too.

An issue can have many tasks over time, one for each attempt. The attempt count covers all repos.

If a database of version 3 holds two active rows for one pair, the upgrade to version 4 fails and the file stays at version 3.

## `events` table

The table is an append-only log. Each event belongs to one task. See [Writes from more than one process](#writes-from-more-than-one-process).

Two triggers make the table append-only. An `UPDATE` or a `DELETE` on `events` fails. This holds for raw SQL too, not only for the store functions. A later cleanup of old events (`retentionDays`) must drop or replace these triggers in a new schema version.

## `plan_revisions` table

The table has one row for each plan that the assistant returned for a task. A revision is one such plan. A later revision comes from the feedback of the operator on an earlier one.

These rules hold:

- No store function deletes a row. After the insert, only the approval of a row changes.
- The newest revision is the revision with the highest version.
- A task can have many approved revisions over its life. The pinned revision is the approved revision with the highest version.
- Only the newest revision can be approved. The approve and the clear of an approval share one transaction with the state move and the event, so a refused move leaves no approval behind.
- The insert of a revision shares one transaction with its `plan_revision` event and the state move, so a refused move leaves no row behind.
- A question is resolved when the next revision has no question with the same id. The answer is the feedback of that next revision. A question of the newest revision is open.

The table has no check on the source of a revision, because later tickets add sources.

### Plan files

Each revision keeps its own file, so a later revision never overwrites an earlier plan. The row is the record. The file is a copy of the plan text for people to open in an editor.

tasker writes the file before it adds the row. As a result, each row has its file. A file with no row comes only from a run that stopped between the two writes. The next run replaces that file. This is safe because the caller holds the task lock, and the next version is always one more than the highest row.

tasker never changes or deletes the file of a revision that has a row.

## `sessions` table

The table has one row for each assistant session of a task. A session is one conversation of the assistant. A session has the role plan or the role execute.

tasker writes the record before the run. [assistants.md](assistants.md#the-session-id) gives the reason. A continued session reads its provider, model and effort from the record. [assistants.md](assistants.md#new-and-continued-sessions) gives the reason.

These rules hold:

- The record is written once. A second record with the same id writes nothing, also when the model or the effort differ. A second record with another id is an error that names both ids. A second id hides the conversation that the task must continue.
- A task has one plan session at most.
- A task has one execute session at most for each version of its plan. The execute runs of the pinned revision work in that session.
- The version is the key of an execute session. A refine after an approval gives a new version, so a new plan never continues the session of an old plan.
- The limit of this key: when the operator runs `tasker unapprove` and then approves the same version again, the execute runs continue the session of that version.
- Only `tasker retry` deletes a session row. A run that failed before its first turn recorded an id that no conversation holds. The next run must not continue that id, so the retry deletes the row, and the next run records a new id.

## `execute_todos` table

The table holds the state of each todo of a plan revision. A todo is one step of the plan. `tasker execute` works on one todo in each turn of the execute session.

The states are in a table and not in events, because tasker reads them back to pick the next turn. A todo is in progress or done. A todo with no row is not started, so the table stores only the two other states. Only `tasker execute` writes a state, one turn at a time.

## `execute_fix_turns` table

The table holds the fix turn of a plan revision. A fix turn is one more turn of the execute session after each todo is done. It gives the assistant the error of a failed verify run. `tasker retry --resume-execute` queues it, and `tasker execute` runs it.

These rules hold:

- A revision has one fix turn at most. A new fix turn replaces the old one, also when the old one is done.
- A row with no done time is a queued fix turn.
- The row holds the last lines of the log of the failed verify command. The sandbox of the run cannot read the data root, so the lines must travel in the row.

## `verify_runs` table

The table has one row for each verify run of a task. [phases.md](phases.md#the-verify-phase) defines a verify run and the failing command of a run.

These rules hold:

- The runs of a task are numbered from 1. The number of a new run is the highest number of the task plus one. Another number is an error.
- The insert of a run shares one transaction with its `verify_run` event and the state move, so a refused move leaves no row behind.
- The row holds the commands that the run started, in order. A run that started no command holds an empty list.
- The row holds the position of the failing command of the run, from 1. A run with no failing command holds none. The position can be one more than the number of started commands. This happens when the deadline came before the failing command started. Then that command is not in the list of started commands, and it has no log. [phases.md](phases.md#the-verify-phase) gives the deadline rule.

The result of a run is one of these values:

| Result | Meaning |
| --- | --- |
| `passed` | Every command exited with 0, and the worktree was clean before and after. |
| `failed` | A command exited with another code, stopped by a signal, or could not start. |
| `timed_out` | The deadline came. |
| `dirty_before` | The worktree had uncommitted changes before the first command, so no command ran. |
| `dirty_after` | The commands passed but left uncommitted changes. |

`tasker verify` decides which result a run gets. The store only keeps it. The table refuses a result outside this list.

The table does not store the paths of the logs. The paths derive from the run number and the position of a command, so the store does not hold them.

## `default_base_branches` table

The table holds the learned default base branch of each repo.

A forget deletes the row only when it still holds the branch that tasker found missing. A value that another process saved in the meantime stays.

[workspaces.md](workspaces.md#learned-default) says when tasker writes or deletes the row.

## `locks` table

The table holds the named locks. A named lock stops two tasker processes from changing the same thing at the same time. For example, two `tasker start` runs in one repo both write the configuration of the bare clone, and git then fails with a held `config.lock`.

There are two kinds of lock: one lock for the bare clone of a repo, and one lock for a task. Each change to the bare clone of a repo (provision, fetch, worktree add and remove, branch delete) must hold the lock of that clone. Each command that changes a task must hold the lock of that task. The two kinds are separate, so two tasks of one repo wait for each other only while one of them changes the clone.

One process never takes the same lock two times. A second try is an error, not a wait.

A crash leaves the row of the lock. The next try finds that the process of the row is dead, and it takes the lock.

The check of the process works only on one machine. A `dataRoot` on a network drive that two machines share is not supported.

## `run_markers` table

The table holds the run marker of a task in a spawning state. A spawning state is a state in which tasker runs a process for the task. The marker records the tasker process that runs the task, so that tasker can find a run that died. A task has one marker at most.

The tasker process decides if a run is alive, not the child. Tasker owns the run and records its end. A child with no tasker has no one to record its end. So a run is dead when tasker is gone, also when the child still runs. The marker keeps the pid of the child, so that a later command can stop a child that still runs.

The move into a spawning state and the write of the marker happen in one transaction. With two separate writes, a crash between them leaves a spawning state with no marker, or a marker of a state that the task left. The move out of a spawning state and the delete of the marker share a transaction for the same reason. The read of the run status holds the write lock too. So the end of a run in another process cannot come between the read and the check of the process, and a run that ended in the correct way never looks dead.

These rules hold:

- A move into a spawning state is an error when the task has a marker. This holds also when the process of the marker is dead.
- When the child starts, the caller must add the pid of the child to the marker. Only the process that wrote the marker can add it.
- Each move to a state that is not spawning deletes the marker of any process, also a move to failed and an abort. A missing marker is not an error.

The marker uses the same check of a process as the [locks](#locks-table), so the limit of the locks applies.

## Schema versions

Version N means that the first N migrations ran. SQLite keeps N in `PRAGMA user_version`.

The store runs the migrations that are missing in one transaction. If one fails, the transaction rolls back and the version does not change.

If the file has a newer version than tasker knows, tasker refuses it and does not change the file.

To add a version, append one migration. Never edit a migration that exists, because databases that already ran it do not run it again.

## Writes from more than one process

Two tasker processes can use the same database at once. A busy timeout makes a process that finds the database locked wait and not fail at once. SQLite has one case that does not use it. On a new file, the switch to WAL upgrades a read lock to a write lock, and SQLite does not wait for that upgrade. As a result, the store tries the switch again until the busy timeout ends. WAL lets readers work while the writer writes.

Each write, and each migration, runs in a `BEGIN IMMEDIATE` transaction, which takes the write lock at the start. As a result, a read-check-write of a row is one step, and another process cannot change the row in between. Two processes that open a new database at the same time do not both run the same migration.

The store writes each event in the same transaction as its row change: the `created` event with the new task row, and the `transition` event with the state change. The state machine checks the edge inside the same transaction as the write. As a result, the read, the write of the state and the event happen in one step.
