# Data root and task store

tasker keeps all of its data under one folder, the `dataRoot` of the configuration. The code is in `src/store/`. No command uses the store yet.

## Folders

`createDataRoot()` makes each folder that is missing. It does not remove or change anything that exists, so a second start on the same `dataRoot` is safe.

| Path | Content |
| --- | --- |
| `<dataRoot>/clones/` | Clones of the repos. |
| `<dataRoot>/worktrees/` | The worktrees of the tasks. |
| `<dataRoot>/clones/<slug>/repo.git` | The bare clone of one repo. |
| `<dataRoot>/clones/<slug>/publish-tokens/` | The publish tokens of one repo. |
| `<dataRoot>/worktrees/<slug>/` | The worktrees of the tasks of one repo. |
| `<dataRoot>/artifacts/` | The files that tasks produce. |
| `<dataRoot>/tasker.db` | The SQLite database of the task store. |

`<slug>` comes from the repo key. `repoPaths()` gives these paths, and [version-control.md](version-control.md) describes the slug. `createDataRoot()` does not make the folders of a repo.

SQLite runs in WAL mode (write-ahead log). It also makes `tasker.db-wal` and `tasker.db-shm` next to the database file. Do not delete these files while a tasker process runs.

## `tasks` table

The table has one row for each task. All times are ISO 8601 text in UTC, for example `2026-01-01T00:00:00.000Z`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer | Primary key. |
| `issue_key` | text | Required. The issue of the task. |
| `repo_key` | text | Required. The key of the repo in the configuration. |
| `state` | text | Required. The state of the task. See [the state machine](../statemachine.md). The store does not check the value. |
| `branch` | text | Optional. The branch of the task. |
| `worktree_path` | text | Optional. The worktree of the task. |
| `created_at` | text | Required. The time that `createTask()` ran. |
| `updated_at` | text | Required. The time of the last change. |

The pair of `repo_key` and `issue_key` is not unique. A user can start the same issue again after a task ends, so one issue can have more than one row. The index `tasks_repo_issue` on these two columns speeds up lookups. It does not enforce a rule.

## `events` table

The table is an append-only log. Each event belongs to one task.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer | Primary key. It grows with each event and tasker never reuses it. |
| `task_id` | integer | Required. A foreign key to `tasks(id)`. |
| `at` | text | Required. The time of the event, in ISO 8601 UTC. |
| `type` | text | Required. The kind of event. |
| `data` | text | Optional. JSON text. The value is `NULL` when the event has no data. |

The index `events_task_id` on `task_id` and `id` serves `listEvents()`.

Two triggers make the table append-only: `events_no_update` and `events_no_delete`. An `UPDATE` or a `DELETE` on `events` fails with the error `events are append-only`. This holds for raw SQL too, not only for the store functions. A later cleanup of old events (`retentionDays`) must drop or replace these triggers in a new schema version.

## Schema versions

The array `migrations` in `src/store/migrations.ts` holds one SQL string for each schema version. Version N means that the first N strings ran. SQLite keeps N in `PRAGMA user_version`.

`openStore()` calls `migrate()`. It runs the strings that are missing, in one transaction. If a string fails, the transaction rolls back and the version does not change.

If the file has a version that is higher than the length of `migrations`, `migrate()` stops with this error: `database schema version <found> is newer than this tasker supports (<known>)`. It does not change the file.

To add a version, append a SQL string to `migrations`. Never edit a string that exists, because databases that already ran it do not run it again.

## Writes from more than one process

Two tasker processes can use the same database at once. `openStore()` makes this safe with these settings, in this order:

1. `PRAGMA busy_timeout = 5000`. A process that finds the database locked waits up to 5 seconds before it fails.
2. `PRAGMA journal_mode = WAL`. Readers do not block the writer.
3. `PRAGMA foreign_keys = ON`.

Each write, and each migration, runs through `immediateTransaction()` in `src/store/transaction.ts`. The helper starts `BEGIN IMMEDIATE`, so the transaction takes the write lock at the start. If the function in the transaction throws, the helper rolls back and throws the same error. If the rollback itself fails, the caller still gets the first error. As a result, `updateTask()` reads and writes a row in one step, and another process cannot change the row in between. Two processes that open a new database at the same time do not both run the same migration.

`updateTask()` takes an optional third argument, `check`. The store calls `check` with the current row inside the same transaction, before the write. If `check` throws, the transaction rolls back, the row does not change, and `updateTask()` throws the same error. `transitionTask()` in `src/state/machine.ts` uses `check` to test the edge. As a result, the read and the write of the state happen in one step.
