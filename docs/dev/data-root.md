# Data root and task store

tasker keeps all of its data under one folder, the `dataRoot` of the configuration.

## Folders

tasker makes each folder that is missing. It does not remove or change anything that exists, so a second start on the same `dataRoot` is safe.

| Path | Content |
| --- | --- |
| `<dataRoot>/clones/` | The folders of each repo: the bare clone, the publish tokens and the worktrees. |
| `<dataRoot>/clones/<slug>/repo.git` | The bare clone of one repo. |
| `<dataRoot>/clones/<slug>/repo.git.incomplete` | The marker of a clone that is not complete. Provision writes it before `git init` and removes it after the first fetch of a fresh clone. If a later step fails, the marker stays, and the next provision deletes the clone folder and makes the clone again. |
| `<dataRoot>/clones/<slug>/repo.git/tasker-ssh.config` | The include file with the ssh command (`core.sshCommand`). Provision writes it, and `include.path` links it. See [docs/dev/version-control.md](version-control.md#provision). |
| `<dataRoot>/clones/<slug>/publish-tokens/` | The publish tokens of one repo. |
| `<dataRoot>/clones/<slug>/worktrees/` | The worktrees of the tasks of one repo. |
| `<dataRoot>/clones/<slug>/worktrees/<shortRef>/` | The worktree of one task. |
| `<dataRoot>/artifacts/` | The files that tasks produce. |
| `<dataRoot>/artifacts/<issue slug>/attempt-<N>/` | The files of one attempt of a task. The issue slug comes from the issue key. |
| `<dataRoot>/tasker.db` | The SQLite database of the task store. |

`<slug>` comes from the repo key. [version-control.md](version-control.md) describes the slug. The setup of the data root does not make the folders of a repo. Provision makes them.

SQLite runs in WAL mode (write-ahead log). It also makes `tasker.db-wal` and `tasker.db-shm` next to the database file. Do not delete these files while a tasker process runs.

## `tasks` table

The table has one row for each task. All times are ISO 8601 text in UTC, for example `2026-01-01T00:00:00.000Z`.

A task is active when its state is not terminal (`finished` and `cancelled`). The store allows one active task for each pair of repo and issue. A partial unique index on the active rows keeps this rule, so it holds for raw SQL too.

An issue can have many tasks over time, one for each attempt. The attempt count covers all repos.

If a database of version 3 holds two active rows for one pair, the upgrade to version 4 fails and the file stays at version 3.

## `events` table

The table is an append-only log. Each event belongs to one task. See [Writes from more than one process](#writes-from-more-than-one-process).

Two triggers make the table append-only. An `UPDATE` or a `DELETE` on `events` fails. This holds for raw SQL too, not only for the store functions. A later cleanup of old events (`retentionDays`) must drop or replace these triggers in a new schema version.

## `default_base_branches` table

The table holds the learned default base branch of each repo.

A forget deletes the row only when it still holds the branch that tasker found missing. A value that another process saved in the meantime stays.

[workspaces.md](workspaces.md#learned-default) says when tasker writes or deletes the row.

## Schema versions

Version N means that the first N migrations ran. SQLite keeps N in `PRAGMA user_version`.

The store runs the migrations that are missing in one transaction. If one fails, the transaction rolls back and the version does not change.

If the file has a newer version than tasker knows, tasker refuses it and does not change the file.

To add a version, append one migration. Never edit a migration that exists, because databases that already ran it do not run it again.

## Writes from more than one process

Two tasker processes can use the same database at once. A busy timeout makes a process that finds the database locked wait and not fail at once. WAL lets readers work while the writer writes.

Each write, and each migration, runs in a `BEGIN IMMEDIATE` transaction, which takes the write lock at the start. As a result, a read-check-write of a row is one step, and another process cannot change the row in between. Two processes that open a new database at the same time do not both run the same migration.

The state machine checks the edge inside the same transaction as the write. As a result, the read, the write of the state and the event happen in one step.
