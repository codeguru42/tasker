# Data root and task store

tasker keeps all of its data under one folder, the `dataRoot` of the configuration. The code is in `src/store/`. No command uses the store yet.

## Folders

`createDataRoot()` makes each folder that is missing. It does not remove or change anything that exists, so a second start on the same `dataRoot` is safe.

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
| `<dataRoot>/artifacts/<issue slug>/attempt-<N>/` | The files of one attempt of a task. `taskArtifactsDir()` gives the path and makes no folder. The issue slug is `pathSlug()` of the issue key. |
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
| `title` | text | Optional. The title of the issue when the task started. |
| `short_ref` | text | Optional. The short ref of the issue key, for example `issue-5`. |
| `base` | text | Optional. The stored form of the base: an origin branch name, or `refs/heads/<x>`. |
| `attempt` | integer | Required. The number of the attempt of the issue. The first attempt is 1. Schema version 4 gives 1 to each older row. |
| `created_at` | text | Required. The time that `createTask()` ran. |
| `updated_at` | text | Required. The time of the last change. |

A task is active when its state is not in `TERMINAL_STATES` (`finished` and `cancelled`). The store allows one active task for each pair of `repo_key` and `issue_key`. These parts keep this rule:

- The partial unique index `tasks_active_repo_issue` covers only the active rows. It holds for raw SQL too.
- `createTask()` throws `ActiveTaskError` when the pair already has an active task. The error has the field `taskId` of that task. A task that starts in a terminal state is not active, so the check does not apply to it.
- The plain index `tasks_repo_issue` on the same two columns stays. It speeds up lookups and enforces no rule.

An issue can have many tasks over time, one for each attempt. `createTask()` sets `attempt` to the highest attempt of the same `issue_key` plus one. The count covers all repos. `updateTask()` cannot change `attempt`.

If a database of version 3 holds two active rows for one pair, the upgrade to version 4 fails and the file stays at version 3.

The store has three functions that read tasks:

- `findActiveTask(repoKey, issueKey)` returns the active task, or `undefined`.
- `findLatestTask(repoKey, issueKey)` returns the active task when one exists. Otherwise it returns the task with the highest `id`, or `undefined` when the issue has no task.
- `listTasks(filter)` returns the tasks that match `repoKey`, `issueKey` and `states`. With no `states`, it returns only the active tasks. An empty `states` array returns no task. The newest `updated_at` comes first, and the higher `id` comes first when the times are equal.

## `events` table

The table is an append-only log. Each event belongs to one task.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer | Primary key. It grows with each event and tasker never reuses it. |
| `task_id` | integer | Required. A foreign key to `tasks(id)`. |
| `at` | text | Required. The time of the event, in ISO 8601 UTC. |
| `type` | text | Required. The kind of event. |
| `data` | text | Optional. JSON text. The value is `NULL` when the event has no data. |

The store writes two kinds of event:

- `created` has the data `{ state }`. `createTask()` writes it in the same transaction as the row.
- `transition` has the data `{ from, to }` and the optional fields of the caller. `transitionTask()` writes it in the same transaction as the state change. See [the code of the state machine](../statemachine.md#code).

The index `events_task_id` on `task_id` and `id` serves `listEvents()`.

Two triggers make the table append-only: `events_no_update` and `events_no_delete`. An `UPDATE` or a `DELETE` on `events` fails with the error `events are append-only`. This holds for raw SQL too, not only for the store functions. A later cleanup of old events (`retentionDays`) must drop or replace these triggers in a new schema version.

## `default_base_branches` table

Schema version 3 adds this table. It holds the learned default base branch of each repo.

| Column | Type | Notes |
| --- | --- | --- |
| `repo_key` | text | Primary key. The repo key in the configuration. |
| `branch` | text | Required. The learned default. It is the name of an origin branch. |
| `updated_at` | text | Required. The time of the last save, in ISO 8601 UTC. |

The store has three functions for the table:

- `getDefaultBaseBranch(repoKey)` returns the branch, or `undefined` when the repo has no row.
- `setDefaultBaseBranch(repoKey, branch)` inserts the row or replaces the branch of the row.
- `forgetDefaultBaseBranch(repoKey, branch)` deletes the row only when its branch equals `branch`. A value that another process saved in the meantime stays.

[workspaces.md](workspaces.md#learned-default) says when tasker writes or deletes the row.

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

`updateTask()` takes an optional third argument, `check`. The store calls `check` with the current row inside the same transaction, before the write. If `check` throws, the transaction rolls back, the row does not change, no event is written, and `updateTask()` throws the same error. `check` can return an event `{ type, data }`. The store appends it in the same transaction as the row write, with the time of `updated_at`. `transitionTask()` in `src/state/machine.ts` uses `check` to test the edge and to return the `transition` event. As a result, the read, the write of the state and the event happen in one step.
