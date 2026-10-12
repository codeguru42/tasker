// Append a new SQL string for each schema version. Never edit an old one.
export const migrations: readonly string[] = [
  `CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  issue_key TEXT NOT NULL,
  repo_key TEXT NOT NULL,
  state TEXT NOT NULL,
  branch TEXT,
  worktree_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX tasks_repo_issue ON tasks (repo_key, issue_key);`,
  `CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT
);
CREATE INDEX events_task_id ON events (task_id, id);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;`,
  `CREATE TABLE default_base_branches (
  repo_key TEXT PRIMARY KEY,
  branch TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
];
